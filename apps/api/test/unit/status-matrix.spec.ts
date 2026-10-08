// Matrice statut de l'événement × type de transaction (SPECIFICATION §12.1), cellule par cellule.
// Les attendus sont écrits ici en clair, recopiés de §12.1 — jamais dérivés de l'implémentation.
import { matchAccounts, type AccountRow } from '../../src/ledger/ports/account-resolver';
import { isAccepted, type EventStatus, type LedgerStatus, type StatusCheckInput } from '../../src/ledger/status-matrix';
import { BuildError, SOURCES, TRANSACTION_TYPES, type Source, type TransactionType } from '../../src/ledger/types';

/** Cellule acceptée : la commande type qui doit passer (source et paramètres). */
type Accepted = Partial<Omit<StatusCheckInput, 'eventStatus' | 'ledgerStatus' | 'type'>>;

const ANY: Accepted = { source: 'ONLINE' };
const SYNC: Accepted = { source: 'OFFLINE_SYNC' };
const BO: Accepted = { source: 'BACKOFFICE' };

/** Pour chaque statut : les types acceptés (avec un contexte valide) ; tous les autres sont refusés. */
const EXPECTED: [EventStatus, LedgerStatus, Partial<Record<TransactionType, Accepted>>][] = [
  [
    'DRAFT',
    'OPEN',
    {
      PROMO_CREDIT: { source: 'BATCH', variant: 'PRELOAD' },
      DEPOSIT_TAKEN: { source: 'ONLINE', depositMode: 'SEPARATE' },
      DEPOSIT_REFUNDED: { source: 'ONLINE', depositMode: 'SEPARATE' },
    },
  ],
  [
    'LIVE',
    'OPEN',
    {
      TOPUP: { source: 'PSP_WEBHOOK' }, TOPUP_CASH: ANY, PROMO_CREDIT: BO, PROMO_EXPIRY: ANY, ACTIVATION_FEE: ANY,
      DEPOSIT_TAKEN: ANY, DEPOSIT_REFUNDED: ANY, DEPOSIT_FORFEITED: ANY, PURCHASE: ANY, REVERSAL: ANY, PITCH_FEE: ANY,
      OPERATOR_FEE: ANY, PLATFORM_FEE: ANY, ANOMALY_RESOLUTION: BO, CASH_CLOSE: BO, CASH_DEPOSIT: ANY,
      PSP_SETTLEMENT: ANY, CHARGEBACK: ANY, WALLET_REFUND: ANY, PAYOUT_INITIATED: ANY, PAYOUT_CONFIRMED: ANY,
      PAYOUT_FAILED: ANY, ADJUSTMENT: BO, MERCHANT_DEBT_TRANSFER: ANY,
      // FR-024: « Tous, sauf BREAKAGE » lu à la lettre : BREAKAGE_REVERSAL passe le moteur ; la base exige une casse
      // antérieure sur le même portefeuille (check_late_claim, CL024).
      BREAKAGE_REVERSAL: BO,
    },
  ],
  [
    'CLOSING',
    'CLOSING',
    {
      PURCHASE: SYNC, TOPUP_CASH: SYNC, DEPOSIT_TAKEN: { source: 'EDGE_SYNC' }, TOPUP: { source: 'PSP_WEBHOOK' },
      REVERSAL: ANY, CASH_CLOSE: BO, DEPOSIT_REFUNDED: ANY, WALLET_REFUND: ANY, PROMO_EXPIRY: ANY, CHARGEBACK: ANY,
    },
  ],
  [
    'RECONCILING',
    'CLOSING',
    {
      PURCHASE: SYNC, TOPUP_CASH: SYNC, DEPOSIT_TAKEN: SYNC,
      // FR-024: « les synchronisations et leurs REVERSAL » : seules les annulations synchronisées sont acceptées.
      REVERSAL: SYNC,
      CASH_CLOSE: BO, CASH_DEPOSIT: ANY, PSP_SETTLEMENT: ANY, ANOMALY_RESOLUTION: BO, ADJUSTMENT: BO, WALLET_REFUND: ANY,
      DEPOSIT_REFUNDED: ANY, PROMO_EXPIRY: ANY, CHARGEBACK: ANY,
    },
  ],
  [
    'SETTLING',
    'CLOSING',
    {
      PITCH_FEE: ANY, MERCHANT_DEBT_TRANSFER: ANY, OPERATOR_FEE: ANY, PLATFORM_FEE: ANY, PAYOUT_INITIATED: ANY,
      PAYOUT_CONFIRMED: ANY, PAYOUT_FAILED: ANY, WALLET_REFUND: ANY, DEPOSIT_REFUNDED: ANY, PROMO_EXPIRY: ANY,
      CHARGEBACK: ANY, ADJUSTMENT: BO,
    },
  ],
  [
    'REFUND_WINDOW',
    'CLOSING',
    {
      WALLET_REFUND: ANY, DEPOSIT_REFUNDED: ANY, PROMO_EXPIRY: ANY, CHARGEBACK: ANY, BREAKAGE: ANY, DEPOSIT_FORFEITED: ANY,
      OPERATOR_FEE: { source: 'BATCH', variant: 'REGULARIZATION' }, PAYOUT_INITIATED: ANY, PAYOUT_CONFIRMED: ANY,
      PAYOUT_FAILED: ANY, ADJUSTMENT: BO,
    },
  ],
  [
    'CLOSED',
    'CLOSING',
    {
      WALLET_REFUND: ANY,
      PAYOUT_INITIATED: { source: 'BATCH', debitPurposes: ['LEGAL_BREAKAGE'] },
      // FR-024: confirmer / constater l'échec d'un versement débite L-VERS-ENCOURS, pas L-LEGAL-CASSE : accepté,
      // sinon le versement légal initié à CLOSED ne pourrait jamais aboutir.
      PAYOUT_CONFIRMED: { source: 'PSP_WEBHOOK', debitPurposes: ['PAYOUT_PENDING'] },
      PAYOUT_FAILED: { source: 'PSP_WEBHOOK', debitPurposes: ['PAYOUT_PENDING'] },
      // FR-024: absent du tableau de §12.1 mais le texte (ADR-77) dit qu'une contestation « reçue entre CLOSED et
      // le verrouillage est écrite normalement » : acceptée.
      CHARGEBACK: { source: 'PSP_WEBHOOK' },
    },
  ],
  ['CLOSED', 'LOCKED', { BREAKAGE_REVERSAL: BO, ADJUSTMENT: BO, WALLET_REFUND: BO, CHARGEBACK: BO }],
];

