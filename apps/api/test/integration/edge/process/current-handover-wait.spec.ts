// `getCurrentEdgeHandover` avec attente longue (WP10, NFR-007, R-17) : réveil immédiat sur notification, repli à 2 s
// si l'écoute est perdue, bornes de `wait`, handover unique par priorité (A13), battement de cœur, aucune fuite
// d'écouteur, aucun réveil par une autre passerelle.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Agent, request } from 'node:https';
import type { Socket } from 'node:net';
import type { Client } from 'pg';
import { MAX_LONG_WAITS_PER_GATEWAY } from '../../../../src/edge/control/current-handover.service';
import { HandoverListener } from '../../../../src/edge/control/handover-listener';
import { connect, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  edgeGet,
  edgeTls,
  newEvent,
  seedEdgeWorld,
  startEdge,
  type ClientCert,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('getCurrentEdgeHandover : attente longue', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;

  /** Une passerelle inscrite sur l'événement `eventId`, avec son certificat. */
  async function gateway(eventId: string, ledgerId: string) {
    const { edgeCa } = await edgeTls();
    const cert = await edgeCa.issue(`gw-${randomUUID().slice(0, 8)}`);
    const id = await addGateway(owner, world, eventId, { sha256: cert.sha256 });
    return { id, cert, ledgerId };
  }
  const current = (cert: ClientCert, wait?: number | string) =>
    edgeGet(
      edge.port,
      `/edge/handovers/current${wait === undefined ? '' : `?wait=${encodeURIComponent(wait)}`}`,
      {
        client: cert,
      },
    );
  /** Ouvre une bascule vers la passerelle (ligne posée par le propriétaire : la notification part au commit). */
  const grant = (g: { id: string; ledgerId: string }, status = 'GRANTED') =>
    owner.query(
      `INSERT INTO debit_authority_handover
         (operator_id, ledger_id, edge_gateway_id, direction, status, epoch, watermark_posting_id, requested_by)
       VALUES ($1, $2, $3, 'TO_EDGE', $4, 1, 0, $5) RETURNING id`,
      [world.operatorId, g.ledgerId, g.id, status, randomUUID()],
    );

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  it('rien d’ouvert : 200 avec handover null, sans attente', async () => {
    const g = await gateway(world.eventId, world.ledgerId);
    const reply = await current(g.cert);
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      ledger_id: world.ledgerId,
      authority: 'CENTRAL',
      handover: null,
      edge_gateway_id: null,
      edge_base_url: null,
    });
  });

  it.each(['26', '-1', 'abc', '1.5', '100', ' '])(
    'wait=%s : 422 VALIDATION_FAILED',
    async (wait) => {
      const g = await gateway(world.otherEventId, world.otherLedgerId);
      const reply = await current(g.cert, wait);
      expect(reply.status).toBe(422);
      expect(reply.json).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );

  it('wait=0 est admis (borne basse)', async () => {
    const g = await gateway(world.otherEventId, world.otherLedgerId);
    expect((await current(g.cert, 0)).status).toBe(200);
  });

  it('changement posé pendant une attente de 25 s : réponse en moins de 2 s (notification)', async () => {
    const g = await gateway(world.eventId, world.ledgerId);
    const started = Date.now();
    const waiting = current(g.cert, 25);
    await sleep(700);
    const changedAt = Date.now();
    await grant(g);
    const reply = await waiting;
    expect(reply.status).toBe(200);
    expect(reply.json?.handover).toMatchObject({
      direction: 'TO_EDGE',
      state: 'GRANTED',
      epoch: 1,
    });
    // Réveil par NOTIFY : bien avant le repli de 2 s qui suit la mise en attente.
    expect(Date.now() - changedAt).toBeLessThan(1500);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('les deux handovers ouverts : le TO_CENTRAL est rendu (A13)', async () => {
    const fresh = await newEvent(owner, world);
    const g = await gateway(fresh.eventId, fresh.ledgerId);
    const edgeHandover = await grant(g, 'ACTIVE');
    await owner.query(
      `INSERT INTO debit_authority_handover
         (operator_id, ledger_id, edge_gateway_id, direction, status, epoch, edge_handover_id, requested_by)
       VALUES ($1, $2, $3, 'TO_CENTRAL', 'RELEASE_REQUESTED', 1, $4, $5)`,
      [world.operatorId, g.ledgerId, g.id, edgeHandover.rows[0].id, randomUUID()],
    );
    const reply = await current(g.cert);
    expect(reply.json?.handover).toMatchObject({
      direction: 'TO_CENTRAL',
      state: 'RELEASE_REQUESTED',
    });
  });

  it('last_seen_at avance à chaque appel (battement de cœur, entrée et sortie)', async () => {
    const g = await gateway(world.eventId, world.ledgerId);
    const seenAt = async (): Promise<number> => {
      const { rows } = await owner.query<{ at: Date | null }>(
        `SELECT last_seen_at AS at FROM edge_gateway WHERE id = $1`,
        [g.id],
      );
      return rows[0]!.at?.getTime() ?? 0;
    };
    expect(await seenAt()).toBe(0);
    expect((await current(g.cert)).status).toBe(200);
    const first = await seenAt();
    expect(first).toBeGreaterThan(0);
    await sleep(60);
    expect((await current(g.cert)).status).toBe(200);
    expect(await seenAt()).toBeGreaterThan(first);
    // Une attente met à jour à la sortie aussi : après 1,2 s d'attente, la date est postérieure au début de l'appel.
    const before = Date.now() - 1000;
    await current(g.cert, 1);
    expect(await seenAt()).toBeGreaterThan(before + 1000);
  });

  it('la notification d’une AUTRE passerelle ne réveille rien : réponse à l’échéance, état inchangé', async () => {
    const mine = await gateway(world.eventId, world.ledgerId);
    const fresh = await newEvent(owner, world);
    const other = await gateway(fresh.eventId, fresh.ledgerId);
    const waiting = current(mine.cert, 3);
    await sleep(500);
    await grant(other);
    const reply = await waiting;
    expect(reply.status).toBe(200);
    expect(reply.json?.handover).toBeNull();
    expect(reply.elapsedMs).toBeGreaterThanOrEqual(2800);
  });

  it('50 attentes abandonnées par le client : zéro écouteur résiduel', async () => {
    const g = await gateway(world.eventId, world.ledgerId);
    const { tls } = await edgeTls();
    const listener = edge.app.get(HandoverListener, { strict: false });
    const abandon = (): Promise<void> =>
      new Promise((resolve) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: edge.port,
            path: '/v1/edge/handovers/current?wait=25',
            ca: tls.serverCaPem,
            servername: 'localhost',
            cert: g.cert.certPem,
            key: g.cert.keyPem,
          },
          () => undefined,
        );
        req.on('error', () => undefined);
        req.on('close', () => resolve());
        req.end();
        setTimeout(() => req.destroy(), 400 + Math.floor(Math.random() * 400));
      });
    await Promise.all(Array.from({ length: 50 }, abandon));
    const deadline = Date.now() + 5000;
    while (listener.watchers() > 0 && Date.now() < deadline) await sleep(50);
    expect(listener.watchers()).toBe(0);
    // Le processus répond toujours (pas de connexion du pool retenue).
    expect((await current(g.cert)).status).toBe(200);
  }, 30_000);

  it('client qui coupe pendant la garde (avant l’armement) : zéro écouteur résiduel', async () => {
    const g = await gateway(world.eventId, world.ledgerId);
    const { tls } = await edgeTls();
    const listener = edge.app.get(HandoverListener, { strict: false });
    const cutEarly = (delayMs: number): Promise<void> =>
      new Promise((resolve) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: edge.port,
            path: '/v1/edge/handovers/current?wait=25',
            ca: tls.serverCaPem,
            servername: 'localhost',
            cert: g.cert.certPem,
            key: g.cert.keyPem,
          },
          () => undefined,
        );
        req.on('error', () => undefined);
        req.on('close', () => resolve());
        req.on('socket', (socket) =>
          socket.once('secureConnect', () => setTimeout(() => req.destroy(), delayMs)),
        );
        req.end();
      });
    await Promise.all(Array.from({ length: 40 }, (_, i) => cutEarly(i % 5)));
    const deadline = Date.now() + 5000;
    while (listener.watchers() > 0 && Date.now() < deadline) await sleep(50);
    expect(listener.watchers()).toBe(0);
  }, 30_000);

  it('20 requêtes (dont des attentes) sur UNE socket keep-alive : aucun écouteur close ne s’accumule', async () => {
    const g = await gateway(world.eventId, world.ledgerId);
    const { tls } = await edgeTls();
    const server = edge.app.getHttpServer();
    const sockets = new Set<Socket>();
    const track = (socket: Socket): void => void sockets.add(socket);
    server.on('secureConnection', track);
    const warnings: string[] = [];
    const onWarning = (w: Error): void => void warnings.push(w.name);
    process.on('warning', onWarning);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const call = (wait: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: edge.port,
            path: `/v1/edge/handovers/current?wait=${wait}`,
            ca: tls.serverCaPem,
            servername: 'localhost',
            cert: g.cert.certPem,
            key: g.cert.keyPem,
            agent,
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
    try {
      expect(await call(0)).toBe(200);
      expect(sockets.size).toBe(1);
      const [socket] = [...sockets] as [Socket];
      const base = socket.listenerCount('close');
      for (let i = 0; i < 20; i += 1) {
        expect(await call(i % 4 === 0 ? 1 : 0)).toBe(200);
        expect(socket.listenerCount('close')).toBe(base);
      }
      expect(sockets.size).toBe(1); // une seule connexion servie les 21 requêtes
      await sleep(100);
      expect(warnings.filter((n) => n === 'MaxListenersExceededWarning')).toEqual([]);
    } finally {
      process.off('warning', onWarning);
      server.off('secureConnection', track);
      agent.destroy();
    }
  }, 30_000);

  it(`au plus ${MAX_LONG_WAITS_PER_GATEWAY} attentes simultanées par passerelle : la suivante répond tout de suite`, async () => {
    const fresh = await newEvent(owner, world);
    const g = await gateway(fresh.eventId, fresh.ledgerId);
    const other = await newEvent(owner, world);
    const g2 = await gateway(other.eventId, other.ledgerId);
    const listener = edge.app.get(HandoverListener, { strict: false });
    const base = listener.watchers();
    const waiting = Array.from({ length: MAX_LONG_WAITS_PER_GATEWAY }, () => current(g.cert, 25));
    const deadline = Date.now() + 5000;
    while (listener.watchers() < base + MAX_LONG_WAITS_PER_GATEWAY && Date.now() < deadline)
      await sleep(50);
    expect(listener.watchers()).toBe(base + MAX_LONG_WAITS_PER_GATEWAY);
    // Une de plus : état courant tout de suite, même code, sans abonné de plus.
    const over = await current(g.cert, 25);
    expect(over.status).toBe(200);
    expect(over.json).toMatchObject({ handover: null });
    expect(over.elapsedMs).toBeLessThan(1500);
    expect(listener.watchers()).toBe(base + MAX_LONG_WAITS_PER_GATEWAY);
    // Une autre passerelle n'est pas touchée par la borne.
    const waitingOther = current(g2.cert, 1);
    expect(listener.watchers()).toBeGreaterThanOrEqual(base + MAX_LONG_WAITS_PER_GATEWAY);
    await grant(g);
    for (const reply of await Promise.all(waiting)) {
      expect(reply.status).toBe(200);
      expect(reply.json?.handover).toMatchObject({ state: 'GRANTED' });
    }
    expect((await waitingOther).status).toBe(200);
    // Les places sont rendues : une nouvelle attente est de nouveau admise.
    const again = current(g.cert, 2);
    await sleep(300);
    expect(listener.watchers()).toBe(base + 1);
    await again;
  }, 40_000);
});

