// WP13, T056 : un brouillon altéré après le scellé n'est jamais signé : il est jeté, les suivants sont publiés.
import { Pool } from 'pg';
import { FakeKms } from '../../../src/kms/fake-kms';
import { OWNER_URL } from '../../support/db';
import {
  clearDrafts,
  draftStatus,
  entryOf,
  harness,
  newWorld,
  publishedVersions,
  seedDraft,
  seedOperators,
  sha,
  type Harness,
} from './support';

jest.setTimeout(120_000);

describe('snapshot-signer : brouillon altéré', () => {
  let owner: Pool;
  let h: Harness;
  const ref = `fake-kms:ecc:${'t'.repeat(8)}`;
  const kms = new FakeKms();

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL, max: 3 });
    await seedOperators(owner);
  });
  afterAll(async () => {
    await clearDrafts(owner);
    await owner.end();
  });
  beforeEach(async () => {
    await clearDrafts(owner);
    kms.resetCalls();
    h = harness(ref, kms);
  });
  afterEach(async () => {
    await h.close();
  });

  const reasonOf = async (id: bigint) =>
    (
      await owner.query('SELECT discard_reason FROM offline_snapshot_draft WHERE id = $1', [
        id.toString(),
      ])
    ).rows[0].discard_reason as string;

  /** Altère le contenu ou l'en-tête APRÈS le scellé, puis vérifie : jeté, rien publié, rien signé. */
  async function tampered(
    mutate: (draft: bigint, ledger: string) => Promise<void>,
    expected: string,
  ) {
    const world = await newWorld(owner, kms, ref);
    const id = await seedDraft(owner, world);
    await mutate(id, world.ledgerId);
    expect(await h.signer.runOnce()).toBe(1);
    expect(await draftStatus(owner, id)).toBe('DISCARDED');
    expect(await reasonOf(id)).toBe(expected);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
    expect(kms.calls.sign).toBe(0);
    expect(h.signer.alarm()).toBe(3);
  }

  it('entrée modifiée : CONTENT_SHA256', () =>
    tampered(async (id) => {
      await owner.query(
        `UPDATE offline_snapshot_entry SET entry = jsonb_set(entry, '{spendable}', '999999')
          WHERE draft_id = $1 AND token_hash = decode($2, 'hex')`,
        [id.toString(), sha('a')],
      );
    }, 'CONTENT_SHA256'));

  it('entrée retirée du contenu : COUNT_ENTRIES', () =>
    tampered(async (id) => {
      await owner.query(
        `DELETE FROM offline_snapshot_entry WHERE draft_id = $1 AND token_hash = decode($2, 'hex')`,
        [id.toString(), sha('a')],
      );
    }, 'COUNT_ENTRIES'));

  it('entrée ajoutée : COUNT_ENTRIES', () =>
    tampered(async (id, ledger) => {
      const token = sha('intrus');
      await owner.query(
        `INSERT INTO offline_snapshot_entry (ledger_id, version, token_hash, draft_id, entry, removed, operator_id)
         SELECT ledger_id, version, decode($2, 'hex'), id, $3::jsonb, false, operator_id
           FROM offline_snapshot_draft WHERE id = $1 AND ledger_id = $4`,
        [id.toString(), token, JSON.stringify(entryOf(token)), ledger],
      );
    }, 'COUNT_ENTRIES'));

  it('content_sha256 faux dans l’en-tête : CONTENT_SHA256', () =>
    tampered(async (id) => {
      await owner.query(
        `UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{content_sha256}', to_jsonb($2::text))
          WHERE id = $1`,
        [id.toString(), '00'.repeat(32)],
      );
    }, 'CONTENT_SHA256'));

  it('entries faux dans l’en-tête : COUNT_ENTRIES', () =>
    tampered(async (id) => {
      await owner.query(
        `UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{entries}', '5') WHERE id = $1`,
        [id.toString()],
      );
    }, 'COUNT_ENTRIES'));

  it('un brouillon faux est jeté et les suivants sont publiés', async () => {
    const bad = await newWorld(owner, kms, ref);
    const good = await newWorld(owner, kms, ref);
    const badId = await seedDraft(owner, bad);
    await seedDraft(owner, good);
    await owner.query(
      `UPDATE offline_snapshot_entry SET entry = jsonb_set(entry, '{status}', '"X"') WHERE draft_id = $1`,
      [badId.toString()],
    );
    expect(await h.signer.runOnce()).toBe(2);
    expect(await draftStatus(owner, badId)).toBe('DISCARDED');
    expect(await publishedVersions(owner, bad.ledgerId)).toHaveLength(0);
    expect(await publishedVersions(owner, good.ledgerId)).toHaveLength(1);
    expect(kms.calls.sign).toBe(1);
  });

  it('la raison inscrite ne cite aucune valeur d’entrée', async () => {
    const world = await newWorld(owner, kms, ref);
    const id = await seedDraft(owner, world);
    await owner.query(
      `UPDATE offline_snapshot_entry SET entry = jsonb_set(entry, '{spendable}', '987654') WHERE draft_id = $1`,
      [id.toString()],
    );
    await h.signer.runOnce();
    const reason = await reasonOf(id);
    expect(reason).not.toMatch(/987654|[0-9a-f]{16}/);
  });
});
