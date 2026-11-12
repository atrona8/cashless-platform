// WP22 / T099 : recharge en espèces sur la passerelle. Session répliquée seule, plafond par
// recharge (décision 21), plafonds réglementaires, trace en file avec le crédit, rejeux.
import { randomUUID } from 'node:crypto';
import {
  counterRequest,
  opCount,
  postTopup,
  readyBench,
  seedMedia,
  seedSession,
  tapOf,
  type Bench,
  type SeedMedia,
  type TestDevice,
} from './_support/bench';

let bench: Bench;
let device: TestDevice;
let seq = 0;

beforeAll(async () => {
  ({ bench, device } = await readyBench());
}, 120_000);
afterAll(async () => bench.close());

// Isolation (WP25 A3) : les tests qui modifient l'état répliqué (devise, plafonds, edge_terms) le remettent TOUJOURS,
// même quand une assertion échoue, au lieu de compter sur une remise en fin de test.
let initialSettings: { currency: string; wallet_limits: unknown; edge_terms: unknown };
beforeAll(async () => {
  initialSettings = (
    await bench.q<typeof initialSettings>(
      'SELECT currency, wallet_limits, edge_terms FROM edge_event_setting',
    )
  )[0]!;
});
afterEach(async () => {
  await bench.q(
    'UPDATE edge_event_setting SET currency = $1, wallet_limits = $2::jsonb, edge_terms = $3::jsonb',
    [
      initialSettings.currency,
      JSON.stringify(initialSettings.wallet_limits),
      initialSettings.edge_terms === null ? null : JSON.stringify(initialSettings.edge_terms),
    ],
  );
});

const key = (): string => `${device.serial}:${(seq += 1)}`;

async function topup(
  media: SeedMedia,
  amount: number,
  o: { key?: string; extra?: Record<string, unknown>; epoch?: number } = {},
) {
  return counterRequest(bench, device, {
    path: '/v1/topups/cash',
    key: o.key ?? key(),
    epoch: o.epoch ?? 3,
    body: {
      amount,
      currency: 'XOF',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
      ...o.extra,
    },
  });
}

