// Un processus ne peut injecter que les ports de clés qu'il a demandés (NFR-005) ; effacement des secrets ; empreintes.
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig, type ExternalModes } from '../../../src/config/config';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KmsModule, KMS_PROVIDER, createKms } from '../../../src/kms/kms.module';
import { FakeInProductionError, UntriedInProductionError } from '../../../src/kms/production-guard';
import { startFakeServer } from '../../support/fake-servers/http-fake';
import {
  DATA_KEY_PORT,
  DECRYPT_PORT,
  KEY_ADMIN_PORT,
  MAC_PORT,
  SIGN_PORT,
  type KmsCapability,
} from '../../../src/kms/kms.ports';
import { withSecret, zeroize } from '../../../src/kms/zeroize';

/** Hors production : `NODE_ENV` est obligatoire (RISK-3). */
const LOCAL = { NODE_ENV: 'test' };

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(LOCAL) }],
  exports: [APP_CONFIG],
})
class ConfigOnly {}

const TOKENS = {
  mac: MAC_PORT,
  dataKey: DATA_KEY_PORT,
  decrypt: DECRYPT_PORT,
  keyAdmin: KEY_ADMIN_PORT,
  sign: SIGN_PORT,
} as const;

async function compile(capabilities: KmsCapability[], wanted: symbol) {
  @Injectable()
  class Consumer {
    constructor(@Inject(wanted) readonly port: unknown) {}
  }
  @Module({
    imports: [{ module: ConfigOnly, global: true }, KmsModule.forCapabilities(capabilities)],
    providers: [Consumer],
  })
  class Root {}
  const moduleRef = await Test.createTestingModule({ imports: [Root] }).compile();
  return moduleRef.get(Consumer);
}

describe('KmsModule.forCapabilities', () => {
  it.each([
    ['clés de bracelet', ['decrypt'], ['decrypt'], ['mac', 'dataKey', 'keyAdmin', 'sign']],
    ['personnalisation', ['mac', 'dataKey'], ['mac', 'dataKey'], ['decrypt', 'keyAdmin', 'sign']],
    ['contrôle quotidien', ['mac', 'decrypt'], ['mac', 'decrypt'], ['dataKey', 'keyAdmin', 'sign']],
    [
      'commande d’administration',
      ['keyAdmin'],
      ['keyAdmin'],
      ['mac', 'dataKey', 'decrypt', 'sign'],
    ],
    ['signature des snapshots', ['sign'], ['sign'], ['mac', 'dataKey', 'decrypt', 'keyAdmin']],
    ['API publique', [], [], ['mac', 'dataKey', 'decrypt', 'keyAdmin', 'sign']],
  ] as Array<[string, KmsCapability[], KmsCapability[], KmsCapability[]]>)(
    '%s : ports demandés injectables, les autres non',
    async (_name, capabilities, allowed, refused) => {
      for (const capability of allowed) {
        expect((await compile(capabilities, TOKENS[capability])).port).toBeInstanceOf(FakeKms);
      }
      for (const capability of refused) {
        await expect(compile(capabilities, TOKENS[capability])).rejects.toThrow(
          /dependencies|resolve/i,
        );
      }
    },
  );

  it('un seul fournisseur de clés par processus', async () => {
    @Module({
      imports: [
        { module: ConfigOnly, global: true },
        KmsModule.forCapabilities(['mac', 'decrypt']),
      ],
    })
    class Root {}
    const moduleRef = await Test.createTestingModule({ imports: [Root] }).compile();
    expect(moduleRef.get(MAC_PORT, { strict: false })).toBe(
      moduleRef.get(KMS_PROVIDER, { strict: false }),
    );
    expect(moduleRef.get(DECRYPT_PORT, { strict: false })).toBe(
      moduleRef.get(MAC_PORT, { strict: false }),
    );
  });
});

describe('effacement des secrets', () => {
  it('withSecret met le tampon à zéro, que le travail réussisse ou échoue', async () => {
    const ok = Buffer.from('283e8c48428c', 'hex');
    expect(await withSecret(ok, (secret) => secret.toString('hex'))).toBe('283e8c48428c');
    expect(ok.equals(Buffer.alloc(6))).toBe(true);
    const failed = Buffer.from('283e8c48428c', 'hex');
    await expect(withSecret(failed, () => Promise.reject(new Error('panne')))).rejects.toThrow(
      'panne',
    );
    expect(failed.equals(Buffer.alloc(6))).toBe(true);
  });

  it('zeroize accepte plusieurs tampons et les absents', () => {
    const a = Buffer.alloc(4, 1);
    const b = Buffer.alloc(4, 2);
    zeroize(a, null, undefined, b);
    expect([a.equals(Buffer.alloc(4)), b.equals(Buffer.alloc(4))]).toEqual([true, true]);
  });
});

