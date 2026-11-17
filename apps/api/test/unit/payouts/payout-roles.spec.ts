// Rôle selon le bénéficiaire (mission 9b, lot WP08 ; décision du porteur, contradiction 1 ; FR-010)
// : liste figée.
import {
  PAYOUT_ROLES,
  PAYOUT_ROLES_BY_BENEFICIARY,
  missingRole,
  validatePayload,
} from '../../../src/payouts/payout-action';
import { maskIban } from '../../../src/common/iban';
import { maskPaymentData } from '../../../src/approval/approval.mapper';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const chain = [
  { scope: { type: 'ORGANIZER' as const, id: id(1) } },
  { scope: { type: 'OPERATOR' as const, id: id(2) } },
];

describe('rôles des versements', () => {
  it('liste figée : tout ajout ou retrait fait échouer ce test', () => {
    expect(PAYOUT_ROLES_BY_BENEFICIARY).toEqual({
      MERCHANT: 'ORGANIZER_ADMIN',
      ORGANIZER: 'ORGANIZER_ADMIN',
      OPERATOR: 'OPERATOR_ADMIN',
      PLATFORM: 'OPERATOR_ADMIN',
    });
    expect(Object.isFrozen(PAYOUT_ROLES_BY_BENEFICIARY)).toBe(true);
    expect([...PAYOUT_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('un lot mixte exige les deux rôles ; chaque classe seule exige le sien', () => {
    const org = {
      assignments: [
        { role: 'ORGANIZER_ADMIN' as const, scopeType: 'ORGANIZER' as const, scopeId: id(1) },
      ],
    };
    const ope = {
      assignments: [
        { role: 'OPERATOR_ADMIN' as const, scopeType: 'OPERATOR' as const, scopeId: id(2) },
      ],
    };
    const both = { assignments: [...org.assignments, ...ope.assignments] };
    expect(missingRole(org, ['MERCHANT', 'ORGANIZER'], chain)).toBeUndefined();
    expect(missingRole(org, ['OPERATOR'], chain)).toBe('OPERATOR_ADMIN');
    expect(missingRole(ope, ['MERCHANT'], chain)).toBe('ORGANIZER_ADMIN');
    expect(missingRole(org, ['MERCHANT', 'PLATFORM'], chain)).toBe('OPERATOR_ADMIN');
    expect(missingRole(both, ['MERCHANT', 'PLATFORM'], chain)).toBeUndefined();
  });

  it('un rôle tenu sur une autre portée ne vaut pas', () => {
    const other = {
      assignments: [
        { role: 'ORGANIZER_ADMIN' as const, scopeType: 'ORGANIZER' as const, scopeId: id(9) },
      ],
    };
    expect(missingRole(other, ['MERCHANT'], chain)).toBe('ORGANIZER_ADMIN');
  });
});

describe('charge figée', () => {
  const line = {
    beneficiary_party_id: id(5),
    beneficiary_kind: 'OPERATOR',
    amount: 1000,
    method: 'WAVE',
    msisdn: '+221770000001',
  };
  const payload = { ledger_id: id(3), scope_type: 'EVENT', scope_id: id(4), lines: [line] };

  it('refuse montant nul, négatif, décimal, au-delà de 2^53, IBAN faux, doublon et champ étranger', () => {
    expect(() => validatePayload(payload)).not.toThrow();
    for (const amount of [0, -5, 1.5, 2 ** 53])
      expect(() => validatePayload({ ...payload, lines: [{ ...line, amount }] })).toThrow();
    expect(() =>
      validatePayload({
        ...payload,
        lines: [
          {
            ...line,
            method: 'BANK_TRANSFER',
            msisdn: undefined,
            iban: 'SN08SN0100152000048500003036',
          },
        ],
      }),
    ).toThrow();
    expect(() => validatePayload({ ...payload, lines: [line, line] })).toThrow();
    expect(() => validatePayload({ ...payload, extra: 1 })).toThrow();
    expect(() => validatePayload({ ...payload, lines: [{ ...line, extra: 1 }] })).toThrow();
    expect(() => validatePayload({ ...payload, lines: [{ ...line, method: 'CASH' }] })).toThrow();
  });
});

describe('masque des données de paiement', () => {
  it('masque iban et msisdn à toute profondeur, sans toucher le reste', () => {
    const out = maskPaymentData({
      note: 'x',
      lines: [{ iban: 'SN08SN0100152000048500003035', msisdn: '+221770000001', amount: 5 }],
    }) as { lines: Array<Record<string, unknown>>; note: string };
    expect(out.note).toBe('x');
    expect(out.lines[0]!.iban).toBe(maskIban('SN08SN0100152000048500003035'));
    expect(out.lines[0]!.msisdn).toBe('**********001');
    expect(out.lines[0]!.amount).toBe(5);
    expect(JSON.stringify(out)).not.toContain('770000001');
  });
});
