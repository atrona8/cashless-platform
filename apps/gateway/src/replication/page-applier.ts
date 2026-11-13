// Application d'UNE page dans UNE transaction locale : soldes, bracelets, clé de colis, bloc
// `reference`, accusés par terminal, purge des deltas couverts, PUIS curseurs. Une page qui échoue
// ne laisse ni donnée ni curseur avancés (la transaction est annulée par l'appelant).
// Horizon (A18) : `last_replicated_posting_id` prend la valeur d'horizon déclarée par la page
// (`to_posting_id`), jamais un `posting.id` deviné des écritures reçues.
import type { TxClient } from '../db/gateway-tx';
import type { DeltaPurge } from './delta-purge';
import { ReplicationPageError, type PageMedia, type ReplicationPage } from './page-schema';
import { encodeBlob, purgeKeyMaterial, storeSealedKey } from './pwd-pack-key';
import { applyReference } from './reference-store';

export interface ApplyContext {
  now: Date;
  purge: DeltaPurge;
  /** Point d'observation (tests : panne injectée entre deux tables). */
  afterStep?: (step: string) => void | Promise<void>;
}
export interface ApplyOutcome {
  role: 'PRIMARY' | 'STANDBY';
  /** Le bloc `reference` portait la ligne de la passerelle. */
  roleServed: boolean;
  /** Dernière page de la passe : aucun des deux curseurs n'a de suite. */
  finalPage: boolean;
}

interface MetaRow {
  ledger_id: string;
  gateway_id: string;
  event_id: string;
  role: 'PRIMARY' | 'STANDBY';
}
interface CursorRow {
  last_replicated_posting_id: string;
  last_change_seq: string;
  last_edge_seq_applied: string;
}