describe('recharge nominale', () => {
  it('crédite le solde effectif et écrit TOPUP_CASH avec le crédit, dans la même transaction', async () => {
    const media = await seedMedia(bench, { paid: 1000 });
    const before = await opCount(bench);
    const r = await topup(media, 10_000);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      type: 'TOPUP_CASH',
      status: 'SUCCEEDED',
      amount: 10_000,
      currency: 'XOF',
      wallet_id: media.walletId,
      balance_after: { spendable: 11_000, paid: 11_000, promo: 0 },
      deposit: null,
    });
    expect(await opCount(bench)).toBe(before + 1);
    const ops = await bench.q<{ type: string; authorized_mode: string; origin_key: string }>(
      `SELECT type, authorized_mode, origin_key FROM edge_op ORDER BY edge_seq DESC LIMIT 1`,
    );
    expect(ops[0]).toMatchObject({ type: 'TOPUP_CASH', authorized_mode: 'EDGE_ONLINE' });
    const deltas = await bench.q<{ paid_delta: string }>(
      `SELECT d.paid_delta FROM edge_op_delta d JOIN edge_op o USING (edge_seq)
        WHERE o.type = 'TOPUP_CASH' ORDER BY d.edge_seq DESC LIMIT 1`,
    );
    expect(deltas[0]!.paid_delta).toBe('10000');
  });

  it('le compte de caisse vient de la session, jamais de la requête', async () => {
    const media = await seedMedia(bench);
    const r = await topup(media, 500, { extra: { cash_desk_account_id: randomUUID() } });
    expect(r.status).toBe(201);
    const op = await bench.q<{ operation: Record<string, unknown> }>(
      'SELECT operation FROM edge_op ORDER BY edge_seq DESC LIMIT 1',
    );
    expect(JSON.stringify(op[0]!.operation)).not.toContain('cash_desk_account_id');
  });

  it('un terminal hors mode TOPUP_DESK reçoit 403', async () => {
    const other = await bench.newDevice({ appMode: 'CATALOG_POS' });
    await seedSession(bench, other, {
      openedAt: new Date(bench.clock.now().getTime() - 7_200_000),
    });
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await counterRequest(bench, other, {
      path: '/v1/topups/cash',
      key: `${other.serial}:1`,
      epoch: 3,
      body: {
        amount: 100,
        currency: 'XOF',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
    expect(r.status).toBe(403);
    expect(await opCount(bench)).toBe(before);
  });
});

describe('session de caisse répliquée avant la bascule (FR-015, C-005)', () => {
  it('sans jeton de personne : 401, rien d’écrit', async () => {
    const lone = await bench.newDevice();
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await counterRequest(bench, lone, {
      path: '/v1/topups/cash',
      key: `${lone.serial}:1`,
      epoch: 3,
      staff: null,
      body: {},
    });
    expect(r.status).toBe(401);
    expect(await opCount(bench)).toBe(before);
    void media;
  });

  it('jeton valide, terminal sans session : 409 NO_REPLICATED_CASH_SESSION, rien d’écrit', async () => {
    const lone = await bench.newDevice();
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await postTopup(bench, lone, media);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONFLICT_STATE', detail: 'NO_REPLICATED_CASH_SESSION' });
    expect(await opCount(bench)).toBe(before);
  });

  it('session ouverte APRÈS la bascule (non utilisable) : 409, rien d’écrit', async () => {
    const lateDevice = await bench.newDevice();
    await seedSession(bench, lateDevice, {
      openedAt: new Date(bench.clock.now().getTime() - 1000),
      usable: false,
    });
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const fresh = await counterRequest(bench, lateDevice, {
      path: '/v1/topups/cash',
      key: `${lateDevice.serial}:1`,
      epoch: 3,
      body: {
        amount: 100,
        currency: 'XOF',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
    expect(fresh.status).toBe(409);
    expect(fresh.json).toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await opCount(bench)).toBe(before);
  });

  it('cash_session_id d’une autre session : 409', async () => {
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await topup(media, 100, { extra: { cash_session_id: randomUUID() } });
    expect(r.status).toBe(409);
    expect(await opCount(bench)).toBe(before);
  });
});

describe('plafond par recharge (décision 21)', () => {
  it('à la borne : accepté ; juste au-dessus : refusé sans écriture ni mise en file', async () => {
    const media = await seedMedia(bench);
    await bench.q(
      `UPDATE edge_event_setting SET wallet_limits = wallet_limits || '{"max_wallet_balance":null,
         "unidentified_max_balance":null,"identified_monthly_limit":null,
         "unidentified_monthly_limit":null}'::jsonb`,
    );
    const ok = await topup(media, 500_000);
    expect(ok.status).toBe(201);
    const before = await opCount(bench);
    const deltas = (await bench.q('SELECT 1 FROM edge_op_delta')).length;
    const over = await topup(media, 500_001);
    expect(over.status).toBe(422);
    expect(over.json).toMatchObject({ code: 'AMOUNT_OUT_OF_RANGE' });
    expect(await opCount(bench)).toBe(before);
    expect((await bench.q('SELECT 1 FROM edge_op_delta')).length).toBe(deltas);
    await bench.q(
      `UPDATE edge_event_setting SET wallet_limits = jsonb_build_object('max_wallet_balance', 2000000,
         'unidentified_max_balance', 1000000, 'identified_monthly_limit', 5000000,
         'unidentified_monthly_limit', 3000000)`,
    );
  });

  it('le plafond est réglable (edge_terms répliqué) et se lit à la borne', async () => {
    const media = await seedMedia(bench);
    await bench.q(`UPDATE edge_event_setting SET edge_terms = '{"max_cash_topup": 2000}'`);
    expect((await topup(media, 2000)).status).toBe(201);
    expect((await topup(media, 2001)).status).toBe(422);
    await bench.q(`UPDATE edge_event_setting SET edge_terms = NULL`);
  });

  it('devise autre que XOF sans max_cash_topup : refusée, rien d’écrit (échec fermé)', async () => {
    const media = await seedMedia(bench);
    await bench.q(`UPDATE edge_event_setting SET currency = 'EUR', edge_terms = '{}'`);
    const before = await opCount(bench);
    const refused = await topup(media, 100, { extra: { currency: 'EUR' } });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: 'AMOUNT_OUT_OF_RANGE' });
    expect(await opCount(bench)).toBe(before);
    // Même devise avec un plafond explicite : servi.
    await bench.q(`UPDATE edge_event_setting SET edge_terms = '{"max_cash_topup": 2000}'`);
    expect((await topup(media, 2000, { extra: { currency: 'EUR' } })).status).toBe(201);
    await bench.q(`UPDATE edge_event_setting SET currency = 'XOF', edge_terms = NULL`);
  });

  it('l’ancienne clé wallet_limits.max_cash_topup n’est plus lue (défaut 500 000)', async () => {
    const media = await seedMedia(bench);
    await bench.q(
      `UPDATE edge_event_setting SET wallet_limits = wallet_limits || '{"max_cash_topup": 2000}'`,
    );
    expect((await topup(media, 2001)).status).toBe(201);
    await bench.q(`UPDATE edge_event_setting SET wallet_limits = wallet_limits - 'max_cash_topup'`);
  });
});

describe('plafonds réglementaires, appliqués à la vente sur l’état répliqué', () => {
  it('plafond de solde non identifié : WALLET_LIMIT_EXCEEDED, rien d’écrit', async () => {
    const media = await seedMedia(bench, { paid: 950_000 });
    const before = await opCount(bench);
    const r = await topup(media, 50_001);
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ code: 'WALLET_LIMIT_EXCEEDED' });
    expect(await opCount(bench)).toBe(before);
    expect((await topup(media, 50_000)).status).toBe(201);
  });

  it('un client identifié a le palier large', async () => {
    const media = await seedMedia(bench, { paid: 1_500_000, kyc: true });
    expect((await topup(media, 400_000)).status).toBe(201);
  });

  it('plafond mensuel : cumul central + recharges locales du mois', async () => {
    const media = await seedMedia(bench, { monthPaid: 2_900_000 });
    expect((await topup(media, 50_000)).status).toBe(201);
    const r = await topup(media, 50_001);
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED' });
  });

  it('plafonds absents de l’état répliqué : échec fermé', async () => {
    const media = await seedMedia(bench);
    await bench.q(`UPDATE edge_event_setting SET wallet_limits = '{}'`);
    const before = await opCount(bench);
    const r = await topup(media, 100);
    expect(r.status).toBe(409);
    expect(await opCount(bench)).toBe(before);
    await bench.q(
      `UPDATE edge_event_setting SET wallet_limits = jsonb_build_object('max_wallet_balance', 2000000,
         'unidentified_max_balance', 1000000, 'identified_monthly_limit', 5000000,
         'unidentified_monthly_limit', 3000000)`,
    );
  });
});

