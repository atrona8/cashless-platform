// Journal d'un terminal après reprise forcée (mission 8, lot WP14, T064 ; R-23, décision 4 du porteur) : les opérations
// déjà rejouées par la passerelle ne font aucun bruit, celles qui ne l'ont pas été ouvrent une anomalie avec montant,
// `TOPUP_CASH` suit le refus existant en y ajoutant la clé d'origine et le lot de reprise. Voies : lot du terminal
// (`POST /offline-batches`) et journal importé par deux personnes (travailleur `journal-import`).
import 'reflect-metadata';
import { ownerRows } from '../../../support/media-fixtures';
import { JournalWorld } from '../../offline/journal-world';
import type { OfflineTerminal } from '../../offline/processing-fixtures';
import { dbNow, edgeAnomalies, onlineRef, runImport, Takeover } from './journal-support';

jest.setTimeout(300_000);

describe('journal après reprise forcée (WP14, T064)', () => {
  let jw: JournalWorld;
  let takeover: Takeover;
  beforeAll(async () => {
    jw = await JournalWorld.create();
    takeover = new Takeover(jw.pw);
  });
  afterAll(async () => {
    await jw?.close();
  });

  const topup = (amount: number, agoSeconds = 5) => ({
    type: 'TOPUP_CASH',
    occurred_at: new Date(dbNow() - agoSeconds * 1000).toISOString(),
    amount,
    currency: 'XOF',
  });
  const nonCompliant = (t: OfflineTerminal) =>
    edgeAnomalies(t.t.deviceId, 'NON_COMPLIANT_OPERATION');
  const cashTxs = (t: OfflineTerminal) =>
    ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction
        WHERE device_id = $1 AND type IN ('TOPUP_CASH', 'ANOMALY_RESOLUTION')`,
      [t.t.deviceId],
    ).then((r) => r[0]!.n);

  it('dix opérations rejouées et trois non rejouées (activation, caution, recharge) : trois anomalies, zéro bruit', async () => {
    const { handoverId } = await takeover.set({});
    const t = await jw.pw.terminal();
    const first = t.t.nextBatchSeq;
    for (let i = 0; i < 10; i += 1) await takeover.replayed(t, first + i, 'JOURNAL');
    const ops = [
      ...Array.from({ length: 10 }, () => onlineRef('activateMedia', { amount: 1000 })),
      onlineRef('activateMedia', { amount: 4000 }),
      onlineRef('takeDeposit', { amount: 2500 }),
      topup(30_000),
    ];
    const res = await jw.pw.submit(t, ops);
    const rs = jw.pw.results(res);
    expect(rs.slice(0, 10).map((r) => r.status)).toEqual(Array(10).fill('DUPLICATE'));
    expect(rs[10]).toMatchObject({ status: 'ACCEPTED', effect: 'NONE' });
    expect(rs[11]).toMatchObject({ status: 'ACCEPTED', effect: 'NONE' });
    expect(rs[12]).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'OFFLINE_NOT_ALLOWED',
      effect: 'NONE',
      detail: 'TOPUP_CASH',
    });
    const replay = await edgeAnomalies(t.t.deviceId);
    expect(replay.map((a) => [a.seq, a.amount])).toEqual([
      ['11', '4000'],
      ['12', '2500'],
    ]);
    const nc = await nonCompliant(t);
    expect(nc).toHaveLength(1);
    expect(nc[0]).toMatchObject({ seq: '13', amount: '30000', loss_bearer: 'OPERATOR' });
    expect(nc[0]!.detail).toMatchObject({
      codes: ['TOPUP_CASH'],
      origin_key: `${t.t.serial}:0013`,
      recovery_id: handoverId,
    });
    // Un même lot de reprise pour les trois : la résolution les regroupe.
    expect(new Set([...replay, ...nc].map((a) => a.detail!.recovery_id))).toEqual(
      new Set([handoverId]),
    );
    // Aucune écriture comptable automatique : l'argent est dans la caisse physique.
    expect(await cashTxs(t)).toBe(0);
    expect([...replay, ...nc].every((a) => a.status === 'OPEN')).toBe(true);
  });

  it('TOPUP_CASH hors reprise forcée : même refus, sans marque de reprise ; passerelle révoquée sans bascule forcée : idem', async () => {
    for (const state of [null, { handover: 'COMPLETED' as const }]) {
      await takeover.set(state);
      const t = await jw.pw.terminal();
      const res = await jw.pw.submit(t, [topup(12_000)]);
      expect(jw.pw.results(res)[0]).toMatchObject({
        status: 'REJECTED',
        reject_reason: 'OFFLINE_NOT_ALLOWED',
        effect: 'NONE',
      });
      const nc = await nonCompliant(t);
      // Le refus ordinaire (mission 7) ouvre déjà son anomalie ; la reprise forcée n'y ajoute rien ici.
      expect(nc).toHaveLength(1);
      expect(nc[0]!.detail).toEqual({ codes: ['TOPUP_CASH'] });
      expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(0);
    }
  });

  it('TOPUP_CASH dont la clé a déjà été rejouée (journal) : DUPLICATE, aucune anomalie', async () => {
    await takeover.set({});
    const t = await jw.pw.terminal();
    await takeover.replayed(t, t.t.nextBatchSeq, 'JOURNAL');
    const res = await jw.pw.submit(t, [topup(12_000)]);
    expect(jw.pw.results(res)[0]).toMatchObject({ status: 'DUPLICATE' });
    expect(await nonCompliant(t)).toHaveLength(0);
  });

  it('forcée avant l’accusé de bascule : aucune anomalie de reprise, ni pour ONLINE_REF ni pour TOPUP_CASH', async () => {
    await takeover.set({ acked: false });
    const t = await jw.pw.terminal();
    const res = await jw.pw.submit(t, [onlineRef('activateMedia', { amount: 800 }), topup(5000)]);
    expect(jw.pw.results(res).map((r) => r.status)).toEqual(['ACCEPTED', 'REJECTED']);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(0);
    expect((await nonCompliant(t))[0]!.detail).toEqual({ codes: ['TOPUP_CASH'] });
  });

  it('journal importé (deux personnes) : mêmes anomalies avec le lot de reprise ; second import identique : rien de plus', async () => {
    const { handoverId } = await takeover.set({});
    const s = { t: await jw.pw.terminal() };
    const first = s.t.t.nextBatchSeq;
    await takeover.replayed(s.t, first, 'EDGE_REGISTRY');
    const batches = jw.exportBatches(s.t, [
      [
        onlineRef('activateMedia', { amount: 1000 }),
        onlineRef('activateMedia', { amount: 3500 }),
        topup(8000),
      ],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await jw.revoke(s.t);
    const final = await runImport(
      jw,
      s.t,
      batches.map((b) => b.body),
    );
    expect(final.status).toBe('APPLIED');
    const replay = await edgeAnomalies(s.t.t.deviceId);
    expect(replay.map((a) => [a.seq, a.amount])).toEqual([[String(first + 1), '3500']]);
    const nc = await nonCompliant(s.t);
    expect(nc).toHaveLength(1);
    expect(nc[0]).toMatchObject({ seq: String(first + 2), amount: '8000' });
    expect(nc[0]!.detail).toMatchObject({ recovery_id: handoverId });
    // Le même export redemandé : rien d'écrit, aucune anomalie de plus.
    const again = await runImport(
      jw,
      s.t,
      batches.map((b) => b.body),
    );
    expect(again.status).toBe('APPLIED');
    expect(await edgeAnomalies(s.t.t.deviceId)).toHaveLength(1);
    expect(await nonCompliant(s.t)).toHaveLength(1);
  });

  it('terminal révoqué entre-temps : le journal envoyé en lot est refusé comme avant, sans anomalie de reprise', async () => {
    await takeover.set({});
    const t = await jw.pw.terminal();
    await jw.revoke(t);
    const res = await jw.pw.submit(t, [onlineRef('activateMedia', { amount: 800 })]);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await edgeAnomalies(t.t.deviceId)).toHaveLength(0);
  });

  it('résolution : les anomalies restent ouvertes sans écriture comptable tant que deux personnes ne les ont pas résolues', async () => {
    await takeover.set({});
    const t = await jw.pw.terminal();
    await jw.pw.submit(t, [onlineRef('takeDeposit', { amount: 900 }), topup(7000)]);
    const open = await ownerRows<{ kind: string; status: string; resolution_tx_id: string | null }>(
      `SELECT kind, status, resolution_tx_id FROM anomaly WHERE device_id = $1
        AND kind IN ('EDGE_REPLAY_FAILED','NON_COMPLIANT_OPERATION') ORDER BY kind`,
      [t.t.deviceId],
    );
    expect(open).toEqual([
      { kind: 'EDGE_REPLAY_FAILED', status: 'OPEN', resolution_tx_id: null },
      { kind: 'NON_COMPLIANT_OPERATION', status: 'OPEN', resolution_tx_id: null },
    ]);
    expect(await cashTxs(t)).toBe(0);
  });
});