/** Contexte le plus permissif pour vérifier qu'un refus ne dépend d'aucun paramètre. */
const PERMISSIVE = { variant: 'PRELOAD', depositMode: 'SEPARATE', debitPurposes: ['LEGAL_BREAKAGE', 'PAYOUT_PENDING'] } as const;

describe('matrice statuts × types (§12.1)', () => {
  for (const [eventStatus, ledgerStatus, accepted] of EXPECTED) {
    describe(`${eventStatus} (grand livre ${ledgerStatus})`, () => {
      it.each([...TRANSACTION_TYPES])('%s', (type) => {
        const cell = accepted[type];
        if (cell) {
          expect(isAccepted({ eventStatus, ledgerStatus, type, source: 'ONLINE', ...cell })).toEqual({ ok: true });
        } else {
          for (const source of SOURCES) {
            const result = isAccepted({ eventStatus, ledgerStatus, type, source, ...PERMISSIVE });
            expect(result.ok).toBe(false);
          }
        }
      });
    });
  }
});

describe('sources, variantes et cas obligatoires', () => {
  const check = (eventStatus: EventStatus, type: TransactionType, source: Source, extra: Accepted = {}, ledgerStatus: LedgerStatus = 'CLOSING') =>
    isAccepted({ eventStatus, ledgerStatus, type, source, ...extra }).ok;

  it('BREAKAGE refusé en LIVE', () => {
    expect(check('LIVE', 'BREAKAGE', 'BATCH', {}, 'OPEN')).toBe(false);
  });

  it('PURCHASE ONLINE refusé en CLOSING, accepté en OFFLINE_SYNC', () => {
    expect(check('CLOSING', 'PURCHASE', 'ONLINE')).toBe(false);
    expect(check('CLOSING', 'PURCHASE', 'OFFLINE_SYNC')).toBe(true);
    expect(check('CLOSING', 'PURCHASE', 'EDGE_SYNC')).toBe(true);
  });

  it('TOPUP en CLOSING : seulement PSP_WEBHOOK', () => {
    expect(check('CLOSING', 'TOPUP', 'PSP_WEBHOOK')).toBe(true);
    expect(check('CLOSING', 'TOPUP', 'ONLINE')).toBe(false);
  });

  it('PITCH_FEE accepté en SETTLING seulement (hors LIVE)', () => {
    const statuses: [EventStatus, LedgerStatus][] = [
      ['DRAFT', 'OPEN'], ['CLOSING', 'CLOSING'], ['RECONCILING', 'CLOSING'], ['SETTLING', 'CLOSING'],
      ['REFUND_WINDOW', 'CLOSING'], ['CLOSED', 'CLOSING'], ['CLOSED', 'LOCKED'],
    ];
    expect(statuses.filter(([e, l]) => check(e, 'PITCH_FEE', 'BATCH', {}, l)).map(([e]) => e)).toEqual(['SETTLING']);
  });

  it('LOCKED : ADJUSTMENT BACKOFFICE accepté, BATCH refusé', () => {
    expect(check('CLOSED', 'ADJUSTMENT', 'BACKOFFICE', {}, 'LOCKED')).toBe(true);
    expect(check('CLOSED', 'ADJUSTMENT', 'BATCH', {}, 'LOCKED')).toBe(false);
  });

  it('DRAFT : PROMO_CREDIT hors préchargement refusé ; caution FROM_BALANCE refusée', () => {
    expect(check('DRAFT', 'PROMO_CREDIT', 'BACKOFFICE', {}, 'OPEN')).toBe(false);
    expect(check('DRAFT', 'DEPOSIT_TAKEN', 'ONLINE', { depositMode: 'FROM_BALANCE' }, 'OPEN')).toBe(false);
  });

  it('REFUND_WINDOW : OPERATOR_FEE hors régularisation refusé', () => {
    expect(check('REFUND_WINDOW', 'OPERATOR_FEE', 'BATCH')).toBe(false);
  });

  it('CLOSED avec soldes : PAYOUT_INITIATED hors compte légal refusé', () => {
    expect(check('CLOSED', 'PAYOUT_INITIATED', 'BATCH', { debitPurposes: ['MERCHANT'] })).toBe(false);
  });

  it('le motif nomme le statut et le type, sans SQL', () => {
    const result = isAccepted({ eventStatus: 'LIVE', ledgerStatus: 'OPEN', type: 'BREAKAGE', source: 'BATCH' });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('BREAKAGE') });
    expect(result.ok === false && result.reason).toContain('LIVE');
  });
});

