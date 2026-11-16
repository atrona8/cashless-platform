// REVERSAL d'un WALLET_REFUND de source BACKOFFICE (mission remboursements 9a, FR-009, décision 5, ADR-189) :
// accepté exactement quand WALLET_REFUND l'est, rien d'autre ne change. Les attendus sont écrits en clair.
import {
  EVENT_STATUSES,
  isAccepted,
  type EventStatus,
  type LedgerStatus,
  type StatusCheckInput,
} from '../../../src/ledger/status-matrix';
import { SOURCES, TRANSACTION_TYPES, type Source } from '../../../src/ledger/types';

const LEDGER_STATUSES: LedgerStatus[] = ['OPEN', 'CLOSING', 'LOCKED'];

function check(
  eventStatus: EventStatus,
  ledgerStatus: LedgerStatus,
  source: Source,
  reversesType?: StatusCheckInput['reversesType'],
): boolean {
  return isAccepted({
    eventStatus,
    ledgerStatus,
    type: 'REVERSAL',
    source,
    ...(reversesType ? { reversesType } : {}),
  }).ok;
}

describe('REVERSAL d’un WALLET_REFUND BACKOFFICE', () => {
  it('propriété : verdict identique à celui de WALLET_REFUND (statut × grand livre)', () => {
    for (const eventStatus of EVENT_STATUSES) {
      for (const ledgerStatus of LEDGER_STATUSES) {
        const refund = isAccepted({
          eventStatus,
          ledgerStatus,
          type: 'WALLET_REFUND',
          source: 'BACKOFFICE',
        });
        expect([
          eventStatus,
          ledgerStatus,
          check(eventStatus, ledgerStatus, 'BACKOFFICE', 'WALLET_REFUND'),
        ]).toEqual([eventStatus, ledgerStatus, refund.ok]);
      }
    }
  });

  it.each<[EventStatus, LedgerStatus]>([
    ['SETTLING', 'OPEN'],
    ['REFUND_WINDOW', 'OPEN'],
    ['RECONCILING', 'OPEN'],
    ['CLOSING', 'OPEN'],
    ['CLOSED', 'CLOSING'],
    ['LIVE', 'OPEN'],
  ])('accepté : %s, grand livre %s', (eventStatus, ledgerStatus) => {
    expect(check(eventStatus, ledgerStatus, 'BACKOFFICE', 'WALLET_REFUND')).toBe(true);
  });

  it('refusé : DRAFT', () => {
    expect(check('DRAFT', 'OPEN', 'BACKOFFICE', 'WALLET_REFUND')).toBe(false);
  });

  it('CLOSED, grand livre LOCKED : accepté en BACKOFFICE seulement (comme WALLET_REFUND)', () => {
    expect(check('CLOSED', 'LOCKED', 'BACKOFFICE', 'WALLET_REFUND')).toBe(true);
    expect(check('CLOSED', 'LOCKED', 'ONLINE', 'WALLET_REFUND')).toBe(false);
  });

  it.each<EventStatus>(['SETTLING', 'REFUND_WINDOW'])(
    'refusé en %s : REVERSAL d’un PURCHASE (ou d’un TOPUP)',
    (eventStatus) => {
      expect(check(eventStatus, 'OPEN', 'BACKOFFICE', 'PURCHASE')).toBe(false);
      expect(check(eventStatus, 'OPEN', 'BACKOFFICE', 'TOPUP')).toBe(false);
    },
  );

  it('refusé en SETTLING : toute source autre que BACKOFFICE', () => {
    for (const source of SOURCES.filter((s) => s !== 'BACKOFFICE')) {
      expect([source, check('SETTLING', 'OPEN', source, 'WALLET_REFUND')]).toEqual([source, false]);
      expect([source, check('REFUND_WINDOW', 'OPEN', source, 'WALLET_REFUND')]).toEqual([
        source,
        false,
      ]);
    }
  });

  it('RECONCILING : REVERSAL synchronisé toujours accepté, reversesType ignoré', () => {
    for (const source of ['OFFLINE_SYNC', 'EDGE_SYNC'] as const) {
      expect(check('RECONCILING', 'OPEN', source)).toBe(true);
      expect(check('RECONCILING', 'OPEN', source, 'WALLET_REFUND')).toBe(true);
      expect(check('RECONCILING', 'OPEN', source, 'PURCHASE')).toBe(true);
    }
  });

  it('sans reversesType : règle de REVERSAL seule (la matrice exhaustive couvre le reste)', () => {
    expect(check('SETTLING', 'OPEN', 'BACKOFFICE')).toBe(false);
    expect(check('REFUND_WINDOW', 'OPEN', 'BACKOFFICE')).toBe(false);
    expect(check('LIVE', 'OPEN', 'ONLINE')).toBe(true);
    expect(check('CLOSING', 'OPEN', 'BACKOFFICE')).toBe(true);
    expect(check('RECONCILING', 'OPEN', 'BACKOFFICE')).toBe(false);
  });

  it('reversesType autre que WALLET_REFUND : verdict de REVERSAL inchangé', () => {
    for (const reversesType of TRANSACTION_TYPES.filter((t) => t !== 'WALLET_REFUND')) {
      for (const eventStatus of EVENT_STATUSES) {
        for (const ledgerStatus of LEDGER_STATUSES) {
          for (const source of SOURCES) {
            expect(check(eventStatus, ledgerStatus, source, reversesType)).toBe(
              check(eventStatus, ledgerStatus, source),
            );
          }
        }
      }
    }
  });

  it('reversesType ne change rien pour un autre type que REVERSAL', () => {
    const base = { eventStatus: 'SETTLING', ledgerStatus: 'OPEN', source: 'BACKOFFICE' } as const;
    expect(isAccepted({ ...base, type: 'PURCHASE', reversesType: 'WALLET_REFUND' }).ok).toBe(false);
  });
});
