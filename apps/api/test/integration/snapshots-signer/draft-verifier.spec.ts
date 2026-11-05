// WP13, T056 : vérification pure d'un brouillon (sans base). Les empreintes de référence ont été calculées HORS du
// code testé (SHA-256 du texte JCS écrit à la main, python3 hashlib) ; elles ne dépendent ni de `canonicalize` ni de
// `contentSha256`.
import {
  contentSha256,
  verifyDraft,
  type ContentRow,
  type DraftRow,
} from '../../../src/snapshots-signer/draft-verifier';

const T1 = '11'.repeat(32);
const T2 = '22'.repeat(32);
const T3 = '33'.repeat(32);
const NOW = new Date('2026-10-30T12:00:00Z');
const OP = '00000000-0000-0000-0000-0000000000a1';
const LG = '00000000-0000-0000-0000-0000000000f1';

const entry = (token: string, over: Record<string, unknown> = {}) => ({
  batch_event_id: null,
  batch_status: 'ACTIVE',
  key_index: 1,
  last_counter: null,
  nfc_uid: '04440000000001',
  originality_sig_sha256: 'ab'.repeat(32),
  pwd_pack_sha256: null,
  spendable: 2500,
  status: 'ACTIVE',
  token_hash: token,
  wallet_status: 'ACTIVE',
  ...over,
});

const VECTORS = {
  empty: '67164dacb279eb59c2605c4439f2c84681572b5b8d77a254657e69d66bd536e1',
  oneEntryOneRemoved: 'd1ae1af8d934112e4583e59247d7dd99ec631e68234cbbe39b9cd94facfcb9bd',
  twoRemoved: '6dc5c8fd05bd87dca9b5c5cf3c8c3fb835ad0038c98ac41e191dd941fd8ab076',
};

function build(
  over: { header?: Record<string, unknown>; rows?: ContentRow[]; draft?: Partial<DraftRow> } = {},
) {
  const rows: ContentRow[] = over.rows ?? [
    { tokenHash: T1, entry: entry(T1), removed: false },
    { tokenHash: T3, entry: null, removed: true },
  ];
  const header = {
    format: 'CASHLESS-SNAPSHOT/v1',
    kind: 'FULL',
    operator_id: OP,
    ledger_id: LG,
    event_id: '00000000-0000-0000-0000-0000000000e1',
    currency: 'XOF',
    version: 1,
    base_version: null,
    generated_at: '2026-10-30T11:59:00Z',
    valid_until: '2026-10-30T12:14:00Z',
    entries: 1,
    removed: 1,
    content_sha256: VECTORS.oneEntryOneRemoved,
    authority_epoch: 1,
    key_id: 'k-1',
    ...over.header,
  };
  const draft: DraftRow = {
    id: 7n,
    operatorId: OP,
    ledgerId: LG,
    kind: 'FULL',
    baseVersion: null,
    version: 1n,
    header,
    ...over.draft,
  };
  return { draft, rows };
}
const run = (over?: Parameters<typeof build>[0]) => {
  const { draft, rows } = build(over);
  return verifyDraft(draft, rows, NOW);
};
const reason = (over?: Parameters<typeof build>[0]) => {
  const verdict = run(over);
  return verdict.ok ? 'OK' : verdict.reason;
};

describe('contentSha256 : vecteurs fixes calculés hors du code testé', () => {
  it('contenu vide : les deux clés restent présentes', () => {
    expect(contentSha256([], [])).toBe(VECTORS.empty);
  });
  it('une entrée (null gardé, clés triées) et un retiré', () => {
    expect(contentSha256([entry(T1)], [T3])).toBe(VECTORS.oneEntryOneRemoved);
  });
  it('retirés seuls, dans l’ordre donné', () => {
    expect(contentSha256([], [T2, T3])).toBe(VECTORS.twoRemoved);
  });
  it('JSON.stringify ne donnerait pas ce vecteur (ordre des clés non canonique)', () => {
    const unsorted = { ...entry(T1) } as Record<string, unknown>;
    const reordered = { token_hash: T1, ...unsorted };
    expect(JSON.stringify({ entries: [reordered], removed_token_hashes: [T3] })).not.toBe(
      JSON.stringify({ entries: [entry(T1)], removed_token_hashes: [T3] }),
    );
    expect(contentSha256([reordered], [T3])).toBe(VECTORS.oneEntryOneRemoved);
  });
});

