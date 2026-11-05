// Différences, blocage, cadence (tableau de vérité de decideNext), paquets, chiffreur provisoire
// (WP11).
import type { SnapshotEntry } from '../../../src/snapshots-content/content-hash';
import {
  createEntryEncryptor,
  RefusingEntryEncryptor,
} from '../../../src/snapshots-content/entry-encryptor';
import {
  buildSnapshot,
  diffRows,
  packets,
  type SourceRow,
  type StateHash,
} from '../../../src/snapshots-content/snapshot-builder';
import {
  decideNext,
  isBlocking,
  type CadenceState,
} from '../../../src/snapshots-content/snapshot-cadence';
import { FakeInProductionError } from '../../../src/kms/production-guard';

const entry = (token: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  token_hash: token,
  nfc_uid: null,
  key_index: 1,
  originality_sig_sha256: null,
  status: 'ACTIVE',
  batch_event_id: null,
  batch_status: 'ACTIVE',
  wallet_status: 'ACTIVE',
  spendable: 0,
  last_counter: null,
  pwd_pack_sha256: null,
  ...extra,
});
const row = (byte: number, extra: Partial<SourceRow> = {}): SourceRow => {
  const tokenHash = Buffer.alloc(32, byte);
  return {
    tokenHash,
    mediaId: '00000000-0000-0000-0000-0000000000' + byte.toString(16).padStart(2, '0'),
    entry: entry(tokenHash.toString('hex')),
    pwdPackEnc: null,
    pwdPackDekId: null,
    keyIndex: 1,
    nfcUid: null,
    removed: false,
    ...extra,
  };
};
const removedRow = (byte: number): SourceRow =>
  row(byte, { entry: null, removed: true, keyIndex: null });
const hex = (byte: number): string => Buffer.alloc(32, byte).toString('hex');
const sha = (byte: number): Buffer => Buffer.alloc(32, byte);

describe('diffRows', () => {
  it('garde le modifié, le nouveau, le ré-ajouté et le retiré ; écarte l’inchangé', () => {
    const rows = [row(1), row(2), row(3), row(4), removedRow(5), removedRow(6)];
    const shas = new Map([
      [hex(1), sha(1)],
      [hex(2), sha(9)],
      [hex(3), sha(3)],
      [hex(4), sha(4)],
    ]);
    const state = new Map<string, StateHash>([
      [hex(1), { entrySha256: sha(1), removed: false }],
      [hex(2), { entrySha256: sha(2), removed: false }],
      [hex(4), { entrySha256: sha(4), removed: true }],
      [hex(5), { entrySha256: sha(0), removed: false }],
      [hex(6), { entrySha256: sha(0), removed: true }],
    ]);
    const diff = diffRows(rows, shas, state);
    expect(diff.live.map((r) => r.tokenHash[0])).toEqual([2, 3, 4]);
    expect(diff.removed.map((r) => r.tokenHash[0])).toEqual([5]);
    expect(diff.unchanged).toBe(2);
  });
});

describe('isBlocking', () => {
  it.each([
    ['retrait', null, true],
    ['SUSPENDED', entry('a', { status: 'SUSPENDED' }), true],
    ['BLACKLISTED', entry('a', { status: 'BLACKLISTED' }), true],
    ['REPLACED', entry('a', { status: 'REPLACED' }), true],
    ['RETIRED', entry('a', { status: 'RETIRED' }), true],
    ['lot non ACTIVE', entry('a', { batch_status: 'RECALLED' }), true],
    ['portefeuille BLOCKED', entry('a', { wallet_status: 'BLOCKED' }), true],
    ['lot absent', entry('a', { batch_status: null }), false],
    ['solde seul', entry('a', { spendable: 5 }), false],
  ])('%s -> %s', (_name, e, expected) => {
    expect(isBlocking({ entry: e })).toBe(expected);
  });
});

