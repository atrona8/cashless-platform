// Concurrence de la fermeture (mission 6, lot WP08, T039 et T042 ; NFR-008 ; contracts/cash.md règle 6) :
// deux fermetures simultanées (une seule gagne, l'autre attend le verrou puis reçoit 409) et une fermeture pendant
// un comptage (la base sérialise sur la session : le comptage avant la fermeture compte, après il est refusé).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { CashWorld } from './cash-session-fixtures';

jest.setTimeout(240_000);

describe('fermeture concurrente (WP08)', () => {
  let cw: CashWorld;
  beforeAll(async () => {
    cw = await CashWorld.create();
  });
  afterAll(async () => {
    await cw?.close();
  });

  const closeTxs = async (id: string) =>
    (await cw.transactionsOf(cw.a.ledgerId, 'CASH_CLOSE')).filter(
      (t) => t.idempotency_key === `cash-close:${id}`,
    );

  it('deux fermetures simultanées de clés différentes : une seule gagne, l’autre 409, un seul CASH_CLOSE', async () => {
    const { t, id } = await cw.ready({ expected: 7_000, counted: 6_500 });
    const [x, y] = await Promise.all([
      cw.closeBo(id, cw.supervisor, randomUUID()),
      cw.closeBo(id, cw.supervisor2, randomUUID()),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.code).toBe('CONFLICT_STATE');
    expect(await closeTxs(id)).toHaveLength(1);
    expect(await cw.session(id)).toMatchObject({ status: 'CLOSED' });
    expect(await cw.deskBalance(t)).toBe(0);
    expect(
      await cw.anomaliesOf(cw.a.ledgerId).then((a) => a.filter((r) => r.device_id === t.deviceId)),
    ).toHaveLength(1);
  });

  it('deux fermetures simultanées, l’une au terminal et l’autre en back-office : une seule gagne', async () => {
    const { t, id } = await cw.ready({ expected: 3_000, counted: 3_000 });
    const [x, y] = await Promise.all([
      cw.closeTerm(t, id, cw.supervisor),
      cw.closeBo(id, cw.supervisor2),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await closeTxs(id)).toHaveLength(1);
    expect(await cw.deskBalance(t)).toBe(0);
  });

  it('fermeture pendant un comptage : sérialisées sur la session, aucune écriture partielle', async () => {
    const { t, id } = await cw.ready({ expected: 2_000, counted: 2_000 });
    const [closed, counted] = await Promise.all([
      cw.closeBo(id, cw.supervisor),
      cw.count(t, id, cw.w.cashierA, 1_900),
    ]);
    expect(closed.status).toBe(200);
    // Le comptage a eu lieu avant la fermeture (200) ou est refusé car la session est fermée (409) : jamais autre chose.
    expect([200, 409]).toContain(counted.status);
    const counts = await cw.counts(id);
    expect(counts.length).toBe(counted.status === 200 ? 2 : 1);
    const session = await cw.session(id);
    expect(session.status).toBe('CLOSED');
    // Le compté retenu à la fermeture est le dernier comptage VALIDÉ avant elle, cohérent avec l'écriture faite.
    expect(Number(session.counted_amount)).toBe(Number(counts[counts.length - 1]!.counted_amount));
    expect(await closeTxs(id)).toHaveLength(1);
    expect(await cw.deskBalance(t)).toBe(0);
    // Jamais de comptage après la fermeture.
    expect((await cw.count(t, id, cw.w.cashierA, 5)).status).toBe(409);
  });

  it('fermeture simultanée à une écriture d’espèces sur la caisse : la caisse finit à 0, la recharge perdante est refusée', async () => {
    const { t, id } = await cw.ready({ expected: 1_000, counted: 1_000 });
    const [closed, topup] = await Promise.all([
      cw.closeBo(id, cw.supervisor),
      cw.topupCash(t, 400).then(
        () => 'ok' as const,
        () => 'refusée' as const,
      ),
    ]);
    expect(closed.status).toBe(200);
    expect(await cw.deskBalance(t)).toBe(0);
    // Écriture sérialisée par le verrou du solde : soit avant la fermeture (alors incluse dans le théorique figé),
    // soit après (refusée par la garde de caisse). Dans les deux cas, la caisse est à zéro et le journal équilibré.
    const session = await cw.session(id);
    expect(Number(session.expected_amount)).toBe(topup === 'ok' ? 1_400 : 1_000);
  });
});