describe('rejeux et refus d’autorité', () => {
  it('100 rejeux de la même clé : un seul effet, une seule entrée de file', async () => {
    const media = await seedMedia(bench);
    const k = key();
    const before = await opCount(bench);
    // Corps identique à l'octet près : horodatages fixés une fois.
    const fixed = { occurred_at: bench.clock.now().toISOString(), tap: tapOf(media, bench) };
    const first = await topup(media, 1000, { key: k, extra: fixed });
    expect(first.status).toBe(201);
    let replayed = 0;
    for (let i = 0; i < 100; i += 1) {
      const again = await topup(media, 1000, { key: k, extra: fixed });
      expect(again.status).toBe(201);
      expect(again.json).toEqual(first.json);
      if (again.headers['idempotency-replayed'] === 'true') replayed += 1;
    }
    expect(replayed).toBe(100);
    expect(await opCount(bench)).toBe(before + 1);
  }, 180_000);

  it('même clé, autre corps : IDEMPOTENCY_KEY_REUSED, aucun effet', async () => {
    const media = await seedMedia(bench);
    const k = key();
    const fixed = { occurred_at: bench.clock.now().toISOString(), tap: tapOf(media, bench) };
    expect((await topup(media, 1000, { key: k, extra: fixed })).status).toBe(201);
    const before = await opCount(bench);
    const other = await topup(media, 2000, { key: k, extra: fixed });
    expect(other.status).toBe(409);
    expect(other.json).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await opCount(bench)).toBe(before);
  });

  it('époque différente : 409 STALE_AUTHORITY_EPOCH, rien d’écrit', async () => {
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await topup(media, 100, { epoch: 2 });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'STALE_AUTHORITY_EPOCH', authority_epoch: 3 });
    expect(await opCount(bench)).toBe(before);
  });

  it('bracelet inconnu, non activé, bloqué : codes du contrat, rien d’écrit', async () => {
    const before = await opCount(bench);
    const unknown = await seedMedia(bench);
    await bench.q('DELETE FROM edge_media WHERE media_id = $1', [unknown.mediaId]);
    expect((await topup(unknown, 100)).json).toMatchObject({ code: 'MEDIA_UNKNOWN' });
    const fresh = await seedMedia(bench, { wallet: false });
    expect((await topup(fresh, 100)).json).toMatchObject({ code: 'MEDIA_NOT_ACTIVATED' });
    const blocked = await seedMedia(bench, { status: 'SUSPENDED' });
    expect((await topup(blocked, 100)).json).toMatchObject({ code: 'MEDIA_BLOCKED' });
    expect(await opCount(bench)).toBe(before);
  });
});
