import { checkPeriod, type PeriodInput } from '../../src/offline-rules/period';

const T = new Date('2026-10-30T12:00:00Z');
const base = {
  occurredAt: T,
  lockedUntil: null as Date | null,
  ledgerStatus: 'OPEN',
  eventStatus: 'LIVE',
  type: 'PURCHASE' as const,
};
const closed = { ok: false, reason: 'PERIOD_CLOSED', anomaly: 'PERIOD_CLOSED_OPERATION' };
const late = { ok: false, reason: 'SYNC_DEADLINE_PASSED', anomaly: 'LATE_OFFLINE_SYNC' };

describe('checkPeriod', () => {
  it.each<[string, Partial<PeriodInput>, unknown]>([
    ['libre', {}, { ok: true }],
    ['locked_until égal à occurredAt : fermé', { lockedUntil: T }, closed],
    ['locked_until une ms avant : libre', { lockedUntil: new Date(T.getTime() - 1) }, { ok: true }],
    ['locked_until après : fermé', { lockedUntil: new Date(T.getTime() + 1) }, closed],
    [
      'grand livre LOCKED',
      { ledgerStatus: 'LOCKED' },
      { ok: false, reason: 'LEDGER_LOCKED', anomaly: 'PERIOD_CLOSED_OPERATION' },
    ],
    [
      'période fermée avant grand livre verrouillé',
      { lockedUntil: T, ledgerStatus: 'LOCKED' },
      closed,
    ],
    ['CLOSING accepte une vente', { eventStatus: 'CLOSING' }, { ok: true }],
    ['RECONCILING accepte une vente', { eventStatus: 'RECONCILING' }, { ok: true }],
    ['SETTLING refuse une vente', { eventStatus: 'SETTLING' }, late],
    ['REFUND_WINDOW refuse une vente', { eventStatus: 'REFUND_WINDOW' }, late],
    ['CLOSED refuse une vente', { eventStatus: 'CLOSED' }, late],
    ['SETTLING refuse une annulation', { eventStatus: 'SETTLING', type: 'REVERSAL' }, late],
    ['SETTLING accepte un VOID', { eventStatus: 'SETTLING', type: 'VOID' }, { ok: true }],
    ['SETTLING accepte ONLINE_REF', { eventStatus: 'SETTLING', type: 'ONLINE_REF' }, { ok: true }],
    ['VOID subit la période fermée', { type: 'VOID', lockedUntil: T }, closed],
    [
      'ONLINE_REF subit LOCKED',
      { type: 'ONLINE_REF', ledgerStatus: 'LOCKED' },
      {
        ok: false,
        reason: 'LEDGER_LOCKED',
        anomaly: 'PERIOD_CLOSED_OPERATION',
      },
    ],
    ['statut d’événement inconnu : refus', { eventStatus: 'WHATEVER' }, late],
  ])('%s', (_n, over, expected) => {
    expect(checkPeriod({ ...base, ...over })).toEqual(expected);
  });
});
