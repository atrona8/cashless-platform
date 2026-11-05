// Isolation de la mission hors-ligne-snapshots-lots (lot WP21, T088 ; SC-011, NFR-007 ; modèles
// `isolation-sweep.spec.ts` et `topup-isolation.spec.ts`).
//   - Complétude : les routes de la mission sont LUES dans `openapi.yaml` (étiquette « Hors ligne ») ;
//     une route du contrat sans cas ici fait échouer le test.
//   - Sans jeton (personne) ou sans preuves (terminal) : 401 sur chaque route servie.
//   - Deux prestataires, chacun avec politique, snapshot, lot (donc résultat de lot), trou et import :
//     les personnes de l'un (administrateur du prestataire, de l'organisateur, superviseur) appellent
//     chaque route de personne sur les objets de l'autre : 404 neutre, jamais 2xx, aucune fuite
//     d'identifiant de l'autre. Le terminal de l'un lit le lot, accuse le snapshot et envoie un lot
//     sur le grand livre de l'autre : refusé, sans écriture.
//   - Après les balayages, les objets des deux prestataires sont intacts (empreinte avant/après).
// Écritures directes en base : amorçage seulement (événement, grand livre, snapshot, lot, trou,
// import du prestataire B), politiques posées par la route.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { send, TestTerminal, type TerminalResponse } from '../../support/test-terminal';

jest.setTimeout(240_000);

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');

interface ContractOp {
  operationId: string;
  method: string;
  path: string;
  deviceProofs: boolean;
}

/** Opérations de la mission : celles du contrat étiquetées « Hors ligne » (jamais une liste en dur). */
function missionOperations(): ContractOp[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<
      string,
      Record<string, { operationId?: string; tags?: string[]; security?: object[] }>
    >;
  };
  return Object.entries(contract.paths).flatMap(([path, operations]) =>
    Object.entries(operations)
      .filter(([, op]) => op.tags?.includes('Hors ligne'))
      .map(([method, op]) => ({
        operationId: op.operationId!,
        method: method.toUpperCase(),
        path,
        deviceProofs: (op.security ?? []).some((s) => 'deviceSignature' in s),
      })),
  );
}

interface Tenant {
  key: 'A' | 'B';
  operatorId: string;
  organizerId: string;
  eventId: string;
  ledgerId: string;
  deviceId: string;
  terminal: TestTerminal;
  batchId: string;
  snapshotVersion: number;
  gapSeq: number;
  importId: string;
  snapshotSha: string;
  admin: TestPerson; // ORGANIZER_ADMIN
  operatorAdmin: TestPerson;
  supervisor: TestPerson;
}

