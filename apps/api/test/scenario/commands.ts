// Les 48 transactions du scénario de référence sous forme de commandes MÉTIER (montant, portefeuille, participation,
// canal, espèces comptées…), jamais leurs lignes : les lignes du JSON ne servent qu'à comparer ce qui a été écrit.
// Clés d'idempotence, dates et sources sont celles du JSON ; les statuts de l'événement suivent la projection R-08.
import type { EventStatus } from '../../src/ledger/status-matrix';
import type { LedgerCommand } from '../../src/ledger/types';
import { transaction } from '../unit/builders/support/scenario-lines';
import type { MerchantKey, ScenarioFixture, WalletKey } from './fixture';

export interface ScenarioStep {
  no: number;
  /** Passage(s) de statut à faire juste avant cette transaction (set_event_status). */
  statusBefore?: EventStatus[];
  command(fx: ScenarioFixture, lookup: (key: string) => Promise<string>): Promise<LedgerCommand>;
}

type Payload = (fx: ScenarioFixture) => unknown;

/** Commande n° `no` : type, clé, date et source du JSON ; le reste vient de la fixture. */
function step(
  no: number,
  payload: Payload,
  options: { statusBefore?: EventStatus[]; media?: 'W04' | 'W05'; reversesKey?: string } = {},
): ScenarioStep {
  return {
    no,
    ...(options.statusBefore ? { statusBefore: options.statusBefore } : {}),
    async command(fx, lookup) {
      const tx = transaction(no);
      return {
        type: tx.type,
        idempotencyKey: tx.idempotency_key,
        occurredAt: new Date(tx.occurred_at),
        source: tx.source,
        ledgerId: fx.ledgerId,
        eventId: fx.eventId,
        currency: 'XOF',
        payload: payload(fx),
        ...(tx.source === 'BACKOFFICE' ? { createdBy: fx.users.author, approvedBy: fx.users.approver } : {}),
        ...(options.media ? { mediaId: fx.media[options.media] } : {}),
        ...(options.reversesKey ? { reversesId: await lookup(options.reversesKey) } : {}),
      };
    },
  };
}

const W = (fx: ScenarioFixture, key: WalletKey) => fx.wallets[key];
const P = (fx: ScenarioFixture, key: MerchantKey) => fx.participations[key];
const topup = (wallet: WalletKey, channel: string, amount: bigint): Payload => (fx) => ({ walletId: W(fx, wallet), channel, amount });
const cash = (wallet: WalletKey, amount: bigint): Payload => (fx) => ({ walletId: W(fx, wallet), cashDesk: 'C1', amount });
const sale = (wallet: WalletKey, merchant: MerchantKey, amount: bigint): Payload => (fx) => ({
  walletId: W(fx, wallet),
  participationId: P(fx, merchant),
  amount,
});
const confirmed = (amount: bigint): Payload => () => ({ amount, moneyAccount: 'A-BANQUE' });

