// FR-003, FR-005, FR-006, FR-007 : calculateurs d'étapes de clôture, sur le client scripté (aucune base). Les
// montants sont ceux du scénario de référence (25 000, 6 000, 1 017, 20 000 = 16 000 / 4 000, 2 000, 1 000).
import { breakage } from '../../../src/closing/calculators/breakage';
import type { ClosingContext, RecordedStep } from '../../../src/closing/calculators/calculator';
import { depositForfeit } from '../../../src/closing/calculators/deposit-forfeit';
import { operatorFee, feeTotal } from '../../../src/closing/calculators/operator-fee';
import { operatorFeeRegularization } from '../../../src/closing/calculators/operator-fee-regularization';
import { pitchFees } from '../../../src/closing/calculators/pitch-fees';
import { platformFee } from '../../../src/closing/calculators/platform-fee';
import { promoExpiry } from '../../../src/closing/calculators/promo-expiry';
import type { ClosingStep } from '../../../src/closing/closing-steps.dto';
import type { ResolvedConfig } from '../../../src/ledger/types';
import { scenarioConfig } from '../builders/support/scenario-lines';

type Handler = (sql: string, values: unknown[]) => unknown[] | undefined;

/** Client scripté : le premier gestionnaire qui reconnaît la requête rend ses lignes ; toute autre requête échoue. */
function client(...handlers: Handler[]) {
  const writes: string[] = [];
  return {
    writes,
    query: (sql: string, values: unknown[] = []) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
      for (const handler of handlers) {
        const rows = handler(sql, values);
        if (rows) return Promise.resolve({ rows });
      }
      return Promise.reject(new Error(`requête inattendue : ${sql.slice(0, 60)}`));
    },
  };
}

const ids = {
  event: 'event-1',
  ledger: 'ledger-1',
  operator: '20000000-0000-0000-0000-000000000002',
  organizer: '20000000-0000-0000-0000-000000000003',
};

function context(
  db: ReturnType<typeof client>,
  over: Partial<Omit<ClosingContext, 'config'>> & { config?: Partial<ResolvedConfig> } = {},
): ClosingContext {
  const { config, ...rest } = over;
  return {
    client: db as never,
    eventId: ids.event,
    operatorId: ids.operator,
    organizerId: ids.organizer,
    ledgerId: ids.ledger,
    currency: 'XOF',
    config: scenarioConfig(config),
    operatorFeeBasis: 'GROSS',
    now: new Date('2026-12-20T10:00:00Z'),
    recorded: new Map(),
    ...rest,
  };
}

const bases =
  (topups: string, media: string): Handler =>
  (sql) => {
    if (sql.includes("t.type IN ('TOPUP', 'TOPUP_CASH')")) return [{ v: topups }];
    if (sql.includes('media_assignment')) return [{ n: media }];
    return undefined;
  };

describe('PITCH_FEES (FR-005)', () => {
  const participations =
    (rows: object[]): Handler =>
    (sql) =>
      sql.includes('FROM merchant_participation') ? rows : undefined;
  const balance =
    (table: Record<string, string>): Handler =>
    (sql, values) =>
      sql.includes('FROM account a LEFT JOIN account_balance')
        ? [{ balance: table[String(values[3])] ?? '0' }]
        : undefined;

  it('retrouve 25 000 (15 000 + 10 000) et ne compte pas le droit PREPAID', async () => {
    const db = client(
      participations([
        { id: 'FOOD', merchant_id: 'm1', pitch_fee: '15000', pitch_fee_mode: 'DEDUCT_OR_DEBT' },
        { id: 'TEE', merchant_id: 'm2', pitch_fee: '10000', pitch_fee_mode: 'DEDUCT_OR_DEBT' },
        {
          id: 'BAR',
          merchant_id: 'm3',
          pitch_fee: '5000',
          pitch_fee_mode: 'PREPAID',
          pitch_fee_reference: 'REF-1',
        },
      ]),
      balance({ FOOD: '-40000', TEE: '-40000' }),
    );
    const result = await pitchFees.compute(context(db));
    expect(result.applicable).toBe(true);
    expect(result.total).toBe(25_000n);
    expect(result.commands.map((c) => c.type)).toEqual(['PITCH_FEE']);
    expect(result.lines.find((l) => l.reference === 'REF-1')).toMatchObject({ amount: 5000n });
    expect(db.writes).toEqual([]);
  });

  it('tous PREPAID : sans objet, aucune commande', async () => {
    const db = client(
      participations([
        {
          id: 'BAR',
          merchant_id: 'm3',
          pitch_fee: '5000',
          pitch_fee_mode: 'PREPAID',
          pitch_fee_reference: 'R',
        },
      ]),
    );
    const result = await pitchFees.compute(context(db));
    expect(result.applicable).toBe(false);
    expect(result.commands).toEqual([]);
    expect(result.lines).toMatchObject([{ amount: 5000n, reference: 'R' }]);
  });

  it('DEDUCT_CAPPED plafonné au solde ; DEDUCT_OR_DEBT insuffisant : dette transférée', async () => {
    const db = client(
      participations([
        { id: 'FOOD', merchant_id: 'm1', pitch_fee: '15000', pitch_fee_mode: 'DEDUCT_CAPPED' },
        { id: 'TEE', merchant_id: 'm2', pitch_fee: '10000', pitch_fee_mode: 'DEDUCT_OR_DEBT' },
      ]),
      balance({ FOOD: '-6000', TEE: '-3000' }),
    );
    const result = await pitchFees.compute(context(db));
    // 6 000 retenus au commerçant plafonné, 10 000 au second dont 7 000 de dette reprise.
    expect(result.total).toBe(16_000n);
    expect(result.commands.map((c) => [c.type, c.idempotencyKey])).toEqual([
      ['PITCH_FEE', 'closing:event-1:PITCH_FEES'],
      ['MERCHANT_DEBT_TRANSFER', 'closing:event-1:PITCH_FEES:debt:TEE'],
    ]);
    expect(result.lines.find((l) => l.label.startsWith('Dette'))?.amount).toBe(7000n);
  });
});

