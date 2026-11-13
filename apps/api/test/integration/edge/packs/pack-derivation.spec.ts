// Dérivation de la clé de contenu des colis (décision 44, ADR-184) : échoue si la source change.
import { deriveContentKey } from '../../../../src/edge/packs/pack-sealing';
import { parsePackOperators } from '../../../../src/edge/packs/edge-packs.service';

const GW = '11111111-2222-3333-4444-555555555555';
const AGREEMENT = Buffer.alloc(65, 4);
const OLDEST = Buffer.alloc(32, 1);

describe('dérivation de la clé de contenu', () => {
  it('mêmes entrées, même clé, valeur attendue fixe', () => {
    const key = deriveContentKey({ dek: OLDEST, gatewayId: GW, agreementPublicKey: AGREEMENT });
    expect(key.toString('hex')).toBe(
      '91887e130ff765c2faab3784c3d03e31ccd507df0ba0c4d41f2e03de3516ea8d',
    );
    expect(
      deriveContentKey({ dek: OLDEST, gatewayId: GW, agreementPublicKey: AGREEMENT }).equals(key),
    ).toBe(true);
  });
  it('autre clé de données, passerelle ou clé d accord : autre clé', () => {
    const base = deriveContentKey({ dek: OLDEST, gatewayId: GW, agreementPublicKey: AGREEMENT });
    const other = (o: object) =>
      deriveContentKey({ dek: OLDEST, gatewayId: GW, agreementPublicKey: AGREEMENT, ...o });
    expect(other({ dek: Buffer.alloc(32, 2) }).equals(base)).toBe(false);
    expect(other({ gatewayId: GW.replace('1', '9') }).equals(base)).toBe(false);
    expect(other({ agreementPublicKey: Buffer.alloc(65, 5) }).equals(base)).toBe(false);
  });
});

describe('EDGE_PACK_OPERATORS', () => {
  it('liste lue, vide ou absente : aucun prestataire, UUID mal formé refusé', () => {
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(parsePackOperators(` ${a} , ${b.toUpperCase()} `)).toEqual([a, b]);
    expect(parsePackOperators('')).toEqual([]);
    expect(parsePackOperators(undefined)).toEqual([]);
    expect(() => parsePackOperators(`${a},pas-un-uuid`)).toThrow('mal formé');
  });
});
