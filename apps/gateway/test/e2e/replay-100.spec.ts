// T115 / NFR-003 : 100 rejeux d'une même opération par trois chemins, une seule écriture par clé
// d'idempotence et par chemin.
//   1. envoi direct au central (autorité CENTRAL) : 100 fois le même `POST /payments` ;
//   2. via la passerelle : 100 fois le même paiement (une entrée de file), puis, après le rendu,
//      le même paiement renvoyé au central par le terminal (rejeu direct) : un seul effet ;
//   3. lot de terminal hors ligne (`POST /offline-batches`) : 100 envois du même lot au central,
//      une seule écriture par opération du lot ;
//   4. lot de terminal hors ligne relayé par la passerelle, puis rejoué directement au central
//      (et l'inverse : central d'abord, puis la passerelle) : une seule écriture par clé, et le
//      central répond `DUPLICATE` à la seconde voie.
// Contrôle de sensibilité : deux clés différentes écrivent deux fois (le compteur voit une
// écriture de plus), sinon un comptage qui rendrait toujours 1 ne prouverait rien.
import 'reflect-metadata';
import { ProcessingWorld } from '../../../api/test/integration/offline/processing-fixtures';
import type { PayTerminal } from '../../../api/test/integration/payments/payments-fixtures';
import { TwoProcessBench, until } from '../support/two-process-bench';
import { activateEdge, report } from '../support/load-support';

const REPLAYS = 100;

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const central = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.centralQuery<T>(sql, params);
const local = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.localQuery<T>(sql, params);

/** Écritures de vente du terminal au registre du central. */
const purchases = async (till: PayTerminal): Promise<number> =>
  Number(
    (
      await central<{ n: string }>(
        `SELECT count(*)::text AS n FROM journal_transaction
          WHERE device_id = $1 AND type = 'PURCHASE'`,
        [till.t.deviceId],
      )
    )[0]!.n,
  );

