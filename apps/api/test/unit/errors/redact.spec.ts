import { REDACTED, REDACTED_FIELDS, redactSecrets } from '../../../src/errors/redact';

const IBAN = 'SN08SN0100152000048500003035';
const SPACED = 'SN08 SN01 0015 2000 0485 0000 3035';
const FRAGMENTS = ['SN08', 'SN01', '0015', '2000', '0485', '0000', '3035', '1520'];
const leaks = (out: string): string[] =>
  FRAGMENTS.filter((f) => out.toLowerCase().includes(f.toLowerCase()));

describe('redactSecrets : IBAN (FR-009)', () => {
  it.each([
    ['JSON', `{"iban":"${IBAN}"}`],
    ['JSON à espaces', `{"iban":"${SPACED}"}`],
    ['JSON imbriqué', `{"a":{"b":[{"destination_iban":"${SPACED}"}]}}`],
    ['formulaire', `iban=${IBAN}&x=1`],
    ['texte', `iban: ${IBAN}`],
    ['nom préfixé', `destination_iban=${IBAN}`],
    ['espaces', `iban=${SPACED}`],
    ['nu dans un message', `Remboursement refusé pour ${IBAN}, réessayez`],
    ['nu minuscules', `refus pour ${IBAN.toLowerCase()} aujourd'hui`],
    ['nu à espaces au milieu', `erreur sur ${SPACED} (voir support)`],
    ['URL', `https://x.test/p?dest=${IBAN}&a=b`],
  ])('aucun fragment du numéro ne reste : %s', (_n, text) => {
    expect(leaks(redactSecrets(text))).toEqual([]);
  });

  it('remplace par [masqué] et conserve le reste du message', () => {
    expect(redactSecrets(`erreur sur ${IBAN} fin`)).toBe(`erreur sur ${REDACTED} fin`);
  });

  it('secrets déjà couverts toujours masqués', () => {
    expect(redactSecrets('{"pin":"123456"}')).not.toContain('123456');
    expect(redactSecrets('token=abcdef123')).not.toContain('abcdef123');
    expect(redactSecrets('h=$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA')).not.toContain('aGFzaA');
    expect(redactSecrets('x-approval-token: tok-1')).not.toContain('tok-1');
  });

  it('un IBAN déjà masqué par maskIban et les chaînes ordinaires ne sont pas cassés', () => {
    const masked = 'FR14*******************2606';
    expect(redactSecrets(`iban_mask=${masked}`)).toContain('iban_mask=');
    for (const ok of [
      'a3f1c2d4-1b2e-4c5d-8e9f-0a1b2c3d4e5f',
      '2026-11-18T10:00:00Z',
      'montant 12500 XOF',
      'CL057 insertion refusée',
      'lot ref CL057',
      '23505',
    ]) {
      expect(redactSecrets(ok)).toBe(ok);
    }
  });

  it('REDACTED_FIELDS = ancienne liste + iban (borne reprise par WP09)', () => {
    expect([...REDACTED_FIELDS]).toEqual([
      'pin',
      'token',
      'customer_qr_token',
      'qr_payload',
      'x-approval-token',
      'iban',
    ]);
  });
});

