// Tests de borne de la mission hors-ligne-snapshots-lots (lot WP21, part E ; règle 3 de CLAUDE.md :
// un test qui
// échoue si une limite acceptée s'élargit). Un `describe` par point : OP-N95(1), (3), (4) ;
// OP-N93(a), (c) ;
// OP-N94(1), (3) ; FR-018 (`VOID_CONFLICT`) ; réponses 403/404 des routes de la mission (existence
// d'un objet).
// Chaque cas FIGE l'état actuel : si la limite est levée (mission 12b ou 13), le cas échoue et doit
// être réécrit en
// même temps que la fiche OP concernée.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { APP_CONFIG } from '../../../src/config/config';
import { TenantTx } from '../../../src/db/tenant-tx';
import { MaintenanceDbModule } from '../../../src/db/maintenance-db.module';
import { assertMaintenanceRole } from '../../../src/db/maintenance-role-guard';
import { deviceKey } from '../../../src/idempotency/device-key';
import { FakeKms } from '../../../src/kms/fake-kms';
import { ApprovalService, type ApprovalActor } from '../../../src/approval/approval.service';
import type { Principal } from '../../../src/identity/principal';
import { deviceBodyGate, gatedBody, staffBodyGate } from '../../../src/offline/batches/body-gate';
import { SaleReversalActions } from '../../../src/reversals/sale-reversal-action';
import { APP_URL, MAINT_URL, OWNER_URL, withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import {
  addBracelet,
  addTerminal,
  createFixture,
  dekPlaintext,
  makeWorkers,
  newTerminal,
  publishReady,
} from '../../support/snapshot-secrets-db';
import { send } from '../../support/test-terminal';
import { JournalWorld } from '../offline/journal-world';
import { ReversalWorld } from '../reversals/reversal-fixtures';

jest.setTimeout(300_000);

// ---------- OP-N95 (3)
describe('OP-N95(3) : DATABASE_URL_MAINT refusé en production s’il n’est pas cashless_maint', () => {
  const pools: Pool[] = [];
  const pool = (url: string) => {
    const created = new Pool({ connectionString: url, max: 1 });
    pools.push(created);
    return created;
  };
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  it('production + propriétaire de la base (superutilisateur local) : refus nommé', async () => {
    await expect(assertMaintenanceRole(pool(OWNER_URL), true)).rejects.toThrow(
      /DATABASE_URL_MAINT refusé en production.*(superutilisateur|propriétaire)/,
    );
  });

  it('production + rôle applicatif (ni propriétaire ni membre de cashless_maint) : refus', async () => {
    await expect(assertMaintenanceRole(pool(APP_URL), true)).rejects.toThrow(
      /n’est pas membre de cashless_maint/,
    );
  });

  it('production + cashless_maint : démarre', async () => {
    await expect(assertMaintenanceRole(pool(MAINT_URL), true)).resolves.toBeUndefined();
  });

  it('hors production : aucun contrôle (poste local), même avec le propriétaire', async () => {
    await expect(assertMaintenanceRole(pool(OWNER_URL), false)).resolves.toBeUndefined();
  });

  // Le module réel : la fabrique du pool applique le contrôle avec `config.production`.
  const build = (url: string, production: boolean) =>
    Test.createTestingModule({ imports: [MaintenanceDbModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ production, maintenanceDatabaseUrl: url, poolSize: 1 })
      .compile();

  it('MaintenanceDbModule : production + propriétaire ne compile pas ; production + cashless_maint compile', async () => {
    await expect(build(OWNER_URL, true)).rejects.toThrow(/OP-N95/);
    const ok = await build(MAINT_URL, true);
    expect(ok.get(TenantTx)).toBeDefined();
    await ok.close();
  });
});

// ---------- monde partagé
describe('bornes OP-N95(1)(4), OP-N94(1)(3), FR-018 et réponses 403/404 (WP21 part E)', () => {
  let jw: JournalWorld;
  beforeAll(async () => {
    jw = await JournalWorld.create();
  });
  afterAll(async () => {
    await jw?.close();
  });

  // ---------- OP-N95 (1)
  describe('OP-N95(1) : corps de plus de 100 ko hors lots et import', () => {
    it('refusé, jamais traité, aucune écriture ; le statut est 500 et non 413 (limite connue)', async () => {
      const t = await jw.pw.terminal();
      const target = t.t.deviceId;
      const count = () =>
        ownerRows<{ n: number }>(
          'SELECT count(*)::int AS n FROM approval_request WHERE target_id = $1',
          [target],
        ).then((r) => r[0]!.n);
      const before = await count();
      const big = JSON.stringify({ reason: 'x'.repeat(150_000) });
      expect(big.length).toBeGreaterThan(100 * 1024);
      const res = await jw.bo('POST', `/devices/${target}/seq-gaps/1/waive`, jw.sup1, big);
      expect(res.status).toBeGreaterThanOrEqual(400);
      // Limite acceptée (OP-N95(1)) : 500 au lieu de 413. Corrigé, ce cas passe à 413 et la fiche
      // est levée.
      expect(res.status).toBe(500);
      expect(await count()).toBe(before);
      // Le même appel sous la limite est traité (le refus vient bien de la taille).
      const small = await jw.bo('POST', `/devices/${target}/seq-gaps/1/waive`, jw.sup1, {
        reason: 'motif assez long',
      });
      expect(small.status).not.toBe(500);
    });
  });

  // ---------- OP-N95 (4)
  describe('OP-N95(4) : gatedBody sans preAuthenticate', () => {
    const run = (gate: Parameters<typeof gatedBody>[2]) => {
      let read = 0;
      let next = 0;
      const req = { headers: { 'content-type': 'application/json' }, body: undefined } as never;
      gatedBody(
        (_req, _res, done) => {
          read += 1;
          done();
        },
        () => true,
        gate,
      )(req, {} as never, () => {
        next += 1;
      });
      return new Promise<{ read: number; next: number }>((resolve) =>
        setImmediate(() => resolve({ read, next })),
      );
    };

    it('sans filtre, le corps est lu sans contrôle d’identité (limite figée)', async () => {
      expect(await run(undefined)).toEqual({ read: 1, next: 1 });
    });

    it('avec un filtre qui refuse, le corps n’est pas lu ; avec un filtre qui admet, il l’est', async () => {
      expect(await run(async () => false)).toMatchObject({ read: 0, next: 1 });
      expect(await run(async () => true)).toMatchObject({ read: 1 });
    });

    it('configuration réelle : le filtre des terminaux et celui des personnes sont présents', () => {
      const app = jw.api.app;
      expect(deviceBodyGate(app)).toBeInstanceOf(Function);
      expect(staffBodyGate(app, ['SUPERVISOR'])).toBeInstanceOf(Function);
    });
  });

  // ---------- OP-N94 (1)
  describe('OP-N94(1) : vente hors catalogue écrite sans lignes', () => {
    it('lignes hors catalogue : vente ACCEPTED, metadata.lines_status CATALOG_MISMATCH, aucune ligne', async () => {
      const t = await jw.pw.terminal();
      const media = await jw.pw.pw.media(1, 20_000);
      const version = await jw.pw.snapshot(t, media);
      const res = await jw.pw.submit(t, [
        jw.pw.sale(t, media[0]!, 1000, version, {
          lines: [{ product_id: randomUUID(), quantity: 1, unit_price: 1000 }],
        }),
      ]);
      const [r] = jw.pw.results(res);
      expect(r).toMatchObject({ status: 'ACCEPTED' });
      const [tx] = await jw.pw.txRows(t.t.deviceId);
      expect(tx!.metadata).toMatchObject({ lines_status: 'CATALOG_MISMATCH' });
      const lines = await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM sale_line WHERE transaction_id = $1',
        [tx!.id],
      );
      expect(lines[0]!.n).toBe(0);
    });
  });

  // ---------- OP-N94 (3)
  describe('OP-N94(3) : annulation du back-office sans reduce_offline_shortfall', () => {
    it('vente hors ligne avec manque, annulée au back-office : soldes rendus, anomalie inchangée (3000, OPEN)', async () => {
      const t = await jw.pw.terminal();
      const media = await jw.pw.pw.media(1, 6000);
      const version = await jw.pw.snapshot(t, media);
      const [r] = jw.pw.results(await jw.pw.submit(t, [jw.pw.sale(t, media[0]!, 9000, version)]));
      expect(r).toMatchObject({ status: 'ACCEPTED_WITH_SHORTFALL', shortfall_amount: 3000 });
      const [sale] = await jw.pw.txRows(t.t.deviceId);

      const rw = new ReversalWorld(jw.pw.pw);
      const first = await rw.person('SUPERVISOR');
      const second = await rw.person('SUPERVISOR');
      const app = jw.api.app;
      const tx = app.get(TenantTx, { strict: false });
      const actions = app.get(SaleReversalActions, { strict: false });
      const approvals = app.get(ApprovalService, { strict: false });
      const operatorId = jw.pw.operatorId;
      const actor = (p: TestPerson): ApprovalActor => ({
        principal: {
          userId: p.userId,
          operatorId,
          issuer: 'test',
          subject: p.subject,
          assignments: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: jw.w.ids.eventA }],
        } as unknown as Principal,
        audit: { actorId: p.userId, actorRole: null, origin: null, requestId: null },
      });
      const asked = await tx.run(operatorId, (client) =>
        actions.request(
          client,
          operatorId,
          { transactionId: sale!.id, reason: 'CUSTOMER_CANCELLED', comment: 'Client parti' },
          actor(first),
        ),
      );
      const done = await tx.run(operatorId, (client) =>
        approvals.approve(client, operatorId, asked.approval_request_id, null, actor(second)),
      );
      expect(done.status).toBe('EXECUTED');
      const reversals = await ownerRows<{ id: string; source: string }>(
        'SELECT id, source FROM journal_transaction WHERE reverses_id = $1',
        [sale!.id],
      );
      expect(reversals).toEqual([{ id: reversals[0]!.id, source: 'BACKOFFICE' }]);
      // Limite acceptée : la perte hors ligne reste surestimée (aucune réduction par ce chemin).
      const anomalies = await jw.pw.anomalies(t.t.deviceId, 'OFFLINE_SHORTFALL');
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]).toMatchObject({ amount: '3000', status: 'OPEN' });
      const detail = await ownerRows<{ detail: { reductions?: unknown[] } | null }>(
        'SELECT detail FROM anomaly WHERE id = $1',
        [anomalies[0]!.id],
      );
      expect(detail[0]!.detail?.reductions ?? []).toEqual([]);
    });
  });

  // ---------- FR-018
  describe('FR-018 : VOID dont la clé est déjà au journal', () => {
    it('anomalie VOID_CONFLICT ouverte, citant la transaction en ligne ; aucune seconde écriture', async () => {
      const t = await jw.pw.terminal();
      const media = await jw.pw.pw.media(1, 20_000);
      const version = await jw.pw.snapshot(t, media);
      // Lot 1 : une vente (numéro 1). L'annulation EN LIGNE prend ensuite la clé du numéro 2.
      jw.pw.results(await jw.pw.submit(t, [jw.pw.sale(t, media[0]!, 5000, version)]));
      const [sale] = await jw.pw.txRows(t.t.deviceId);
      t.t.nextSeq = 50;
      const rw = new ReversalWorld(jw.pw.pw);
      const online = await rw.reverse(t, sale!.id, { key: deviceKey(t.t.serial, 2n) });
      expect(online.status).toBe(201);
      const onlineTx = String(online.body.transaction_id);
      // La branche ne s'atteint que si la clé est au journal SANS ligne de registre (écriture de la
      // passerelle) :
      // avec une ligne, le lot est rejeté plus tôt (`IDEMPOTENCY_KEY_REUSED`, anomalie
      // `IDEMPOTENCY_CONFLICT`).
      await withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        const gone = await db.query(
          'DELETE FROM device_seq_registry WHERE device_id = $1 AND seq = 2',
          [t.t.deviceId],
        );
        expect(gone.rowCount).toBe(1);
        await db.query('COMMIT');
      });
      const before = (await jw.pw.txRows(t.t.deviceId)).length;
      // Lot 2 : un VOID au numéro 2.
      const now = new Date().toISOString();
      const res = await jw.pw.submit(t, [
        { type: 'VOID', occurred_at: now, void_reason: 'ABORTED_BY_OPERATOR' },
      ]);
      const [r] = jw.pw.results(res);
      expect(r).toMatchObject({ seq: 2, status: 'DUPLICATE', transaction_id: onlineTx });
      const conflicts = await jw.pw.anomalies(t.t.deviceId, 'VOID_CONFLICT');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({ seq: '2', transaction_id: onlineTx, status: 'OPEN' });
      expect((await jw.pw.txRows(t.t.deviceId)).length).toBe(before);
    });
  });

  // ---------- 403 / 404
  describe('réponses 403/404 : existence d’un objet d’un autre prestataire', () => {
    let adminB: TestPerson; // ORGANIZER_ADMIN d'un autre prestataire
    let supervisorA2: TestPerson; // SUPERVISOR d'un autre organisateur du MÊME prestataire
    let adminA2: TestPerson;
    let deviceId: string;
    let eventId: string;
    let organizerId: string;
    let importBodies: unknown[];
    const unknown = randomUUID();

    beforeAll(async () => {
      const { w } = jw.pw.pw;
      const otherOrganizer = randomUUID();
      await withOwner(async (db) => {
        await db.query(
          `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
           VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
          [otherOrganizer, w.ops.a],
        );
        const person = (operatorId: string, role: 'SUPERVISOR' | 'ORGANIZER_ADMIN', id: string) =>
          w.idp.createPerson(db, {
            operatorId,
            roles: [{ role, scopeType: 'ORGANIZER', scopeId: id }],
          });
        adminB = await person(w.ops.b, 'ORGANIZER_ADMIN', w.ids.organizerB);
        supervisorA2 = await person(w.ops.a, 'SUPERVISOR', otherOrganizer);
        adminA2 = await person(w.ops.a, 'ORGANIZER_ADMIN', otherOrganizer);
      });
      const seller = await jw.seller(1);
      deviceId = seller.t.t.deviceId;
      eventId = w.ids.eventA;
      organizerId = w.ids.organizerA;
      importBodies = jw
        .exportBatches(seller.t, [[jw.sale(seller.t, seller.media[0]!, 1000, seller.version)]])
        .map((b) => b.body);
    });

    interface Probe {
      route: string;
      method: 'GET' | 'POST' | 'PUT';
      path: (id: string) => string;
      kind: 'device' | 'event' | 'organizer';
      body?: unknown;
    }
    const REASON = 'Motif suffisamment long';
    const probes = (): Probe[] => [
      {
        route: 'waiveSeqGap',
        method: 'POST',
        kind: 'device',
        path: (id) => `/devices/${id}/seq-gaps/1/waive`,
        body: { reason: REASON },
      },
      {
        route: 'importDeviceJournal',
        method: 'POST',
        kind: 'device',
        path: (id) => `/devices/${id}/journal-imports`,
        body: { batches: importBodies, reason: REASON },
      },
      {
        route: 'getDeviceJournalImport',
        method: 'GET',
        kind: 'device',
        path: (id) => `/devices/${id}/journal-imports/${unknown}`,
      },
      {
        route: 'getDeviceOfflinePolicy',
        method: 'GET',
        kind: 'device',
        path: (id) => `/devices/${id}/offline-policy`,
      },
      {
        route: 'setDeviceOfflinePolicy',
        method: 'PUT',
        kind: 'device',
        path: (id) => `/devices/${id}/offline-policy`,
        body: { version: 1, max_per_sale: 1 },
      },
      {
        route: 'getEventOfflinePolicy',
        method: 'GET',
        kind: 'event',
        path: (id) => `/events/${id}/offline-policy`,
      },
      {
        route: 'setEventOfflinePolicy',
        method: 'PUT',
        kind: 'event',
        path: (id) => `/events/${id}/offline-policy`,
        body: { version: 1, max_per_sale: 1 },
      },
      {
        route: 'getEventOfflineRisk',
        method: 'GET',
        kind: 'event',
        path: (id) => `/events/${id}/offline-risk`,
      },
      {
        route: 'getOrganizerOfflinePolicy',
        method: 'GET',
        kind: 'organizer',
        path: (id) => `/organizers/${id}/offline-policy`,
      },
      {
        route: 'setOrganizerOfflinePolicy',
        method: 'PUT',
        kind: 'organizer',
        path: (id) => `/organizers/${id}/offline-policy`,
        body: { version: 1, max_per_sale: 1 },
      },
    ];
    const existing = (kind: Probe['kind']) =>
      kind === 'device' ? deviceId : kind === 'event' ? eventId : organizerId;

    const call = async (probe: Probe, who: TestPerson, id: string) => {
      const res = await send(
        {
          url: new URL(`${jw.api.baseUrl}${probe.path(id)}`),
          method: probe.method,
          headers: {
            authorization: `Bearer ${who.token}`,
            ...(probe.method !== 'GET'
              ? { 'content-type': 'application/json', 'idempotency-key': randomUUID() }
              : {}),
          },
          body: probe.method === 'GET' ? '' : JSON.stringify(probe.body ?? {}),
          cert: null,
          key: null,
        },
        jw.api.tls.serverCaPem,
      );
      return { status: res.status, code: res.body?.code, detail: res.body?.detail };
    };

    it('personne d’un autre prestataire : objet existant et objet inconnu donnent la MÊME réponse (aucune fuite)', async () => {
      for (const who of [jw.supForeign, adminB])
        for (const probe of probes()) {
          const real = await call(probe, who, existing(probe.kind));
          const none = await call(probe, who, randomUUID());
          expect({ route: probe.route, ...real }).toEqual({ route: probe.route, ...none });
          expect([403, 404]).toContain(real.status);
        }
    });

    it('personne d’un autre prestataire : 404 neutre sur les routes de terminal dont le rôle est tenu', async () => {
      // SUPERVISOR d'un autre prestataire : le rôle est tenu, l'objet est invisible (RLS) : 404,
      // jamais 403.
      for (const route of ['waiveSeqGap', 'importDeviceJournal', 'getDeviceJournalImport']) {
        const probe = probes().find((p) => p.route === route)!;
        const res = await call(probe, jw.supForeign, existing(probe.kind));
        expect({ route, status: res.status }).toEqual({ route, status: 404 });
      }
    });

    it('personne du même prestataire sans le rôle voulu : 403 identique, que l’objet existe ou non (routes de politique et de risque)', async () => {
      for (const who of [supervisorA2, adminA2])
        for (const probe of probes().filter((p) => /Policy|Risk/.test(p.route))) {
          const real = await call(probe, who, existing(probe.kind));
          const none = await call(probe, who, randomUUID());
          expect({ route: probe.route, ...real }).toEqual({ route: probe.route, ...none });
        }
    });

    it('SUPERVISOR d’un autre organisateur du MÊME prestataire : terminal existant et inconnu, même 404 (pas de fuite)', async () => {
      for (const route of ['waiveSeqGap', 'importDeviceJournal']) {
        const probe = probes().find((p) => p.route === route)!;
        const real = await call(probe, supervisorA2, existing(probe.kind));
        const none = await call(probe, supervisorA2, randomUUID());
        expect({ route, ...real }).toEqual({ route, ...none });
        expect({ route, status: real.status, code: real.code }).toEqual({
          route,
          status: 404,
          code: 'NOT_FOUND',
        });
      }
    });
  });
});

// ---------- OP-N93
describe('OP-N93(a) : clés publiques servies, celles du prestataire OU celles de la plateforme', () => {
  it('prestataire avec clé CENTRAL ACTIVE propre : aucune clé de la plateforme n’est rendue', async () => {
    const operatorId = randomUUID();
    const own = `bounds-own-${randomUUID()}`;
    const platform = `bounds-platform-${randomUUID()}`;
    await withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Borne N93', 'SN')`,
          [operatorId],
        );
        await db.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
        const insert = (keyId: string, owner: string | null) =>
          db.query(
            `INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key,
                                               kms_key_ref, status)
             VALUES ($1, $2, 'CENTRAL', 'ECDSA_P256_SHA256', '\\x0a', $3, 'ACTIVE')`,
            [keyId, owner, `t:${keyId}`],
          );
        // Avant : la clé ACTIVE de la plateforme est servie (le prestataire n'a pas la sienne).
        const platformBefore = await db.query(
          "SELECT key_id FROM snapshot_signing_key WHERE operator_id IS NULL AND status = 'ACTIVE'",
        );
        if (platformBefore.rowCount === 0) await insert(platform, null);
        const platformIds = (
          await db.query(
            "SELECT key_id FROM snapshot_signing_key WHERE operator_id IS NULL AND status = 'ACTIVE'",
          )
        ).rows.map((r) => r.key_id as string);
        expect(platformIds.length).toBeGreaterThan(0);
        const served = async () =>
          (await db.query('SELECT key_id FROM snapshot_public_keys($1)', [operatorId])).rows.map(
            (r) => r.key_id as string,
          );
        expect(await served()).toEqual(expect.arrayContaining(platformIds));
        // Après : sa propre clé ACTIVE remplace celles de la plateforme (limite : un ancien
        // snapshot signé par la
        // plateforme n'est plus vérifiable avec les clés servies).
        await insert(own, operatorId);
        expect(await served()).toEqual([own]);
        for (const id of platformIds) expect(await served()).not.toContain(id);
      } finally {
        await db.query('ROLLBACK');
      }
    });
  });
});

