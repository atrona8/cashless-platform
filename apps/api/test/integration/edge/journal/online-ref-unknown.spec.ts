// `ONLINE_REF` inconnue après reprise forcée (mission 8, lot WP14, T063 ; research R-23, décision 4 du porteur). Route
// réelle `POST /offline-batches`, vrai processeur : le résultat reste `VOID` / `ONLINE_NOT_EXECUTED` (aucun changement de
// contrat) et seule l'anomalie `EDGE_REPLAY_FAILED` s'ajoute, dans les trois conditions de R-23 et pas en dehors.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TenantTx } from '../../../../src/db/tenant-tx';
import type { BatchContext, ParsedOperation } from '../../../../src/offline/batches/batch.types';
import { resolveOnlineRef } from '../../../../src/offline/processing/online-ref-resolver';
import { tapBody } from '../../../support/media-fixtures';
import { ProcessingWorld, type OfflineTerminal } from '../../offline/processing-fixtures';
import { dbNow, edgeAnomalies, onlineRef, Takeover, type ReplayedVia } from './journal-support';

jest.setTimeout(240_000);

describe('ONLINE_REF inconnue à la reprise forcée (WP14, T063)', () => {
  let world: ProcessingWorld;
  let takeover: Takeover;
  beforeAll(async () => {
    world = await ProcessingWorld.create();
    takeover = new Takeover(world);
  });
  afterAll(async () => {
    await world?.close();
  });

  const terminal = (): Promise<OfflineTerminal> => world.terminal();
  const nextSeq = (t: OfflineTerminal): number => t.t.nextBatchSeq;
  const VOID_RESULT = { status: 'ACCEPTED', effect: 'NONE', retryable: false };
  const registry = async (t: OfflineTerminal) =>
    (await world.pw.registry(t.t.deviceId)).map((r) => [r.seq, r.outcome, r.reason]);

  it('reprise forcée, activation inconnue : VOID comme avant et une anomalie avec bracelet, terminal, clé, montant', async () => {
    const { handoverId } = await takeover.set({});
    const t = await terminal();
    const [m] = await world.pw.media(1, 1000);
    const at = new Date(dbNow() - 5000).toISOString();
    const res = await world.submit(t, [
      onlineRef('activateMedia', {
        amount: 5000,
        extra: { tap: tapBody(m!.media, 1, { occurred_at: at }) },
      }),
    ]);
    expect(world.results(res)[0]).toMatchObject({ seq: 1, ...VOID_RESULT });
    expect(await registry(t)).toEqual([['1', 'VOID', 'ONLINE_NOT_EXECUTED']]);
    const an = await edgeAnomalies(t.t.deviceId);
    expect(an).toHaveLength(1);
    expect(an[0]).toMatchObject({
      seq: '1',
      amount: '5000',
      loss_bearer: 'OPERATOR',
      media_id: m!.media.id,
      status: 'OPEN',
      batch_id: res.batch.header.batch_id,
    });
    expect(an[0]!.detail).toMatchObject({
      origin_key: `${t.t.serial}:0001`,
      recovery_id: handoverId,
      amount_known: true,
    });
    // Ni écriture au grand livre, ni contenu d'opération dans l'anomalie.
    expect(await world.txRows(t.t.deviceId)).toHaveLength(0);
    expect(JSON.stringify(an[0]!.detail)).not.toMatch(/occurred_at|tap|token|signature/);
  });

  it('sans reprise forcée : même entrée, même résultat, aucune anomalie (comportement d’avant inchangé)', async () => {
    await takeover.set(null);
    const t = await terminal();
    const res = await world.submit(t, [onlineRef('activateMedia', { amount: 5000 })]);
    expect(world.results(res)[0]).toMatchObject({ seq: 1, ...VOID_RESULT });
    expect(await registry(t)).toEqual([['1', 'VOID', 'ONLINE_NOT_EXECUTED']]);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(0);
  });

  it.each<[string, ReplayedVia, string]>([
    ['écriture du journal (rejouée par la passerelle)', 'JOURNAL', ''],
    ['registre EDGE_SYNC (même sans la clé au journal)', 'EDGE_REGISTRY', ''],
    ['registre d’idempotence de la route en ligne', 'ONLINE_IDEMPOTENCY', ''],
  ])('activation déjà rejouée : %s, aucune anomalie', async (_label, via) => {
    await takeover.set({});
    const t = await terminal();
    await takeover.replayed(t, nextSeq(t), via);
    const res = await world.submit(t, [onlineRef('activateMedia', { amount: 5000 })]);
    const [r] = world.results(res);
    if (via === 'JOURNAL')
      expect(r).toMatchObject({ status: 'DUPLICATE', effect: 'LEDGER_WRITTEN' });
    else expect(r).toMatchObject(VOID_RESULT);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(0);
  });

  it('caution : la clé #deposit rejouée suffit pour la caution, jamais pour l’activation (une anomalie, pas deux)', async () => {
    await takeover.set({});
    const t = await terminal();
    const first = nextSeq(t);
    // seq 1 : activation dont seule la caution `#deposit` a été rejouée ; seq 2 : caution rejouée ; seq 3 : caution inconnue.
    await takeover.replayed(t, first, 'EDGE_REGISTRY', '#deposit');
    await takeover.replayed(t, first + 1, 'EDGE_REGISTRY', '#deposit');
    const res = await world.submit(t, [
      onlineRef('activateMedia', { amount: 2000 }),
      onlineRef('takeDeposit', { amount: 2000 }),
      onlineRef('takeDeposit', { amount: 3000 }),
    ]);
    for (const r of world.results(res)) expect(r).toMatchObject(VOID_RESULT);
    const an = await edgeAnomalies(t.t.deviceId);
    expect(an.map((a) => [a.seq, a.amount])).toEqual([
      ['1', '2000'],
      ['3', '3000'],
    ]);
  });

  it('montant inconnu : montant nul et détail « montant inconnu », jamais un montant deviné', async () => {
    await takeover.set({});
    const t = await terminal();
    const res = await world.submit(t, [onlineRef('takeDeposit')]);
    expect(world.results(res)[0]).toMatchObject(VOID_RESULT);
    const [a] = await edgeAnomalies(t.t.deviceId);
    expect(a).toMatchObject({ amount: '0' });
    expect(a!.detail).toMatchObject({ amount_known: false });
    expect(String(a!.detail!.message)).toContain('montant inconnu');
  });

  it('les trois conditions sont nécessaires : bascule non forcée, passerelle non révoquée, non accusée, antérieure', async () => {
    const cases: Array<[string, Parameters<Takeover['set']>[0], number]> = [
      [
        'passerelle révoquée sans bascule forcée (inscription retirée)',
        { handover: 'COMPLETED' },
        5,
      ],
      ['bascule forcée mais passerelle non révoquée', { gateway: 'ACTIVE' }, 5],
      ['reprise forcée avant l’accusé de bascule', { acked: false }, 5],
      ['opération antérieure à l’accord de la bascule', { grantedAgo: 600 }, 7200],
    ];
    for (const [label, state, agoSeconds] of cases) {
      await takeover.set(state);
      const t = await terminal();
      const res = await world.submit(t, [onlineRef('activateMedia', { amount: 900, agoSeconds })]);
      expect([label, world.results(res)[0]]).toEqual([label, expect.objectContaining(VOID_RESULT)]);
      expect([label, await edgeAnomalies(t.t.deviceId)]).toEqual([label, []]);
    }
  });

  it('OP-N117 : borne haute de la reprise (fin accusée) à la tolérance près ; avant la fin : anomalie', async () => {
    // Reprise terminée il y a 600 s ; tolérance de 120 s de chaque côté.
    const cases: Array<[string, number, number]> = [
      ['opération datée de 5 s : bien après la fin de la reprise', 5, 0],
      ['opération datée juste après la fin, hors tolérance (400 s)', 400, 0],
      ['opération datée de 700 s : avant la fin de la reprise', 700, 1],
      ['opération datée juste avant la fin (560 s) : dans la reprise', 560, 1],
      ['opération datée juste après la fin, dans la tolérance (520 s)', 520, 1],
    ];
    for (const [label, agoSeconds, expected] of cases) {
      await takeover.set({ endedAgo: 600 });
      const t = await terminal();
      const res = await world.submit(t, [onlineRef('activateMedia', { amount: 900, agoSeconds })]);
      expect([label, world.results(res)[0]]).toEqual([label, expect.objectContaining(VOID_RESULT)]);
      expect([label, (await edgeAnomalies(t.t.deviceId)).length]).toEqual([label, expected]);
    }
    // Sans fin posée (aucune borne haute) : l'opération récente reste signalée, comme avant.
    await takeover.set({});
    const t = await terminal();
    await world.submit(t, [onlineRef('activateMedia', { amount: 900 })]);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(1);
  });

  it('opérations en ligne autres que l’activation et la caution (restitution) : comportement d’avant', async () => {
    await takeover.set({});
    const t = await terminal();
    const res = await world.submit(t, [onlineRef('refundDeposit', { amount: 100 })]);
    expect(world.results(res)[0]).toMatchObject(VOID_RESULT);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(0);
  });

  it('même lot renvoyé deux fois : toujours une seule anomalie, résultat mémorisé identique', async () => {
    await takeover.set({});
    const t = await terminal();
    const ops = [onlineRef('activateMedia', { amount: 1500 })];
    const batch = t.t.buildBatch(ops, { ledgerId: world.ledgerId });
    const send = () => t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, batch);
    const first = world.results(await send());
    const second = world.results(await send());
    expect(second).toEqual(first);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(1);
  });

  it('même clé d’origine résolue deux fois, en parallèle ou non : une seule anomalie (idempotence par clé)', async () => {
    await takeover.set({});
    const t = await terminal();
    // Une première opération consomme le numéro 1 et la clé ; on rejoue le résolveur sur cette même clé.
    const res = await world.submit(t, [onlineRef('takeDeposit', { amount: 700 })]);
    expect(world.results(res)[0]).toMatchObject(VOID_RESULT);
    const tx = world.pw.api.app.get(TenantTx, { strict: false });
    const ctx = {
      batchId: res.batch.header.batch_id,
      deviceId: t.t.deviceId,
      operatorId: world.operatorId,
      ledgerId: world.ledgerId,
      serial: t.t.serial,
      receivedAt: new Date(),
      receivedVia: 'DEVICE',
      importId: null,
      authorityEpoch: 0,
      inversions: [],
    } as BatchContext;
    const op = {
      seq: 1n,
      type: 'ONLINE_REF',
      raw: onlineRef('takeDeposit', { amount: 700 }),
    } as unknown as ParsedOperation;
    const ids = await Promise.all(
      [1, 2, 3].map(() =>
        tx.run(world.operatorId, (client) => resolveOnlineRef(client, ctx, op, 'OPERATOR')),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(1);
  });

  it('ONLINE_REF CONFIRMED à transaction introuvable (R-30.1) : VOID inchangé, ONLINE_CONFIRMED_MISSING gardée, une seule EDGE_REPLAY_FAILED', async () => {
    await takeover.set({});
    const t = await terminal();
    const [m] = await world.pw.media(1, 5000);
    const version = await world.snapshot(t, [m!]);
    const at = new Date(dbNow() - 1000).toISOString();
    // L'opération doit passer la conformité (snapshot, configuration, session, lecture) pour atteindre le second appel.
    const op = onlineRef('activateMedia', {
      amount: 2200,
      agoSeconds: 1,
      extra: {
        online_status: 'CONFIRMED',
        online_transaction_id: randomUUID(),
        tap: tapBody(m!.media, 1, { occurred_at: at }),
        snapshot_version: version,
        config_id: t.configId,
        vendor_session_id: t.sessionId,
      },
    });
    const batch = t.t.buildBatch([op], { ledgerId: world.ledgerId });
    const send = () => t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, batch);
    const first = world.results(await send());
    expect(first[0]).toMatchObject(VOID_RESULT);
    expect(await registry(t)).toEqual([['1', 'VOID', 'ONLINE_NOT_EXECUTED']]);
    expect(await edgeAnomalies(t.t.deviceId, 'ONLINE_CONFIRMED_MISSING')).toHaveLength(1);
    const an = await edgeAnomalies(t.t.deviceId);
    expect(an.map((a) => [a.seq, a.amount])).toEqual([['1', '2200']]);
    // Même lot renvoyé : résultat mémorisé, toujours une seule anomalie de chaque sorte.
    expect(world.results(await send())).toEqual(first);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(1);
    // Sans reprise forcée : même résultat, ONLINE_CONFIRMED_MISSING seule.
    await takeover.set(null);
    const u = await terminal();
    const [m2] = await world.pw.media(1, 5000);
    const v2 = await world.snapshot(u, [m2!]);
    const at2 = new Date(dbNow() - 1000).toISOString();
    const op2 = {
      ...op,
      occurred_at: at2,
      tap: tapBody(m2!.media, 1, { occurred_at: at2 }),
      snapshot_version: v2,
      config_id: u.configId,
      vendor_session_id: u.sessionId,
    };
    const res = await world.submit(u, [op2]);
    expect(world.results(res)[0]).toMatchObject(VOID_RESULT);
    expect(await edgeAnomalies(u.t.deviceId)).toHaveLength(0);
    expect(await edgeAnomalies(u.t.deviceId, 'ONLINE_CONFIRMED_MISSING')).toHaveLength(1);
  });

  it('aucun INSERT INTO anomaly dans apps/api/src/edge/** (écriture par open_offline_anomaly seulement)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../../../src/edge');
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) =>
          e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
        );
    const writers = walk(root).filter((f) =>
      /INSERT\s+INTO\s+anomaly\b/i.test(fs.readFileSync(f, 'utf8')),
    );
    expect(writers).toEqual([]);
  });
});