export async function applyPage(
  tx: TxClient,
  page: ReplicationPage,
  ctx: ApplyContext,
): Promise<ApplyOutcome> {
  const step = async (name: string): Promise<void> => {
    await ctx.afterStep?.(name);
  };
  // Verrou : deux applications de pages ne se mêlent jamais.
  const cursor = (await tx.query<CursorRow>('SELECT * FROM edge_replication_cursor FOR UPDATE'))
    .rows[0] as CursorRow;
  const meta = (await tx.query<MetaRow>('SELECT * FROM edge_meta')).rows[0];
  if (!meta) throw new ReplicationPageError('passerelle non enrôlée', 'INVALID');

  // Cloisonnement (NFR-011) : rien d'un autre événement, grand livre ou passerelle.
  if (page.ledger_id !== meta.ledger_id.toLowerCase()) {
    throw new ReplicationPageError('page d’un autre grand livre', 'FOREIGN');
  }
  const ref = page.reference;
  if (ref.gateway && ref.gateway.gateway_id !== meta.gateway_id.toLowerCase()) {
    throw new ReplicationPageError('ligne d’une autre passerelle', 'FOREIGN');
  }
  if (ref.event && ref.event.event_id !== meta.event_id.toLowerCase()) {
    throw new ReplicationPageError('réglages d’un autre événement', 'FOREIGN');
  }
  const foreignBatch = (m: PageMedia): boolean =>
    m.batch_event_id !== null && m.batch_event_id !== meta.event_id.toLowerCase();
  if (page.media.some(foreignBatch) || ref.unassigned_media.some(foreignBatch)) {
    throw new ReplicationPageError('bracelet d’un autre événement', 'FOREIGN');
  }

  // Curseurs : jamais de trou, jamais de recul.
  const posting = BigInt(cursor.last_replicated_posting_id);
  const change = Number(cursor.last_change_seq);
  const seqApplied = Number(cursor.last_edge_seq_applied);
  if (BigInt(page.from_posting_id) > posting) {
    throw new ReplicationPageError('page avec un trou de postings', 'CURSOR');
  }
  if (BigInt(page.to_posting_id) < posting || page.to_posting_id < page.from_posting_id) {
    throw new ReplicationPageError('horizon de postings en recul', 'CURSOR');
  }
  if (ref.from_change_seq > change || ref.to_change_seq < change) {
    throw new ReplicationPageError('page de référence avec trou ou en recul', 'CURSOR');
  }
  if (page.edge_seq_applied < seqApplied) {
    throw new ReplicationPageError('edge_seq_applied en recul', 'CURSOR');
  }

  const role = ref.gateway?.role ?? meta.role;
  const primary = role === 'PRIMARY';
  if (role !== meta.role) await tx.query('UPDATE edge_meta SET role = $1', [role]);
  // M2 : plus PRIMARY, la passerelle ne garde ni clé scellée, ni colis, ni empreintes de jetons.
  if (!primary) await purgeKeyMaterial(tx);
  await step('role');

  for (const w of page.wallets) {
    await tx.query(
      `INSERT INTO edge_wallet (wallet_id, status, central_paid, central_promo, applied_edge_seq,
                                last_posting_id)
       VALUES ($1, COALESCE((SELECT status FROM edge_wallet_state WHERE wallet_id = $1), $2),
               $3, $4, $5, $6)
       ON CONFLICT (wallet_id) DO UPDATE SET status = EXCLUDED.status,
         central_paid = EXCLUDED.central_paid, central_promo = EXCLUDED.central_promo,
         applied_edge_seq = EXCLUDED.applied_edge_seq, last_posting_id = EXCLUDED.last_posting_id`,
      [
        w.wallet_id,
        w.status,
        w.paid.toString(),
        w.promo.toString(),
        page.edge_seq_applied,
        page.to_posting_id,
      ],
    );
    // Plafonds : absent = inconnu (le palier le plus strict, la passerelle refuse).
    const limits: Record<string, boolean> = { topup_month_known: w.topup_month_paid !== null };
    // M6 : absent = faux (le plus strict), jamais un `true` ancien conservé.
    limits.kyc_verified = w.kyc_verified === true;
    await tx.query(
      `INSERT INTO edge_wallet_limit (wallet_id, topup_month_paid, limits) VALUES ($1, $2, $3)
       ON CONFLICT (wallet_id) DO UPDATE SET topup_month_paid = EXCLUDED.topup_month_paid,
         limits = edge_wallet_limit.limits || EXCLUDED.limits`,
      [w.wallet_id, (w.topup_month_paid ?? 0n).toString(), JSON.stringify(limits)],
    );
  }
  await step('wallets');

  for (const m of page.media) {
    await tx.query(
      `INSERT INTO edge_media (token_hash, status, batch_status, uid, counter_last, key_index,
                               originality_sig_sha256, pwd_pack_enc, pwd_pack_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (token_hash) DO UPDATE SET
         status = CASE WHEN edge_media.media_id IS NOT NULL THEN edge_media.status
                       ELSE EXCLUDED.status END,
         batch_status = CASE WHEN edge_media.media_id IS NOT NULL THEN edge_media.batch_status
                             ELSE EXCLUDED.batch_status END,
         uid = EXCLUDED.uid,
         counter_last = GREATEST(edge_media.counter_last, EXCLUDED.counter_last),
         key_index = EXCLUDED.key_index,
         originality_sig_sha256 = EXCLUDED.originality_sig_sha256,
         pwd_pack_enc = CASE WHEN $10 THEN EXCLUDED.pwd_pack_enc ELSE edge_media.pwd_pack_enc END,
         pwd_pack_sha256 = CASE WHEN $10 THEN EXCLUDED.pwd_pack_sha256
                                ELSE edge_media.pwd_pack_sha256 END,
         version = edge_media.version + 1`,
      [
        Buffer.from(m.token_hash, 'hex'),
        m.status,
        m.batch_status,
        m.nfc_uid === null ? null : Buffer.from(m.nfc_uid, 'hex'),
        (m.last_counter ?? 0n).toString(),
        m.key_index,
        m.originality_sig_sha256 === null ? null : Buffer.from(m.originality_sig_sha256, 'hex'),
        primary ? encodeBlob(m.pwd_pack_enc) : null,
        primary && m.pwd_pack_sha256 !== null ? Buffer.from(m.pwd_pack_sha256, 'hex') : null,
        primary,
      ],
    );
  }
  // A16 : une STANDBY non promue ne stocke ni clé ni colis, même si on lui en sert.
  if (primary && page.pwd_pack_key) await storeSealedKey(tx, page.pwd_pack_key);
  await step('media');

  await applyReference(tx, ref, { role });
  await step('reference');

  // Conditions de guichet (décision 36) : dernière page seulement ; absentes de cette page,
  // remises à « inconnu » (échec fermé, jamais une valeur ancienne gardée).
  if (!page.has_more) {
    const terms = page.edge_terms ?? null;
    await tx.query('UPDATE edge_event_setting SET edge_terms = $1', [
      terms === null
        ? null
        : JSON.stringify(terms, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v)),
    ]);
  }
  await step('edge_terms');

  for (const s of page.device_seq_acked ?? []) {
    await tx.query(
      `INSERT INTO edge_device_seq (device_id, central_acked_seq, central_acked_at, acked_known)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (device_id) DO UPDATE SET
         central_acked_seq = GREATEST(edge_device_seq.central_acked_seq, EXCLUDED.central_acked_seq),
         central_acked_at = CASE WHEN EXCLUDED.central_acked_seq >= edge_device_seq.central_acked_seq
                                 THEN EXCLUDED.central_acked_at
                                 ELSE edge_device_seq.central_acked_at END,
         acked_known = true`,
      [s.device_id, s.contiguous_acked_seq, s.as_of],
    );
  }
  const finalPage = !page.has_more && !ref.has_more;
  await ctx.purge.onPageApplied(tx, page.edge_seq_applied, !page.has_more);
  await step('purge');

  // Les curseurs en dernier, dans la même transaction.
  await tx.query(
    `UPDATE edge_replication_cursor SET last_replicated_posting_id = $1, last_change_seq = $2,
       last_edge_seq_applied = $3, last_applied_at = $4`,
    [page.to_posting_id, ref.to_change_seq, page.edge_seq_applied, ctx.now],
  );
  await step('cursor');
  return {
    role,
    roleServed: ref.gateway !== null,
    finalPage,
  };
}