describe('OP-N93(c) : famine au-delà de 500 enveloppes', () => {
  let owner: Pool;
  let content: Pool;
  beforeAll(() => {
    owner = new Pool({ connectionString: OWNER_URL, max: 2 });
    content = new Pool({
      connectionString: process.env.DATABASE_URL_SNAPCONTENT || undefined,
      max: 2,
    });
  });
  afterAll(async () => {
    await owner.end();
    await content.end();
  });

  it('500 terminaux à clé d’accord invalide en tête de file : le terminal valide suivant n’est pas servi', async () => {
    const kms = new FakeKms();
    const f = await createFixture(owner, kms);
    const dek = await dekPlaintext(owner, kms, f);
    await addBracelet(owner, f, dek);
    dek.fill(0);
    const valid = newTerminal();
    valid.id = `ffffffff-ffff-4fff-8fff-${randomBytes(6).toString('hex')}`;
    await addTerminal(owner, f, valid);
    const w = makeWorkers(content, f, kms);
    try {
      expect(await w.content.runOnce()).toBe(1);
      expect(await publishReady(owner, f)).toBe(1);
      // 500 terminaux ACTIFS à clé invalide, d'identifiants plus petits que celui du terminal
      // valide.
      const client = await owner.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
        await client.query(
          `INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key)
           SELECT ('00000000-0000-4000-8000-' || lpad(to_hex($4::bigint + g), 12, '0'))::uuid, $1, 'POS',
                  'CATALOG_POS', $2, 'B-' || g || '-' || $3::text, decode('04' || repeat('00', 64), 'hex')
             FROM generate_series(1, 500) g`,
          [f.operatorId, f.eventId, randomUUID(), Math.floor(Math.random() * 2 ** 40)],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const wrapped = () =>
        ownerRows<{ n: number }>(
          'SELECT count(*)::int AS n FROM offline_snapshot_key WHERE ledger_id = $1 AND device_id = $2',
          [f.ledgerId, valid.id],
        ).then((r) => r[0]!.n);
      // Limite acceptée : la file lit 500 lignes, toutes invalides, rien n'est écrit, le terminal
      // valide attend.
      expect(await w.wrapping.runOnce()).toBe(0);
      expect(await wrapped()).toBe(0);
      // Contrôle : sans les invalides en tête, le même terminal est servi (la cause est la famine).
      await owner.query(
        `UPDATE device SET status = 'SUSPENDED' WHERE operator_id = $1 AND id <> $2`,
        [f.operatorId, valid.id],
      );
      expect(await w.wrapping.runOnce()).toBe(1);
      expect(await wrapped()).toBe(1);
    } finally {
      await w.close();
    }
  });
});
