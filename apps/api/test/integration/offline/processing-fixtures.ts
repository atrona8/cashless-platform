// Jeu d'essai du traitement des opérations d'un lot (mission 7, lot WP19) : le jeu des paiements (terminal enrôlé,
// vendeur, bracelets crédités) auquel s'ajoutent politique hors ligne, configuration servie et snapshot. Chaque suite crée
// son PROPRE prestataire, grand livre et terminaux : aucune affirmation globale (processus de fond, règle de l'orchestrateur).
// Amorçage en propriétaire seulement ; tout traitement passe par la route `POST /offline-batches` et le vrai processeur.
import { createHash, randomUUID } from 'node:crypto';
import { tapBody } from '../../support/media-fixtures';
import { ownerRows } from '../../support/media-fixtures';
import { withOwner } from '../../support/db';
import type { TerminalResponse } from '../../support/test-terminal';
import { PaymentWorld, type PayMedia, type PayTerminal } from '../payments/payments-fixtures';
import { asOperator } from '../vendors/vendor-fixtures';

export interface PolicyValues {
  offline_enabled?: boolean;
  max_per_sale?: number;
  max_per_media_per_device?: number;
  max_total_per_device?: number;
  max_snapshot_age_seconds?: number;
}

export interface OfflineTerminal extends PayTerminal {
  configId: number;
}

export interface SnapshotOptions {
  /** Secondes avant maintenant. */
  generatedAgo?: number;
  validForSeconds?: number;
  /** Surcharges de la ligne de journal d'un bracelet (par index de `media`). */
  log?: (index: number) => Partial<{
    in_snapshot: boolean;
    media_status: string | null;
    batch_status: string | null;
    batch_event_id: string | null;
    wallet_status: string | null;
  }>;
}

export class ProcessingWorld {
  pw!: PaymentWorld;
  private version = 0;

  static async create(): Promise<ProcessingWorld> {
    const world = new ProcessingWorld();
    world.pw = await PaymentWorld.create();
    return world;
  }

  close(): Promise<void> {
    return this.pw.close();
  }

  get ledgerId(): string {
    return this.pw.w.ids.ledgerA;
  }
  get operatorId(): string {
    return this.pw.w.ops.a;
  }

  /** Terminal du point de vente, politique hors ligne posée au niveau du terminal, configuration servie. */
  async terminal(policy: PolicyValues = {}): Promise<OfflineTerminal> {
    const t = await this.pw.terminal({ mode: 'CATALOG_POS' });
    const values = {
      offline_enabled: true,
      max_per_sale: 100_000,
      max_per_media_per_device: 1_000_000,
      max_total_per_device: 10_000_000,
      max_snapshot_age_seconds: 900,
      ...policy,
    };
    const configId = await withOwner((db) =>
      asOperator(db, this.operatorId, async () => {
        await db.query('SELECT set_offline_policy($1, $2, $3::jsonb, NULL, $4)', [
          'DEVICE',
          t.t.deviceId,
          JSON.stringify(values),
          this.pw.w.operatorAdminA.userId,
        ]);
        const r = await db.query<{ id: string }>('SELECT id::text FROM record_config_served($1)', [
          t.t.deviceId,
        ]);
        return Number(r.rows[0]!.id);
      }),
    );
    // Les dates des opérations restent après l'enrôlement, la session et la configuration (statut daté, session datée).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { ...t, configId };
  }