// OP-N156 : bornes ajoutées le 19/11/2026 (IBAN à tirets, espaces insécables, IBAN collés, msisdn).
describe('redactSecrets : IBAN en texte libre, formes limites (OP-N156)', () => {
  const HYPHEN = 'FR76-3000-4028-3798-7654-3210-943';
  const NBSP = 'SN08\u00a0SN01\u00a00015\u00a02000\u00a00485\u00a00000\u00a03035';
  it.each([
    ['tirets', `refus pour ${HYPHEN} aujourd'hui`],
    ['tirets, fin de phrase', `iban inconnu ${HYPHEN}.`],
    ['espaces insécables', `erreur sur ${NBSP} (voir support)`],
    ['deux collés', `doublon ${IBAN}${IBAN} détecté`],
    ['deux collés, noms différents', `a ${IBAN}FR1420041010050500013M02606 b`],
  ])('aucun fragment ne reste : %s', (_n, text) => {
    const out = redactSecrets(text);
    expect(leaks(out)).toEqual([]);
    expect(out).not.toMatch(/FR76|3000|4028|3798|7654|3210|943\b|2606/);
    expect(out).toContain(REDACTED);
  });

  it('les UUID, dates, montants, hachés et références ne sont pas masqués', () => {
    for (const ok of [
      'ab12cdef-1b2e-4c5d-8e9f-0a1b2c3d4e5f',
      'id=ab12cdef-1b2e-4c5d-8e9f-0a1b2c3d4e5f ok',
      '2026-11-18T10:00:00+00:00',
      '2026-11-18T10:00:00+01:00',
      'montant +12500 XOF, solde -3000',
      'CL057 et CL058 : 2026-11-19',
      'ref 2026-11-19-0001',
    ]) {
      expect(redactSecrets(ok)).toBe(ok);
    }
  });
});

describe('redactSecrets : msisdn (OP-N156)', () => {
  const MSISDN = '+221771234567';
  const DIGITS = /771234567|77 123 45 67|77-123-45-67/;
  it.each([
    ['JSON msisdn', `{"msisdn":"${MSISDN}"}`],
    ['JSON payer_msisdn', `{"payer_msisdn":"${MSISDN}"}`],
    ['JSON payerMsisdn', `{"payerMsisdn":"${MSISDN}"}`],
    ['JSON phone', `{"phone":"${MSISDN}"}`],
    ['JSON phone_number', `{"phone_number":"${MSISDN}"}`],
    ['JSON mobile', `{"mobile":"${MSISDN}"}`],
    ['JSON imbriqué', `{"a":[{"payer_msisdn":"${MSISDN}"}]}`],
    ['formulaire', `payer_msisdn=${MSISDN}&x=1`],
    ['texte', `msisdn: ${MSISDN}`],
    ['libre', `Paiement refusé pour ${MSISDN} ce matin`],
    ['libre, espaces', 'Paiement refusé pour +221 77 123 45 67 ce matin'],
    ['libre, tirets', 'Paiement refusé pour +221-77-123-45-67.'],
    ['libre, insécables', 'Paiement refusé pour +221\u00a077\u00a0123\u00a045\u00a067 ok'],
    ['URL', `https://x.test/p?to=${MSISDN}&a=b`],
  ])('le numéro est masqué : %s', (_n, text) => {
    const out = redactSecrets(text);
    expect(out).not.toMatch(DIGITS);
    expect(out).not.toContain('221');
    expect(out).toContain(REDACTED);
  });

  it.each([
    ['JSON msisdn', '{"msisdn":"771234567"}'],
    ['JSON payerMsisdn nombre', '{"payerMsisdn":771234567}'],
    ['JSON phone', '{"phone":"0771234567"}'],
    ['formulaire payer_msisdn', 'payer_msisdn=771234567&x=1'],
    ['texte phone_number', 'phone_number: 0771234567'],
  ])('valeur sans + masquée par le nom du champ : %s', (_n, text) => {
    const out = redactSecrets(text);
    expect(out).not.toContain('771234567');
    expect(out).toContain(REDACTED);
  });

  it('conserve le reste du message', () => {
    expect(redactSecrets(`échec pour ${MSISDN} fin`)).toBe(`échec pour ${REDACTED} fin`);
  });

  it("n'altère ni montants, ni décalages horaires, ni nombres sans plus", () => {
    for (const ok of [
      'montant +12500 XOF',
      'total 771234567 XOF',
      '2026-11-18T10:00:00+0100',
      'tel absent, terminal mobile-1 prêt',
      'a3f1c2d4-1b2e-4c5d-8e9f-0a1b2c3d4e5f',
    ]) {
      expect(redactSecrets(ok)).toBe(ok);
    }
  });
});