describe('decideNext', () => {
  const T0 = new Date('2026-11-01T10:00:00.000Z');
  const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
  const opts = { fullEveryMs: 3_600_000, validityMs: 900_000 };
  const state = (extra: Partial<CadenceState> = {}): CadenceState => ({
    lastVersion: 4,
    lastGeneratedAt: T0,
    lastFullAt: T0,
    eligibleDevices: 3,
    eligibleIncreased: false,
    totalEntries: 100,
    ...extra,
  });
  const normal = { entry: entry('a', { spendable: 3 }) };
  const blocking = { entry: entry('a', { status: 'SUSPENDED' }) };

  it('première version : FULL', () => {
    expect(decideNext(state({ lastVersion: 0, lastGeneratedAt: null }), [], at(0), opts)).toBe(
      'FULL',
    );
  });
  it('blocage : DELTA immédiat', () => {
    expect(decideNext(state(), [blocking], at(1), opts)).toBe('DELTA');
    expect(decideNext(state(), [{ entry: null }], at(0), opts)).toBe('DELTA');
  });
  it('changement ordinaire : rien à 59 s, DELTA à 60 s et 61 s', () => {
    expect(decideNext(state(), [normal], at(59), opts)).toBe('none');
    expect(decideNext(state(), [normal], at(60), opts)).toBe('DELTA');
    expect(decideNext(state(), [normal], at(61), opts)).toBe('DELTA');
  });
  it('maintien à valid_until/3 (300 s), pas avant', () => {
    expect(decideNext(state(), [], at(299), opts)).toBe('none');
    expect(decideNext(state(), [], at(300), opts)).toBe('KEEPALIVE');
  });
  it('terminal devenu éligible : version tout de suite', () => {
    expect(decideNext(state({ eligibleIncreased: true }), [], at(1), opts)).toBe('KEEPALIVE');
  });
  it('aucun terminal éligible : rien', () => {
    expect(decideNext(state({ eligibleDevices: 0 }), [blocking], at(500), opts)).toBe('none');
  });
  it('FULL horaire, pas à 3 600 s pile', () => {
    expect(decideNext(state(), [], at(3600), opts)).not.toBe('FULL');
    expect(decideNext(state(), [], at(3601), opts)).toBe('FULL');
  });
  it('DELTA de plus de 20 % : FULL ; exactement 20 % : DELTA', () => {
    const many = (n: number) => Array.from({ length: n }, () => blocking);
    expect(decideNext(state(), many(21), at(1), opts)).toBe('FULL');
    expect(decideNext(state(), many(20), at(1), opts)).toBe('DELTA');
  });
  it('horloge reculée : âge 0, ni rafale de maintien ni erreur', () => {
    expect(decideNext(state(), [], at(-500), opts)).toBe('none');
    expect(decideNext(state(), [normal], at(-500), opts)).toBe('none');
    expect(decideNext(state({ totalEntries: 0 }), [blocking], at(-500), opts)).toBe('DELTA');
  });
});

describe('paquets et construction', () => {
  it('12 000 éléments = 3 paquets de 5 000, 5 000, 2 000 ; 5 001 = 2 paquets', () => {
    const items = Array.from({ length: 12_000 }, (_, i) => i);
    expect(packets(items).map((p) => p.length)).toEqual([5000, 5000, 2000]);
    expect(packets(items.slice(0, 5001)).map((p) => p.length)).toEqual([5000, 1]);
    expect(packets([])).toEqual([[]]);
  });

  it('en-tête : comptes réels, version et base, dates, empreinte', async () => {
    const built = await buildSnapshot({
      kind: 'DELTA',
      operatorId: 'o',
      ledgerId: 'l',
      expectedVersion: 5,
      baseVersion: 4,
      live: [row(2), row(1)],
      removed: [removedRow(3)],
      generatedAt: new Date('2026-11-01T10:00:00.000Z'),
      validityMs: 900_000,
      encryptor: new RefusingEntryEncryptor(),
    });
    expect(built.header).toMatchObject({
      kind: 'DELTA',
      version: 5,
      base_version: 4,
      entries: 2,
      removed: 1,
      generated_at: '2026-11-01T10:00:00.000Z',
      valid_until: '2026-11-01T10:15:00.000Z',
    });
    expect(built.header.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.items.map((i) => i.token_hash)).toEqual([hex(1), hex(2), hex(3)]);
    expect(built.items[2]).toMatchObject({ entry: null, removed: true, pwd_pack_enc: null });
  });

  it('chiffreur provisoire : ligne avec mot de passe refusée, rien construit', async () => {
    await expect(
      buildSnapshot({
        kind: 'FULL',
        operatorId: 'o',
        ledgerId: 'l',
        expectedVersion: 1,
        baseVersion: null,
        live: [row(1, { pwdPackEnc: Buffer.alloc(34, 1), pwdPackDekId: 'd' })],
        removed: [],
        generatedAt: new Date(),
        validityMs: 1000,
        encryptor: new RefusingEntryEncryptor(),
      }),
    ).rejects.toThrow(/WP12/);
  });

  it('chiffreur provisoire : refuse de démarrer en production (aucun faux en production)', () => {
    expect(() => createEntryEncryptor({ production: true })).toThrow(FakeInProductionError);
    expect(createEntryEncryptor({ production: false })).toBeInstanceOf(RefusingEntryEncryptor);
  });
});
