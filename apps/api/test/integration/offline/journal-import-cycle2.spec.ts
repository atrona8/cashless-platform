// Import du journal, cycle 2 de WP20 (relecture du 03/11/2026) : quatre gardes jusque-là sans test (lot non
// COMPLETED, SUPERVISOR d'un autre événement, raccord de chaîne, approbateur non ACTIVE), import bloqué en PENDING
// (rejet, échéance : migration 0050) et identité vérifiée AVANT la lecture du corps (import et lots).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { PassThrough } from 'node:stream';
import type { Request } from 'express';
import { TenantTx, type TxClient } from '../../../src/db/tenant-tx';
import { JournalImportService } from '../../../src/offline/journal/journal-import.service';
import { batchBodyMiddleware, isBatchRoute } from '../../../src/offline/batches/batch-body';
import { deviceBodyGate, gatedBody, staffBodyGate } from '../../../src/offline/batches/body-gate';
import { JournalImportActions } from '../../../src/offline/journal/journal-import.action';
import { journalBodyMiddleware, isImportRoute } from '../../../src/offline/journal/journal-body';
import { parseImportBatches } from '../../../src/offline/journal/journal-verify';
import { verifyChain } from '../../../src/offline/batches/batch-chain';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { JournalWorld } from './journal-world';

jest.setTimeout(300_000);

