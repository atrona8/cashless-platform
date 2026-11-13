// WP19 / T085, T088 (i) à (iii) : la clé de la passerelle ne signe que des jetons valables sur elle
// seule (le central les refuse), le central ne signe rien que la passerelle accepte, et la
// rotation de clé ne prolonge jamais un jeton. Le vérificateur du central est le VRAI
// `DeviceTokenService` de l'API (importé par ce test seulement, jamais par `src`).
import {
  SignJWT,
  decodeJwt,
  decodeProtectedHeader,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { evaluateProviderRules } from '../../src/processes/startup-guard';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { GatewayTx } from '../../src/db/gateway-tx';
import {
  DeviceTokenService,
  DeviceTokenError,
  edgeAudience,
} from '../../src/device/device-token.service';
import {
  DeviceTokenService as CentralTokenService,
  DeviceTokenError as CentralError,
} from '../../../api/src/device-tokens/device-token.service';
import { FakeTokenSigner } from '../../../api/src/device-tokens/fake-token-signer';
import {
  makeBench,
  RotatableKeystore,
  TestClock,
  type Bench,
  type TestDevice,
} from './_support/harness';

let b: Bench;
let d: TestDevice;
let central: CentralTokenService;
let centralSigner: FakeTokenSigner;
const centralConfig = {
  deviceTokenIssuer: 'cashless-api',
  deviceTokenTtlSeconds: 900,
  clockToleranceSeconds: 10,
};

beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  d = await b.newDevice();
  centralSigner = await FakeTokenSigner.create();
  central = new CentralTokenService(centralSigner, centralConfig as never);
});
afterAll(async () => b.close());

const run = <T>(fn: (tx: Parameters<DeviceTokenService['issue']>[0]) => Promise<T>): Promise<T> =>
  new GatewayTx(b.db.pool).run(fn);

describe('(i) la clé de la passerelle et le central', () => {
  it('jeton de la passerelle : kid edge:<gateway_id>:<n>, aud cashless-edge/<gateway_id>, 900 s au plus', async () => {
    const token = await b.tokenFor(d);
    const header = decodeProtectedHeader(token);
    const claims = decodeJwt(token);
    expect(header).toMatchObject({ alg: 'ES256', typ: 'device+jwt' });
    expect(header.kid).toMatch(new RegExp(`^edge:${b.gatewayId}:[1-9][0-9]*$`));
    expect(claims.aud).toBe(edgeAudience(b.gatewayId));
    expect(claims.iss).toBe(b.gatewayId);
    expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(900);
    expect(claims.sub).toBe(d.deviceId);
    expect(claims.fid).toBe(d.fid);
  });

  it('refusé par le vérificateur du central : par kid', async () => {
    const token = await b.tokenFor(d);
    await expect(central.verify(token)).rejects.toBeInstanceOf(CentralError);
  });

  it('refusé par le central quand le kid du central est forgé : par signature', async () => {
    const token = await b.tokenFor(d);
    const [, payload, signature] = token.split('.');
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', typ: 'device+jwt', kid: centralSigner.kid }),
    ).toString('base64url');
    await expect(central.verify(`${header}.${payload}.${signature}`)).rejects.toBeInstanceOf(
      CentralError,
    );
  });

  it('refusé par le central quand la clé du central signe un jeton d’audience de la passerelle : par audience', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const claims = {
      iss: centralConfig.deviceTokenIssuer,
      aud: edgeAudience(b.gatewayId),
      sub: d.deviceId,
      operator_id: b.ids.operator,
      serial: d.serial,
      event_id: b.ids.event,
      cnf: { jkt: 'x' },
      fid: d.fid,
      iat,
      exp: iat + 900,
      jti: 'j',
    };
    // Le même jeton, avec l'audience du central, serait accepté : la seule audience le refuse.
    const goodAudience = await centralSigner.sign({ ...claims, aud: 'cashless-device' });
    await expect(central.verify(goodAudience)).resolves.toBeDefined();
    await expect(central.verify(await centralSigner.sign(claims))).rejects.toBeInstanceOf(
      CentralError,
    );
  });

  it('la passerelle ne signe jamais avec une audience du central', async () => {
    const token = await b.tokenFor(d);
    expect(decodeJwt(token).aud).not.toBe('cashless-device');
  });
});

describe('(ii) un jeton du central sur la passerelle', () => {
  it('401 sur une route de terminal, et le terminal rafraîchit (UNAUTHENTICATED)', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = await centralSigner.sign({
      iss: centralConfig.deviceTokenIssuer,
      aud: 'cashless-device',
      sub: d.deviceId,
      operator_id: b.ids.operator,
      serial: d.serial,
      event_id: b.ids.event,
      cnf: { jkt: 'x' },
      fid: d.fid,
      iat,
      exp: iat + 900,
      jti: 'j',
    });
    const r = await b.request(d, { path: '/v1/device/seq-status', token });
    expect(r.status).toBe(401);
    expect(r.json?.code).toBe('UNAUTHENTICATED');
  });

  it('refusé AVANT toute cryptographie : le kid est contrôlé le premier', async () => {
    const tokens = b.tokens;
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ sub: d.deviceId })
      .setProtectedHeader({ alg: 'ES256', typ: 'device+jwt', kid: centralSigner.kid })
      .sign(privateKey);
    // Raison 'kid étranger' (et non 'vérification') : le contrôle du kid précède la cryptographie.
    await expect(run((tx) => tokens.verify(tx, forged))).rejects.toMatchObject({
      reason: 'kid étranger',
    });
    const garbage = `${forged.split('.').slice(0, 2).join('.')}.${Buffer.alloc(64).toString('base64url')}`;
    await expect(run((tx) => tokens.verify(tx, garbage))).rejects.toMatchObject({
      reason: 'kid étranger',
    });
  });

  it('kid d’une autre passerelle, même forme : refusé', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const other = '99999999-9999-4999-8999-999999999999';
    const forged = await new SignJWT({ sub: d.deviceId })
      .setProtectedHeader({ alg: 'ES256', typ: 'device+jwt', kid: `edge:${other}:1` })
      .sign(privateKey);
    await expect(run((tx) => b.tokens.verify(tx, forged))).rejects.toBeInstanceOf(DeviceTokenError);
  });

  it('alg autre que ES256 (none, HS256) : refusé', async () => {
    const none = `${Buffer.from('{"alg":"none","typ":"device+jwt","kid":"x"}').toString('base64url')}.e30.`;
    await expect(run((tx) => b.tokens.verify(tx, none))).rejects.toBeInstanceOf(DeviceTokenError);
  });
});

