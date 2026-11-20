// Assertions App Attest (WP13, T051) : vérificateur seul, accès à la base remplacé par une copie en
// mémoire (les cas qui touchent la vraie fonction SQL sont dans test/integration/attestation).
// Chaque refus est précédé d'un cas valide construit par la même aide (contrôle positif). Le
// signeur de test est écrit d'après la procédure d'Apple, pas d'après le vérificateur ; il ne
// remplace PAS un vecteur réel d'Apple (limite R1, OP-N64 : exigé avant la mission 12).
import 'reflect-metadata';
import { decode, encode } from 'cbor2';
import { AttestationError } from '../../../src/attestation/attestation.port';
import { IosAppAttestAssertionVerifier } from '../../../src/attestation/ios-app-attest-assertion';
import { IosAppAttestVerifier } from '../../../src/attestation/ios-app-attest';
import { iosClientDataHash } from '../../../src/attestation/enrollment-challenge';
import type { TxClient } from '../../../src/db/tenant-tx';
import {
  appAssertion,
  appAttestObject,
  createIosTestPki,
  keyPair,
  sha256,
  spki,
  rawPoint,
  TEST_IOS_BUNDLE_ID,
  TEST_IOS_TEAM_ID,
  type AppAssertionOptions,
} from '../../support/attestation/ios';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const REQUEST = sha256(Buffer.from('requête liée', 'utf8'));

type KeyPair = Awaited<ReturnType<typeof keyPair>>;

interface FakeOptions {
  /** Compteur stocké. */
  counter?: number;
  /** Avance imposée (sinon : la règle de la base, `stocké < demandé`). */
  advance?: boolean | 'CL059' | 'crash';
  noRow?: boolean;
}

/** Faux accès : une ligne en mémoire ; `calls` garde les avances demandées. */
function fakeClient(key: KeyPair, publicKey: Buffer, options: FakeOptions = {}) {
  const state = { counter: options.counter ?? 0, calls: [] as number[] };
  const keyId = sha256(Buffer.from('keyId de test'));
  const client: TxClient = {
    query: (async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM device_app_attest_key'))
        return {
          rows: options.noRow
            ? []
            : [{ key_id: keyId, public_key: publicKey, counter: String(state.counter) }],
        };
      const asked = params[2] as number;
      state.calls.push(asked);
      if (options.advance === 'CL059') throw Object.assign(new Error('refusé'), { code: 'CL059' });
      if (options.advance === 'crash') throw new Error('base indisponible');
      const advanced = options.advance ?? state.counter < asked;
      if (advanced === true && options.advance === undefined) state.counter = asked;
      return { rows: [{ advanced }] };
    }) as never,
  };
  void key;
  return { client, state, keyId };
}

async function refusal(promise: Promise<unknown>, reason: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AttestationError);
  expect((error as AttestationError).reason).toMatch(reason);
}