describe('NFR-003 : 100 rejeux par trois chemins', () => {
  it('chemin 1, central direct : une écriture, 100 réponses 2xx identiques', async () => {
    bench = await TwoProcessBench.start();
    const w = bench.world;
    const till = await w.terminal();
    const media = await w.media(2, 1_000_000);
    const key = till.t.seqKey();
    const body = w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]);
    const first = await w.pay(till, body, { key, epoch: String(bench.epoch) });
    expect(first.status).toBe(201);
    for (let i = 0; i < REPLAYS; i += 1) {
      const again = await w.pay(till, body, { key, epoch: String(bench.epoch) });
      expect(again.status).toBeGreaterThanOrEqual(200);
      expect(again.status).toBeLessThan(300);
      expect(again.body.transaction_id).toBe(first.body.transaction_id);
    }
    expect(await purchases(till)).toBe(1);
    // Sensibilité : une AUTRE clé (autre tape) écrit une seconde fois.
    const other = await w.pay(till, w.catalogBody(till, { tap: w.tap(media[1]!) }, [[0, 1]]), {
      key: till.t.seqKey(),
      epoch: String(bench.epoch),
    });
    expect(other.status).toBe(201);
    expect(await purchases(till)).toBe(2);
    report('NFR-003 chemin 1', { rejeux: REPLAYS, ecritures: 1 });
  }, 600_000);

  it('chemin 2, via la passerelle puis rejeu direct après le rendu : un seul effet', async () => {
    const w = bench.world;
    const till = await w.terminal();
    const media = await w.media(1, 1_000_000);
    await activateEdge(bench, [media[0]!.walletId]);
    const key = till.t.seqKey();
    const body = w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]);
    const queueBefore = Number(
      (await local<{ n: string }>('SELECT count(*)::text AS n FROM edge_op'))[0]!.n,
    );
    const first = await bench.gwPay(till, body, { key });
    expect(first.status).toBe(201);
    for (let i = 0; i < REPLAYS; i += 1) {
      const again = await bench.gwPay(till, body, { key });
      expect(again.status).toBeGreaterThanOrEqual(200);
      expect(again.status).toBeLessThan(300);
      expect(again.body.transaction_id).toBe(first.body.transaction_id);
    }
    const queued =
      Number((await local<{ n: string }>('SELECT count(*)::text AS n FROM edge_op'))[0]!.n) -
      queueBefore;
    expect(queued).toBe(1);

    await bench.releaseToCentral();
    await until(
      'rendu terminé',
      async () =>
        (
          await central<{ status: string }>(
            `SELECT status FROM debit_authority_handover
              WHERE ledger_id = $1 AND direction = 'TO_CENTRAL' ORDER BY requested_at DESC LIMIT 1`,
            [bench.ledgerId],
          )
        )[0]?.status === 'COMPLETED',
      180_000,
      200,
    );
    expect(await purchases(till)).toBe(1);
    // Le terminal renvoie la vente au central sans savoir si elle est passée : aucun effet.
    await bench.refreshEpoch();
    for (let i = 0; i < 10; i += 1) {
      const direct = await w.pay(till, body, { key, epoch: String(bench.epoch) });
      expect(direct.status).toBeLessThan(500);
    }
    expect(await purchases(till)).toBe(1);
    report('NFR-003 chemin 2', { rejeux: REPLAYS, entreesDeFile: queued, ecritures: 1 });
  }, 600_000);

  it('chemin 3, lot de terminal rejoué 100 fois : une écriture par opération', async () => {
    const world = new ProcessingWorld();
    world.pw = bench.world;
    const t = await world.terminal();
    const media = await world.pw.media(2, 1_000_000);
    const version = await world.snapshot(t, media);
    const ops = [world.sale(t, media[0]!, 500, version), world.sale(t, media[1]!, 700, version)];
    const epoch = Number(
      (
        await central<{ e: string }>(
          'SELECT authority_epoch::text AS e FROM ledger WHERE id = $1',
          [bench.ledgerId],
        )
      )[0]!.e,
    );
    const batch = t.t.buildBatch(ops, { ledgerId: bench.ledgerId, epoch });
    const send = () => t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, batch);
    const first = await send();
    const results = world.results(first);
    expect(results.map((r) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    for (let i = 0; i < REPLAYS; i += 1) {
      const again = await send();
      expect(again.status).toBe(200);
      expect(
        world.results(again).every((r) => r.status === 'DUPLICATE' || r.status === 'ACCEPTED'),
      ).toBe(true);
    }
    expect(await purchases(t)).toBe(2);
    report('NFR-003 chemin 3', { rejeux: REPLAYS, ecritures: 2 });
  }, 600_000);

  it("chemin 4, lot relayé par la passerelle puis rejeu direct, et l'inverse", async () => {
    bench ??= await TwoProcessBench.start();
    const world = new ProcessingWorld();
    world.pw = bench.world;
    type Terminal = Awaited<ReturnType<ProcessingWorld['terminal']>>;
    const gwBatch = async (t: Terminal, batch: Parameters<Terminal['t']['submitBatch']>[2]) =>
      t.t.submitBatch(bench.gwBaseUrl, bench.serverCa, batch, {
        proofs: { token: await bench.gatewayToken(t) },
      });
    const direct = (t: Terminal, batch: Parameters<Terminal['t']['submitBatch']>[2]) =>
      t.t.submitBatch(bench.centralBaseUrl, bench.serverCa, batch);
    const authorityEpoch = async (): Promise<number> =>
      Number(
        (
          await central<{ e: string }>(
            'SELECT authority_epoch::text AS e FROM ledger WHERE id = $1',
            [bench.ledgerId],
          )
        )[0]!.e,
      );
    const statuses = (res: { status: number; text: string; body: unknown }): string[] =>
      world.results(res as never).map((r) => String(r.status));
    // Les mêmes opérations (mêmes clés `serial:seq`) dans un lot neuf, à l'époque courante : un lot
    // est signé pour UNE époque, un rejeu après un changement d'autorité ne peut être que cela.
    const again = (t: Terminal, first: ReturnType<Terminal['t']['buildBatch']>, epoch: number) =>
      t.t.buildBatch(first.journal.operations as never, {
        ledgerId: bench.ledgerId,
        epoch,
        fromSeq: Number(first.header.seq_from),
        prev: Buffer.from(String(first.header.prev_chain_hash), 'hex'),
      });
    const relayedStatuses = async (serial: string): Promise<string[]> =>
      (
        await local<{ s: string }>(
          'SELECT central_status AS s FROM edge_op WHERE origin_key LIKE $1 ORDER BY edge_seq',
          [`${serial}%`],
        )
      ).map((r) => r.s);
    const waitRelease = () =>
      until(
        'rendu terminé',
        async () =>
          (
            await central<{ status: string }>(
              `SELECT status FROM debit_authority_handover
                WHERE ledger_id = $1 AND direction = 'TO_CENTRAL'
                ORDER BY requested_at DESC LIMIT 1`,
              [bench.ledgerId],
            )
          )[0]?.status === 'COMPLETED',
        180_000,
        200,
      );

    // (a) Passerelle d'abord : le lot est relayé au rendu, puis le terminal le rejoue au central.
    const ta = await world.terminal();
    const mediaA = await world.pw.media(2, 1_000_000);
    await activateEdge(
      bench,
      mediaA.map((m) => m.walletId),
    );
    const versionA = await world.snapshot(ta, mediaA);
    await seedLocalSnapshot(bench, ta.t.deviceId, versionA, mediaA);
    const opsA = [
      world.sale(ta, mediaA[0]!, 500, versionA),
      world.sale(ta, mediaA[1]!, 700, versionA),
    ];
    const batchA = ta.t.buildBatch(opsA, { ledgerId: bench.ledgerId, epoch: bench.epoch });
    const viaGateway = await gwBatch(ta, batchA);
    expect(viaGateway.status).toBe(200);
    const localA = statuses(viaGateway);
    expect(localA).toEqual(['ACCEPTED', 'ACCEPTED']);
    await bench.releaseToCentral();
    await waitRelease();
    // Le central reçoit la décision locale de la passerelle (`edge_decision`) : il écrit les deux
    // ventes au relais, ni plus (refus pour décision absente) ni moins.
    const relayedA = await relayedStatuses(ta.t.serial);
    const writtenByRelay = await purchases(ta);
    expect(relayedA).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(writtenByRelay).toBe(2);
    const replayA = await direct(ta, again(ta, batchA, await authorityEpoch()));
    expect(statuses(replayA)).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(await purchases(ta)).toBe(2);
    // Troisième envoi : dans tous les cas un doublon, toujours deux écritures.
    const thirdA = await direct(ta, again(ta, batchA, await authorityEpoch()));
    expect(statuses(thirdA)).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(await purchases(ta)).toBe(2);

    // (b) Central d'abord, puis les mêmes opérations par la passerelle.
    const tb = await world.terminal();
    const mediaB = await world.pw.media(2, 1_000_000);
    const versionB = await world.snapshot(tb, mediaB);
    const opsB = [
      world.sale(tb, mediaB[0]!, 500, versionB),
      world.sale(tb, mediaB[1]!, 700, versionB),
    ];
    const batchB = tb.t.buildBatch(opsB, {
      ledgerId: bench.ledgerId,
      epoch: await authorityEpoch(),
    });
    expect(statuses(await direct(tb, batchB))).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(await purchases(tb)).toBe(2);
    await activateEdge(
      bench,
      mediaB.map((m) => m.walletId),
    );
    await seedLocalSnapshot(bench, tb.t.deviceId, versionB, mediaB);
    const viaGatewayB = await gwBatch(tb, again(tb, batchB, bench.epoch));
    expect(viaGatewayB.status).toBe(200);
    const localB = statuses(viaGatewayB);
    await bench.releaseToCentral();
    await waitRelease();
    const relayedB = await relayedStatuses(tb.t.serial);
    expect(relayedB).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(await purchases(tb)).toBe(2);
    report('NFR-003 chemin 4', {
      passerelleDabord: {
        verdictLocal: localA,
        relaiAuCentral: relayedA,
        ecrituresParLeRelai: writtenByRelay,
        rejeuDirect: statuses(replayA),
        ecritures: 2,
      },
      centralDabord: { verdictPasserelle: localB, relaiAuCentral: relayedB, ecritures: 2 },
    });
  }, 900_000);
});

