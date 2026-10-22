// Défis d'enrôlement (WP10, T046, research R-08) : stables, sensibles à chaque octet, sans ambiguïté de concaténation.
import { createHash } from 'node:crypto';
import {
  androidAgreeChallenge,
  androidSignChallenge,
  iosClientDataHash,
} from '../../../src/attestation/enrollment-challenge';

const CODE = 'ABCDEFGHJKMN';
const SERIAL = 'TPE-0001';
const SIGNING = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d03010703420004aa', 'hex');
const AGREEMENT = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d03010703420004bb', 'hex');

function framed(domain: string, fields: Buffer[]): Buffer {
  const hash = createHash('sha256').update(domain, 'ascii');
  for (const value of fields) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    hash.update(length).update(value);
  }
  return hash.digest();
}

function flipped(value: Buffer, index: number): Buffer {
  const copy = Buffer.from(value);
  copy[index] = copy[index]! ^ 0x01;
  return copy;
}

describe('défis d’enrôlement', () => {
  it('suivent l’encodage de R-08 (domaine, champs préfixés par leur longueur)', () => {
    const code = Buffer.from(CODE);
    const serial = Buffer.from(SERIAL);
    expect(androidAgreeChallenge(CODE, SERIAL)).toEqual(
      framed('cashless-enroll-v1/agree', [code, serial]),
    );
    expect(androidSignChallenge(CODE, SERIAL, AGREEMENT)).toEqual(
      framed('cashless-enroll-v1/sign', [code, serial, AGREEMENT]),
    );
    expect(iosClientDataHash(CODE, SERIAL, SIGNING, AGREEMENT)).toEqual(
      framed('cashless-enroll-v1/ios', [code, serial, SIGNING, AGREEMENT]),
    );
  });

  it('sont stables : 32 octets, mêmes entrées → même défi', () => {
    expect(androidAgreeChallenge(CODE, SERIAL)).toHaveLength(32);
    expect(androidAgreeChallenge(CODE, SERIAL)).toEqual(androidAgreeChallenge(CODE, SERIAL));
    expect(androidSignChallenge(CODE, SERIAL, AGREEMENT)).toEqual(
      androidSignChallenge(CODE, SERIAL, AGREEMENT),
    );
    expect(iosClientDataHash(CODE, SERIAL, SIGNING, AGREEMENT)).toEqual(
      iosClientDataHash(CODE, SERIAL, SIGNING, AGREEMENT),
    );
  });

  it('un octet changé donne un autre défi (code, serial, chaque SPKI)', () => {
    const agree = androidAgreeChallenge(CODE, SERIAL);
    expect(androidAgreeChallenge('ABCDEFGHJKMP', SERIAL)).not.toEqual(agree);
    expect(androidAgreeChallenge(CODE, 'TPE-0002')).not.toEqual(agree);

    const sign = androidSignChallenge(CODE, SERIAL, AGREEMENT);
    expect(
      androidSignChallenge(CODE, SERIAL, flipped(AGREEMENT, AGREEMENT.length - 1)),
    ).not.toEqual(sign);
    expect(androidSignChallenge('BBCDEFGHJKMN', SERIAL, AGREEMENT)).not.toEqual(sign);

    const ios = iosClientDataHash(CODE, SERIAL, SIGNING, AGREEMENT);
    expect(iosClientDataHash(CODE, SERIAL, flipped(SIGNING, 0), AGREEMENT)).not.toEqual(ios);
    expect(iosClientDataHash(CODE, SERIAL, SIGNING, flipped(AGREEMENT, 10))).not.toEqual(ios);
  });

  it('séparent les domaines et les frontières de champs', () => {
    // Même code et même serial : défis d'accord, de signature et iOS tous distincts.
    expect(androidAgreeChallenge(CODE, SERIAL)).not.toEqual(
      androidSignChallenge(CODE, SERIAL, AGREEMENT),
    );
    // Déplacer un caractère d'un champ à l'autre change le défi (pas d'ambiguïté de concaténation).
    expect(androidAgreeChallenge('ABCDEFGHJKM', `N${SERIAL}`)).not.toEqual(
      androidAgreeChallenge(CODE, SERIAL),
    );
    // Les deux SPKI iOS échangés : autre défi.
    expect(iosClientDataHash(CODE, SERIAL, AGREEMENT, SIGNING)).not.toEqual(
      iosClientDataHash(CODE, SERIAL, SIGNING, AGREEMENT),
    );
  });

  it('refusent un champ vide', () => {
    expect(() => androidAgreeChallenge('', SERIAL)).toThrow(/code vide/);
    expect(() => androidSignChallenge(CODE, SERIAL, Buffer.alloc(0))).toThrow(/SPKI/);
  });
});
