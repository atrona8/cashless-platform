// Mission 9a, WP05 (T025) : compte d'argent de sortie d'un remboursement manuel, par canal.
import { moneyAccountFor } from '../../../../src/ledger/builders/festival/refund';
import { BuildError } from '../../../../src/ledger/types';

describe('moneyAccountFor', () => {
  it('Wave et Orange Money : comptes A-PSP-* des grands livres d’événement', () => {
    expect(moneyAccountFor('WAVE')).toBe('A-PSP-WAVE');
    expect(moneyAccountFor('ORANGE_MONEY')).toBe('A-PSP-OM');
  });

  it.each(['BANK_TRANSFER', 'CARD', '', 'wave'])('%p : refusé (VALIDATION_FAILED)', (method) => {
    expect(() => moneyAccountFor(method)).toThrow(BuildError);
    try {
      moneyAccountFor(method);
    } catch (error) {
      expect((error as BuildError).code).toBe('VALIDATION_FAILED');
    }
  });
});