describe('import du journal : cycle 2 (WP20)', () => {
  let world: JournalWorld;
  beforeAll(async () => {
    world = await JournalWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function exported(groups = 1) {
    const s = await world.seller(groups + 1);
    const batches = world.exportBatches(
      s.t,
      Array.from({ length: groups }, (_, i) => [world.sale(s.t, s.media[i]!, 1000, s.version)]),
    );
    return { ...s, batches, bodies: batches.map((b) => b.body) };
  }
  const importsOf = (deviceId: string) =>
    ownerRows<{ id: string; status: string; result: { reason?: string } | null }>(
      'SELECT id, status, result FROM device_journal_import WHERE device_id = $1 ORDER BY created_at',
      [deviceId],
    );
  const expire = (requestId: string) =>
    withOwner(async (db) => {
      await db.query('SET session_replication_role = replica');
      try {
        await db.query(
          `UPDATE approval_request SET expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1`,
          [requestId],
        );
      } finally {
        await db.query('SET session_replication_role = DEFAULT');
      }
    });
  const targetOf = async (requestId: string) => (await world.requestRow(requestId)).target_id;

  // ---- Constat 1 : finish(APPLIED) exige tous les lots COMPLETED -------------------------------------------------
  it('un lot reçu par une autre voie et resté PROCESSING : l’import finit FAILED BATCH_NOT_COMPLETED, jamais APPLIED', async () => {
    const e = await exported(1);
    await world.revoke(e.t);
    const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(res.status).toBe(202);
    const requestId = res.body.approval_request_id as string;
    expect((await world.approve(requestId, world.sup2)).status).toBe(200);
    const importId = await targetOf(requestId);
    // Le lot a été reçu entre-temps par la voie ordinaire (même contenu), et reste en cours : il n'est pas à nous.
    const [parsed] = parseImportBatches(e.bodies).parsed;
    const hashes = verifyChain(parsed!).opHashes;
    await withOwner((db) =>
      db.query(
        `INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes,
                                    prev_chain_hash, last_chain_hash, signature, chain_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::bytea[], $8, $9, $10, 'VERIFIED')`,
        [
          parsed!.header.batchId,
          world.w.ops.a,
          e.t.t.deviceId,
          world.pw.ledgerId,
          parsed!.header.seqFrom.toString(),
          parsed!.header.seqTo.toString(),
          hashes,
          parsed!.header.prevChainHash,
          parsed!.header.lastChainHash,
          Buffer.from(parsed!.signature, 'base64'),
        ],
      ),
    );
    const final = await world.runUntilFinal(importId);
    expect(final.status).toBe('FAILED');
    expect(final.result?.reason).toBe('BATCH_NOT_COMPLETED');
    expect(
      (
        await ownerRows('SELECT 1 FROM offline_batch WHERE id = $1 AND status = $2', [
          parsed!.header.batchId,
          'PROCESSING',
        ])
      ).length,
    ).toBe(1);
  });

  // ---- Constat 2 : SUPERVISOR d'un autre événement -----------------------------------------------------------------
  it('SUPERVISOR d’un autre événement ou d’un autre organisateur du même prestataire : 404 neutre (04/11/2026), rien créé', async () => {
    const e = await exported(1);
    await world.revoke(e.t);
    // Un autre organisateur et un autre événement DU MÊME prestataire, avec leurs SUPERVISOR.
    const others = await withOwner(async (db) => {
      const organizer = randomUUID();
      const event = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizer, world.w.ops.a],
      );
      const [profile] = (
        await db.query<{ id: string }>(`SELECT jurisdiction_id AS id FROM event WHERE id = $1`, [
          world.w.ids.eventA,
        ])
      ).rows;
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         VALUES ($1, $2, $3, 'Événement A2', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [event, world.w.ops.a, organizer, profile!.id],
      );
      const make = (scopeType: 'EVENT' | 'ORGANIZER', scopeId: string) =>
        world.w.idp.createPerson(db, {
          operatorId: world.w.ops.a,
          roles: [{ role: 'SUPERVISOR', scopeType, scopeId }],
        });
      return [
        { who: await make('EVENT', event), scopeType: 'EVENT' as const, scopeId: event },
        {
          who: await make('ORGANIZER', organizer),
          scopeType: 'ORGANIZER' as const,
          scopeId: organizer,
        },
      ];
    });
    for (const { who } of others) {
      const res = await world.requestImport(who, e.t.t.deviceId, e.bodies);
      expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
    }
    // Le contrôle propre au service (avant tout create_) : le service d'approbation le double, mais ne le remplace pas.
    const service = world.api.app.get(JournalImportService, { strict: false });
    const tx = world.api.app.get(TenantTx, { strict: false });
    const read = <T>(fn: (client: TxClient) => Promise<T>) => tx.run(world.w.ops.a, fn);
    const prepared = service.prepare(
      Buffer.from(JSON.stringify({ batches: e.bodies, reason: 'Import du journal après perte' })),
      false,
    );
    const actorOf = (userId: string, scopeType: string, scopeId: string) =>
      ({
        operatorId: world.w.ops.a,
        role: 'SUPERVISOR',
        audit: {},
        principal: {
          userId,
          operatorId: world.w.ops.a,
          assignments: [{ role: 'SUPERVISOR', scopeType, scopeId }],
          issuer: 'test',
          subject: userId,
        },
      }) as never;
    for (const { who, scopeType, scopeId } of others)
      await expect(
        service.check(read, actorOf(who.userId, scopeType, scopeId), e.t.t.deviceId, prepared),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.check(
        read,
        actorOf(world.sup1.userId, 'ORGANIZER', world.w.ids.organizerA),
        e.t.t.deviceId,
        prepared,
      ),
    ).resolves.toMatchObject({ eventId: world.w.ids.eventA });
    expect(await importsOf(e.t.t.deviceId)).toHaveLength(0);
    expect(
      await ownerRows(
        `SELECT 1 FROM approval_request WHERE action = 'DEVICE_JOURNAL_IMPORT' AND payload->>'device_id' = $1`,
        [e.t.t.deviceId],
      ),
    ).toHaveLength(0);
    // Le SUPERVISOR de l'événement, lui, passe.
    expect((await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies)).status).toBe(202);
  });

  // ---- Constat 3 : raccord prevChainHash entre deux lots contigus --------------------------------------------------
  it('deux lots contigus dont le second a un prev_chain_hash altéré (re-signé) : 409 CHAIN_BROKEN, rien créé', async () => {
    const s = await world.seller(2);
    const [first] = world.exportBatches(s.t, [[world.sale(s.t, s.media[0]!, 1000, s.version)]]);
    const second = s.t.t.buildBatch([world.sale(s.t, s.media[1]!, 500, s.version)], {
      ledgerId: world.pw.ledgerId,
      prev: Buffer.alloc(32, 9),
    });
    await world.revoke(s.t);
    const res = await world.requestImport(world.sup1, s.t.t.deviceId, [first!.body, second.body]);
    expect([res.status, res.body.code]).toEqual([409, 'CHAIN_BROKEN']);
    expect(await importsOf(s.t.t.deviceId)).toHaveLength(0);
  });

  // ---- Constat 4 : approbateur non ACTIVE ---------------------------------------------------------------------------
  it('assertApprover refuse un SUPERVISOR désactivé du même prestataire', async () => {
    const disabled = await withOwner((db) =>
      world.w.idp.createPerson(db, {
        operatorId: world.w.ops.a,
        status: 'DISABLED',
        roles: [{ role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: world.w.ids.organizerA }],
      }),
    );
    const actions = world.api.app.get(JournalImportActions, { strict: false });
    const tx = world.api.app.get(TenantTx, { strict: false });
    await tx.run(world.w.ops.a, async (client) => {
      await expect(
        actions.assertApprover(client, world.w.ops.a, world.sup1.userId, disabled.userId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        actions.assertApprover(client, world.w.ops.a, world.sup1.userId, world.sup2.userId),
      ).resolves.toBeUndefined();
    });
  });

  // ---- Import bloqué en PENDING : rejet, échéance -------------------------------------------------------------------
  it('rejet de la demande : import REJECTED, audité ; une nouvelle demande est acceptée puis appliquée', async () => {
    const e = await exported(2);
    await world.revoke(e.t);
    const first = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(first.status).toBe(202);
    const firstRequest = first.body.approval_request_id as string;
    const firstImport = await targetOf(firstRequest);
    // Demande encore valable : pas de seconde demande, l'import reste PENDING.
    expect((await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies)).status).toBe(409);
    expect((await world.importRow(firstImport))?.status).toBe('PENDING');
    const rejected = await world.bo(
      'POST',
      `/approval-requests/${firstRequest}/reject`,
      world.sup2,
      {
        note: 'Refusé pour le test',
      },
    );
    expect([rejected.status, rejected.body.status]).toEqual([200, 'REJECTED']);
    const imp = await world.importRow(firstImport);
    expect(imp?.status).toBe('REJECTED');
    expect(imp?.result).toMatchObject({ reason: 'REJECTED', cancelled_by: world.sup2.userId });
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'DEVICE_JOURNAL_IMPORT_CANCELLED' AND object_id = $1`,
        [firstImport],
      ),
    ).toHaveLength(1);
    const again = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(again.status).toBe(202);
    const request = again.body.approval_request_id as string;
    expect((await world.approve(request, world.sup2)).status).toBe(200);
    const final = await world.runUntilFinal(await targetOf(request));
    expect(final.status).toBe('APPLIED');
    expect((await world.importRow(firstImport))?.status).toBe('REJECTED');
  });

  it('demande échue puis décidée trop tard : 409, import REJECTED (EXPIRED), nouvelle demande acceptée', async () => {
    const e = await exported(1);
    await world.revoke(e.t);
    const first = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    const requestId = first.body.approval_request_id as string;
    const importId = await targetOf(requestId);
    await expire(requestId);
    const late = await world.approve(requestId, world.sup2);
    expect([late.status, late.body.code]).toEqual([409, 'APPROVAL_INVALID']);
    expect((await world.requestRow(requestId)).status).toBe('EXPIRED');
    const imp = await world.importRow(importId);
    expect(imp?.status).toBe('REJECTED');
    expect(imp?.result).toMatchObject({ reason: 'EXPIRED' });
    expect((await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies)).status).toBe(202);
  });

  it('demande échue que personne n’a décidée : la nouvelle demande libère l’ancien import', async () => {
    const e = await exported(1);
    await world.revoke(e.t);
    const first = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    const requestId = first.body.approval_request_id as string;
    const importId = await targetOf(requestId);
    await expire(requestId);
    expect((await world.importRow(importId))?.status).toBe('PENDING');
    const again = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(again.status).toBe(202);
    const imp = await world.importRow(importId);
    expect(imp?.status).toBe('REJECTED');
    expect(imp?.result).toMatchObject({ reason: 'EXPIRED' });
    const rows = await importsOf(e.t.t.deviceId);
    expect(rows.map((r) => r.status)).toEqual(['REJECTED', 'PENDING']);
  });

  // ---- Identité avant lecture du corps ---------------------------------------------------------------------------------
  /** Requête factice : un flux jamais consommé, avec les en-têtes et le chemin d'une vraie. */
  function fakeRequest(path: string, headers: Record<string, string>) {
    const stream = new PassThrough();
    const req = Object.assign(stream, {
      method: 'POST',
      path,
      headers: { 'content-type': 'application/json', ...headers },
      header(name: string) {
        return (this.headers as Record<string, string>)[name.toLowerCase()];
      },
    });
    return req as unknown as Request & PassThrough & { rawBody?: Buffer; body?: unknown };
  }
  /** Passe la requête dans l'enveloppe, y écrit 5 Mio, et dit si le corps a été lu. */
  async function bodyRead(
    wrapped: ReturnType<typeof gatedBody>,
    req: ReturnType<typeof fakeRequest>,
  ): Promise<boolean> {
    // Le corps est déjà là (en mémoire du flux) : seule une lecture le consomme.
    req.write(Buffer.alloc(5 * 1_048_576, 120));
    req.end();
    await new Promise<void>((resolve) => wrapped(req, {} as never, () => resolve()));
    await sleep(50);
    return (
      req.rawBody !== undefined || req.listenerCount('data') > 0 || req.readableFlowing === true
    );
  }
  const importPath = (id: string) => `/v1/devices/${id}/journal-imports`;

  it('import : jeton invalide, absent, d’un CASHIER ou désactivé : le corps n’est pas lu (aucun écouteur sur le flux)', async () => {
    const gate = staffBodyGate(world.api.app, ['SUPERVISOR']);
    expect(gate).toBeDefined();
    const wrapped = gatedBody(journalBodyMiddleware, isImportRoute, gate);
    const disabled = await withOwner((db) =>
      world.w.idp.createPerson(db, {
        operatorId: world.w.ops.a,
        status: 'DISABLED',
        roles: [{ role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: world.w.ids.organizerA }],
      }),
    );
    const path = importPath(randomUUID());
    for (const authorization of [
      'Bearer garbage.garbage.garbage',
      'Bearer ',
      `Bearer ${world.w.cashierA.token}`,
      `Bearer ${disabled.token}`,
    ]) {
      const req = fakeRequest(path, { authorization });
      expect([authorization.slice(0, 20), await bodyRead(wrapped, req)]).toEqual([
        authorization.slice(0, 20),
        false,
      ]);
      expect(req.headers['content-type']).toBeUndefined();
      expect(req.readableFlowing).toBeNull();
    }
    // Contre-épreuve : un SUPERVISOR est lu (le test sait donc voir une lecture).
    const ok = fakeRequest(path, { authorization: `Bearer ${world.sup1.token}` });
    expect(await bodyRead(wrapped, ok)).toBe(true);
    expect(ok.rawBody?.length).toBe(5 * 1_048_576);
  });

  /** Statut de la réponse ; une coupure d'écriture (le serveur répond sans lire le corps) n'est pas une erreur. */
  function statusOf(path: string, headers: Record<string, string>, body: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${world.api.baseUrl}${path}`);
      const req = httpsRequest(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          ca: world.api.tls.serverCaPem,
          servername: url.hostname,
          agent: false,
          headers: {
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
            ...headers,
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', (error) => {
        // Coupure d'écriture : la réponse est déjà en route ; sans elle, on échoue (pas d'attente infinie).
        if (['EPIPE', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? ''))
          setTimeout(() => reject(error), 3000);
        else reject(error);
      });
      req.end(body);
    });
  }

  it('import : corps de 150 Kio (au-delà de l’analyseur global) avec jeton invalide 401, avec jeton de CASHIER 403', async () => {
    const huge = `{"reason":"${'x'.repeat(150 * 1024)}"}`;
    const path = `/devices/${randomUUID()}/journal-imports`;
    expect(await statusOf(path, { authorization: 'Bearer garbage.garbage.garbage' }, huge)).toBe(
      401,
    );
    expect(await statusOf(path, { authorization: `Bearer ${world.w.cashierA.token}` }, huge)).toBe(
      403,
    );
  });

  it('POST /offline-batches : jeton de terminal invalide ou absent : le corps n’est pas lu ; 401 pour un corps de 150 Kio', async () => {
    const gate = deviceBodyGate(world.api.app);
    expect(gate).toBeDefined();
    const wrapped = gatedBody(batchBodyMiddleware, isBatchRoute, gate);
    for (const headers of <Array<Record<string, string>>>[
      { authorization: 'Bearer garbage.garbage.garbage' },
      {},
      { authorization: `Bearer ${world.sup1.token}` },
    ]) {
      const req = fakeRequest('/v1/offline-batches', headers);
      expect(await bodyRead(wrapped, req)).toBe(false);
      expect(req.readableFlowing).toBeNull();
    }
    expect(
      await statusOf(
        '/offline-batches',
        { authorization: 'Bearer garbage.garbage.garbage' },
        `{"pad":"${'x'.repeat(150 * 1024)}"}`,
      ),
    ).toBe(401);
  });

  it('une route étrangère n’est pas touchée par le filtre ; un filtre en erreur refuse la lecture', async () => {
    const calls = jest.fn(async () => true);
    const next = jest.fn();
    const handler = jest.fn((_req, _res, n: () => void) => n());
    gatedBody(handler as never, () => false, calls)({} as never, {} as never, next);
    expect(calls).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    const failing = fakeRequest('/v1/offline-batches', {});
    const failed = gatedBody(
      handler as never,
      () => true,
      async () => {
        throw new Error('base indisponible');
      },
    );
    await new Promise<void>((resolve) => failed(failing, {} as never, () => resolve()));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(failing.readableFlowing).toBeNull();
  });
});