/**
 * Snapshot LOCAL de la passerelle du banc (mêmes version et bracelets que celui posé au central) :
 * les règles locales du lot (version connue, enveloppe du terminal, état du bracelet à cette
 * version) s'y appuient. Le banc le pose en SQL : la fabrication réelle (colis déchiffrés, clé du
 * terminal) est éprouvée par les essais du lot WP23.
 */
async function seedLocalSnapshot(
  b: TwoProcessBench,
  deviceId: string,
  version: number,
  media: Array<{ media: { tokenHash: Buffer } }>,
): Promise<void> {
  await b.localQuery(
    `INSERT INTO edge_snapshot (version, kind, header, signature, signing_kid, content_sha256,
                                created_at)
     VALUES ($1, 'FULL', jsonb_build_object('generated_at', now() - interval '300 seconds',
             'valid_until', now() + interval '1 day'), '\\x01', 'k', sha256('\\x01'::bytea),
             now() - interval '300 seconds')`,
    [version],
  );
  await b.localQuery(
    `INSERT INTO edge_snapshot_key (version, device_id, envelope) VALUES ($1, $2, '{}'::jsonb)`,
    [version, deviceId],
  );
  await b.localQuery(
    `INSERT INTO edge_snapshot_ack (device_id, version, acked_at)
     VALUES ($1, $2, now() - interval '10 minutes')`,
    [deviceId, version],
  );
  for (const m of media)
    await b.localQuery(
      `INSERT INTO edge_snapshot_entry (version, token_hash, entry)
       VALUES ($1, $2, jsonb_build_object('status', 'ACTIVE', 'batch_status', 'ACTIVE',
               'wallet_status', 'ACTIVE', 'batch_event_id', $3::text))`,
      [version, m.media.tokenHash, b.eventId],
    );
}