describe('verifyDraft', () => {
  it('brouillon sain : accepté', () => {
    const verdict = run();
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.verified.keyId).toBe('k-1');
  });

  it('DELTA sain : base = version - 1', () => {
    expect(
      reason({
        header: { kind: 'DELTA', version: 4, base_version: 3 },
        draft: { kind: 'DELTA', version: 4n, baseVersion: 3n },
      }),
    ).toBe('OK');
  });

  it.each([
    'authority_epoch',
    'base_version',
    'content_sha256',
    'currency',
    'entries',
    'event_id',
    'format',
    'generated_at',
    'key_id',
    'kind',
    'ledger_id',
    'operator_id',
    'removed',
    'valid_until',
    'version',
  ])('champ %s retiré : refus nommant le champ', (field) => {
    const { draft, rows } = build();
    const header = { ...(draft.header as Record<string, unknown>) };
    delete header[field];
    const verdict = verifyDraft({ ...draft, header }, rows, NOW);
    expect(verdict).toEqual({ ok: false, reason: `HEADER_MISSING:${field}` });
  });

  it('champ en trop : refus', () => {
    expect(reason({ header: { extra: 1 } })).toBe('HEADER_EXTRA_FIELD');
  });

  it.each([
    [{ format: 'CASHLESS-SNAPSHOT/v2' }, 'HEADER_FORMAT'],
    [{ kind: 'PARTIAL' }, 'HEADER_KIND'],
    [{ kind: 'DELTA' }, 'HEADER_KIND_MISMATCH'],
    [{ operator_id: '00000000-0000-0000-0000-0000000000a2' }, 'HEADER_OPERATOR_MISMATCH'],
    [{ ledger_id: '00000000-0000-0000-0000-0000000000f2' }, 'HEADER_LEDGER_MISMATCH'],
    [{ version: 2 }, 'HEADER_VERSION_MISMATCH'],
    [{ base_version: 0 }, 'BASE_VERSION_FULL'],
    [{ entries: 2 }, 'COUNT_ENTRIES'],
    [{ removed: 0 }, 'COUNT_REMOVED'],
    [{ valid_until: '2026-10-30T11:59:00Z' }, 'VALIDITY_ORDER'],
    [{ valid_until: '2026-10-30T11:59:30Z' }, 'VALIDITY_EXPIRED'],
    [{ generated_at: 'hier' }, 'HEADER_TYPE:generated_at'],
    [{ content_sha256: '00'.repeat(32) }, 'CONTENT_SHA256'],
    [{ content_sha256: 'AB' }, 'HEADER_TYPE:content_sha256'],
    [{ key_id: '' }, 'HEADER_TYPE:key_id'],
    [{ entries: '1' }, 'HEADER_TYPE:entries'],
  ])('en-tête %j : refus %s', (header, expected) => {
    expect(reason({ header })).toBe(expected);
  });

  it('DELTA : base différente de version - 1, ou base absente : refus', () => {
    const delta = { kind: 'DELTA', version: 4 };
    const draft = { kind: 'DELTA', version: 4n };
    expect(
      reason({ header: { ...delta, base_version: 2 }, draft: { ...draft, baseVersion: 2n } }),
    ).toBe('BASE_VERSION_DELTA');
    expect(
      reason({ header: { ...delta, base_version: null }, draft: { ...draft, baseVersion: null } }),
    ).toBe('BASE_VERSION_DELTA');
    // colonne du brouillon en désaccord avec l'en-tête
    expect(
      reason({ header: { ...delta, base_version: 3 }, draft: { ...draft, baseVersion: 2n } }),
    ).toBe('BASE_VERSION_DELTA');
  });

  it('contenu : doublon, ordre, onze clés exactes, jeton discordant, retiré avec entrée', () => {
    const live = (t: string, over?: Record<string, unknown>): ContentRow => ({
      tokenHash: t,
      entry: entry(t, over),
      removed: false,
    });
    const two = { header: { entries: 2, removed: 0 } };
    expect(reason({ ...two, rows: [live(T1), live(T1)] })).toBe('DUPLICATE_TOKEN');
    expect(reason({ ...two, rows: [live(T3), live(T1)] })).toBe('ORDER');
    expect(reason({ ...two, rows: [live(T1), live(T2, { token_hash: T3 })] })).toBe(
      'ENTRY_TOKEN_MISMATCH',
    );
    const withPwd = { ...entry(T1), pwd_pack_enc: 'AAAA' };
    expect(
      reason({
        rows: [
          { tokenHash: T1, entry: withPwd, removed: false },
          { tokenHash: T3, entry: null, removed: true },
        ],
      }),
    ).toBe('ENTRY_KEYS');
    const missing: Record<string, unknown> = entry(T1);
    delete missing.spendable;
    expect(
      reason({
        rows: [
          { tokenHash: T1, entry: missing, removed: false },
          { tokenHash: T3, entry: null, removed: true },
        ],
      }),
    ).toBe('ENTRY_KEYS');
    expect(reason({ rows: [live(T1), { tokenHash: T3, entry: entry(T3), removed: true }] })).toBe(
      'REMOVED_WITH_ENTRY',
    );
    expect(reason({ rows: [{ tokenHash: 'zz', entry: null, removed: true }, live(T1)] })).toBe(
      'TOKEN_HASH_SHAPE',
    );
    expect(
      reason({
        rows: [live(T1, { spendable: 2 ** 60 }), { tokenHash: T3, entry: null, removed: true }],
      }),
    ).toBe('ENTRY_NUMBER');
  });

  it('une valeur d’entrée changée : empreinte discordante, raison sans valeur', () => {
    const verdict = run({
      rows: [
        { tokenHash: T1, entry: entry(T1, { spendable: 9999 }), removed: false },
        { tokenHash: T3, entry: null, removed: true },
      ],
    });
    expect(verdict).toEqual({ ok: false, reason: 'CONTENT_SHA256' });
  });

  it('le brouillon vérifié est figé', () => {
    const verdict = run();
    expect(verdict.ok && Object.isFrozen(verdict.verified)).toBe(true);
  });
});
