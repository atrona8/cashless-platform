import { inspect } from 'node:util';
import { FakePspSecretStore } from '../../../src/psp/fake/fake-psp-secret-store';
import { PspSecretError } from '../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../src/psp/secret';
import { UnavailablePspSecretStore } from '../../../src/psp/unavailable/unavailable-psp';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CANARI = 'CANARI-9f3a77c1';
const bind = (holder: string, ref: string) => ({
  configurationId: 'c',
  holderPartyId: holder,
  secretRef: ref,
});

async function codeOf(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as PspSecretError;
    return { code: e.code, message: e.message };
  }
  throw new Error('aurait dû échouer');
}

describe('FakePspSecretStore', () => {
  const store = new FakePspSecretStore();
  store.put(`psp/${A}/wave`, { adapter: CANARI, current: `${CANARI}-n` });

  it('lit un secret de son titulaire (casse du titulaire indifférente)', async () => {
    const got = await store.get(bind(A.toUpperCase(), `psp/${A}/wave`));
    expect(got.notification.current.reveal()).toBe(`${CANARI}-n`);
    expect(got.adapter?.reveal()).toBe(CANARI);
  });

  it('titulaire croisé : HOLDER_MISMATCH sans valeur ni titulaire attendu', async () => {
    const err = await codeOf(store.get(bind(B, `psp/${A}/wave`)));
    expect(err.code).toBe('HOLDER_MISMATCH');
    for (const forbidden of [CANARI, A, B, 'wave']) expect(err.message).not.toContain(forbidden);
  });

  it('forme invalide, nom commençant par un point, absent', async () => {
    for (const ref of [
      'wave',
      `psp/${A}`,
      `psp/${A}/`,
      `psp/${A}/.`,
      `psp/${A}/..`,
      `psp/${A}/.cache`,
      `psp/${A}/a/b`,
      `PSP/${A}/x`,
      `psp/not-a-uuid/x`,
    ])
      expect((await codeOf(store.get(bind(A, ref)))).code).toBe('REF_INVALID');
    expect((await codeOf(store.get(bind(A, `psp/${A}/absent`)))).code).toBe('NOT_FOUND');
  });

  it('précédent sans échéance refusé à put ; ref invalide refusée à put', () => {
    expect(() => store.put(`psp/${A}/x`, { current: 'c', previous: 'p' })).toThrow();
    expect(() => store.put(`psp/${A}/.x`, { current: 'c' })).toThrow(PspSecretError);
    expect(() =>
      store.put(`psp/${A}/x`, { current: 'c', previous: 'p', previousValidUntil: new Date() }),
    ).not.toThrow();
  });

  it('le faux coffre est marqué faux, le coffre indisponible non', async () => {
    expect(store.isFake).toBe(true);
    const unavailable = new UnavailablePspSecretStore();
    expect((unavailable as { isFake?: boolean }).isFake).toBeUndefined();
    expect((await codeOf(unavailable.get(bind(A, `psp/${A}/wave`)))).code).toBe('UNAVAILABLE');
  });

  it('canari : jamais affiché par String, JSON, inspect ni un message d’erreur', async () => {
    const got = await store.get(bind(A, `psp/${A}/wave`));
    const shown = [
      String(got.adapter),
      JSON.stringify(got),
      inspect(got, { depth: 10 }),
      `${got.notification.current}`,
      JSON.stringify({ secret: Secret.of(CANARI) }),
      inspect(Secret.of(CANARI)),
    ].join('|');
    expect(shown).not.toContain('CANARI');
    expect(shown).toContain('[secret]');
    const messages = [
      (await codeOf(store.get(bind(B, `psp/${A}/wave`)))).message,
      (await codeOf(store.get(bind(A, `psp/${A}/${CANARI}`)))).message,
      (await codeOf(store.get(bind(A, `${CANARI}`)))).message,
    ];
    for (const m of messages) expect(m).not.toContain('CANARI');
    expect(() => Secret.of('')).toThrow();
  });
});
