// Empreinte d'idempotence du poste de personnalisation (relecture WP13, OP-N54, ADR-99 ; ADR-116) :
// HMAC sous `IDEMPOTENCY_HMAC_KEY`, liée à la personne ; jamais le SHA-256 sans clé des champs de la
// puce, qui laissait retrouver l'UID par essais depuis `api_idempotency.request_hash`.
import { createHash, createHmac } from 'node:crypto';
import {
  personalizationHash,
  type PersonalizationInput,
} from '../../../src/media/personalization/personalization.dto';

const KEY_A = Buffer.alloc(32, 0xa5);
const KEY_B = Buffer.alloc(32, 0x5a);
const PERSON = '7d1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f';
const INPUT: PersonalizationInput = {
  batchId: '0b5f4c1e-8f1b-4d55-9a3c-1f2e3d4c5b6a',
  tokenHash: Buffer.alloc(32, 0x11),
  uid: Buffer.from('04a1b2c3d4e5f6', 'hex'),
  signatureSha256: Buffer.alloc(32, 0x22),
  signatureOk: true,
  stationPublicKey: Buffer.alloc(65, 0x04),
};
const FIELDS = [Buffer.from(INPUT.batchId), INPUT.tokenHash, INPUT.uid, INPUT.signatureSha256];

describe('personalizationHash (OP-N54, ADR-116)', () => {
  it('HMAC-SHA256 sous la clé, préfixe de domaine et personne ; jamais le SHA-256 sans clé', () => {
    const hash = personalizationHash(INPUT, PERSON, KEY_A);
    const keyed = createHmac('sha256', KEY_A)
      .update(Buffer.from('CASHLESS/IDEMPOTENCY/PERSO/v1', 'ascii'))
      .update(PERSON, 'utf8');
    for (const field of FIELDS) keyed.update(field);
    expect(hash).toBe(keyed.digest('hex'));
    const unkeyed = createHash('sha256');
    for (const field of FIELDS) unkeyed.update(field);
    expect(hash).not.toBe(unkeyed.digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('autre clé, autre personne, autre puce : autre empreinte ; la clé du poste n’y entre pas', () => {
    const hash = personalizationHash(INPUT, PERSON, KEY_A);
    expect(personalizationHash(INPUT, PERSON, KEY_B)).not.toBe(hash);
    expect(personalizationHash(INPUT, '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b', KEY_A)).not.toBe(
      hash,
    );
    expect(
      personalizationHash({ ...INPUT, uid: Buffer.from('04a1b2c3d4e5f7', 'hex') }, PERSON, KEY_A),
    ).not.toBe(hash);
    expect(
      personalizationHash({ ...INPUT, stationPublicKey: Buffer.alloc(65, 0x05) }, PERSON, KEY_A),
    ).toBe(hash);
  });

  it('refuse une clé de moins de 32 octets', () => {
    expect(() => personalizationHash(INPUT, PERSON, Buffer.alloc(16))).toThrow(/32 octets/);
  });
});