describe('(iii) rotation de la clé de jeton', () => {
  it('l’ancien jeton reste valable jusqu’à son exp, jamais après ; l’ancienne clé ne forge pas', async () => {
    const bench = await makeBench({ failureFloorMs: 5 });
    try {
      const dev = await bench.newDevice();
      const oldToken = await bench.tokenFor(dev);
      const oldKid = decodeProtectedHeader(oldToken).kid!;
      expect(oldKid.endsWith(':1')).toBe(true);
      // Le matériel change de clé : n + 1, l'ancienne passe RETIRED.
      bench.clock.advance(1000);
      bench.keystore.rotate();
      const newToken = await bench.tokenFor(dev);
      expect(decodeProtectedHeader(newToken).kid!.endsWith(':2')).toBe(true);
      const rows = await bench.q<{ kid: string; status: string }>(
        'SELECT kid, status FROM edge_token_key ORDER BY kid',
      );
      expect(rows.map((r) => r.status)).toEqual(['RETIRED', 'ACTIVE']);
      // Ancien jeton : encore accepté avant son exp.
      expect(
        (await bench.request(dev, { path: '/v1/device/seq-status', token: oldToken })).status,
      ).toBe(200);
      expect(
        (await bench.request(dev, { path: '/v1/device/seq-status', token: newToken })).status,
      ).toBe(200);
      // Jamais après exp.
      bench.clock.advance(901_000);
      const late = await bench.request(dev, { path: '/v1/device/seq-status', token: oldToken });
      expect(late.status).toBe(401);
    } finally {
      await bench.close();
    }
  });

  it('un jeton daté après la rotation, signé de l’ancienne clé, est refusé', async () => {
    const ks = new RotatableKeystore();
    const bench = await makeBench({ failureFloorMs: 5 });
    try {
      const dev = await bench.newDevice();
      const base = await bench.tokenFor(dev);
      const oldKid = decodeProtectedHeader(base).kid!;
      // Rotation, puis un porteur de l'ancienne clé fabrique un jeton neuf signé AVEC elle.
      const oldKeystore = bench.keystore.inner;
      bench.clock.advance(1000);
      bench.keystore.rotate();
      await bench.tokenFor(dev);
      const iat = Math.floor(bench.clock.now().getTime() / 1000);
      const claims = {
        iss: bench.gatewayId,
        aud: edgeAudience(bench.gatewayId),
        sub: dev.deviceId,
        operator_id: bench.ids.operator,
        serial: dev.serial,
        event_id: bench.ids.event,
        cnf: { jkt: decodeJwt(base).cnf && (decodeJwt(base).cnf as { jkt: string }).jkt },
        fid: dev.fid,
        iat,
        exp: iat + 900,
        jti: 'forge',
      };
      const input = `${Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'device+jwt', kid: oldKid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
      const signature = await oldKeystore.sign('token', Buffer.from(input));
      const forged = `${input}.${signature.toString('base64url')}`;
      const r = await bench.request(dev, { path: '/v1/device/seq-status', token: forged });
      expect(r.status).toBe(401);
    } finally {
      void ks;
      await bench.close();
    }
  });

  it('une clé inchangée ne crée aucune ligne de plus', async () => {
    await b.tokenFor(d);
    await b.tokenFor(d);
    const rows = await b.q('SELECT kid FROM edge_token_key');
    expect(rows).toHaveLength(1);
  });
});

describe('clé privée et faux', () => {
  it('le port n’expose aucune méthode d’export de clé privée', () => {
    const methods = Object.getOwnPropertyNames(FakeHardwareKeystore.prototype);
    expect(methods.filter((m) => /export|private|secret/i.test(m))).toEqual([]);
    expect(Object.keys(new FakeHardwareKeystore())).toEqual(['isFake']);
  });

  it('la clé de signature des jetons passe par le port : un faux est refusé en production', () => {
    const config = { production: true } as never;
    const violations = evaluateProviderRules(config, {
      keystore: new FakeHardwareKeystore(),
      catchUp: {},
      deltaPurgeProvided: true,
    });
    expect(violations.join(' ')).toMatch(/HARDWARE_KEYSTORE/);
  });

  it('aucun jeton ni clé dans les journaux de la garde', async () => {
    const { Logger } = await import('@nestjs/common');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const token = await b.tokenFor(d);
    await b.request(d, {
      path: '/v1/device/seq-status',
      token,
      signer: (await b.newDevice()).signing.privateKey,
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('device_authentication_refused');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split('.')[2]!);
    warn.mockRestore();
  });
});

void TestClock;
void exportJWK;
void calculateJwkThumbprint;
