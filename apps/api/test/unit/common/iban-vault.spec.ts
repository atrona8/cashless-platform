import { randomBytes } from 'node:crypto';
import { IbanVault, IbanVaultError } from '../../../src/common/iban-vault';

const IBAN = 'SN08SN0100152000048500003035';
const OP_A = '11111111-1111-4111-8111-111111111111';
const OP_B = '22222222-2222-4222-8222-222222222222';
const K1 = randomBytes(32);
const K2 = randomBytes(32);

const vault = (): IbanVault => new IbanVault(new Map([['k1', K1]]), 'k1');
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IbanVaultError);
    return (e as IbanVaultError).code;
  }
  throw new Error('aucune erreur levée');
};
// Altère un octet de l'enveloppe à l'indice donné de iv‖chiffré‖tag.
const tamper = (env: string, index: number): string => {
  const [, , kid, b64] = env.split(':');
  const buf = Buffer.from(b64!, 'base64url');
  buf[index] = buf[index]! ^ 0x01;
  return `enc:v1:${kid}:${buf.toString('base64url')}`;
};

describe('IbanVault', () => {
  it('aller-retour', () => {
    const v = vault();
    const env = v.seal(IBAN, OP_A);
    expect(v.isSealed(env)).toBe(true);
    expect(env).not.toContain(IBAN);
    expect(v.open(env, OP_A)).toBe(IBAN);
  });

  it('format exact : préfixe, kid, longueur iv(12) + chiffré + tag(16)', () => {
    const env = vault().seal(IBAN, OP_A);
    expect(env.startsWith('enc:v1:k1:')).toBe(true);
    const packed = Buffer.from(env.split(':')[3]!, 'base64url');
    expect(packed.length).toBe(12 + Buffer.byteLength(IBAN) + 16);
  });

  it('IV aléatoire : deux seal du même IBAN diffèrent', () => {
    const v = vault();
    expect(v.seal(IBAN, OP_A)).not.toBe(v.seal(IBAN, OP_A));
  });

  it('refuse le prestataire d’un autre (AAD)', () => {
    const v = vault();
    expect(codeOf(() => v.open(v.seal(IBAN, OP_A), OP_B))).toBe('IBAN_VAULT_OPEN_FAILED');
  });

  it.each([
    ['IV', 0],
    ['chiffré', 12],
    ['tag', 12 + Buffer.byteLength(IBAN) + 3],
  ])('refuse une enveloppe altérée (%s)', (_n, index) => {
    const v = vault();
    expect(codeOf(() => v.open(tamper(v.seal(IBAN, OP_A), index), OP_A))).toBe(
      'IBAN_VAULT_OPEN_FAILED',
    );
  });

  it('refuse un kid inconnu', () => {
    const v = vault();
    const env = v.seal(IBAN, OP_A).replace('enc:v1:k1:', 'enc:v1:zz:');
    expect(codeOf(() => v.open(env, OP_A))).toBe('IBAN_VAULT_UNKNOWN_KID');
  });

  it.each([
    IBAN,
    '',
    'enc:v1:',
    'enc:v1:k1',
    'enc:v1:k1:',
    'enc:v1:k1:!!!',
    'enc:v1:k1:AAAA',
    'enc:v2:k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'ENC:v1:k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'enc:v1:k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'.slice(0, 20),
  ])('refuse un format invalide : %j', (bad) => {
    expect(codeOf(() => vault().open(bad, OP_A))).toMatch(/IBAN_VAULT_(BAD_FORMAT|OPEN_FAILED)/);
  });

  it('isSealed : enc:v1: exact seulement', () => {
    const v = vault();
    expect(v.isSealed('enc:v2:k1:x')).toBe(false);
    expect(v.isSealed('ENC:v1:k1:x')).toBe(false);
    expect(v.isSealed(IBAN)).toBe(false);
  });

  it('refuse de sceller une enveloppe (jamais de double chiffrement)', () => {
    const v = vault();
    expect(codeOf(() => v.seal(v.seal(IBAN, OP_A), OP_A))).toBe('IBAN_VAULT_ALREADY_SEALED');
  });

  it('rotation : ancien kid ouvert, nouvelle écriture au kid actif', () => {
    const old = new IbanVault(new Map([['k1', K1]]), 'k1').seal(IBAN, OP_A);
    const ring = new IbanVault(
      new Map([
        ['k1', K1],
        ['k2', K2],
      ]),
      'k2',
    );
    expect(ring.open(old, OP_A)).toBe(IBAN);
    expect(ring.seal(IBAN, OP_A).startsWith('enc:v1:k2:')).toBe(true);
    // Sans l'ancien kid dans l'anneau, l'ancienne enveloppe n'est plus lisible.
    expect(codeOf(() => new IbanVault(new Map([['k2', K2]]), 'k2').open(old, OP_A))).toBe(
      'IBAN_VAULT_UNKNOWN_KID',
    );
  });

  it('les messages d’erreur ne contiennent ni IBAN, ni enveloppe, ni clé', () => {
    const v = vault();
    const env = v.seal(IBAN, OP_A);
    const msgs: string[] = [];
    for (const fn of [
      () => v.open(env, OP_B),
      () => v.open(tamper(env, 14), OP_A),
      () => v.open(env.replace(':k1:', ':zz:'), OP_A),
      () => v.seal(env, OP_A),
      () => new IbanVault(new Map([['k1', K1]]), 'absent'),
    ]) {
      try {
        fn();
      } catch (e) {
        msgs.push(`${(e as Error).message}|${(e as Error).stack ?? ''}`.split('\n    at')[0]!);
      }
    }
    expect(msgs).toHaveLength(5);
    for (const m of msgs) {
      expect(m).not.toContain(IBAN);
      expect(m).not.toContain(env.split(':')[3]!);
      expect(m).not.toContain(K1.toString('base64'));
      expect(m).not.toContain(K1.toString('hex'));
    }
    expect(JSON.stringify(v)).not.toContain(K1.toString('base64'));
    expect(String(v)).toBe('IbanVault');
  });

  it('refuse un anneau invalide à la construction', () => {
    expect(codeOf(() => new IbanVault(new Map([['k1', randomBytes(16)]]), 'k1'))).toBe(
      'IBAN_VAULT_CONFIG',
    );
    expect(codeOf(() => new IbanVault(new Map([['k1', K1]]), 'k2'))).toBe('IBAN_VAULT_CONFIG');
    expect(codeOf(() => new IbanVault(new Map(), 'k1'))).toBe('IBAN_VAULT_CONFIG');
  });
});
