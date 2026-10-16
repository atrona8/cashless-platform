// Un processus ne peut injecter que les ports de clés qu'il a demandés (NFR-005) ; effacement des secrets ; empreintes.
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig } from '../../../src/config/config';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KmsModule, KMS_PROVIDER } from '../../../src/kms/kms.module';
import {
  DATA_KEY_PORT,
  DECRYPT_PORT,
  KEY_ADMIN_PORT,
  MAC_PORT,
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
    ['clés de bracelet', ['decrypt'], ['decrypt'], ['mac', 'dataKey', 'keyAdmin']],
    ['personnalisation', ['mac', 'dataKey'], ['mac', 'dataKey'], ['decrypt', 'keyAdmin']],
    ['contrôle quotidien', ['mac', 'decrypt'], ['mac', 'decrypt'], ['dataKey', 'keyAdmin']],
    ['commande d’administration', ['keyAdmin'], ['keyAdmin'], ['mac', 'dataKey', 'decrypt']],
    ['API publique', [], [], ['mac', 'dataKey', 'decrypt', 'keyAdmin']],
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
