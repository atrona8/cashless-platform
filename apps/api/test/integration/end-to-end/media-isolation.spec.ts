// Balayage d'isolation de la mission bracelets-nfc (WP20, T084 ; NFR-004, SC-005). CHAQUE
// opération que la mission a ajoutée au contrat — lue dans openapi.yaml par son champ
// `x-process` (`public`, `personalization`, `tag-keys`), jamais une liste écrite à la main — est
// :
//   1. appelée, sur le processus qui la sert, par le personnel, le terminal et le festivalier
//   d'un
//      AUTRE prestataire (B) sur les objets du prestataire A : refus (403 ou 404), jamais de
//      succès, aucune donnée de A dans le corps, rien de modifié chez A. Exceptions documentées,
//      cas par cas, dans `cases` ;
//   2. servie par le processus annoncé et absente (404, route inconnue) de tous les autres. Une
//   opération du contrat sans cas dans ce fichier fait échouer le test (comme
//   configuration-isolation.spec.ts).
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateClaimCode } from '@cashless/tag-format';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { createKeyProcess, createTestApp, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createChip,
  createMediaWorld,
  createStation,
  goLive,
  MEDIA_KEY_INDEX,
  openCashDesk,
  ownerRows as rows,
  personalizationBody,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const PROCESSES = ['public', 'personalization', 'tag-keys'] as const;
type MissionProcess = (typeof PROCESSES)[number];
/** Processus démarrés : une opération est absente de chacun de ceux qui ne la servent pas. */
const ALL_PROCESSES = [...PROCESSES, 'tag-check', 'key-admin'] as const;
type AnyProcess = (typeof ALL_PROCESSES)[number];
type Method = 'get' | 'post' | 'patch';

interface Route {
  method: Method;
  path: string;
  operationId: string;
  process: MissionProcess;
}

/** Opérations de la mission, lues dans le contrat par leur champ `x-process`. */
function missionRoutes(): Route[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string; 'x-process'?: string }>>;
  };
  return Object.entries(contract.paths).flatMap(([path, operations]) =>
    (['get', 'post', 'patch', 'put', 'delete'] as const)
      .filter((method) => operations[method]?.['x-process'] !== undefined)
      .map((method) => ({
        method: method as Method,
        path,
        operationId: operations[method]!.operationId!,
        process: operations[method]!['x-process'] as MissionProcess,
      })),
  );
}

/**
 * Qui appelle l'opération :
 * - `staff` : personnel de B (jeton d'une personne), back-office ou poste de personnalisation ;
 * - `counter` : guichet (terminal ET personne) — terminal de B et personnel de B, et les
 *   mélanges ;
 * - `device` : terminal de B seul ;
 * - `customer` : festivalier de B (app) ;
 * - `public` : route sans identité, cas particulier traité dans son propre test.
 */
type Who = 'staff' | 'counter' | 'device' | 'customer' | 'public';

interface Case {
  who: Who;
  /** Corps valide (JSON ou texte CSV) : le refus vient de l'isolation, pas de la validation. */
  body?: () => object | string;
  /** Statuts de refus admis (403 et 404 par défaut). */
  refused?: number[];
  /** Vérification propre à l'opération, à la place du contrôle des statuts de refus. */
  check?: (res: request.Response, caller: string) => string | null;
  /** Pourquoi l'opération s'écarte du refus 403/404 attendu. */
  note?: string;
}

jest.setTimeout(600_000);

