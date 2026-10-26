// Corps et réponses des vendeurs (mission 5b, lot WP09, T043 ; FR-002, NFR-002) : formats du PIN
// refusés sans écho, nom du vendeur borné, réponses en liste blanche.
import { ProblemException } from '../../../src/errors/problem';
import {
  parseVendorCreate,
  parseVendorPinChange,
  parseVendorSessionOpen,
  parseVendorStatusChange,
  terminalVendorDto,
  vendorDto,
  vendorSessionDto,
} from '../../../src/vendors/vendors.dto';
import { contractViolations } from '../../support/contract-schema';

const VENDOR = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const SECRET_KEYS = ['pin', 'pin_hash', 'failed_attempts', 'locked_at'];

/** Refus `422 VALIDATION_FAILED` dont le corps ne cite pas `echo`. */
function expectSilentRefusal(run: () => unknown, echo: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProblemException);
  const problem = caught as ProblemException;
  expect([problem.code, problem.status]).toEqual(['VALIDATION_FAILED', 422]);
  const text = JSON.stringify({
    detail: problem.detail,
    extensions: problem.extensions,
    message: problem.message,
  });
  if (echo !== '') expect(text).not.toContain(echo);
}

describe('PIN : exactement 6 chiffres, refus sans écho', () => {
  const badPins: Array<[string, unknown, string]> = [
    ['5 chiffres', '12345', '12345'],
    ['7 chiffres', '1234567', '1234567'],
    ['lettres', '12a456', '12a456'],
    ['espaces', ' 123456', '123456'],
    ['espace interne', '123 456', '123 456'],
    ['nombre JSON', 123456, '123456'],
    ['absent', undefined, ''],
    ['chiffres arabes-indiens', '١٢٣٤٥٦', '١٢٣٤٥٦'],
  ];
  it.each(badPins)('createVendor : %s → 422 sans écho', (_name, pin, echo) => {
    expectSilentRefusal(() => parseVendorCreate({ display_name: 'Awa', pin }), echo);
  });
  it.each(badPins)('setVendorPin : %s → 422 sans écho', (_name, pin, echo) => {
    expectSilentRefusal(() => parseVendorPinChange({ pin }), echo);
  });
  it.each(badPins)('openVendorSession : %s → 422 sans écho', (_name, pin, echo) => {
    expectSilentRefusal(() => parseVendorSessionOpen({ vendor_id: VENDOR, pin }), echo);
  });
  it('champ inconnu : refusé sans citer son nom (qui pourrait être la valeur)', () => {
    expectSilentRefusal(() => parseVendorPinChange({ pin: '123456', '654321': true }), '654321');
  });
  it('PIN valide accepté tel quel', () => {
    expect(parseVendorCreate({ display_name: ' Awa (bar) ', pin: '012345' })).toEqual({
      displayName: 'Awa (bar)',
      pin: '012345',
    });
    expect(parseVendorPinChange({ pin: '000000' })).toBe('000000');
    expect(parseVendorSessionOpen({ vendor_id: VENDOR.toUpperCase(), pin: '999999' })).toEqual({
      vendorId: VENDOR,
      pin: '999999',
    });
  });
});

describe('nom du vendeur et statut', () => {
  it.each([
    ['vide', ''],
    ['blancs', '   '],
    ['81 caractères', 'x'.repeat(81)],
    ['nombre', 12],
  ])('display_name %s → 422', (_name, value) => {
    expectSilentRefusal(() => parseVendorCreate({ display_name: value, pin: '123456' }), '');
  });
  it('display_name de 80 caractères accepté', () => {
    expect(
      parseVendorCreate({ display_name: 'x'.repeat(80), pin: '123456' }).displayName,
    ).toHaveLength(80);
  });
  it('statut : ACTIVE ou DISABLED seulement', () => {
    expect(parseVendorStatusChange({ status: 'DISABLED' })).toBe('DISABLED');
    expectSilentRefusal(() => parseVendorStatusChange({ status: 'LOCKED' }), '');
  });
  it('vendor_id non UUID → 422', () => {
    expectSilentRefusal(() => parseVendorSessionOpen({ vendor_id: 'x', pin: '123456' }), '');
  });
});

describe('réponses : liste blanche, conformes au contrat (NFR-002)', () => {
  // Ligne « polluée » : même si une requête rendait des colonnes secrètes, elles ne sortent pas.
  const polluted = {
    id: VENDOR,
    merchant_id: '0d1e2f3a-4b5c-4d6e-8f7a-8b9c0d1e2f3a',
    display_name: 'Awa',
    status: 'ACTIVE' as const,
    locked: false,
    pin: '123456',
    pin_hash: '$argon2id$v=19$m=19456,t=2,p=1$x$y',
    failed_attempts: 3,
    locked_at: null,
  };
  it('Vendor', () => {
    const dto = vendorDto(polluted);
    expect(contractViolations('Vendor', dto)).toEqual([]);
    for (const key of SECRET_KEYS) expect(dto).not.toHaveProperty(key);
    expect(JSON.stringify(dto)).not.toContain('$argon2id$');
  });
  it('TerminalVendor : identifiant et nom seulement', () => {
    expect(Object.keys(terminalVendorDto(polluted)).sort()).toEqual(['display_name', 'vendor_id']);
  });
  it('VendorSession', () => {
    const dto = vendorSessionDto({
      vendor_session_id: '2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b',
      vendor_id: VENDOR,
      vendor_display_name: 'Awa',
      expires_at: new Date('2026-12-12T07:10:00Z'),
    });
    expect(contractViolations('VendorSession', dto)).toEqual([]);
    for (const key of SECRET_KEYS) expect(dto).not.toHaveProperty(key);
  });
});