describe('empreinte à clé des codes', () => {
  const hasher = new ClaimHasher(loadConfig(LOCAL));
  const other = new ClaimHasher(loadConfig({ ...LOCAL, CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32) }));

  it('la saisie est normalisée avant l’empreinte', () => {
    expect(hasher.claimCodeHash('k7qm-4xh9rt').equals(hasher.claimCodeHash('K7QM4XH9RT'))).toBe(
      true,
    );
    expect(hasher.claimCodeHash('K7QM4XH9RT')).toHaveLength(32);
    expect(hasher.claimCodeHash('K7QM4XH9RT').equals(hasher.claimCodeHash('K7QM4XH9RS'))).toBe(
      false,
    );
    expect(() => hasher.claimCodeHash('K7QM-4XH9R0')).toThrow();
  });

  it('dépend du secret : la base seule ne permet pas de retrouver un code', () => {
    expect(hasher.claimCodeHash('K7QM4XH9RT').equals(other.claimCodeHash('K7QM4XH9RT'))).toBe(
      false,
    );
  });

  it('le code de confirmation est lié à sa demande', () => {
    const claim = '50000000-0000-0000-0000-000000000001';
    expect(
      hasher.confirmationHash(claim, '123456').equals(hasher.confirmationHash(claim, '123456')),
    ).toBe(true);
    expect(
      hasher
        .confirmationHash(claim, '123456')
        .equals(hasher.confirmationHash('50000000-0000-0000-0000-000000000002', '123456')),
    ).toBe(false);
    expect(
      hasher.confirmationHash(claim, '123456').equals(hasher.confirmationHash(claim, '123457')),
    ).toBe(false);
    expect(() => hasher.confirmationHash(claim, '12345')).toThrow();
    expect(() => hasher.confirmationHash(claim, '12345a')).toThrow();
  });

  it('la référence d’une adresse ne contient pas l’adresse', () => {
    expect(hasher.addressRef('203.0.113.7')).toMatch(/^[0-9a-f]{32}$/);
    expect(hasher.addressRef('203.0.113.7')).toBe(hasher.addressRef('203.0.113.7'));
    expect(hasher.addressRef('203.0.113.7')).not.toBe(hasher.addressRef('203.0.113.8'));
  });
});

// ----- Mission 12b-1, WP10 : sélection `KMS_BACKEND` (décisions D3 et D6 du porteur, 26/11/2026) -----

const real = (env: NodeJS.ProcessEnv = {}) => loadConfig({ ...LOCAL, KMS_BACKEND: 'real', ...env });
const production = (kms: ExternalModes['kms']) => ({
  production: true,
  externalModes: { psp: 'real', pspSecrets: 'real', kms, sealCopy: 'real' } as ExternalModes,
});

describe('createKms : production × fake/real × listé/non listé', () => {
  it('production, fake posé : refus, même si `kms` est listé', () => {
    expect(() => createKms(production('fake'))).toThrow(FakeInProductionError);
    expect(() => createKms(production('fake'), ['mac'], ['kms'])).toThrow(FakeInProductionError);
  });

  it('production, réel non listé : le démarrage est refusé et le message nomme le service', () => {
    expect(() => createKms(production('real'), ['mac'])).toThrow(UntriedInProductionError);
    expect(() => createKms(production('real'), ['mac'])).toThrow(
      /Démarrage refusé : kms n'a pas été essayé contre le vrai service/,
    );
    // Réglage absent en production = réel : même refus.
    expect(() => createKms({ production: true })).toThrow(UntriedInProductionError);
    // Un autre service listé n'ouvre pas le service de clés.
    expect(() => createKms(production('real'), ['mac'], ['seal-copy', 'psp.secrets'])).toThrow(
      UntriedInProductionError,
    );
  });

  it('production, réel listé : le service réel, sans appel réseau, qui n’expose que les ports demandés', () => {
    const kms = createKms({ ...production('real'), ...pickAws() }, ['mac'], ['kms']);
    expect(kms).toMatchObject({ isFake: false, service: 'kms' });
    expect(Object.keys(kms).sort()).toEqual(['generateMac', 'isFake', 'service']);
    expect(Object.isFrozen(kms)).toBe(true);
  });

  it('hors production : fake par défaut, real permis', () => {
    expect(createKms(loadConfig(LOCAL))).toBeInstanceOf(FakeKms);
    const kms = createKms(real(), ['decrypt']);
    expect(kms).not.toBeInstanceOf(FakeKms);
    expect(Object.keys(kms).sort()).toEqual(['decrypt', 'isFake', 'service']);
  });
});

function pickAws() {
  return { aws: loadConfig(LOCAL).aws };
}

describe('KMS réel : le module démarre sans appeler KMS, l’usage échoue sans secret', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  it('serveur arrêté : le module compile ; la première opération échoue, sans la référence de clé', async () => {
    const server = await startFakeServer(() => undefined);
    const url = server.url;
    await server.close();
    Object.assign(process.env, {
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_MAX_ATTEMPTS: '1',
      AWS_EC2_METADATA_DISABLED: 'true',
    });
    const config = real({ AWS_ENDPOINT_URL: url });
    @Module({
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    })
    class RealConfig {}
    @Injectable()
    class Consumer {
      constructor(
        @Inject(MAC_PORT) readonly mac: { generateMac(ref: string, m: Uint8Array): unknown },
      ) {}
    }
    @Module({
      imports: [{ module: RealConfig, global: true }, KmsModule.forCapabilities(['mac'])],
      providers: [Consumer],
    })
    class Root {}
    const moduleRef = await Test.createTestingModule({ imports: [Root] }).compile();
    const { mac } = moduleRef.get(Consumer);
    const error: unknown = await Promise.resolve(
      mac.generateMac('arn:aws:kms:eu-west-3:1:key/cle-tres-secrete', Buffer.from('x')),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('cle-tres-secrete');
    // Un port non demandé n'existe pas dans le processus.
    expect(() => moduleRef.get(DECRYPT_PORT, { strict: false })).toThrow();
    await moduleRef.close();
  });
});
