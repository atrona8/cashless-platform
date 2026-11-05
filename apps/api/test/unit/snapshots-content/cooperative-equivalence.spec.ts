// WP21 (NFR-005) : le calcul par tranches rend EXACTEMENT les mêmes empreintes et verdicts que le calcul d'un seul
// tenant, et rend la main à la boucle d'événements pendant qu'il tourne. Aucun format, aucune canonicalisation ni
// aucune signature ne change : seul l'ordonnancement.
import {
  contentSha256,
  contentSha256Cooperative,
  type SnapshotEntry,
} from '../../../src/snapshots-content/content-hash';
import { SLICE_ROWS } from '../../../src/processes/cooperative';
import {
  contentSha256 as signerSha256,
  verifyDraft,
  verifyDraftCooperative,
  type ContentRow,
  type DraftRow,
} from '../../../src/snapshots-signer/draft-verifier';

const hex = (n: number): string => n.toString(16).padStart(64, '0');
const entry = (n: number): SnapshotEntry => ({
  token_hash: hex(n),
  nfc_uid: n % 3 === 0 ? null : '04440000000001',
  key_index: 1,
  originality_sig_sha256: n % 2 === 0 ? 'ab'.repeat(32) : null,
  status: 'ACTIVE',
  batch_event_id: null,
  batch_status: 'ACTIVE',
  wallet_status: 'ACTIVE',
  spendable: n * 7 - 50,
  last_counter: n % 5 === 0 ? n : null,
  pwd_pack_sha256: null,
});

const SIZES = [0, 1, SLICE_ROWS - 1, SLICE_ROWS, SLICE_ROWS + 1, 2 * SLICE_ROWS + 3];

describe('empreinte de contenu par tranches (producteur)', () => {
  it.each(SIZES)(
    'identique à contentSha256 pour %i entrées (ordre inversé, retirés)',
    async (n) => {
      const entries = Array.from({ length: n }, (_, i) => entry(i + 1)).reverse();
      const removed = [hex(900_000), hex(900_001), hex(5)];
      expect(await contentSha256Cooperative(entries, removed)).toBe(
        contentSha256(entries, removed),
      );
    },
  );
  it('refuse toujours pwd_pack_enc', async () => {
    const bad = { ...entry(1), pwd_pack_enc: 'aa' } as unknown as SnapshotEntry;
    await expect(contentSha256Cooperative([bad], [])).rejects.toThrow(/pwd_pack_enc/);
  });
  it('rend la main à la boucle pendant le calcul', async () => {
    const entries = Array.from({ length: 20 * SLICE_ROWS }, (_, i) => entry(i + 1));
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    const done = contentSha256Cooperative(entries, []);
    await done;
    clearInterval(timer);
    // Sans tranches, aucune minuterie ne pourrait passer avant la fin du calcul.
    expect(ticks).toBeGreaterThanOrEqual(1);
  });
});

const OP = '00000000-0000-0000-0000-0000000000a1';
const LG = '00000000-0000-0000-0000-0000000000f1';
const NOW = new Date('2026-10-30T12:00:00Z');

function draftOf(rows: ContentRow[], hash?: string): DraftRow {
  const entries = rows.filter((r) => !r.removed).map((r) => r.entry);
  const removed = rows.filter((r) => r.removed).map((r) => r.tokenHash);
  return {
    id: 7n,
    operatorId: OP,
    ledgerId: LG,
    kind: 'FULL',
    baseVersion: null,
    version: 1n,
    header: {
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
      entries: entries.length,
      removed: removed.length,
      content_sha256: hash ?? signerSha256(entries, removed),
      authority_epoch: 1,
      key_id: 'k-1',
    },
  };
}
const rowsOf = (n: number): ContentRow[] => [
  ...Array.from({ length: n }, (_, i) => ({
    tokenHash: hex(i + 1),
    entry: entry(i + 1) as unknown,
    removed: false,
  })),
  { tokenHash: hex(n + 10), entry: null, removed: true },
];

describe('vérification de brouillon par tranches (signataire)', () => {
  it.each(SIZES)('même verdict que verifyDraft pour %i entrées', async (n) => {
    const rows = rowsOf(n);
    const draft = draftOf(rows);
    const a = verifyDraft(draft, rows, NOW);
    const b = await verifyDraftCooperative(draft, rows, NOW);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
  it.each([
    ['empreinte fausse', (r: ContentRow[]) => r, '0'.repeat(64), 'CONTENT_SHA256'],
    ['ordre rompu', (r: ContentRow[]) => [r[1]!, r[0]!, ...r.slice(2)], undefined, 'ORDER'],
    ['doublon', (r: ContentRow[]) => [r[0]!, r[0]!, ...r.slice(1)], undefined, 'DUPLICATE_TOKEN'],
    [
      'clé en trop',
      (r: ContentRow[]) => [
        { ...r[0]!, entry: { ...(r[0]!.entry as object), extra: 1 } },
        ...r.slice(1),
      ],
      undefined,
      'ENTRY_KEYS',
    ],
  ])('même rejet que verifyDraft : %s', async (_name, mutate, hash, code) => {
    const base = rowsOf(SLICE_ROWS + 5);
    const draft = draftOf(base, hash);
    const rows = mutate(base);
    const a = verifyDraft(draft, rows, NOW);
    const b = await verifyDraftCooperative(draft, rows, NOW);
    expect(a).toEqual({ ok: false, reason: code });
    expect(b).toEqual({ ok: false, reason: code });
  });
});
