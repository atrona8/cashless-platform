// Jeton d'appareil (contracts/device-tokens.md, research R-07, plan IC-08) : claims, `cnf.jkt`, expiration ; refus de
// `alg: none`, HS256, autre `aud`, autre `typ`, autre clé ; faux signataire refusé en production.
import { generateKeyPairSync } from 'node:crypto';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from 'jose';
import { APP_CONFIG } from '../../src/config/config';
import {
  DEVICE_TOKEN_AUDIENCE,
  DeviceTokenError,
  DeviceTokenService,
} from '../../src/device-tokens/device-token.service';
import {
  DeviceTokensModule,
  createTokenSigner,
} from '../../src/device-tokens/device-tokens.module';
import { FakeTokenSigner } from '../../src/device-tokens/fake-token-signer';
import { FakeInProductionError } from '../../src/kms/production-guard';

const CONFIG = {
  deviceTokenIssuer: 'https://api.cashless.test',
  deviceTokenTtlSeconds: 900,
  clockToleranceSeconds: 120,
};

function p256Spki(): { spki: Buffer; jwk: { kty: string; crv: string; x: string; y: string } } {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
  return {
    spki: publicKey.export({ type: 'spki', format: 'der' }),
    jwk: { kty: kty!, crv: crv!, x: x!, y: y! },
  };
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('DeviceTokenService', () => {
  let signer: FakeTokenSigner;
  let service: DeviceTokenService;
  const terminal = p256Spki();
  const input = {
    deviceId: '0b6f2a54-3d1e-4c7a-9f3b-1a2b3c4d5e6f',
    operatorId: '7c1d9e20-5a4b-4f6c-8d2e-9a8b7c6d5e4f',
    serial: 'SN-0001',
    eventId: '3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b',
    signingSpki: terminal.spki,
    familyId: 'f1e2d3c4-b5a6-4978-8695-a4b3c2d1e0f9',
  };

  beforeAll(async () => {
    signer = await FakeTokenSigner.create();
    service = new DeviceTokenService(signer, CONFIG);
  });

  /** Jeton aux claims valides, en-tête et clé choisis par le test. */
  async function forge(
    header: Record<string, unknown>,
    key?: Parameters<SignJWT['sign']>[0],
    overrides: JWTPayload = {},
  ): Promise<string> {
    const { token } = await service.issue(input);
    const claims = { ...decodeJwt(token), ...overrides };
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: signer.kid, typ: 'device+jwt', ...header } as never)
      .sign(key ?? (await generateKeyPair('ES256')).privateKey);
  }

  it('émet les claims du contrat, lié à la clé du terminal', async () => {
    const issued = await service.issue(input);
    const header = decodeProtectedHeader(issued.token);
    expect(header).toEqual({ alg: 'ES256', kid: signer.kid, typ: 'device+jwt' });
    const claims = decodeJwt(issued.token);
    expect(claims).toMatchObject({
      iss: CONFIG.deviceTokenIssuer,
      aud: DEVICE_TOKEN_AUDIENCE,
      sub: input.deviceId,
      operator_id: input.operatorId,
      serial: input.serial,
      event_id: input.eventId,
      fid: input.familyId,
      jti: issued.jti,
    });
    expect(claims.exp! - claims.iat!).toBe(900);
    expect(issued.expiresIn).toBe(900);
    expect((claims.cnf as { jkt: string }).jkt).toBe(
      await calculateJwkThumbprint(terminal.jwk, 'sha256'),
    );
    // Aucun statut, rôle ni affectation de point de vente dans le jeton.
    expect(Object.keys(claims).sort()).toEqual(
      [
        'aud',
        'cnf',
        'event_id',
        'exp',
        'fid',
        'iat',
        'iss',
        'jti',
        'operator_id',
        'serial',
        'sub',
      ].sort(),
    );

    const verified = await service.verify(issued.token);
    expect(verified).toMatchObject({
      deviceId: input.deviceId,
      operatorIdClaim: input.operatorId,
      serialClaim: input.serial,
      eventIdClaim: input.eventId,
      familyId: input.familyId,
      jti: issued.jti,
      jkt: (claims.cnf as { jkt: string }).jkt,
    });
  });

  it('jti aléatoire, terminal sans affectation accepté (event_id null)', async () => {
    const a = await service.issue({ ...input, eventId: null });
    const b = await service.issue(input);
    expect(a.jti).not.toBe(b.jti);
    expect((await service.verify(a.token)).eventIdClaim).toBeNull();
  });

  it('refuse une clé de terminal qui n’est pas P-256', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    await expect(
      service.issue({ ...input, signingSpki: publicKey.export({ type: 'spki', format: 'der' }) }),
    ).rejects.toThrow(/P-256/);
  });

  it('expiration : accepté dans la tolérance d’horloge, refusé au-delà', async () => {
    const now = Date.now();
    const justExpired = await service.issue(input, new Date(now - (900 + 60) * 1000));
    await expect(service.verify(justExpired.token)).resolves.toBeDefined();
    const expired = await service.issue(input, new Date(now - (900 + 121 + 5) * 1000));
    await expect(service.verify(expired.token)).rejects.toThrow(DeviceTokenError);
  });

  it('refuse alg: none', async () => {
    const { token } = await service.issue(input);
    const [, payload] = token.split('.');
    const none = `${b64({ alg: 'none', kid: signer.kid, typ: 'device+jwt' })}.${payload}.`;
    await expect(service.verify(none)).rejects.toThrow(DeviceTokenError);
  });

  it('refuse HS256 signé avec la clé publique comme secret', async () => {
    const secret = Buffer.from(JSON.stringify(signer.publicJwk()));
    const token = await forge({ alg: 'HS256' }, secret);
    await expect(service.verify(token)).rejects.toThrow(DeviceTokenError);
    const xSecret = Buffer.from(signer.publicJwk().x!, 'base64url');
    await expect(service.verify(await forge({ alg: 'HS256' }, xSecret))).rejects.toThrow(
      DeviceTokenError,
    );
  });

  it('refuse un autre aud ou un autre iss, signés par la vraie clé', async () => {
    const { token } = await service.issue(input);
    const resign = (overrides: JWTPayload) => signer.sign({ ...decodeJwt(token), ...overrides });
    await expect(service.verify(await resign({ aud: 'cashless-api' }))).rejects.toThrow(
      DeviceTokenError,
    );
    await expect(service.verify(await resign({ iss: 'https://autre.test' }))).rejects.toThrow(
      DeviceTokenError,
    );
  });

  it('refuse un autre typ signé par la vraie clé', async () => {
    // Signataires du test qui partagent une clé et ne diffèrent que par l'en-tête `typ`.
    const pair = await generateKeyPair('ES256', { extractable: true });
    const { kty, crv, x, y } = await exportJWK(pair.publicKey);
    const jwk = { kty, crv, x, y, kid: 'k1', alg: 'ES256' };
    const make = (typ: string) =>
      new DeviceTokenService(
        {
          kid: 'k1',
          publicJwk: () => jwk,
          sign: (claims) =>
            new SignJWT(claims)
              .setProtectedHeader({ alg: 'ES256', kid: 'k1', typ })
              .sign(pair.privateKey),
        },
        CONFIG,
      );
    const good = make('device+jwt');
    await expect(good.verify((await good.issue(input)).token)).resolves.toBeDefined();
    await expect(good.verify((await make('JWT').issue(input)).token)).rejects.toThrow(
      DeviceTokenError,
    );
    await expect(good.verify((await make('at+jwt').issue(input)).token)).rejects.toThrow(
      DeviceTokenError,
    );
  });

  it('refuse un jeton signé par une autre clé, même avec le kid du signataire', async () => {
    await expect(service.verify(await forge({}))).rejects.toThrow(DeviceTokenError);
    const other = await FakeTokenSigner.create();
    const { token } = await new DeviceTokenService(other, CONFIG).issue(input);
    await expect(service.verify(token)).rejects.toThrow(DeviceTokenError);
  });

  it('refuse un jeton mal formé ou sans claim requis', async () => {
    await expect(service.verify('pas.un.jeton')).rejects.toThrow(DeviceTokenError);
    const { token } = await service.issue(input);
    const claims = decodeJwt(token);
    delete claims.fid;
    await expect(service.verify(await signer.sign(claims))).rejects.toThrow(DeviceTokenError);
    await expect(
      service.verify(await signer.sign({ ...decodeJwt(token), cnf: {} })),
    ).rejects.toThrow(DeviceTokenError);
  });

  it('la clé publique exposée ne porte aucune partie privée', () => {
    const jwk = signer.publicJwk();
    expect(Object.keys(jwk).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'x', 'y']);
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', kid: signer.kid });
  });
});

describe('fabrique du signataire', () => {
  it('un seul faux par processus : les deux processus HTTP vérifient avec la même clé', async () => {
    const a = await createTokenSigner({ production: false });
    const b = await createTokenSigner({ production: false });
    expect(a.isFake).toBe(true);
    expect(b.kid).toBe(a.kid);
  });

  it('refuse le faux en production', () => {
    expect(() => createTokenSigner({ production: true })).toThrow(FakeInProductionError);
  });

  it('un processus qui importe DeviceTokensModule ne démarre pas en production', async () => {
    @Module({
      providers: [{ provide: APP_CONFIG, useValue: { production: true, ...CONFIG } }],
      exports: [APP_CONFIG],
    })
    class ProductionConfig {}
    await expect(
      Test.createTestingModule({
        imports: [{ module: ProductionConfig, global: true }, DeviceTokensModule],
      }).compile(),
    ).rejects.toThrow(FakeInProductionError);
  });
});