describe('SC-011, NFR-007 : isolation des routes hors ligne', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: FakeDeviceCa;
  let tokens: DeviceTokenService;
  let a: Tenant;
  let b: Tenant;
  const contract = missionOperations();

  const person = (
    method: string,
    path: string,
    who: TestPerson | null,
    body?: unknown,
  ): Promise<TerminalResponse> =>
    send(
      {
        url: new URL(`${api.baseUrl}${path}`),
        method,
        headers: {
          ...(who ? { authorization: `Bearer ${who.token}` } : {}),
          ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'idempotency-key': randomUUID() } : {}),
        },
        body: method === 'GET' ? '' : JSON.stringify(body ?? {}),
        cert: null,
        key: null,
      },
      api.tls.serverCaPem,
    );

  async function tenant(key: 'A' | 'B'): Promise<Tenant> {
    const operatorId = key === 'A' ? w.ops.a : w.ops.b;
    const organizerId = key === 'A' ? w.ids.organizerA : w.ids.organizerB;
    let eventId = w.ids.eventA;
    let ledgerId = w.ids.ledgerA;
    const role = (r: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN' | 'SUPERVISOR') =>
      withOwner((db) =>
        w.idp.createPerson(db, {
          operatorId,
          roles: [
            r === 'OPERATOR_ADMIN'
              ? { role: r, scopeType: 'OPERATOR', scopeId: operatorId }
              : { role: r, scopeType: 'ORGANIZER', scopeId: organizerId },
          ],
        }),
      );
    const [operatorAdmin, admin, supervisor] = [
      await role('OPERATOR_ADMIN'),
      await role('ORGANIZER_ADMIN'),
      await role('SUPERVISOR'),
    ];
    if (key === 'B') {
      eventId = randomUUID();
      ledgerId = await withOwner(async (db) => {
        const profile = (
          await db.query<{ j: string }>('SELECT jurisdiction_id AS j FROM event WHERE id = $1', [
            w.ids.eventA,
          ])
        ).rows[0]!.j;
        await db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                              jurisdiction_id, funds_holder)
           VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
          [eventId, operatorId, organizerId, profile],
        );
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [operatorId]);
        return (
          await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventId])
        ).rows[0]!.ledger;
      });
    }
    const terminal = await withOwner((db) =>
      new TestTerminal('ANDROID').enroll(db, { operatorId, eventId, ca }),
    );
    await terminal.issueToken(tokens);
    const deviceId = terminal.deviceId;
    // Politiques posées par la route (organisateur, événement, terminal) : l'état à protéger.
    for (const path of [
      `/organizers/${organizerId}/offline-policy`,
      `/events/${eventId}/offline-policy`,
      `/devices/${deviceId}/offline-policy`,
    ]) {
      const res = await person('PUT', path, admin, { max_per_sale: 500, offline_enabled: true });
      if (res.status !== 200) throw new Error(`politique ${path} : ${res.status} ${res.text}`);
    }
    // Snapshot publié du grand livre (amorçage en propriétaire), lot ouvert, trou, import.
    const snapshotVersion = 1 + Math.floor(Math.random() * 1e6) * 1000;
    const snapshotSha = createHash('sha256').update(`snap-${key}-${operatorId}`).digest('hex');
    const batchId = randomUUID();
    const gapSeq = 7;
    const importId = randomUUID();
    await withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query(
        `INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, generated_at,
                valid_until, entries, content_sha256, authority_epoch, key_id, header, signature,
                content_key_wrapped, published_at)
         VALUES ($1, $2, $3, 'FULL', $4, now(), now() + interval '1 day', 0, $5, 0, 'k', '{}',
                 '\\x01', '\\x01', now())`,
        [operatorId, ledgerId, eventId, snapshotVersion, Buffer.from(snapshotSha, 'hex')],
      );
      await db.query('COMMIT');
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [operatorId]);
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, seq, amount)
         VALUES ($1, $2, 'SEQ_GAP', $3, $4, 0)`,
        [operatorId, ledgerId, deviceId, gapSeq],
      );
      await db.query(`DO $$ DECLARE hs bytea[]; e bytea; h bytea; BEGIN
        SELECT array_agg(sha256(convert_to('op' || s, 'UTF8')) ORDER BY s) INTO hs
          FROM generate_series(1, 3) s;
        e := device_chain_genesis('${deviceId}'::uuid);
        FOREACH h IN ARRAY hs LOOP e := chain_step(e, h); END LOOP;
        PERFORM open_offline_batch('${batchId}'::uuid, '${deviceId}'::uuid, '${ledgerId}'::uuid, 1,
                                   device_chain_genesis('${deviceId}'::uuid), hs, e, '\\x01');
      END $$`);
      await db.query(
        `INSERT INTO device_journal_import (id, operator_id, device_id, batches, batches_sha256,
                                            summary, status, reason, requested_by)
         VALUES ($1, $2, $3, '[{}]'::jsonb, sha256('x'), '{}'::jsonb, 'PENDING',
                 'Import de test d’isolation', $4)`,
        [importId, operatorId, deviceId, supervisor.userId],
      );
    });
    return {
      key,
      operatorId,
      organizerId,
      eventId,
      ledgerId,
      deviceId,
      terminal,
      batchId,
      snapshotVersion,
      gapSeq,
      importId,
      snapshotSha,
      admin,
      operatorAdmin,
      supervisor,
    };
  }

  /**
   * Empreinte de tout ce que les routes de la mission peuvent toucher, pour un prestataire.
   * L'interrogation se fait en propriétaire (la RLS ne filtre pas) : chaque requête est donc
   * filtrée explicitement par `operator_id` (toutes ces tables en portent un), pour qu'une suite
   * voisine qui écrit chez un autre prestataire ne fasse pas échouer « rien n'a bougé », sans
   * rien retirer à la preuve : une écriture de l'attaquant chez la victime change l'empreinte.
   */
  async function digest(t: Tenant): Promise<string> {
    const queries: Array<[string, string]> = [
      [
        'policy',
        'SELECT scope_type, scope_id, version, max_per_sale, offline_enabled FROM offline_policy WHERE operator_id = $1',
      ],
      ['history', 'SELECT scope_id, version FROM offline_policy_history WHERE operator_id = $1'],
      ['snapshot', 'SELECT ledger_id, version, kind FROM offline_snapshot WHERE operator_id = $1'],
      [
        'key',
        'SELECT ledger_id, version, device_id FROM offline_snapshot_key WHERE operator_id = $1',
      ],
      [
        'batch',
        'SELECT id, status, device_id, seq_from, seq_to FROM offline_batch WHERE operator_id = $1',
      ],
      [
        'gap',
        "SELECT device_id, seq, status FROM anomaly WHERE kind = 'SEQ_GAP' AND operator_id = $1",
      ],
      [
        'import',
        'SELECT id, status, approved_by FROM device_journal_import WHERE operator_id = $1',
      ],
      [
        'registry',
        'SELECT device_id, seq, outcome FROM device_seq_registry WHERE operator_id = $1',
      ],
      ['approval', 'SELECT id, status FROM approval_request WHERE operator_id = $1'],
      ['tx', 'SELECT id FROM journal_transaction WHERE device_id IS NOT NULL AND operator_id = $1'],
    ];
    const parts: unknown[] = [];
    for (const [name, sql] of queries)
      parts.push([
        name,
        await withOwner(async (db) => {
          await db.query('BEGIN');
          await db.query(`SELECT set_config('app.operator_id', $1, true)`, [t.operatorId]);
          const { rows } = await db.query(`SELECT * FROM (${sql}) q ORDER BY q::text`, [
            t.operatorId,
          ]);
          await db.query('ROLLBACK');
          return rows;
        }),
      ]);
    return createHash('sha256')
      .update(JSON.stringify(parts, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
      .digest('hex');
  }

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    a = await tenant('A');
    b = await tenant('B');
  });
  afterAll(async () => {
    await api?.close();
  });

  // ----- Cas par opération du contrat -----

  type Victim = Tenant;
  interface PersonCase {
    path: (v: Victim) => string;
    body?: (v: Victim) => object;
  }
  /** Lot exporté (signé par le terminal de la victime, non envoyé) : corps d'import valide. */
  const exported = (v: Victim): object => {
    const t = v.terminal;
    const saved = { next: t.nextBatchSeq, tip: t.chainTip };
    const batch = t.buildBatch(
      [{ type: 'VOID', occurred_at: new Date().toISOString(), void_reason: 'ABORTED_BY_OPERATOR' }],
      { ledgerId: v.ledgerId },
    );
    t.nextBatchSeq = saved.next;
    t.chainTip = saved.tip;
    return batch.body as object;
  };
  /** Routes de personne : chemin sur les objets de la victime, corps valide (le refus vient de l'isolation). */
  const PERSON: Record<string, PersonCase> = {
    getOfflineCeiling: { path: (v) => `/operators/${v.operatorId}/offline-ceiling` },
    setOfflineCeiling: {
      path: (v) => `/operators/${v.operatorId}/offline-ceiling`,
      body: () => ({ version: 1, max_per_sale: 1 }),
    },
    getOrganizerOfflinePolicy: { path: (v) => `/organizers/${v.organizerId}/offline-policy` },
    setOrganizerOfflinePolicy: {
      path: (v) => `/organizers/${v.organizerId}/offline-policy`,
      body: () => ({ version: 1, max_per_sale: 1 }),
    },
    getEventOfflinePolicy: { path: (v) => `/events/${v.eventId}/offline-policy` },
    setEventOfflinePolicy: {
      path: (v) => `/events/${v.eventId}/offline-policy`,
      body: () => ({ version: 1, max_per_sale: 1 }),
    },
    getDeviceOfflinePolicy: { path: (v) => `/devices/${v.deviceId}/offline-policy` },
    setDeviceOfflinePolicy: {
      path: (v) => `/devices/${v.deviceId}/offline-policy`,
      body: () => ({ version: 1, max_per_sale: 1 }),
    },
    getEventOfflineRisk: { path: (v) => `/events/${v.eventId}/offline-risk` },
    getEventDeviceSyncStatus: { path: (v) => `/events/${v.eventId}/device-sync-status` },
    waiveSeqGap: {
      path: (v) => `/devices/${v.deviceId}/seq-gaps/${v.gapSeq}/waive`,
      body: () => ({ reason: 'Levée demandée par un intrus, sans droit sur ce terminal.' }),
    },
    importDeviceJournal: {
      path: (v) => `/devices/${v.deviceId}/journal-imports`,
      body: (v) => ({ batches: [exported(v)], reason: 'Import demandé par un intrus sans droit.' }),
    },
    getDeviceJournalImport: {
      path: (v) => `/devices/${v.deviceId}/journal-imports/${v.importId}`,
    },
  };
  const METHOD: Record<string, string> = Object.fromEntries(
    contract.map((op) => [op.operationId, op.method]),
  );
  const fullPath = (op: ContractOp, v: Victim) => PERSON[op.operationId]!.path(v);

  /** Routes de terminal : appel par un terminal sur les objets de la victime. */
  const DEVICE: Record<
    string,
    (t: TestTerminal, v: Victim, own: Victim) => Promise<TerminalResponse>
  > = {
    getDeviceSeqStatus: (t) =>
      t.request(api.baseUrl, api.tls.serverCaPem, { method: 'GET', path: '/device/seq-status' }),
    getOfflineSnapshot: (t, v) =>
      t.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'GET',
        path: `/offline-snapshots/current?since_version=${v.snapshotVersion}`,
      }),
    ackOfflineSnapshot: (t, v) =>
      t.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'POST',
        path: '/offline-snapshots/ack',
        body: { version: v.snapshotVersion, content_sha256: v.snapshotSha },
      }),
    submitOfflineBatch: (t, v) =>
      t.submitBatch(
        api.baseUrl,
        api.tls.serverCaPem,
        t.buildBatch(
          [
            {
              type: 'VOID',
              occurred_at: new Date().toISOString(),
              void_reason: 'ABORTED_BY_OPERATOR',
            },
          ],
          { ledgerId: v.ledgerId },
        ),
      ),
    getOfflineBatchResult: (t, v) =>
      t.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'GET',
        path: `/offline-batches/${v.batchId}`,
      }),
  };

  // Toutes les routes de la mission sont servies (partie D de WP21) : aucune n'échappe au balayage.
  const NOT_SERVED = new Set<string>();

  it('le contrat déclare les routes de la mission et chacune a un cas (complétude)', () => {
    expect(contract.length).toBeGreaterThanOrEqual(18);
    const covered = new Set([...Object.keys(PERSON), ...Object.keys(DEVICE)]);
    expect(
      contract.filter((op) => !covered.has(op.operationId)).map((op) => op.operationId),
    ).toEqual([]);
    // Un cas sans route du contrat est une faute de frappe : aucun cas orphelin.
    expect([...covered].filter((id) => !contract.some((op) => op.operationId === id))).toEqual([]);
    // Les cas de personne portent sur des routes sans preuves de terminal, et inversement.
    for (const op of contract)
      expect({ id: op.operationId, device: op.deviceProofs }).toEqual({
        id: op.operationId,
        device: op.operationId in DEVICE,
      });
  });

  it('sans jeton ni preuves : 401 sur chaque route servie', async () => {
    for (const op of contract.filter((o) => !NOT_SERVED.has(o.operationId))) {
      if (op.operationId in PERSON) {
        const p = PERSON[op.operationId]!;
        const res = await person(op.method, p.path(a), null, p.body?.(a));
        expect({ route: op.operationId, status: res.status }).toEqual({
          route: op.operationId,
          status: 401,
        });
      } else {
        const url = new URL(`${api.baseUrl}${op.path.replace('{batch_id}', a.batchId)}`);
        const res = await send(
          { url, method: op.method, headers: {}, body: '', cert: null, key: null },
          api.tls.serverCaPem,
        );
        expect({ route: op.operationId, status: res.status }).toEqual({
          route: op.operationId,
          status: 401,
        });
      }
    }
  });

  describe.each([
    ['A', () => a, () => b],
    ['B', () => b, () => a],
  ] as Array<[string, () => Tenant, () => Tenant]>)(
    'personnes du prestataire %s',
    (_n, me, victim) => {
      it.each([
        ['OPERATOR_ADMIN', (t: Tenant) => t.operatorAdmin],
        ['ORGANIZER_ADMIN', (t: Tenant) => t.admin],
        ['SUPERVISOR', (t: Tenant) => t.supervisor],
      ])(
        '%s : 403 ou 404 sur chaque route de personne de l’autre, rien n’a bougé',
        async (_r, pick) => {
          const before = [await digest(a), await digest(b)];
          const intruder = pick(me());
          const v = victim();
          const leaks: string[] = [];
          for (const op of contract.filter((o) => o.operationId in PERSON)) {
            if (NOT_SERVED.has(op.operationId)) continue;
            const p = PERSON[op.operationId]!;
            const res = await person(op.method, fullPath(op, v), intruder, p.body?.(v));
            const label = `${op.operationId} : ${res.status} ${String(res.body?.code)}`;
            // 404 neutre (objet de l'autre) ou 403 (rôle sans portée sur l'objet) : jamais 2xx.
            if (![403, 404].includes(res.status)) leaks.push(label);
            // Aucun identifiant de l'autre prestataire dans la réponse.
            const text = res.text ?? '';
            for (const secret of [v.operatorId, v.deviceId, v.batchId, v.importId, v.ledgerId])
              if (text.includes(secret)) leaks.push(`${op.operationId} : fuite d'identifiant`);
          }
          expect(leaks).toEqual([]);
          expect([await digest(a), await digest(b)]).toEqual(before);
        },
      );
    },
  );

  describe.each([
    ['A', () => a, () => b],
    ['B', () => b, () => a],
  ] as Array<[string, () => Tenant, () => Tenant]>)(
    'terminal du prestataire %s',
    (_n, me, victim) => {
      it('lot, résultat de lot, snapshot et accusé de l’autre : refusés, aucune écriture', async () => {
        const before = [await digest(a), await digest(b)];
        const t = me().terminal;
        const v = victim();
        // Résultat d'un lot de l'autre : 404 neutre.
        const read = await DEVICE.getOfflineBatchResult!(t, v, me());
        expect([read.status, read.body.code]).toEqual([404, 'NOT_FOUND']);
        expect(read.text).not.toContain(v.deviceId);
        // État des séquences : celui du terminal appelant, jamais celui de l'autre (identité du jeton).
        const seqStatus = await DEVICE.getDeviceSeqStatus!(t, v, me());
        expect(seqStatus.status).toBe(200);
        expect(seqStatus.body.device_serial).toBe(t.serial);
        expect(seqStatus.text).not.toContain(v.terminal.serial);
        expect(seqStatus.text).not.toContain(v.deviceId);
        // Accusé d'une version de l'autre : version inconnue pour ce terminal.
        const ack = await DEVICE.ackOfflineSnapshot!(t, v, me());
        expect([ack.status, ack.body.code]).toEqual([409, 'SNAPSHOT_VERSION_UNKNOWN']);
        // Snapshot : jamais celui de l'autre (le terminal n'a rien d'à lui de prêt : 409/403, jamais 2xx).
        const snap = await DEVICE.getOfflineSnapshot!(t, v, me());
        expect(snap.status).toBeGreaterThanOrEqual(400);
        expect(snap.text).not.toContain(v.snapshotSha);
        // Lot sur le grand livre de l'autre : refusé en entier.
        const sent = await DEVICE.submitOfflineBatch!(t, v, me());
        expect(sent.status).toBe(400);
        expect(sent.body.code).toBe('VALIDATION_FAILED');
        expect(
          await ownerRows(`SELECT 1 FROM offline_batch WHERE device_id = $1 AND ledger_id = $2`, [
            t.deviceId,
            v.ledgerId,
          ]),
        ).toHaveLength(0);
        expect([await digest(a), await digest(b)]).toEqual(before);
      });
    },
  );

  it('après tous les balayages, les objets des deux prestataires sont intacts et lisibles', async () => {
    for (const t of [a, b]) {
      const own = await t.terminal.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'GET',
        path: `/offline-batches/${t.batchId}`,
      });
      expect(own.status).toBe(202); // lot en traitement : le sien reste lisible
      const policy = await person('GET', `/devices/${t.deviceId}/offline-policy`, t.admin);
      expect(policy.status).toBe(200);
      expect(JSON.stringify(policy.body)).toContain('500');
      // Import PENDING : la lecture de personne ne rend que les imports en cours ou clos ; la ligne reste.
      expect(
        await ownerRows<{ status: string }>(
          'SELECT status FROM device_journal_import WHERE id = $1',
          [t.importId],
        ),
      ).toEqual([{ status: 'PENDING' }]);
    }
    expect(METHOD.waiveSeqGap).toBe('POST');
  });
});