describe('résolution des comptes (correspondance en mémoire)', () => {
  const row = (id: string, code: string, purpose: string, extra: Partial<AccountRow> = {}): AccountRow => ({
    id, code, purpose, owner_party_id: null, wallet_id: null, participation_id: null, ...extra,
  });
  const rows = [
    row('a1', 'A-PSP-WAVE', 'PSP', { owner_party_id: 'org' }),
    row('a2', 'L-ORG-COM', 'ORG_COM', { owner_party_id: 'org' }),
    row('a3', 'L-WAL-1-P', 'WALLET_PAID', { wallet_id: 'w1' }),
    row('a4', 'L-WAL-2-P', 'WALLET_PAID', { wallet_id: 'w2' }),
    row('a5', 'L-MCH-FOOD', 'MERCHANT', { owner_party_id: 'food', participation_id: 'p-food' }),
  ];

  it('par code, par fonction et titulaire, par portefeuille, par participation', () => {
    const refs = [
      { code: 'A-PSP-WAVE' },
      { purpose: 'ORG_COM', ownerPartyId: 'org' },
      { purpose: 'WALLET_PAID', walletId: 'w2' },
      { purpose: 'MERCHANT', participationId: 'p-food' },
    ];
    expect([...matchAccounts(rows, refs).values()]).toEqual(['a1', 'a2', 'a4', 'a5']);
  });

  it('introuvable ou ambigu : VALIDATION_FAILED', () => {
    expect(() => matchAccounts(rows, [{ code: 'A-BANQUE' }])).toThrow(BuildError);
    expect(() => matchAccounts(rows, [{ purpose: 'WALLET_PAID' }])).toThrow(/ambigu/);
  });
});
