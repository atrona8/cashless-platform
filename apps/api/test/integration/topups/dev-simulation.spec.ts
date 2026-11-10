// Intégration : simulation du paiement d'une recharge PSP par le festivalier (route de DÉVELOPPEMENT hors contrat,
// OP-N121, ADR-181). Parcours complet sur HTTPS réel : initiation, simulation, statut, solde, historique. La route
// passe par le vrai chemin des notifications (signature, idempotence, écriture TOPUP, plafonds).
import { randomUUID } from 'node:crypto';
import { ownerRows } from '../../support/media-fixtures';
import { PspWorld } from './psp-fixtures';

describe('simulation du paiement PSP (développement)', () => {
  let p: PspWorld;

  beforeAll(async () => {
    p = await PspWorld.create();
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });

  const initiate = async (amount = 10000, method: 'WAVE' | 'ORANGE_MONEY' = 'WAVE') => {
    const w = await p.wallet();
    const res = await p.cust(
      w.customer,
      'POST',
      '/topups/psp',
      p.body(w.walletId, { amount, provider: method }),
    );
    return { w, res };
  };
  const simulate = (
    w: { customer: Parameters<PspWorld['cust']>[0] },
    id: string,
    outcome: unknown,
  ) => p.cust(w.customer, 'POST', `/__dev/psp-topups/${id}/outcome`, { outcome });
  const wallets = (w: { customer: Parameters<PspWorld['cust']>[0] }) =>
    p.cust(w.customer, 'GET', '/me/wallets');
  const paid = async (w: { customer: Parameters<PspWorld['cust']>[0] }) =>
    ((await wallets(w)).body as { data: Array<{ balance: { paid: number } }> }).data[0]!.balance
      .paid;
  const history = (w: { customer: Parameters<PspWorld['cust']>[0]; walletId: string }) =>
    p.cust(w.customer, 'GET', `/me/wallets/${w.walletId}/transactions`);

  it('parcours complet : initiation, simulation SUCCEEDED, statut, solde et historique', async () => {
    const { w, res } = await initiate(10000);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    const id = res.body.topup_id as string;
    expect(await paid(w)).toBe(0);

    const sim = await simulate(w, id, 'SUCCEEDED');
    expect(sim.status).toBe(200);
    expect(sim.body).toMatchObject({ topup_id: id, status: 'SUCCEEDED' });
    expect(sim.body.transaction_id).toEqual(expect.any(String));

    const got = await p.cust(w.customer, 'GET', `/topups/psp/${id}`);
    expect(got.body).toMatchObject({
      status: 'SUCCEEDED',
      transaction_id: sim.body.transaction_id,
    });
    expect(await paid(w)).toBe(10000);
    const lines = (await history(w)).body.data as Array<{ type: string; amount: number }>;
    expect(lines.filter((l) => l.type === 'TOPUP' && l.amount === 10000)).toHaveLength(1);
    expect(await p.transactions(id)).toHaveLength(1);
  });

  it('FAILED : statut FAILED, aucun crédit ni écriture', async () => {
    const { w, res } = await initiate(7000, 'ORANGE_MONEY');
    const id = res.body.topup_id as string;
    const sim = await simulate(w, id, 'FAILED');
    expect(sim.status).toBe(200);
    expect(sim.body.status).toBe('FAILED');
    expect(sim.body.transaction_id).toBeNull();
    expect(await paid(w)).toBe(0);
    expect(await p.transactions(id)).toEqual([]);
    // Recharge terminée : l'autre résultat est refusé (409), le même rend l'état courant.
    expect((await simulate(w, id, 'SUCCEEDED')).status).toBe(409);
    expect((await simulate(w, id, 'FAILED')).body.status).toBe('FAILED');
  });

  it('double simulation SUCCEEDED : un seul crédit', async () => {
    const { w, res } = await initiate(5000);
    const id = res.body.topup_id as string;
    const [a, b] = await Promise.all([simulate(w, id, 'SUCCEEDED'), simulate(w, id, 'SUCCEEDED')]);
    const c = await simulate(w, id, 'SUCCEEDED');
    for (const r of [a, b, c]) expect([200, 409]).toContain(r.status);
    expect(c.body.status).toBe('SUCCEEDED');
    expect(await p.transactions(id)).toHaveLength(1);
    expect(await paid(w)).toBe(5000);
    expect(
      await p.count(`SELECT 1 FROM psp_event WHERE provider_event_id = $1`, [
        `dev-sim-${id}-SUCCEEDED`,
      ]),
    ).toBe(1);
  });

  it('recharge d’un autre festivalier, inconnue ou mal formée : même 404', async () => {
    const { res } = await initiate(3000);
    const stranger = await p.wallet();
    const id = res.body.topup_id as string;
    const bodies: string[] = [];
    for (const target of [id, randomUUID(), 'pas-un-uuid']) {
      const r = await simulate(stranger, target, 'SUCCEEDED');
      expect(r.status).toBe(404);
      const { instance: _i, request_id: _r, ...body } = r.body;
      bodies.push(JSON.stringify(body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect((await p.read(id))!.status).toBe('PENDING');
  });

  it('sans identité : refusé ; résultat invalide : 400', async () => {
    const { w, res } = await initiate(2000);
    const id = res.body.topup_id as string;
    expect((await simulate(w, id, 'PAID')).status).toBe(400);
    expect((await simulate(w, id, undefined)).status).toBe(400);
    const anonymous = await p.cust(
      { headers: {} } as never,
      'POST',
      `/__dev/psp-topups/${id}/outcome`,
      {
        outcome: 'SUCCEEDED',
      },
    );
    expect(anonymous.status).toBe(401);
    expect((await p.read(id))!.status).toBe('PENDING');
  });

  it('plafond de solde : la notification ne crédite pas au-delà (FAILED, anomalie), grand livre intact', async () => {
    const w = await p.wallet({ funds: 4000 });
    const [old] = await ownerRows<{ id: string }>(
      'SELECT jurisdiction_id AS id FROM event WHERE id = $1',
      [p.ev.eventId],
    );
    const profile = randomUUID();
    await ownerRows(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination,
                                         unidentified_max_balance, unidentified_monthly_limit)
       VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER', 10000, NULL)`,
      [profile],
    );
    await ownerRows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [p.ev.eventId, profile]);
    try {
      const res = await p.cust(
        w.customer,
        'POST',
        '/topups/psp',
        p.body(w.walletId, { amount: 9000 }),
      );
      if (res.status !== 201) {
        // Refus dès l'initiation : aucune recharge à simuler, solde inchangé.
        expect(res.status).toBeGreaterThanOrEqual(400);
      } else {
        const sim = await simulate(w, res.body.topup_id as string, 'SUCCEEDED');
        expect(sim.body.status).toBe('FAILED');
        expect(sim.body.transaction_id).toBeNull();
        expect(await p.transactions(res.body.topup_id as string)).toEqual([]);
      }
      expect(await paid(w)).toBe(4000);
    } finally {
      await ownerRows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [
        p.ev.eventId,
        old!.id,
      ]);
    }
  });
});