describe('OPERATOR_FEE et PLATFORM_FEE (FR-005)', () => {
  it('frais 6 000 (HT 5 085 + TVA 915) ; assiette brute même en NET_OF_REFUNDS', async () => {
    const result = await operatorFee.compute(
      context(client(bases('100000', '6')), { operatorFeeBasis: 'NET_OF_REFUNDS' }),
    );
    expect(result.total).toBe(6000n);
    expect(result.lines.map((l) => l.amount)).toEqual([5085n, 915n]);
    expect(result.summary).toMatchObject({ operatorFeeHt: 5085, bases: { TOPUP_AMOUNT: 100000 } });
  });

  it('redevance 1 017 (862 HT + 155 TVA) sur les frais HT relus de l’étape 2', async () => {
    const recorded = new Map<ClosingStep, RecordedStep>([
      ['OPERATOR_FEE', { status: 'DONE', summary: { operatorFeeHt: 5085 }, transactionIds: ['t'] }],
    ]);
    const result = await platformFee.compute(context(client(), { recorded }));
    expect(result.total).toBe(1017n);
    expect(result.lines.map((l) => l.amount)).toEqual([862n, 155n]);
  });

  it('redevance : étape 2 sans objet donne une étape sans objet', async () => {
    const recorded = new Map<ClosingStep, RecordedStep>([
      ['OPERATOR_FEE', { status: 'NOT_APPLICABLE', summary: {}, transactionIds: [] }],
    ]);
    expect((await platformFee.compute(context(client(), { recorded }))).applicable).toBe(false);
  });
});

describe('OPERATOR_FEE_REGULARIZATION (FR-005, R-04)', () => {
  // Règle à minimum : 3 % des recharges, au moins 2 500, au plus 5 000.
  const rule = { rateBps: 300n, min: 2500n, max: 5000n };
  const config: Partial<ResolvedConfig> = { operatorFees: [{ basis: 'TOPUP_AMOUNT', rule }] };
  const recorded = new Map<ClosingStep, RecordedStep>([
    [
      'OPERATOR_FEE',
      {
        status: 'DONE',
        summary: { bases: { TOPUP_AMOUNT: 100000, PER_MEDIA: 6 } },
        transactionIds: ['tx-fee'],
      },
    ],
  ]);
  const refunds =
    (amount: string): Handler =>
    (sql) => {
      if (sql.includes('min(recorded_at)')) return [{ at: new Date('2026-12-12T10:00:00Z') }];
      if (sql.includes("t.type = 'WALLET_REFUND'")) return [{ v: amount }];
      return undefined;
    };

  it('GROSS : sans objet', async () => {
    const result = await operatorFeeRegularization.compute(context(client(), { config }));
    expect(result.applicable).toBe(false);
  });

  it('le delta est un double calcul avec min et max, pas le taux sur les remboursements', async () => {
    const result = await operatorFeeRegularization.compute(
      context(client(refunds('20000')), { config, operatorFeeBasis: 'NET_OF_REFUNDS', recorded }),
    );
    // Brut 3 000 ; net (80 000) 2 400 relevé au minimum 2 500 : delta 500. Le taux sur 20 000 donnerait 600.
    expect(feeTotal(scenarioConfig(config), { TOPUP_AMOUNT: 100000n, PER_MEDIA: 0n })).toBe(3000n);
    expect(result.applicable).toBe(true);
    expect(result.total).toBe(500n);
    expect(result.total).not.toBe((20_000n * rule.rateBps) / 10_000n);
    expect(result.summary).toMatchObject({ refunded: 20000, delta: 500 });
    expect(result.commands.map((c) => c.idempotencyKey)).toEqual([
      'closing:event-1:OPERATOR_FEE_REGULARIZATION',
    ]);
  });

  it('minimum qui absorbe le remboursement : delta nul, sans objet', async () => {
    const result = await operatorFeeRegularization.compute(
      context(client(refunds('5000')), {
        config: { operatorFees: [{ basis: 'TOPUP_AMOUNT', rule: { rateBps: 300n, min: 3000n } }] },
        operatorFeeBasis: 'NET_OF_REFUNDS',
        recorded,
      }),
    );
    expect(result.applicable).toBe(false);
    expect(result.commands).toEqual([]);
  });
});