describe('getCurrentEdgeHandover : repli à 2 s', () => {
  it('écoute détruite : la réponse arrive au plus tard 2 s après le changement', async () => {
    const owner = await connect(OWNER_URL);
    const world = await seedEdgeWorld(owner);
    const edge = await startEdge();
    try {
      const { edgeCa } = await edgeTls();
      const cert = await edgeCa.issue('gw-repli');
      const id = await addGateway(owner, world, world.eventId, { sha256: cert.sha256 });
      // Écoute ouverte puis détruite : il ne reste que le repli.
      const listener = edge.app.get(HandoverListener, { strict: false });
      const warm = edgeGet(edge.port, '/edge/handovers/current?wait=1', { client: cert });
      await warm;
      await listener.halt();
      const waiting = edgeGet(edge.port, '/edge/handovers/current?wait=25', { client: cert });
      await sleep(600);
      const changedAt = Date.now();
      await owner.query(
        `INSERT INTO debit_authority_handover
           (operator_id, ledger_id, edge_gateway_id, direction, status, epoch, watermark_posting_id, requested_by)
         VALUES ($1, $2, $3, 'TO_EDGE', 'GRANTED', 1, 0, $4)`,
        [world.operatorId, world.ledgerId, id, randomUUID()],
      );
      const reply = await waiting;
      const lag = Date.now() - changedAt;
      expect(reply.json?.handover).toMatchObject({ state: 'GRANTED' });
      expect(lag).toBeLessThanOrEqual(2600);
      // Le repli, pas la notification : la réponse n'est pas immédiate.
      expect(lag).toBeGreaterThan(50);
    } finally {
      await edge.close();
      await owner.end();
    }
  });
});