describe('balayage d’isolation des routes des bracelets (NFR-004, SC-005)', () => {
  const routes = missionRoutes();
  let w: MediaWorld;
  let apps: Record<AnyProcess, INestApplication>;
  const keyProcesses: KeyProcessApp[] = [];
  let hasher: ClaimHasher;

  // Prestataire A : ses objets, cibles du balayage.
  let deviceA: TestDevice;
  let batchA: string;
  let mActive: SeededMedia; // actif, avec son code imprimé associé
  let mFresh: SeededMedia; // personnalisé, jamais activé
  let mPerso: SeededMedia; // personnalisé, sans code imprimé (cible de associateClaimCode)
  let walletActive: string;
  let codeA: string; // code imprimé de mActive
  let codeFree: string; // code du lot A encore libre
  let jobA: string; // travail des clés de A, en échec
  // Prestataire B : ses personnes, son événement, son terminal, une lecture de son propre
  // bracelet.
  let eventB: string;
  let deviceB: TestDevice;
  let operatorAdminB: TestPerson;
  let organizerAdminB: TestPerson;
  let supervisorB: TestPerson;
  let mediaB: SeededMedia; // bracelet actif de B, lu par son propre terminal
  let tapIdB: number;
  let counter = 0;
  const next = () => (counter += 1);
  let ip = 0;
  const nextIp = () => {
    ip += 1;
    return `198.18.${Math.floor(ip / 250)}.${(ip % 250) + 1}`;
  };
  const INTRUS = 'Intrus du balayage';

  /** Cas par opération : chaque opération du contrat DOIT en avoir un. */
  const cases: Record<string, Case> = {
    // ----- tag-keys -----
    getMediaAuthKey: {
      who: 'device',
      body: () => ({ nfc_uid: mActive.uid, key_index: MEDIA_KEY_INDEX }),
    },
    // ----- public : terminal -----
    createTap: {
      who: 'device',
      body: () => tapBody(mActive, next()),
      note:
        'Le résultat d’une lecture est rendu en 200 (contrat createTap) : pour un bracelet ' +
        'd’un autre prestataire, UNKNOWN, identique à un bracelet inconnu, sans lecture, ' +
        'bracelet ni portefeuille.',
      check: (res, caller) => {
        const expected = {
          tap_id: null,
          result: 'UNKNOWN',
          tap_expires_at: null,
          media: null,
          wallet: null,
        };
        return res.status === 200 && JSON.stringify(res.body) === JSON.stringify(expected)
          ? null
          : `${caller} : ${res.status} ${res.text}`;
      },
    },
    // ----- public : guichet -----
    activateMedia: {
      who: 'counter',
      body: () => ({
        tap: tapBody(mFresh, next()),
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
      }),
    },
    getMedia: { who: 'counter' },
    takeDeposit: { who: 'counter', body: () => ({ tap: tapBody(mActive, next()) }) },
    refundDeposit: { who: 'counter', body: () => ({ tap: tapBody(mActive, next()) }) },
    releaseMedia: { who: 'counter', body: () => ({ tap: tapBody(mActive, next()) }) },
    reassignPoolMedia: {
      who: 'counter',
      body: () => ({ new_token_hash: randomBytes(32).toString('hex') }),
    },
    replaceMedia: {
      who: 'counter',
      body: () => ({ new_media_tap: tapBody(mFresh, next()), reason: INTRUS }),
    },
    refundCashDue: { who: 'counter', body: () => ({ tap: tapBody(mActive, next()) }) },
    confirmMediaClaim: {
      who: 'counter',
      // Lecture valide du terminal de B (sur un bracelet de B) et code imprimé d'un
      // bracelet de A.
      body: () => ({ tap_id: tapIdB, claim_code: codeA, confirmation_code: '123456' }),
      refused: [403, 404, 422],
      note:
        'Terminal et personnel de B légitimes chez eux : le code de A n’existe pas pour eux, ' +
        'refus MEDIA_CLAIM_INVALID (422), le même que pour un code inconnu ' +
        '(contracts/claim-codes.md).',
    },
    // ----- public : app festivalier et consultation anonyme -----
    claimMedia: {
      who: 'customer',
      body: () => ({ claim_code: codeA }),
      refused: [422],
      note:
        'Un code d’un autre prestataire est refusé comme un code inconnu ' +
        '(MEDIA_CLAIM_INVALID, 422) : répondre 404 distinguerait un code existant ailleurs ' +
        '(vérifié dans le test dédié).',
    },
    lookupBalanceByClaimCode: {
      who: 'public',
      note: 'Route publique, sans identité ni prestataire : traitée dans son propre test.',
    },
    // ----- public : back-office des clés -----
    listTagKeys: { who: 'staff' },
    requestTagKey: { who: 'staff', body: () => ({ scope: 'SHARED' }) },
    getTagKey: { who: 'staff' },
    requestDekRotation: { who: 'staff', body: () => ({}) },
    requestTagKeyRetirement: { who: 'staff', body: () => ({}) },
    listTagKeyJobs: { who: 'staff' },
    retryTagKeyJob: { who: 'staff', body: () => ({}) },
    listTagKeyCheckRuns: { who: 'staff' },
    // ----- public : lots -----
    listMediaBatches: { who: 'staff' },
    createMediaBatch: {
      who: 'staff',
      body: () => ({
        organizer_id: w.ids.organizerA,
        event_id: w.ids.eventA,
        kind: 'PUBLIC',
        quantity: 10,
        key_index: MEDIA_KEY_INDEX,
        print_order_ref: INTRUS,
      }),
    },
    getMediaBatch: { who: 'staff' },
    updateMediaBatch: { who: 'staff', body: () => ({ print_order_ref: INTRUS }) },
    setMediaBatchStatus: { who: 'staff', body: () => ({ status: 'SUSPENDED', reason: INTRUS }) },
    getMediaBatchInventory: { who: 'staff' },
    issueClaimCodeOrder: { who: 'staff', body: () => ({}) },
    importClaimCodeAssociations: { who: 'staff', body: () => `${codeFree},${mPerso.uid}\n` },
    closeMediaBatch: { who: 'staff', body: () => ({}) },
    catchUpBatchPreload: { who: 'staff', body: () => ({}) },
    // ----- public : bracelets au back-office -----
    listMedia: { who: 'staff' },
    getMediaAdmin: { who: 'staff' },
    blacklistMedia: { who: 'staff', body: () => ({ reason: INTRUS }) },
    requestMediaReinstatement: { who: 'staff', body: () => ({ reason: INTRUS }) },
    reportMediaLost: { who: 'staff', body: () => ({ reason: INTRUS }) },
    recoverMedia: { who: 'staff', body: () => ({}) },
    // ----- personalization -----
    registerPersonalizedMedia: {
      who: 'staff',
      body: () => personalizationBody(batchA, createChip(), createStation()),
    },
    associateClaimCode: { who: 'staff', body: () => ({ claim_code: codeFree }) },
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      const person = (roles: Parameters<MediaWorld['idp']['createPerson']>[1]['roles']) =>
        w.idp.createPerson(db, { operatorId: w.ops.b, roles });
      operatorAdminB = await person([
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b },
      ]);
      organizerAdminB = await person([
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: w.ids.organizerB },
      ]);
      supervisorB = await person([
        { role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: w.ids.organizerB },
      ]);

      // Prestataire A : événement en service, terminal avec caisse, lot actif, trois
      // bracelets.
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      deviceA = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      await openCashDesk(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        organizerId: w.ids.organizerA,
        serial: deviceA.serial,
      });
      batchA = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      [mActive, mFresh, mPerso] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batchA,
        kmsKeyRef: w.keyRef.a,
        count: 3,
      })) as [SeededMedia, SeededMedia, SeededMedia];
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      walletActive = (
        await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
      ).rows[0]!.id;
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: walletActive,
        mediaIds: [mActive.id],
      });
      jobA = (
        await db.query<{ id: string }>(
          `INSERT INTO tag_key_job (operator_id, key_index, kind, status, attempts, last_error)
           VALUES ($1, $2, 'ROTATE_DEK', 'FAILED', 1, 'échec de test') RETURNING id`,
          [w.ops.a, MEDIA_KEY_INDEX],
        )
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status)
         VALUES ($1, 5, 0, 'OK')`,
        [w.ops.a],
      );

      // Prestataire B : son événement en service, son terminal avec caisse, un bracelet
      // actif.
      eventB = randomUUID();
      const profile = randomUUID();
      await db.query(
        `INSERT INTO jurisdiction_profile
           (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01',
                 'ORGANIZER')`,
        [profile],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventB, w.ops.b, w.ids.organizerB, profile],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      const ledgerB = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventB])
      ).rows[0]!.ledger;
      await goLive(db, w.ops.b, eventB, operatorAdminB.userId);
      deviceB = await createTestDevice(db, { operatorId: w.ops.b, eventId: eventB });
      await openCashDesk(db, {
        operatorId: w.ops.b,
        ledgerId: ledgerB,
        organizerId: w.ids.organizerB,
        serial: deviceB.serial,
      });
      const batchB = await createBatch(db, {
        operatorId: w.ops.b,
        organizerId: w.ids.organizerB,
        eventId: eventB,
        status: 'ACTIVE',
      });
      [mediaB] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.b,
        batchId: batchB,
        kmsKeyRef: w.keyRef.b,
        count: 1,
      })) as [SeededMedia];
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      const walletB = (
        await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [eventB])
      ).rows[0]!.id;
      await activateMedia(db, {
        operatorId: w.ops.b,
        eventId: eventB,
        walletId: walletB,
        mediaIds: [mediaB.id],
      });
    });

    const publicApp = await createTestApp({ identity: w.idp });
    hasher = publicApp.get(ClaimHasher, { strict: false });
    for (const name of ['personalization', 'tag-keys', 'tag-check', 'key-admin'] as const) {
      keyProcesses.push(
        await createKeyProcess(name, name === 'personalization' ? { identity: w.idp } : {}),
      );
    }
    apps = {
      public: publicApp,
      personalization: keyProcesses[0]!.app,
      'tag-keys': keyProcesses[1]!.app,
      'tag-check': keyProcesses[2]!.app,
      'key-admin': keyProcesses[3]!.app,
    };

    // Codes imprimés du lot A : celui de mActive (associé), et un code encore libre.
    codeA = generateClaimCode(randomBytes);
    codeFree = generateClaimCode(randomBytes);
    await withOwner(async (db) => {
      const hash = hasher.claimCodeHash(codeA);
      await db.query(
        `INSERT INTO claim_code (operator_id, batch_id, code_hash, media_id, associated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [w.ops.a, batchA, hash, mActive.id],
      );
      await db.query('UPDATE media SET claim_code_hash = $2 WHERE id = $1', [mActive.id, hash]);
      await db.query(
        'INSERT INTO claim_code (operator_id, batch_id, code_hash) VALUES ($1, $2, $3)',
        [w.ops.a, batchA, hasher.claimCodeHash(codeFree)],
      );
    });

    // Lecture légitime du terminal de B sur son propre bracelet (citée par
    // confirmMediaClaim).
    const tap = await request(publicApp.getHttpServer())
      .post('/v1/taps')
      .set(deviceB.headers)
      .send(tapBody(mediaB, next()));
    expect(tap.body.result).toBe('OK');
    tapIdB = tap.body.tap_id as number;
  });

  afterAll(async () => {
    await apps?.public.close();
    for (const process of keyProcesses) await process.app.close();
  });

  /** Chemin d'une opération sur les objets de A, depuis le prestataire `root` du chemin. */
  const url = (route: Route, root: string): string =>
    `/v1${route.path
      .replace('{operator_id}', root)
      .replace('{media_id}', route.operationId === 'associateClaimCode' ? mPerso.id : mActive.id)
      .replace('{batch_id}', batchA)
      .replace('{key_index}', String(MEDIA_KEY_INDEX))
      .replace('{job_id}', jobA)}`;

  const send = (
    app: INestApplication,
    route: Route,
    path: string,
    headers: Record<string, string>,
  ) => {
    const req = request(app.getHttpServer())[route.method](path).set(headers);
    if (route.method === 'get') return req;
    const body = cases[route.operationId]?.body?.() ?? {};
    req.set('Idempotency-Key', randomUUID());
    return typeof body === 'string'
      ? req.set('Content-Type', 'text/csv').send(body)
      : req.send(body);
  };

  const bearer = (person: TestPerson) => ({ Authorization: `Bearer ${person.token}` });

  /** Appelants de B (et mélanges de guichet) pour une opération. */
  const callers = (
    route: Route,
  ): Array<{ label: string; headers: () => Promise<Record<string, string>> }> => {
    const c = cases[route.operationId]!;
    const staff = (label: string, person: TestPerson) => ({
      label,
      headers: async () => bearer(person),
    });
    const desk = (label: string, device: TestDevice, person: TestPerson) => ({
      label,
      headers: async () => ({
        ...device.headers,
        'X-Staff-Authorization': `Bearer ${person.token}`,
      }),
    });
    switch (c.who) {
      case 'staff':
        return route.process === 'personalization'
          ? [
              staff('PERSONALIZER de B', w.personalizerB),
              staff('OPERATOR_ADMIN de B', operatorAdminB),
            ]
          : [
              staff('OPERATOR_ADMIN de B', operatorAdminB),
              staff('ORGANIZER_ADMIN de B', organizerAdminB),
              staff('SUPERVISOR de B', supervisorB),
              staff('CASHIER de B', w.cashierB),
            ];
      case 'counter':
        return [
          desk('terminal de B + CASHIER de B', deviceB, w.cashierB),
          desk('terminal de B + SUPERVISOR de B', deviceB, supervisorB),
          desk('terminal de B + CASHIER de A', deviceB, w.cashierA),
          desk('terminal de A + CASHIER de B', deviceA, w.cashierB),
        ];
      case 'device':
        return [{ label: 'terminal de B', headers: async () => deviceB.headers }];
      case 'customer':
        return [
          {
            label: 'festivalier de B',
            // Un festivalier neuf par appel : la limite d'essais par compte ne joue
            // pas.
            headers: async () => (await withOwner((db) => createTestCustomer(db, w.ops.b))).headers,
          },
        ];
      case 'public':
        return [];
    }
  };

  /** Identifiants et valeurs de A qui ne doivent apparaître dans aucune réponse faite à B. */
  const secrets = () => [
    mActive.id,
    mFresh.id,
    mPerso.id,
    mActive.uid,
    mActive.uid.toUpperCase(),
    mPerso.uid,
    mPerso.uid.toUpperCase(),
    batchA,
    walletActive,
    jobA,
    codeA,
    codeFree,
    w.ids.organizerA,
    w.ids.eventA,
    w.ids.ledgerA,
  ];
  const leaks = (text: string) => secrets().filter((secret) => text.includes(secret));

  /** État des données de A touchées par les opérations de la mission. */
  const snapshot = () =>
    withOwner(async (db) => {
      const { rows } = await db.query(
        `SELECT
           (SELECT string_agg(id || ':' || status || ':' || coalesce(wallet_id::text, '-')
                              || ':' || deposit_status || ':' || deposit_held
                              || ':' || coalesce(encode(claim_code_hash, 'hex'), '-'),
                              '|' ORDER BY id)
              FROM media WHERE operator_id = $1) AS media,
           (SELECT string_agg(id || ':' || status || ':' || quantity
                              || ':' || coalesce(print_order_ref, '-') || ':' || deposit_amount,
                              '|' ORDER BY id)
              FROM media_batch WHERE operator_id = $1) AS batches,
           (SELECT string_agg(id || ':' || coalesce(media_id::text, '-')
                              || ':' || coalesce(invalidated_at::text, '-'), '|' ORDER BY id)
              FROM claim_code WHERE operator_id = $1) AS claim_codes,
           (SELECT count(*)::int FROM media_claim WHERE operator_id = $1) AS media_claims,
           (SELECT count(*)::int FROM claim_attempt WHERE operator_id = $1) AS claim_attempts,
           (SELECT count(*)::int FROM media_tap WHERE operator_id = $1) AS taps,
           (SELECT string_agg(id || ':' || status || ':' || attempts, '|' ORDER BY id)
              FROM tag_key_job WHERE operator_id = $1) AS jobs,
           (SELECT string_agg(key_index || ':' || status, '|' ORDER BY key_index)
              FROM tag_key WHERE operator_id = $1) AS tag_keys,
           (SELECT count(*)::int FROM tag_data_key WHERE operator_id = $1) AS data_keys,
           (SELECT count(*)::int FROM approval_request WHERE operator_id = $1) AS approval_requests,
           (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $2) AS transactions,
           (SELECT coalesce(customer_id::text, '-') FROM wallet WHERE id = $3) AS wallet_owner,
           (SELECT count(*)::int FROM media_batch WHERE print_order_ref = $4) AS intruder_batches`,
        [w.ops.a, w.ids.ledgerA, walletActive, INTRUS],
      );
      return rows[0] as Record<string, unknown>;
    });

  it('le contrat déclare les 39 opérations, chacune a un cas, aucun cas n’est orphelin', () => {
    expect(routes).toHaveLength(39);
    expect(new Set(routes.map((route) => route.operationId)).size).toBe(39);
    for (const route of routes) expect(PROCESSES).toContain(route.process);
    expect(
      routes.filter((route) => !(route.operationId in cases)).map((route) => route.operationId),
    ).toEqual([]);
    expect(
      Object.keys(cases).filter((id) => !routes.some((route) => route.operationId === id)),
    ).toEqual([]);
    // Chaque paramètre de chemin a une valeur dans `url` : aucun `{…}` ne reste dans un
    // appel.
    const known = /\{(operator_id|media_id|batch_id|key_index|job_id)\}/g;
    expect(
      routes.filter((route) => route.path.replace(known, '').includes('{')).map((r) => r.path),
    ).toEqual([]);
  });

  it('chaque opération est servie par son processus, et absente (404) des autres', async () => {
    const problems: string[] = [];
    for (const route of routes) {
      for (const process of ALL_PROCESSES) {
        // Appel sans identité : le processus qui sert la route la refuse (401, ou 400
        // pour la consultation publique avec un code mal formé) ; les autres ne la
        // connaissent pas.
        const res = await (route.operationId === 'lookupBalanceByClaimCode'
          ? request(apps[process].getHttpServer())
              .post(url(route, w.ops.a))
              .set('X-Forwarded-For', nextIp())
              .send({ claim_code: 'pas-un-code' })
          : send(apps[process], route, url(route, w.ops.a), { 'X-Forwarded-For': nextIp() }));
        const label = `${route.operationId} sur ${process}`;
        if (process === route.process) {
          const served = route.operationId === 'lookupBalanceByClaimCode' ? 400 : 401;
          if (res.status !== served)
            problems.push(`${label} : ${res.status} (attendu ${served}) ${res.text}`);
        } else if (res.status !== 404 || res.body?.code !== 'NOT_FOUND') {
          problems.push(`${label} : ${res.status} (attendu 404, route absente) ${res.text}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('B (personnel, terminal, festivalier) sur A : refus, sans fuite ni changement', async () => {
    const before = await snapshot();
    const problems: string[] = [];
    let calls = 0;
    for (const route of routes) {
      const c = cases[route.operationId]!;
      const refused = c.refused ?? [403, 404];
      for (const caller of callers(route)) {
        calls += 1;
        const res = await send(
          apps[route.process],
          route,
          url(route, w.ops.a),
          await caller.headers(),
        );
        const label = `${route.operationId} par ${caller.label}`;
        if (c.check) {
          const problem = c.check(res, label);
          if (problem) problems.push(problem);
        } else if (!refused.includes(res.status)) {
          problems.push(`${label} : ${res.status} (attendu ${refused.join(' ou ')}) ${res.text}`);
        }
        if (res.status === 422 && res.body?.code !== 'MEDIA_CLAIM_INVALID') {
          problems.push(`${label} : 422 inattendu ${res.text}`);
        }
        const leaked = leaks(res.text);
        if (leaked.length > 0)
          problems.push(`${label} : donnée de A dans la réponse (${leaked.join(', ')})`);
      }
    }
    expect(problems).toEqual([]);
    expect(calls).toBeGreaterThan(routes.length);
    expect(await snapshot()).toEqual(before);
  });

  it('festivalier de B : le code de A est refusé exactement comme un code inconnu', async () => {
    const route = routes.find((r) => r.operationId === 'claimMedia')!;
    const foreign = await withOwner((db) => createTestCustomer(db, w.ops.b));
    const claim = (code: string) =>
      request(apps[route.process].getHttpServer())
        .post('/v1/me/media')
        .set(foreign.headers)
        .set('Idempotency-Key', randomUUID())
        .send({ claim_code: code });
    const strip = (res: request.Response) => {
      const { instance: _instance, ...body } = res.body as Record<string, unknown>;
      return { status: res.status, body };
    };
    const known = await claim(codeA);
    expect(known.status).toBe(422);
    expect(strip(known)).toEqual(strip(await claim(generateClaimCode(randomBytes))));
  });

  it('consultation publique par code (cas particulier) : rien de plus que pour tous', async () => {
    const route = routes.find((r) => r.operationId === 'lookupBalanceByClaimCode')!;
    const lookup = (headers: Record<string, string>) =>
      request(apps[route.process].getHttpServer())
        .post('/v1/public/balance-lookups')
        .set({ 'X-Forwarded-For': nextIp(), ...headers })
        .send({ claim_code: codeA });
    const before = await snapshot();
    // Sans identité : solde et derniers mouvements, aucune donnée d'identification.
    const anonymous = await lookup({});
    expect(anonymous.status).toBe(200);
    expect(Object.keys(anonymous.body).sort()).toEqual([
      'currency',
      'media_status',
      'recent',
      'spendable',
    ]);
    expect(leaks(anonymous.text)).toEqual([]);
    expect(anonymous.text).not.toMatch(
      /customer|wallet_id|media_id|uid|token|operator|organizer|event/i,
    );
    // Une identité de B (personnel, terminal, festivalier) n'obtient rien de plus : ignorée.
    const customerB = await withOwner((db) => createTestCustomer(db, w.ops.b));
    for (const headers of [bearer(operatorAdminB), deviceB.headers, customerB.headers]) {
      const res = await lookup(headers);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(anonymous.body);
    }
    // Le code n'est pas consommé, rien ne change chez A, sauf la trace des essais en ajout
    // seul : public_balance_lookup inscrit chaque consultation (limites par code et par
    // adresse).
    const after = await snapshot();
    expect({ ...after, claim_attempts: 0 }).toEqual({ ...before, claim_attempts: 0 });
    expect(Number(after.claim_attempts) - Number(before.claim_attempts)).toBe(4);
    expect(
      await rows<{ outcome: string; customer_id: string | null }>(
        `SELECT DISTINCT outcome, customer_id FROM claim_attempt
          WHERE operator_id = $1 AND customer_id IS NULL ORDER BY outcome`,
        [w.ops.a],
      ),
    ).toEqual([{ outcome: 'LOOKUP', customer_id: null }]);
  });

  it('chez lui, B ne vise aucun objet de A ; ses listes n’en montrent aucun', async () => {
    const before = await snapshot();
    const problems: string[] = [];
    const objectParam = /\{(media_id|batch_id|job_id)\}/;
    const staffRoutes = routes.filter((route) => cases[route.operationId]!.who === 'staff');
    const targeted = staffRoutes.filter((route) => objectParam.test(route.path));
    expect(targeted.length).toBeGreaterThanOrEqual(15);
    // Écritures de collection dont le corps désigne un objet de A (organisateur, lot).
    const bodyTargeted = staffRoutes.filter((route) =>
      ['createMediaBatch', 'registerPersonalizedMedia'].includes(route.operationId),
    );
    expect(bodyTargeted).toHaveLength(2);
    for (const route of [...targeted, ...bodyTargeted]) {
      const people =
        route.process === 'personalization'
          ? [w.personalizerB]
          : [operatorAdminB, organizerAdminB, supervisorB];
      for (const person of people) {
        const res = await send(apps[route.process], route, url(route, w.ops.b), bearer(person));
        const label = `${route.operationId} (chemin de B)`;
        if (![403, 404, 409, 422].includes(res.status))
          problems.push(`${label} : ${res.status} ${res.text}`);
        const leaked = leaks(res.text);
        if (leaked.length > 0) problems.push(`${label} : donnée de A (${leaked.join(', ')})`);
      }
    }
    // Listes de B : aucun objet de A.
    const lists = staffRoutes.filter(
      (route) =>
        route.method === 'get' && !/\{(media_id|batch_id|job_id|key_index)\}/.test(route.path),
    );
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const route of lists) {
      const res = await send(
        apps[route.process],
        route,
        url(route, w.ops.b),
        bearer(operatorAdminB),
      );
      if (res.status !== 200)
        problems.push(`${route.operationId} (liste de B) : ${res.status} ${res.text}`);
      const leaked = leaks(res.text);
      if (leaked.length > 0)
        problems.push(`${route.operationId} (liste de B) : donnée de A (${leaked.join(', ')})`);
    }
    expect(problems).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
});