export const STEPS: ScenarioStep[] = [
  step(1, topup('W01', 'WAVE', 20_000n), { statusBefore: ['LIVE'] }),
  step(2, topup('W02', 'OM', 15_000n)),
  step(3, topup('W03', 'CARTE', 30_000n)),
  step(4, cash('W04', 10_000n)),
  step(5, () => ({ moneyAccount: 'A-CAISSE-C1' }), { media: 'W04' }), // take_deposit, lot SEPARATE
  step(6, cash('W05', 25_000n)),
  step(7, () => ({}), { media: 'W05' }), // take_deposit, lot FROM_BALANCE
  step(8, (fx) => ({ walletId: W(fx, 'W06'), amount: 6000n })),
  step(9, (fx) => ({ walletIds: (['W01', 'W02', 'W03', 'W04', 'W05'] as const).map((w) => W(fx, w)) })),
  step(10, sale('W01', 'FOOD', 6000n)),
  step(11, sale('W01', 'BAR', 4000n)),
  step(12, sale('W02', 'TEE', 12_000n)),
  step(13, sale('W03', 'FOOD', 9000n)),
  step(14, sale('W03', 'BAR', 7500n)),
  step(15, sale('W04', 'BAR', 6000n)),
  step(16, () => ({}), { reversesKey: 'TPE-BAR-01:0003' }),
  step(17, sale('W04', 'BAR', 3000n)),
  step(18, sale('W05', 'TEE', 8000n)),
  step(19, sale('W05', 'FOOD', 5000n)),
  step(20, sale('W06', 'BAR', 4000n)),
  step(21, sale('W06', 'FOOD', 1000n)),
  step(22, sale('W04', 'FOOD', 9000n)), // hors ligne : la part non couverte va au compte d'attente
  step(23, () => ({}), { media: 'W05' }), // refund_deposit, recrédité sur le portefeuille
  step(24, () => ({ cashDesk: 'C1', counted: 36_800n, expected: 37_000n }), { statusBefore: ['CLOSING'] }),
  step(25, () => ({ amount: 3000n }), { statusBefore: ['RECONCILING'] }),
  step(26, () => ({ amount: 36_800n })),
  step(27, () => ({ channel: 'WAVE', net: 19_800n })),
  step(28, () => ({ channel: 'OM', net: 14_775n })),
  step(29, () => ({ channel: 'CARTE', net: 29_250n })),
  step(
    30,
    (fx) => ({
      items: [
        { participationId: P(fx, 'FOOD'), mode: 'DEDUCT_OR_DEBT' },
        { participationId: P(fx, 'TEE'), mode: 'DEDUCT_OR_DEBT' },
        { participationId: P(fx, 'BAR'), mode: 'PREPAID' },
      ],
    }),
    { statusBefore: ['SETTLING'] },
  ),
  // Assiettes de la période : recharges payées (T1-T4, T6) et bracelets activés (paramètre du scénario).
  step(31, () => ({ bases: { TOPUP_AMOUNT: 100_000n, PER_MEDIA: 6n } })),
  step(32, () => ({ operatorFeeHt: 5085n })),
  step(33, (fx) => ({
    payouts: [
      { beneficiary: { participationId: P(fx, 'FOOD') }, amount: 11_400n },
      { beneficiary: { participationId: P(fx, 'TEE') }, amount: 8000n },
      { beneficiary: { participationId: P(fx, 'BAR') }, amount: 18_500n },
      { beneficiary: 'OPERATOR', amount: 4983n },
      { beneficiary: 'PLATFORM', amount: 1017n },
    ],
  })),
  step(34, confirmed(11_400n)),
  step(35, (fx) => ({ amount: 8000n, beneficiary: { participationId: P(fx, 'TEE') } })),
  step(36, confirmed(18_500n)),
  step(37, confirmed(4983n)),
  step(38, confirmed(1017n)),
  step(39, (fx) => ({ payouts: [{ beneficiary: { participationId: P(fx, 'TEE') }, amount: 8000n }] })),
  step(40, confirmed(8000n)),
  step(41, (fx) => ({ walletId: W(fx, 'W02'), amount: 2000n, moneyAccount: 'A-BANQUE' }), { statusBefore: ['REFUND_WINDOW'] }),
  step(42, (fx) => ({ walletId: W(fx, 'W03'), amount: 12_500n, moneyAccount: 'A-BANQUE' })),
  step(43, (fx) => ({ wallets: [{ walletId: W(fx, 'W01'), paid: 9000n }, { walletId: W(fx, 'W05'), paid: 11_000n }] })),
  step(44, () => ({}), { media: 'W04' }), // forfeit_deposit : bracelet jamais rendu
  step(45, (fx) => ({ walletId: W(fx, 'W06'), amount: 1000n })),
  step(46, () => ({
    payouts: [
      { beneficiary: 'ORGANIZER', amount: 39_225n },
      { beneficiary: 'OPERATOR', amount: 4000n },
    ],
  })),
  step(47, confirmed(39_225n)),
  step(48, confirmed(4000n)),
];

/** Passage final, après la dernière transaction. */
export const FINAL_STATUS: EventStatus = 'CLOSED';
