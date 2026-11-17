import { isValidIban, maskIban, normalizeIban } from '../../../src/common/iban';

// Exemples officiels (registre IBAN) et exemple du test 9a (WP11 le réutilise).
const VALID = [
  'GB82WEST12345698765432',
  'DE89370400440532013000',
  'FR1420041010050500013M02606',
  'ES9121000418450200051332',
  'IT60X0542811101000000123456',
  'NL91ABNA0417164300',
  'BE68539007547034',
  'CH9300762011623852957',
  'PT50000201231234567890154',
  'LU280019400644750000',
  'AT611904300234573201',
  'PL61109010140000071219812874',
  'NO9386011117947',
  'MA64011519000001205000534921',
  'CI93CI0080111301134291200589',
  'SN08SN0100152000048500003035',
];

describe('isValidIban', () => {
  it.each(VALID)('accepte %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it('accepte espaces, tirets et minuscules (SN08 SN01 0015 2000 0485 0000 3035)', () => {
    expect(isValidIban('SN08 SN01 0015 2000 0485 0000 3035')).toBe(true);
    expect(isValidIban('sn08-sn01-0015-2000-0485-0000-3035')).toBe(true);
    expect(isValidIban('  gb82 west 1234 5698 7654 32 ')).toBe(true);
  });

  it('refuse un chiffre changé', () => {
    expect(isValidIban('SN08SN0100152000048500003036')).toBe(false);
    expect(isValidIban('GB82WEST12345698765433')).toBe(false);
  });

  it('refuse une transposition de deux caractères voisins différents', () => {
    expect(isValidIban('DE89370400440532013000'.replace('3704', '7304'))).toBe(false);
    expect(isValidIban('GB82WEST12345698765432'.replace('WEST', 'WETS'))).toBe(false);
  });

  it('refuse une longueur fausse (27 et 29 pour un pays à 28)', () => {
    expect(isValidIban('SN08SN010015200004850000303')).toBe(false);
    expect(isValidIban('SN08SN01001520000485000030350')).toBe(false);
    expect(isValidIban('FR1420041010050500013M0260')).toBe(false);
  });

  it('refuse deux chiffres de contrôle faux (00, 01, 99)', () => {
    for (const check of ['00', '01', '99']) {
      expect(isValidIban(`SN${check}SN0100152000048500003035`)).toBe(false);
    }
  });

  it('refuse un pays hors table, même si le reste modulo 97 vaut 1', () => {
    const numeric = (text: string): string =>
      text.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    const bban = '0100152000048500003035';
    const check = String(98 - Number(BigInt(`${numeric(`${bban}XX`)}00`) % 97n)).padStart(2, '0');
    const forged = `XX${check}${bban}`;
    // Preuve que la construction est correcte : le reste vaut bien 1.
    expect(BigInt(numeric(`${bban}XX${check}`)) % 97n).toBe(1n);
    expect(isValidIban(forged)).toBe(false);
    expect(isValidIban('ZZ82WEST12345698765432')).toBe(false);
  });

  it('refuse un caractère non alphanumérique, une chaîne vide ou trop courte', () => {
    expect(isValidIban('')).toBe(false);
    expect(isValidIban('   ')).toBe(false);
    expect(isValidIban('SN')).toBe(false);
    expect(isValidIban('SN08SN010015200004850000303!')).toBe(false);
    expect(isValidIban('SN08SN0100152000048500003035;')).toBe(false);
    expect(isValidIban('SNO8SN0100152000048500003035')).toBe(false);
  });
});

describe('normalizeIban', () => {
  it('retire espaces et tirets, passe en majuscules, ne valide pas', () => {
    expect(normalizeIban(' sn08 sn01-0015 ')).toBe('SN08SN010015');
    expect(normalizeIban('pas un iban')).toBe('PASUNIBAN');
  });
});

describe('maskIban', () => {
  it('garde le pays, les deux chiffres de contrôle et les quatre derniers caractères', () => {
    expect(maskIban('SN08SN0100152000048500003035')).toBe(`SN08${'*'.repeat(20)}3035`);
    expect(maskIban('sn08 sn01 0015 2000 0485 0000 3035')).toBe(`SN08${'*'.repeat(20)}3035`);
  });

  it('masque en entier une valeur trop courte', () => {
    expect(maskIban('SN08')).toBe('****');
    expect(maskIban('')).toBe('');
  });

  it('ne laisse rien du numéro de compte', () => {
    const iban = 'FR1420041010050500013M02606';
    const masked = maskIban(iban);
    expect(masked).not.toContain('2004');
    expect(masked).toHaveLength(iban.length);
    expect(masked.slice(4, -4)).toMatch(/^\*+$/);
  });
});
