// Annulation conforme au contrat, réduction du manque et inversions de dates (mission 7, lot WP19, cycle 2 ;
// contracts/compliance.md « Temps », openapi.yaml exemple `POST /offline-batches` seq 88). Route réelle, vrai processeur.
import 'reflect-metadata';
import { deviceKey } from '../../../src/idempotency/device-key';
import { ownerRows } from '../../support/media-fixtures';
import { ReversalWorld } from '../reversals/reversal-fixtures';
import { ProcessingWorld, type OfflineTerminal } from './processing-fixtures';

jest.setTimeout(240_000);

describe('annulation sans lecture, réduction du manque, inversions de dates (WP19)', () => {
  let world: ProcessingWorld;
  beforeAll(async () => {
    world = await ProcessingWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  const setup = async (funds = 20_000) => {
    const t = await world.terminal();
    const media = await world.pw.media(1, funds);
    const version = await world.snapshot(t, media);
    return { t, m: media[0]!, version };
  };

  /** L'opération EXACTE de l'exemple `openapi.yaml` (seq 88) : ni `tap`, ni devise, ni montant. */
  const exampleReversal = (t: OfflineTerminal, version: number, reversesSeq: number) => ({
    type: 'REVERSAL',
    occurred_at: new Date().toISOString(),
    snapshot_version: version,
    config_id: t.configId,
    online_status: 'NOT_ATTEMPTED',
    reverses_seq: reversesSeq,
    reason: 'INPUT_ERROR',
    // L'exemple publié n'a pas de session de vendeur (la vente de l'exemple non plus) : elle reste exigée.
    vendor_session_id: t.sessionId,
  });

  const shortfallDetail = (deviceId: string) =>
    ownerRows<{ amount: string; status: string; resolution_tx_id: string | null; detail: { reductions?: unknown[] } }>(
      `SELECT amount::text, status, resolution_tx_id, detail FROM anomaly
        WHERE device_id = $1 AND kind = 'OFFLINE_SHORTFALL'`,
      [deviceId],
    );

  it('annulation de l’exemple openapi (sans tap, devise ni montant) : acceptée, soldes revenus', async () => {
    const { t, m, version } = await setup();
    const res = await world.submit(t, [
      world.sale(t, m, 5000, version),
      exampleReversal(t, version, 1),
    ] as never);
    const rs = world.results(res);
    expect(rs[0]).toMatchObject({ status: 'ACCEPTED' });
    expect(rs[1]).toMatchObject({ status: 'ACCEPTED', effect: 'LEDGER_WRITTEN' });
    expect(await world.spendable(m.walletId)).toBe(20_000);
    expect((await world.txRows(t.t.deviceId)).map((x) => x.type)).toEqual(['PURCHASE', 'REVERSAL']);
  });

  it('annulation sans tap d’une cible introuvable : REVERSAL_TARGET_NOT_FOUND (raison première), rien d’écrit', async () => {
    const { t, version } = await setup();
    const res = await world.submit(t, [exampleReversal(t, version, 85)] as never);
    const [r] = world.results(res);
    expect(r).toMatchObject({ status: 'REJECTED', reject_reason: 'REVERSAL_TARGET_NOT_FOUND' });
    expect(await world.txRows(t.t.deviceId)).toHaveLength(0);
  });

  it('annulation sans tap : le snapshot cité reste exigé (version inconnue : rejet)', async () => {
    const { t, m, version } = await setup();
    const res = await world.submit(t, [
      world.sale(t, m, 5000, version),
      { ...exampleReversal(t, version, 1), snapshot_version: 999_999_999 },
    ] as never);
    const rs = world.results(res);
    expect(rs[1]).toMatchObject({ status: 'REJECTED', reject_reason: 'SNAPSHOT_VERSION_UNKNOWN' });
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
  });

  it('M7 hors ligne : l’anomalie du manque cite la VRAIE transaction d’annulation (reductions[].reversal_tx, resolution_tx_id)', async () => {
    const { t, m, version } = await setup(6000);
    const res = await world.submit(t, [
      world.sale(t, m, 9000, version),
      exampleReversal(t, version, 1),
    ] as never);
    const rs = world.results(res);
    expect(rs[0]).toMatchObject({ status: 'ACCEPTED_WITH_SHORTFALL', shortfall_amount: 3000 });
    const txs = await world.txRows(t.t.deviceId);
    const reversalTx = txs.find((x) => x.type === 'REVERSAL')!.id;
    const saleTx = txs.find((x) => x.type === 'PURCHASE')!.id;
    expect(rs[1]).toMatchObject({ transaction_id: reversalTx });
    const [an] = await shortfallDetail(t.t.deviceId);
    expect(an).toMatchObject({ amount: '0', status: 'RESOLVED', resolution_tx_id: reversalTx });
    expect(an!.detail.reductions).toEqual([
      expect.objectContaining({ reversal_tx: reversalTx, amount: 3000 }),
    ]);
    expect(reversalTx).not.toBe(saleTx);
  });

  it('M7 en ligne (reversal.service.ts) : même exigence, avec la transaction de l’annulation en ligne', async () => {
    const { t, m, version } = await setup(6000);
    await world.submit(t, [world.sale(t, m, 9000, version)]);
    const [sale] = await world.txRows(t.t.deviceId);
    t.t.nextSeq = 50; // hors des numéros du lot
    const rw = new ReversalWorld(world.pw);
    const res = await rw.reverse(t, sale!.id, { key: deviceKey(t.t.serial, 50n) });
    expect(res.status).toBe(201);
    const reversalTx = String(res.body.transaction_id);
    expect(reversalTx).not.toBe(sale!.id);
    const [an] = await shortfallDetail(t.t.deviceId);
    expect(an).toMatchObject({ amount: '0', status: 'RESOLVED', resolution_tx_id: reversalTx });
    expect(an!.detail.reductions).toEqual([
      expect.objectContaining({ reversal_tx: reversalTx, amount: 3000 }),
    ]);
  });

  it('inversion de dates (FR-025) : une anomalie CLOCK_SKEW (codes seuls), résultat inchangé, idempotente au renvoi', async () => {
    const { t, m, version } = await setup();
    // La date la plus ancienne (2 s) doit suivre l'enrôlement et la session du terminal.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const ops = [
      world.sale(t, m, 1000, version, {}, -119), // 119 s d'avance, dans la tolérance
      world.sale(t, m, 1000, version, {}, 2), // recule de 121 s > 120 s (après la session : pas de rejet)
      world.sale(t, m, 1000, version, {}, -119), // pas plus ancien que la plus grande date : pas d'inversion
    ];
    const res = await world.submit(t, ops);
    expect(world.results(res).map((r) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    const skew = async () =>
      ownerRows<{ seq: string; detail: unknown }>(
        `SELECT seq::text, detail FROM anomaly WHERE device_id = $1 AND kind = 'CLOCK_SKEW'`,
        [t.t.deviceId],
      );
    expect(await skew()).toEqual([{ seq: '2', detail: { codes: ['DATE_INVERSION'] } }]);
    const again = await world.submit(t, ops, { fromSeq: 1 });
    expect(world.results(again).map((r) => r.status)).toEqual([
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
    ]);
    expect(await skew()).toHaveLength(1);
  });
});