describe('assertion iOS App Attest', () => {
  let keys: KeyPair;
  let otherKeys: KeyPair;
  let publicSpki: Buffer;
  const verifier = new IosAppAttestAssertionVerifier({
    teamId: TEST_IOS_TEAM_ID,
    bundleId: TEST_IOS_BUNDLE_ID,
  });

  beforeAll(async () => {
    keys = await keyPair();
    otherKeys = await keyPair();
    publicSpki = await spki(keys.publicKey);
  });

  const make = (options: Partial<AppAssertionOptions> = {}) =>
    appAssertion({
      privateKey: keys.privateKey,
      clientDataHash: REQUEST,
      counter: 1,
      ...options,
    });
  const run = async (
    options: Partial<AppAssertionOptions> = {},
    fake: FakeOptions = {},
    hash: Buffer = REQUEST,
  ) => {
    const { client, state } = fakeClient(keys, publicSpki, fake);
    const outcome = verifier.verify(
      { deviceId: DEVICE, assertion: await make(options), clientDataHash: hash },
      client,
    );
    return { outcome, state };
  };
  const refused = async (
    options: Partial<AppAssertionOptions>,
    reason: RegExp,
    fake: FakeOptions = {},
    hash: Buffer = REQUEST,
  ) => {
    // Contrôle positif : la même aide, sans le défaut, est acceptée.
    await expect((await run({}, fake)).outcome).resolves.toBeUndefined();
    const { outcome, state } = await run(options, fake, hash);
    await refusal(outcome, reason);
    return state;
  };

  it('assertion valide : acceptée, compteur avancé une fois', async () => {
    const { outcome, state } = await run({ counter: 7 });
    await expect(outcome).resolves.toBeUndefined();
    expect(state.calls).toEqual([7]);
    expect(state.counter).toBe(7);
  });

  it('compteur très grand (2^32 - 1) accepté', async () => {
    const { outcome } = await run({ counter: 4_294_967_295 });
    await expect(outcome).resolves.toBeUndefined();
  });

  it('signature d’une autre clé : refusée, compteur intact', async () => {
    const state = await refused({ privateKey: otherKeys.privateKey }, /signature invalide/);
    expect(state.counter).toBe(0);
  });

  it('clientDataHash d’une autre requête : refusé', async () => {
    const state = await refused({}, /signature invalide/, {}, sha256(Buffer.from('autre')));
    expect(state.counter).toBe(0);
  });

  it('rpIdHash d’une autre application : refusé, compteur intact', async () => {
    const state = await refused({ rpId: `${TEST_IOS_TEAM_ID}.org.autre.app` }, /rpIdHash/);
    expect(state.counter).toBe(0);
  });

  it('un octet de authenticatorData changé après signature : refusé', async () => {
    const good = await make({ counter: 1 });
    await expect(
      verifier.verify(
        { deviceId: DEVICE, assertion: good, clientDataHash: REQUEST },
        fakeClient(keys, publicSpki).client,
      ),
    ).resolves.toBeUndefined();
    const parts = decode(good, { preferMap: true }) as Map<string, Uint8Array>;
    const data = Buffer.from(parts.get('authenticatorData')!);
    data[36] = data[36]! ^ 0xff; // compteur 1 -> 254, signature inchangée
    parts.set('authenticatorData', new Uint8Array(data));
    parts.set('signature', new Uint8Array(parts.get('signature')!));
    const forged = Buffer.from(encode(parts));
    const { client, state } = fakeClient(keys, publicSpki);
    await refusal(
      verifier.verify({ deviceId: DEVICE, assertion: forged, clientDataHash: REQUEST }, client),
      /signature invalide/,
    );
    expect(state.calls).toEqual([]);
  });

  it('compteur égal, inférieur : refusés (rien n’avance) ; supérieur accepté', async () => {
    const equal = await run({ counter: 5 }, { counter: 5 });
    await refusal(equal.outcome, /compteur non croissant/);
    const lower = await run({ counter: 4 }, { counter: 5 });
    await refusal(lower.outcome, /compteur non croissant/);
    expect(equal.state.calls).toEqual([]);
    expect(lower.state.calls).toEqual([]);
    const higher = await run({ counter: 6 }, { counter: 5 });
    await expect(higher.outcome).resolves.toBeUndefined();
  });

  it('le contrôle du compteur se suffit : une avance permissive ne le contourne pas', async () => {
    const { outcome, state } = await run({ counter: 5 }, { counter: 5, advance: true });
    await refusal(outcome, /compteur non croissant/);
    expect(state.calls).toEqual([]);
  });

  it('le retour de l’avance est honoré : faux (rejeu concurrent) = refus', async () => {
    const { outcome, state } = await run({ counter: 9 }, { counter: 0, advance: false });
    await refusal(outcome, /compteur non avancé/);
    expect(state.calls).toEqual([9]);
  });

  it('CL059 (autre prestataire, révoqué) converti en refus ; autre erreur relancée', async () => {
    await refusal((await run({}, { advance: 'CL059' })).outcome, /appareil refusé/);
    const crash = (await run({}, { advance: 'crash' })).outcome;
    await expect(crash).rejects.toThrow('base indisponible');
    await expect(crash).rejects.not.toBeInstanceOf(AttestationError);
  });

  it('appareil sans clé App Attest (Android, ancien iOS) : refusé', async () => {
    await expect((await run()).outcome).resolves.toBeUndefined();
    const { outcome } = await run({}, { noRow: true });
    await refusal(outcome, /sans clé App Attest/);
  });

  describe('forme de l’objet', () => {
    const raw = (assertion: Buffer) => async () => {
      const { client } = fakeClient(keys, publicSpki);
      return verifier.verify({ deviceId: DEVICE, assertion, clientDataHash: REQUEST }, client);
    };

    it('CBOR illisible, vide, démesuré', async () => {
      await expect((await run()).outcome).resolves.toBeUndefined();
      await refusal(raw(Buffer.from('ff00ff', 'hex'))(), /CBOR/);
      await refusal(raw(Buffer.alloc(0))(), /taille/);
      await refusal(raw(Buffer.alloc(2048, 1))(), /taille/);
    });

    it('clé manquante ou en trop', async () => {
      await expect((await run()).outcome).resolves.toBeUndefined();
      await refusal(raw(await make({ omitKeys: ['signature'] }))(), /clés attendues/);
      await refusal(raw(await make({ omitKeys: ['authenticatorData'] }))(), /clés attendues/);
      await refusal(
        raw(await make({ extraKeys: [['fmt', 'apple-appattest']] }))(),
        /clés attendues/,
      );
    });

    it('authenticatorData ≠ 37 octets, drapeau AT présent', async () => {
      await expect((await run()).outcome).resolves.toBeUndefined();
      const rp = sha256(Buffer.from(`${TEST_IOS_TEAM_ID}.${TEST_IOS_BUNDLE_ID}`));
      await refusal(
        raw(await make({ rawAuthenticatorData: Buffer.concat([rp, Buffer.alloc(6)]) }))(),
        /longueur/,
      );
      await refusal(raw(await make({ rawAuthenticatorData: rp.subarray(0, 20) }))(), /longueur/);
      await refusal(raw(await make({ flags: 0x40 }))(), /drapeau/);
    });

    it('signature non DER ou tronquée', async () => {
      await expect((await run()).outcome).resolves.toBeUndefined();
      await refusal(raw(await make({ signatureOverride: Buffer.alloc(64, 1) }))(), /signature/);
      const good = await make();
      expect(good.length).toBeGreaterThan(0);
      await refusal(raw(await make({ signatureOverride: Buffer.alloc(0) }))(), /signature/);
    });
  });

  it('cohérence : enrôlement puis assertion par la même clé ; autre clé refusée', async () => {
    const pki = await createIosTestPki();
    const [signing, agreement] = await Promise.all([keyPair(), keyPair()]);
    const signingSpki = await spki(signing.publicKey);
    const agreementSpki = await spki(agreement.publicKey);
    const attested = await new IosAppAttestVerifier({
      roots: [pki.rootDer],
      teamId: TEST_IOS_TEAM_ID,
      bundleId: TEST_IOS_BUNDLE_ID,
      environment: 'production',
      production: false,
    }).verify({
      os: 'IOS',
      keyAttestationChain: [
        await appAttestObject({
          publicKey: keys.publicKey,
          clientDataHash: iosClientDataHash('ABCDEFGHJKMN', 'S-1', signingSpki, agreementSpki),
          pki,
        }),
      ],
      agreementAttestationChain: null,
      signingPublicKey: signingSpki,
      agreementPublicKey: agreementSpki,
      enrollmentCode: 'ABCDEFGHJKMN',
      serial: 'S-1',
    });
    const stored = attested.appAttestKey!;
    expect(stored.keyId.equals(sha256(await rawPoint(keys.publicKey)))).toBe(true);
    const { client } = fakeClient(keys, stored.publicKey);
    const ok = await make({ counter: 1 });
    await expect(
      verifier.verify({ deviceId: DEVICE, assertion: ok, clientDataHash: REQUEST }, client),
    ).resolves.toBeUndefined();
    const { client: other } = fakeClient(keys, stored.publicKey);
    const bad = await make({ counter: 1, privateKey: otherKeys.privateKey });
    await refusal(
      verifier.verify({ deviceId: DEVICE, assertion: bad, clientDataHash: REQUEST }, other),
      /signature invalide/,
    );
  });
});
