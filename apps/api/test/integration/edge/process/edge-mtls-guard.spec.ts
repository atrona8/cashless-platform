// Garde `edgeMtls` du processus `edge` (WP10, R-04) : chaîne TLS contre l'autorité des passerelles seule, empreinte
// relue en base à chaque requête (révocation immédiate, aucun cache), réponse identique pour tous les refus, aucune
// identité prise dans la requête. Cas « mauvais » pour chaque contrôle : neutraliser la garde les fait passer au vert,
// donc le test au rouge.
import 'reflect-metadata';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { request } from 'node:https';
import type { Client } from 'pg';
import { edgeTlsServerOptions, tlsServerOptions } from '../../../../src/processes/bootstrap';
import { connect, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  edgeGet,
  edgeTls,
  seedEdgeWorld,
  startEdge,
  type ClientCert,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';

const CURRENT = '/edge/handovers/current';

/** Corps d'un refus sans le champ propre à la requête. */
const sameBody = (body: Record<string, unknown> | null): Record<string, unknown> => {
  const { instance: _instance, ...rest } = body ?? {};
  return rest;
};

describe('garde edgeMtls du processus edge', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;
  let gatewayId: string;
  let cert: ClientCert;

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    const { edgeCa } = await edgeTls();
    cert = await edgeCa.issue('gw-ok');
    gatewayId = await addGateway(owner, world, world.eventId, { sha256: cert.sha256 });
    edge = await startEdge();
  });

  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  it('certificat de la CA des passerelles inscrit : 200, état de SON grand livre', async () => {
    const reply = await edgeGet(edge.port, CURRENT, { client: cert });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ ledger_id: world.ledgerId, handover: null });
  });

  it('sans certificat : 401 UNAUTHENTICATED', async () => {
    const reply = await edgeGet(edge.port, CURRENT);
    expect(reply.status).toBe(401);
    expect(reply.json).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('empreinte inconnue (certificat valide de la bonne autorité, non inscrit) : 401', async () => {
    const { edgeCa } = await edgeTls();
    const stranger = await edgeCa.issue('gw-inconnue');
    expect((await edgeGet(edge.port, CURRENT, { client: stranger })).status).toBe(401);
  });

  it('certificat expiré de la bonne autorité, empreinte inscrite : 401 (chaîne TLS, pas la base)', async () => {
    const { edgeCa } = await edgeTls();
    const expired = await edgeCa.issue('gw-expiree', { expired: true });
    await addGateway(owner, world, world.otherEventId, { sha256: expired.sha256 });
    expect((await edgeGet(edge.port, CURRENT, { client: expired })).status).toBe(401);
  });

  it('certificat de la CA des terminaux, même inscrit par erreur : 401 (la chaîne TLS l’arrête)', async () => {
    const { deviceCa } = await edgeTls();
    const terminal = await deviceCa.issue('terminal-enrole');
    const wrongly = await addGateway(owner, world, world.otherEventId, { sha256: terminal.sha256 });
    expect(wrongly).toBeTruthy();
    const reply = await edgeGet(edge.port, CURRENT, { client: terminal });
    expect(reply.status).toBe(401);
    // Contrôle positif : la base, elle, reconnaîtrait cette empreinte (l'écart est bien celui de la chaîne).
    const known = await owner.query(`SELECT 1 FROM identify_edge_gateway($1)`, [terminal.sha256]);
    expect(known.rowCount).toBe(1);
  });

  it('passerelle révoquée entre deux requêtes : la seconde est 401 (aucun cache)', async () => {
    const { edgeCa } = await edgeTls();
    const mine = await edgeCa.issue('gw-revoquee');
    const id = await addGateway(owner, world, world.otherEventId, { sha256: mine.sha256 });
    expect((await edgeGet(edge.port, CURRENT, { client: mine })).status).toBe(200);
    await owner.query(`SELECT revoke_edge_gateway($1, 'test', 'test')`, [id]);
    const after = await edgeGet(edge.port, CURRENT, { client: mine });
    expect(after.status).toBe(401);
    expect(after.json).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('les refus (sans certificat, inconnu, révoqué, autre autorité) ont le même corps', async () => {
    const { edgeCa, deviceCa } = await edgeTls();
    const revoked = await edgeCa.issue('gw-revoquee-2');
    const id = await addGateway(owner, world, world.otherEventId, { sha256: revoked.sha256 });
    await owner.query(`SELECT revoke_edge_gateway($1, 'test', 'test')`, [id]);
    const replies = await Promise.all([
      edgeGet(edge.port, CURRENT),
      edgeGet(edge.port, CURRENT, { client: await edgeCa.issue('gw-jamais-vue') }),
      edgeGet(edge.port, CURRENT, { client: revoked }),
      edgeGet(edge.port, CURRENT, { client: await deviceCa.issue('terminal') }),
    ]);
    for (const reply of replies) expect(reply.status).toBe(401);
    const [first, ...others] = replies.map((reply) => sameBody(reply.json));
    for (const other of others) expect(other).toEqual(first);
  });

  it('une passerelle STANDBY passe la garde (elle surveille)', async () => {
    const { edgeCa } = await edgeTls();
    const standby = await edgeCa.issue('gw-standby');
    await addGateway(owner, world, world.otherEventId, { sha256: standby.sha256, role: 'STANDBY' });
    expect((await edgeGet(edge.port, CURRENT, { client: standby })).status).toBe(200);
  });

  it('X-Gateway-Id, X-Operator-Id et X-Forwarded-For ne changent jamais l’identité', async () => {
    const { edgeCa } = await edgeTls();
    const other = await edgeCa.issue('gw-autre');
    const otherId = await addGateway(owner, world, world.otherEventId, { sha256: other.sha256 });
    const reply = await edgeGet(edge.port, CURRENT, {
      client: cert,
      headers: {
        'X-Gateway-Id': otherId,
        'X-Operator-Id': world.otherOperatorId,
        'X-Forwarded-For': '10.0.0.9',
      },
    });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ ledger_id: world.ledgerId });
    const seen = await owner.query<{ id: string; at: Date | null }>(
      `SELECT id, last_seen_at AS at FROM edge_gateway WHERE id = ANY($1)`,
      [[gatewayId, otherId]],
    );
    const lastSeen = Object.fromEntries(seen.rows.map((row) => [row.id, row.at]));
    expect(lastSeen[gatewayId]).not.toBeNull();
    expect(lastSeen[otherId]).toBeNull();
  });

  describe('deux autorités ne se mélangent jamais sur un écouteur', () => {
    /** Serveur HTTPS réel construit avec `options` : rend `socket.authorized` vu pour le certificat présenté. */
    async function authorized(
      options: ReturnType<typeof tlsServerOptions>,
      client: ClientCert,
    ): Promise<boolean> {
      const { tls } = await edgeTls();
      const server: Server = createServer(options!, (req, res) => {
        res.end(
          JSON.stringify({ authorized: (req.socket as { authorized?: boolean }).authorized }),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = server.address() as AddressInfo;
        return await new Promise<boolean>((resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port,
              path: '/',
              ca: tls.serverCaPem,
              servername: 'localhost',
              cert: client.certPem,
              key: client.keyPem,
            },
            (res) => {
              let body = '';
              res.on('data', (chunk: Buffer) => (body += chunk.toString()));
              res.on('end', () =>
                resolve((JSON.parse(body) as { authorized: boolean }).authorized),
              );
            },
          );
          req.on('error', reject);
          req.end();
        });
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }

    it('écouteur edge : l’autorité des passerelles passe, celle des terminaux non', async () => {
      const { edgeCa, deviceCa, tls, edgeCaCertFile } = await edgeTls();
      const options = edgeTlsServerOptions({
        production: false,
        edgeTlsCertFile: tls.tlsCertFile,
        edgeTlsKeyFile: tls.tlsKeyFile,
        edgeCaCertFile,
      });
      expect(options?.ca?.toString()).toBe(edgeCa.certPem);
      expect(await authorized(options, await edgeCa.issue('g'))).toBe(true);
      expect(await authorized(options, await deviceCa.issue('t'))).toBe(false);
    });

    it('écouteur public (inchangé) : `ca` = autorité des terminaux seule ; un certificat de passerelle est refusé', async () => {
      const { edgeCa, deviceCa, tls } = await edgeTls();
      const options = tlsServerOptions({
        tlsCertFile: tls.tlsCertFile,
        tlsKeyFile: tls.tlsKeyFile,
        deviceCaCertFile: tls.deviceCaCertFile,
      });
      expect(options?.ca?.toString()).toBe(tls.deviceCaCertPem);
      expect(options?.minVersion).toBe('TLSv1.3');
      expect(await authorized(options, await deviceCa.issue('t'))).toBe(true);
      expect(await authorized(options, await edgeCa.issue('g'))).toBe(false);
    });

    it('l’écouteur edge refuse tout réglage qui élargirait `ca` : une seule autorité, TLS 1.3', async () => {
      const { tls, edgeCaCertFile } = await edgeTls();
      const options = edgeTlsServerOptions({
        production: true,
        edgeTlsCertFile: tls.tlsCertFile,
        edgeTlsKeyFile: tls.tlsKeyFile,
        edgeCaCertFile,
      });
      expect(options?.requestCert).toBe(true);
      expect(options?.rejectUnauthorized).toBe(false);
      expect(options?.minVersion).toBe('TLSv1.3');
      expect(String(options?.ca).match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
    });
  });
});
