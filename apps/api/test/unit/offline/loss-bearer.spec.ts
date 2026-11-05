import { lossBearer } from '../../../src/offline/rules/loss-bearer';

describe('lossBearer', () => {
  it.each([
    ['PLATFORM', 'OPERATOR'],
    ['OPERATOR', 'OPERATOR'],
    ['ORGANIZER', 'ORGANIZER'],
    ['MERCHANT', 'MERCHANT'],
  ] as const)('%s -> %s', (from, to) => {
    expect(lossBearer(from)).toBe(to);
  });

  it('valeur hors liste : Error', () => {
    expect(() => lossBearer('BANK' as never)).toThrow();
  });
});