describe('BREAKAGE (FR-006)', () => {
  const wallets =
    (rows: object[]): Handler =>
    (sql) =>
      sql.includes('FROM account a JOIN account_balance') ? rows : undefined;
  const rows = [
    { wallet_id: 'W01', purpose: 'WALLET_PAID', balance: '9000' },
    { wallet_id: 'W05', purpose: 'WALLET_PAID', balance: '11000' },
  ];

  it('20 000 partagés 16 000 (organisateur) et 4 000 (prestataire)', async () => {
    const result = await breakage.compute(context(client(wallets(rows))));
    expect(result.total).toBe(20_000n);
    expect(result.lines.map((l) => l.amount)).toEqual([16_000n, 4000n]);
  });

  it('OPERATOR : 100 % au prestataire, breakage_organizer_bps ignoré', async () => {
    const result = await breakage.compute(
      context(client(wallets(rows)), { config: { breakageDestination: 'OPERATOR' } }),
    );
    expect(result.lines.map((l) => [l.partyId, l.amount])).toEqual([[ids.operator, 20_000n]]);
  });

  it('LEGAL_ACCOUNT : une ligne du compte légal ; NONE : sans objet', async () => {
    const legal = await breakage.compute(
      context(client(wallets(rows)), { config: { breakageDestination: 'LEGAL_ACCOUNT' } }),
    );
    expect(legal.lines.map((l) => [l.label, l.amount])).toEqual([['Casse, compte légal', 20_000n]]);
    const none = await breakage.compute(
      context(client(), { config: { breakageDestination: 'NONE' } }),
    );
    expect(none.applicable).toBe(false);
  });

  it('aucun portefeuille à solde : sans objet', async () => {
    expect((await breakage.compute(context(client(wallets([]))))).applicable).toBe(false);
  });
});

describe('DEPOSIT_FORFEIT et PROMO_EXPIRY (FR-007)', () => {
  it('caution de 2 000 : un DEPOSIT_FORFEITED par support', async () => {
    const db = client((sql) =>
      sql.includes("deposit_status = 'HELD'")
        ? [{ id: 'media-4', deposit_held: '2000' }]
        : undefined,
    );
    const result = await depositForfeit.compute(context(db));
    expect(result.total).toBe(2000n);
    expect(result.commands.map((c) => [c.type, c.mediaId, c.idempotencyKey])).toEqual([
      ['DEPOSIT_FORFEITED', 'media-4', 'closing:event-1:DEPOSIT_FORFEIT:media-4'],
    ]);
  });

  it('crédits offerts de 1 000 : un PROMO_EXPIRY par portefeuille', async () => {
    const db = client((sql) =>
      sql.includes('FROM account a JOIN account_balance')
        ? [{ wallet_id: 'W06', purpose: 'WALLET_PROMO', balance: '1000' }]
        : undefined,
    );
    const result = await promoExpiry.compute(context(db));
    expect(result.total).toBe(1000n);
    expect(result.commands.map((c) => c.type)).toEqual(['PROMO_EXPIRY']);
  });

  it('rien à faire : sans objet', async () => {
    const db = client(() => []);
    expect((await depositForfeit.compute(context(db))).applicable).toBe(false);
    expect((await promoExpiry.compute(context(db))).applicable).toBe(false);
  });
});
