import 'reflect-metadata';
import { CentralClient } from '../../src/central-client/central-client';
import { CENTRAL_PROBLEM_CODES, CentralError } from '../../src/central-client/central-errors';
import {
  ACK_REFUSAL_MS,
  GatewayClockService,
  type ClockSources,
} from '../../src/clock/gateway-clock';
import { GatewayTx } from '../../src/db/gateway-tx';
import { LINK_ISOLATED_AFTER_MS } from '../../src/authority/control-channel';
import { createTestDb } from '../startup/_support/db';
import { FakeCentral, selfSigned, stateWith, emptyState, handover } from './_support/central';
import {
  appendAckedOps,
  authorityRow,
  forceAuthority,
  makeHarness,
  type Harness,
} from './_support/harness';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => h.close());

const failure = async (promise: Promise<unknown>): Promise<CentralError> =>
  (await promise.then(
    () => {
      throw new Error('succès inattendu');
    },
    (e) => e,
  )) as CentralError;

describe('client du central en mTLS', () => {
  it('présente le certificat client et lit le handover', async () => {
    h.central.script = () => ({ status: 200, body: emptyState(3) });
    const res = await h.client.getCurrentEdgeHandover(0);
    expect(res.body.epoch).toBe(3);
    expect(h.central.requests[0]!.clientCertPresent).toBe(true);
    expect(h.central.requests[0]!.query.get('wait')).toBe('0');
    expect(h.central.requests[0]!.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it(
    'autorité du central épinglée : un certificat différent ' +
      'est refusé, aucune requête n’aboutit',
    async () => {
      const other = await FakeCentral.start(await selfSigned('faux-central'));
      try {
        await h.db.pool.query('ALTER TABLE edge_meta DISABLE TRIGGER edge_meta_guard');
        await h.db.pool.query('UPDATE edge_meta SET central_url = $1', [other.url]);
        const fresh = new CentralClient(h.config, h.tx, h.clock);
        const error = await failure(fresh.getCurrentEdgeHandover(0));
        expect(error.code).toBe('PINNING_FAILED');
        expect(other.requests).toHaveLength(0);
        expect(h.clock.observed).toHaveLength(0);
      } finally {
        await other.stop();
      }
    },
  );

  it(
    'l’en-tête Date de chaque réponse (succès ou erreur ' + 'HTTP) est donné à observeCentral',
    async () => {
      h.central.script = () => ({
        status: 200,
        body: emptyState(),
        headers: { Date: 'Fri, 06 Nov 2026 12:34:56 GMT' },
      });
      const res = await h.client.getCurrentEdgeHandover(0);
      expect(res.centralDate?.toISOString()).toBe('2026-11-06T12:34:56.000Z');
      expect(h.clock.observed.map((d) => d.toISOString())).toEqual(['2026-11-06T12:34:56.000Z']);
      h.central.script = () => ({
        status: 409,
        body: { code: 'HANDOVER_INVALID_STATE' },
        headers: { Date: 'Fri, 06 Nov 2026 12:35:00 GMT' },
      });
      await failure(h.client.ackEdgeHandover('h', { epoch: 1, replicated_posting_id: 1 }));
      expect(h.clock.observed).toHaveLength(2);
    },
  );

  it(
    'pas de nouvelle tentative implicite d’un POST ' + '(connexion coupée : une seule requête)',
    async () => {
      h.central.script = () => ({ destroy: true });
      const error = await failure(
        h.client.releaseEdgeHandover('h', {
          epoch: 1,
          final_edge_seq: 1,
          last_chain_hash: 'ab',
          operations_count: 1,
        }),
      );
      expect(error.code).toBe('NETWORK');
      expect(error.isLinkFailure).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(h.central.requests).toHaveLength(1);
    },
  );

  it('une attente longue est annulable (AbortSignal)', async () => {
    h.central.script = () => ({ hold: true });
    const controller = new AbortController();
    const pending = failure(h.client.getCurrentEdgeHandover(25, { signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    controller.abort();
    expect((await pending).code).toBe('ABORTED');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(
      (await failure(h.client.getCurrentEdgeHandover(0, { signal: controller.signal }))).code,
    ).toBe('ABORTED');
  });

  it('délai dépassé : TIMEOUT', async () => {
    h.central.script = () => ({ hold: true });
    expect((await failure(h.client.getCurrentEdgeHandover(0, { timeoutMs: 200 }))).code).toBe(
      'TIMEOUT',
    );
  });

  it('réponse tronquée : jamais prise pour un succès', async () => {
    h.central.script = () => ({ truncate: true });
    expect((await failure(h.client.getCurrentEdgeHandover(0))).code).toBe('TRUNCATED_RESPONSE');
  });

  it('chaque code du contrat devient son erreur typée (avec les champs utiles)', async () => {
    for (const code of CENTRAL_PROBLEM_CODES) {
      h.central.script = () => ({
        status: code === 'BATCH_SIGNATURE_INVALID' ? 400 : code === 'BATCH_TOO_LARGE' ? 413 : 409,
        body: { code, missing_edge_seqs: [4, 5], authority_epoch: 9 },
      });
      const error = await failure(h.client.submitEdgeSyncBatch('b', { batch_id: 'b' }));
      expect(error.code).toBe(code);
      expect(error.details.missingEdgeSeqs).toEqual([4, 5]);
      expect(error.details.authorityEpoch).toBe(9);
    }
    expect(h.central.requests.at(-1)!.headers['idempotency-key']).toBe('b');
  });

  it(
    '401 et 403 : certificat refusé (révocation) ; un ' + 'code inconnu n’est jamais un succès',
    async () => {
      for (const status of [401, 403]) {
        h.central.script = () => ({ status, body: { code: 'UNAUTHENTICATED' } });
        const error = await failure(h.client.getCurrentEdgeHandover(0));
        expect(error.code).toBe('CERTIFICATE_REJECTED');
        expect(error.isCertificateRejected).toBe(true);
      }
      for (const reply of [
        { status: 409, body: { code: 'CODE_NOUVEAU' } },
        { status: 500, body: 'pas un problème' },
        { status: 302, body: {} },
        { status: 202, body: {} },
      ]) {
        h.central.script = () => reply;
        expect((await failure(h.client.getCurrentEdgeHandover(0))).code).toMatch(
          /UNKNOWN_CENTRAL_ERROR|MALFORMED_RESPONSE/,
        );
      }
    },
  );

  it('http en clair refusé, jamais de repli', async () => {
    await h.db.pool.query('ALTER TABLE edge_meta DISABLE TRIGGER edge_meta_guard');
    await h.db.pool.query(`UPDATE edge_meta SET central_url = 'http://127.0.0.1:9'`);
    const fresh = new CentralClient(h.config, h.tx, h.clock);
    expect((await failure(fresh.getCurrentEdgeHandover(0))).message).toMatch(/https obligatoire/);
  });
});

describe('borne de observeCentral (horloge)', () => {
  const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
  class Sources implements ClockSources {
    constructor(public system: number) {}
    mono = 0n;
    systemNow(): number {
      return this.system;
    }
    monotonicNow(): bigint {
      return this.mono;
    }
  }

  it('une date centrale très lointaine ne fige pas time_floor ; l’accusé est refusé', async () => {
    const db = await createTestDb();
    try {
      const clock = new GatewayClockService(new GatewayTx(db.pool), new Sources(T0));
      await clock.start();
      const before = clock.now().getTime();
      const floorBefore = (await db.pool.query('SELECT time_floor FROM edge_clock')).rows[0]
        .time_floor;
      await clock.observeCentral(new Date(T0 + 3650 * 86_400_000)); // dix ans plus tard
      expect(clock.refusesAck()).toBe(true);
      expect(clock.now().getTime()).toBe(before);
      const row = (await db.pool.query('SELECT time_floor, ack_refused FROM edge_clock')).rows[0];
      expect(row.ack_refused).toBe(true);
      expect(new Date(row.time_floor).getTime()).toBeLessThanOrEqual(T0);
      expect(row.time_floor).toEqual(floorBefore);
      // Une mesure cohérente suivante est adoptée et lève le refus.
      await clock.observeCentral(new Date(T0 + 60_000));
      expect(clock.refusesAck()).toBe(false);
      expect(clock.now().getTime()).toBe(T0 + 60_000);
      // 25 h en arrière : refusée aussi, l'heure servie ne recule pas.
      await clock.observeCentral(new Date(T0 + 60_000 - 25 * 3_600_000));
      expect(clock.refusesAck()).toBe(true);
      expect(clock.now().getTime()).toBe(T0 + 60_000);
      expect(ACK_REFUSAL_MS).toBe(24 * 3_600_000);
      const audit = await db.pool.query(
        `SELECT count(*) FROM edge_audit WHERE kind = 'CLOCK_CENTRAL_OUT_OF_BOUNDS'`,
      );
      expect(Number(audit.rows[0].count)).toBe(2);
    } finally {
      await db.drop();
    }
  });
});

describe('canal de contrôle', () => {
  it(
    'relance l’attente longue aussitôt (wait=25), sans ' + 'pause entre deux passes réussies',
    async () => {
      let seen = 0;
      h.central.script = () => {
        seen += 1;
        return { status: 200, body: emptyState() };
      };
      h.channel.start();
      await new Promise((r) => setTimeout(r, 600));
      await h.channel.stop();
      expect(seen).toBeGreaterThan(5); // des dizaines de passes en 600 ms : aucun sleep de sondage
      expect(
        h.central.requests.every(
          (r) => r.query.get('wait') === '25' || r.query.get('wait') === '0',
        ),
      ).toBe(true);
      expect(h.central.requests[0]!.query.get('wait')).toBe('25');
    },
  );

  it(
    'un changement de handover est vu et persisté par la ' + 'boucle ; wake() interrompt l’attente',
    async () => {
      let step = 0;
      h.central.script = () => {
        step += 1;
        return step === 1
          ? { hold: true }
          : { status: 200, body: stateWith(handover({}), 'EDGE', 5) };
      };
      h.channel.start();
      await new Promise((r) => setTimeout(r, 200));
      h.channel.wake();
      await new Promise((r) => setTimeout(r, 500));
      await h.channel.stop();
      expect((await authorityRow(h.db)).state).toBe('GRANTED_PENDING');
    },
  );

  it(
    'lien : ISOLATED après 25 s sans échange réussi, ' + 'CATCHING_UP/CONNECTED au retour',
    async () => {
      let clockMs = 0;
      h.channel.timeSource = () => clockMs;
      await forceAuthority(h.db, {
        state: 'ACTIVE',
        epoch: 5,
        highest_epoch_seen: 5,
        link_state: 'CONNECTED',
      });
      h.central.script = () => ({
        status: 200,
        body: stateWith(handover({ state: 'ACTIVE' }), 'EDGE', 5),
      });
      await h.channel.runOnce(0); // dernier échange réussi à t = 0
      h.central.script = () => ({ destroy: true });
      const failing = (): Promise<void> =>
        h.channel
          .runOnce(0)
          .catch(async (e) =>
            (h.channel as never as { onFailure(e: unknown): Promise<void> }).onFailure(e),
          );
      await failing();
      expect((await authorityRow(h.db)).link_state).toBe('CONNECTED'); // moins de 25 s
      clockMs = LINK_ISOLATED_AFTER_MS + 1;
      await failing();
      expect((await authorityRow(h.db)).link_state).toBe('ISOLATED');
      // Retour du lien, file non vide : CATCHING_UP ; vide : CONNECTED.
      await appendAckedOps(h.db, 1, false);
      h.central.script = () => ({
        status: 200,
        body: stateWith(handover({ state: 'ACTIVE' }), 'EDGE', 5),
      });
      await h.channel.runOnce(0);
      expect((await authorityRow(h.db)).link_state).toBe('CATCHING_UP');
      await h.db.pool.query(
        `UPDATE edge_chain_head SET acked_edge_seq = 1, acked_chain_hash = last_chain_hash`,
      );
      await h.channel.runOnce(0);
      expect((await authorityRow(h.db)).link_state).toBe('CONNECTED');
    },
  );

  it('certificat refusé (401) : REVOKED persistant depuis ACTIVE, la boucle s’arrête', async () => {
    await forceAuthority(h.db, { state: 'ACTIVE', epoch: 5, highest_epoch_seen: 5 });
    h.central.script = () => ({ status: 401, body: { code: 'UNAUTHENTICATED' } });
    h.channel.start();
    await new Promise((r) => setTimeout(r, 500));
    await h.channel.stop();
    expect((await authorityRow(h.db)).state).toBe('REVOKED');
    const count = h.central.requests.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(h.central.requests.length).toBe(count);
  });

  it(
    'erreur réseau : attente bornée croissante ' + '(plafond 5 s), reprise sans état perdu',
    async () => {
      h.central.script = () => ({ destroy: true });
      h.channel.start();
      await new Promise((r) => setTimeout(r, 900));
      // 250 ms puis 500 ms : 3 tentatives environ en 900 ms, pas une boucle chaude.
      expect(h.central.requests.length).toBeLessThanOrEqual(4);
      h.central.script = () => ({ status: 200, body: stateWith(handover({}), 'EDGE', 5) });
      await new Promise((r) => setTimeout(r, 1500));
      await h.channel.stop();
      expect((await authorityRow(h.db)).state).toBe('GRANTED_PENDING');
    },
  );
});
