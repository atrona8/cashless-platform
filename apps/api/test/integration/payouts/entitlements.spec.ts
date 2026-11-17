// Intégration : droits nets (route 5) et liste des versements (route 7) (mission 9b, lot WP08, T035
// et T037 ;
// FR-009, FR-011, NFR-004).
import { PayoutWorld, IBAN } from './payout-fixtures';

jest.setTimeout(120_000);

describe('droits nets et liste', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 240_000);
  afterAll(async () => {
    await p.close();
  });

  const entitlements = (who = p.w.organizerAdminA, query = '') =>
    p.bo('GET', `/ledgers/${p.ledger}/payout-entitlements${query}`, who);
  const find = (body: Record<string, unknown>, id: string) =>
    (body.data as Array<Record<string, unknown>>).find((e) => e.party_id === id);

  it('décision 8 : INITIATED laisse net_claim, monte pending_payouts, baisse available ; CONFIRMED et FAILED', async () => {
    const m = await p.merchant(39_225);
    const row = async () => find((await entitlements()).body, m.partyId);
    expect(await row()).toMatchObject({
      party_kind: 'MERCHANT',
      net_claim: 39_225,
      pending_payouts: 0,
      available: 39_225,
    });
    const { id } = await p.batch([p.line(m, 30_000)]);
    const payout = (await p.payoutsOf(id))[0]!.id;
    expect(await row()).toMatchObject({
      net_claim: 39_225,
      pending_payouts: 30_000,
      available: 9_225,
    });
    expect((await p.request([p.line(m, 9_226)])).status).toBe(409);
    expect((await p.request([p.line(m, 9_225)])).status).toBe(202);
    // CONFIRMED : net_claim et pending_payouts baissent, available inchangé.
    await p.bo('POST', `/payouts/${payout}/confirm`, p.w.organizerAdminA, {
      outcome: 'CONFIRMED',
      external_reference: 'R',
    });
    expect(await row()).toMatchObject({ net_claim: 9_225, pending_payouts: 0, available: 9_225 });
    // FAILED sur un second versement : retour à l'état d'avant.
    const second = await p.batch([p.line(m, 5_000)]);
    expect(await row()).toMatchObject({
      net_claim: 9_225,
      pending_payouts: 5_000,
      available: 4_225,
    });
    const p2 = (await p.payoutsOf(second.id))[0]!.id;
    await p.bo('POST', `/payouts/${p2}/confirm`, p.w.organizerAdminA, {
      outcome: 'FAILED',
      failure_reason: 'échec',
    });
    expect(await row()).toMatchObject({ net_claim: 9_225, pending_payouts: 0, available: 9_225 });
  });

  it('un droit nul reste listé, jamais négatif', async () => {
    const m = await p.merchant(0);
    const row = find((await entitlements()).body, m.partyId);
    expect(row).toMatchObject({ net_claim: 0, available: 0 });
  });

  it('pages : curseur opaque, limite bornée, curseur illisible 400', async () => {
    await p.merchant(100);
    await p.merchant(100);
    const first = await entitlements(p.w.organizerAdminA, '?limit=1');
    expect(first.status).toBe(200);
    expect(first.body.has_more).toBe(true);
    const second = await entitlements(
      p.w.organizerAdminA,
      `?limit=1&cursor=${first.body.next_cursor}`,
    );
    expect((second.body.data as unknown[])[0]).not.toEqual((first.body.data as unknown[])[0]);
    expect((await entitlements(p.w.organizerAdminA, '?cursor=zzz')).status).toBe(400);
    expect((await entitlements(p.w.organizerAdminA, '?limit=0')).status).toBe(400);
  });

  it('rôles : SUPERVISOR et CASHIER 403 ; grand livre d’un autre prestataire 404', async () => {
    expect((await entitlements(p.w.supervisorA)).status).toBe(403);
    expect((await entitlements(p.w.cashierA)).status).toBe(403);
    expect((await entitlements(p.operatorAdminB)).status).toBe(404);
    expect((await p.bo('GET', `/ledgers/${p.ledger}/payouts`, p.operatorAdminB)).status).toBe(404);
    expect(
      (await p.bo('GET', `/ledgers/${p.ledger}/payout-entitlements`, p.organizerAdminB)).status,
    ).toBe(404);
  });

  it('FR-011 : la liste des versements ne porte jamais l’IBAN ni le numéro ; filtres status et lot', async () => {
    const m = await p.merchant(10_000);
    const { id } = await p.batch([
      p.line(m, 4_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
    ]);
    const list = await p.bo(
      'GET',
      `/ledgers/${p.ledger}/payouts?approval_request_id=${id}`,
      p.w.organizerAdminA,
    );
    expect(list.status).toBe(200);
    const data = list.body.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      approval_request_id: id,
      beneficiary_party_id: m.partyId,
      amount: 4_000,
      method: 'BANK_TRANSFER',
      status: 'INITIATED',
      initiated_by: p.w.organizerAdminA.userId,
      approved_by: p.organizerAdmin2.userId,
    });
    expect(list.text).not.toContain(IBAN);
    expect(list.text).not.toContain('iban');
    expect(list.text).not.toContain('msisdn');
    const initiated = await p.bo(
      'GET',
      `/ledgers/${p.ledger}/payouts?status=INITIATED&limit=200`,
      p.w.organizerAdminA,
    );
    expect(initiated.status).toBe(200);
    expect(
      (await p.bo('GET', `/ledgers/${p.ledger}/payouts?status=NOPE`, p.w.organizerAdminA)).status,
    ).toBe(400);
    expect(
      (
        await p.bo(
          'GET',
          `/ledgers/${p.ledger}/payouts?approval_request_id=xx`,
          p.w.organizerAdminA,
        )
      ).status,
    ).toBe(400);
  });

  it('NFR-004 : les routes 5 et 7 émettent le même nombre de requêtes pour 1 ou 50 lignes (pas de N+1)', async () => {
    for (let i = 0; i < 6; i++) {
      const m = await p.merchant(1_000);
      await p.batch([p.line(m, 100)]);
    }
    const read5 = (limit: number) => async () => {
      expect((await entitlements(p.w.organizerAdminA, `?limit=${limit}`)).status).toBe(200);
    };
    const read7 = (limit: number) => async () => {
      const res = await p.bo(
        'GET',
        `/ledgers/${p.ledger}/payouts?limit=${limit}`,
        p.w.organizerAdminA,
      );
      expect(res.status).toBe(200);
    };
    for (const read of [read5, read7]) {
      await read(1)();
      const one = await p.countQueries(read(1));
      const many = await p.countQueries(read(50));
      expect(many).toBe(one);
    }
  });
});