  /** Version de snapshot qui liste `media` pour ce terminal ; rend son numéro. */
  async snapshot(
    terminal: OfflineTerminal,
    media: PayMedia[],
    options: SnapshotOptions = {},
  ): Promise<number> {
    const version = (this.version += 1) + Math.floor(Math.random() * 1e6) * 1000;
    const generatedAgo = options.generatedAgo ?? 300;
    const validFor = options.validForSeconds ?? 86_400;
    await withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query(
        `INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, generated_at,
                                       valid_until, entries, content_sha256, authority_epoch, key_id, header,
                                       signature, content_key_wrapped, published_at)
         VALUES ($1, $2, $3, 'FULL', $4, now() - make_interval(secs => $5),
                 now() - make_interval(secs => $5) + make_interval(secs => $6), 0, $7, 0, 'k', '{}', '\\x01',
                 '\\x01', now() - make_interval(secs => $5))`,
        [
          this.operatorId,
          this.ledgerId,
          this.pw.w.ids.eventA,
          version,
          generatedAgo,
          validFor,
          createHash('sha256').update(String(version)).digest(),
        ],
      );
      await db.query(
        `INSERT INTO offline_snapshot_key (ledger_id, version, device_id, agreement_key_sha256, operator_id, envelope)
         VALUES ($1, $2, $3, $4, $5, '{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"e","iv":"i","wrapped_key":"w"}'::jsonb)`,
        [
          this.ledgerId,
          version,
          terminal.t.deviceId,
          createHash('sha256').update('k').digest(),
          this.operatorId,
        ],
      );
      for (const [i, m] of media.entries()) {
        const o = options.log?.(i) ?? {};
        await db.query(
          `INSERT INTO offline_snapshot_media_log (ledger_id, version, token_hash, media_status, batch_status,
                                                   batch_event_id, wallet_status, in_snapshot, operator_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            this.ledgerId,
            version,
            m.media.tokenHash,
            o.media_status === undefined ? 'ACTIVE' : o.media_status,
            o.batch_status === undefined ? 'ACTIVE' : o.batch_status,
            o.batch_event_id === undefined ? this.pw.w.ids.eventA : o.batch_event_id,
            o.wallet_status === undefined ? 'ACTIVE' : o.wallet_status,
            o.in_snapshot ?? true,
            this.operatorId,
          ],
        );
      }
      await db.query('COMMIT');
    });
    return version;
  }

  /** Vente hors ligne datée de `agoSeconds` (négatif : dans le futur) secondes avant maintenant. */
  sale(
    terminal: OfflineTerminal,
    m: PayMedia,
    amount: number,
    snapshotVersion: number,
    overrides: Record<string, unknown> = {},
    agoSeconds = 1,
  ): Record<string, unknown> & { type: string; occurred_at: string } {
    const occurredAt = new Date(Date.now() - agoSeconds * 1000).toISOString();
    m.counter += 1;
    return {
      type: 'PURCHASE',
      occurred_at: occurredAt,
      amount,
      currency: 'XOF',
      tap: tapBody(m.media, m.counter, { occurred_at: occurredAt }),
      snapshot_version: snapshotVersion,
      config_id: terminal.configId,
      vendor_session_id: terminal.sessionId,
      online_status: 'NOT_ATTEMPTED',
      ...overrides,
    };
  }

  submit(
    terminal: OfflineTerminal,
    ops: Array<Record<string, unknown> & { type: string; occurred_at: string }>,
    options: { fromSeq?: number; batchId?: string } = {},
  ): Promise<TerminalResponse & { batch: ReturnType<OfflineTerminal['t']['buildBatch']> }> {
    const batch = terminal.t.buildBatch(ops, { ledgerId: this.ledgerId, ...options });
    return terminal.t
      .submitBatch(this.pw.api.baseUrl, this.pw.api.tls.serverCaPem, batch)
      .then((r) => Object.assign(r, { batch }));
  }

  results(res: TerminalResponse): Array<Record<string, unknown>> {
    if (res.status !== 200) throw new Error(`lot refusé : ${res.status} ${res.text}`);
    return res.body.results as Array<Record<string, unknown>>;
  }

  txRows(deviceId: string) {
    return ownerRows<{
      id: string;
      type: string;
      device_id: string;
      source: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, type, device_id, source, metadata FROM journal_transaction WHERE device_id = $1 ORDER BY recorded_at`,
      [deviceId],
    );
  }

  anomalies(deviceId: string, kind?: string) {
    return ownerRows<{
      id: string;
      kind: string;
      amount: string;
      loss_bearer: string | null;
      seq: string | null;
      transaction_id: string | null;
      status: string;
    }>(
      `SELECT id, kind, amount::text, loss_bearer, seq::text, transaction_id, status FROM anomaly
        WHERE device_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY created_at`,
      [deviceId, kind ?? null],
    );
  }

  postings(txId: string) {
    return ownerRows<{ purpose: string; amount: string }>(
      `SELECT a.purpose, p.amount::text FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 ORDER BY p.line_no`,
      [txId],
    );
  }

  spendable(walletId: string): Promise<number> {
    return this.pw.spendable(walletId);
  }

  static unknownUuid(): string {
    return randomUUID();
  }
}
