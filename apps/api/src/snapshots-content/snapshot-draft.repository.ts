// Accès base du processus snapshot-content (WP11) : UNIQUEMENT les fonctions accordées à
// `cashless_snapcontent`
// (post-roles.sql § 8e). Aucune lecture directe d'historique ni d'`offline_snapshot`. Une
// transaction courte par
// appel (`TenantTx`) ; le gros calcul et le service de clés restent hors transaction.
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (règle 4 de CLAUDE.md) : usage des fonctions de droits de
// base.
import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { AdvisorySession } from '../db/advisory-session';
import { TenantTx } from '../db/tenant-tx';
import type { SnapshotEntry } from './content-hash';
import type { DraftItem, ProducerHeader, SourceRow, StateHash } from './snapshot-builder';
import { packets } from './snapshot-builder';

export interface Target {
  operatorId: string;
  ledgerId: string;
  eventId: string;
  lastVersion: number;
  lastGeneratedAt: Date | null;
  lastFullVersion: number;
  eligibleDevices: number;
  /** Plus petit `max_snapshot_age` des terminaux éligibles (colonne `interval` de la base), en ms. */
  maxSnapshotAgeMs: number;
}

interface SourceDbRow {
  token_hash: Buffer;
  media_id: string;
  entry: SnapshotEntry | null;
  pwd_pack_enc: Buffer | null;
  pwd_pack_dek_id: string | null;
  key_index: number | null;
  nfc_uid: Buffer | null;
  removed: boolean;
}

const toSource = (row: SourceDbRow): SourceRow => ({
  tokenHash: row.token_hash,
  mediaId: row.media_id,
  entry: row.entry,
  pwdPackEnc: row.pwd_pack_enc,
  pwdPackDekId: row.pwd_pack_dek_id,
  keyIndex: row.key_index,
  nfcUid: row.nfc_uid,
  removed: row.removed,
});

/** Motif court (DETAIL) d'une erreur de la base, nul si elle n'en porte pas. */
export function dbDetail(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' ? detail : null;
}

/** Espace de noms du verrou consultatif de grand livre (distinct de tous ceux des fonctions SQL). */
const LEDGER_LOCK = 'snapshot-content-ledger';

@Injectable()
export class SnapshotDraftRepository implements OnModuleDestroy {
  constructor(
    private readonly tx: TenantTx,
    @Optional() private readonly locks?: AdvisorySession,
  ) {}

  /**
   * Prend (ou confirme) l'exclusivité du processus sur ce grand livre : verrou consultatif de
   * session, non bloquant. Faux = une autre instance le traite : n'y touche pas.
   */
  async tryLock(ledgerId: string): Promise<boolean> {
    if (!this.locks) throw new Error('verrou de grand livre : session absente');
    return this.locks.tryLock(LEDGER_LOCK, ledgerId);
  }

  /** Libère les verrous des grands livres qui ne sont plus ciblés. */
  async releaseExcept(ledgerIds: ReadonlySet<string>): Promise<void> {
    await this.locks?.releaseExcept(LEDGER_LOCK, ledgerIds);
  }

  async close(): Promise<void> {
    await this.locks?.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async targets(): Promise<Target[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{
        operator_id: string;
        ledger_id: string;
        event_id: string;
        last_version: bigint | string;
        last_generated_at: Date | null;
        last_full_version: bigint | string;
        eligible_devices: number;
        max_age_ms: number;
      }>(
        'SELECT t.*, (extract(epoch FROM t.max_snapshot_age) * 1000)::float8 AS max_age_ms ' +
          'FROM offline_snapshot_targets() t ORDER BY t.ledger_id',
      );
      return rows.map((row) => ({
        operatorId: row.operator_id,
        ledgerId: row.ledger_id,
        eventId: row.event_id,
        lastVersion: Number(row.last_version),
        lastGeneratedAt: row.last_generated_at,
        lastFullVersion: Number(row.last_full_version),
        eligibleDevices: row.eligible_devices,
        maxSnapshotAgeMs: Number(row.max_age_ms),
      }));
    });
  }

  async sourceFull(operatorId: string, ledgerId: string): Promise<SourceRow[]> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<SourceDbRow>(
        'SELECT token_hash, media_id, entry, pwd_pack_enc, pwd_pack_dek_id, key_index, ' +
          'nfc_uid, removed ' +
          'FROM offline_snapshot_source($1)',
        [ledgerId],
      );
      return rows.map(toSource);
    });
  }

  async sourceDelta(operatorId: string, ledgerId: string, since: Date): Promise<SourceRow[]> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<SourceDbRow>(
        'SELECT token_hash, media_id, entry, pwd_pack_enc, pwd_pack_dek_id, key_index, ' +
          'nfc_uid, removed ' +
          'FROM offline_snapshot_source_delta($1, $2)',
        [ledgerId, since],
      );
      return rows.map(toSource);
    });
  }

  async stateHashes(operatorId: string, ledgerId: string): Promise<Map<string, StateHash>> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{
        token_hash: Buffer;
        entry_sha256: Buffer;
        removed: boolean;
      }>('SELECT token_hash, entry_sha256, removed FROM offline_snapshot_state_hashes($1)', [
        ledgerId,
      ]);
      return new Map(
        rows.map((row) => [
          row.token_hash.toString('hex'),
          { entrySha256: row.entry_sha256, removed: row.removed },
        ]),
      );
    });
  }

  /** Empreinte de changement de chaque entrée, calculée par la base (forme jsonb::text, jamais
   * recopiée ici). */
  async entryShas(rows: readonly SourceRow[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    for (const group of packets(rows.filter((row) => row.entry !== null))) {
      if (group.length === 0) continue;
      await this.tx.withoutTenant(async (client) => {
        const { rows: shas } = await client.query<{ sha: Buffer }>(
          'SELECT offline_snapshot_entry_sha256(t.x) AS sha ' +
            'FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(x, n) ORDER BY t.n',
          [JSON.stringify(group.map((row) => row.entry))],
        );
        group.forEach((row, index) => out.set(row.tokenHash.toString('hex'), shas[index]!.sha));
      });
    }
    return out;
  }

  /**
   * Inscrit le brouillon : save_ avec le premier paquet, append_ pour les suivants, puis seal_. Un
   * échec après
   * l'ouverture jette le brouillon (discard_) avant de relancer l'erreur d'origine. Rend l'id du
   * brouillon.
   */
  async writeDraft(
    operatorId: string,
    ledgerId: string,
    header: ProducerHeader,
    contentKeyWrapped: Buffer,
    items: readonly DraftItem[],
  ): Promise<number> {
    const [first, ...rest] = packets(items);
    const draft = await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ id: bigint | string }>(
        'SELECT save_offline_snapshot_draft($1, $2, $3::jsonb, $4, $5::jsonb) AS id',
        [ledgerId, header.kind, JSON.stringify(header), contentKeyWrapped, JSON.stringify(first)],
      );
      return Number(rows[0]!.id);
    });
    try {
      for (const packet of rest) {
        await this.tx.run(operatorId, (client) =>
          client.query('SELECT append_offline_snapshot_draft_entries($1, $2::jsonb)', [
            draft,
            JSON.stringify(packet),
          ]),
        );
      }
      await this.tx.run(operatorId, (client) =>
        client.query('SELECT seal_offline_snapshot_draft($1)', [draft]),
      );
    } catch (error) {
      try {
        await this.discard(operatorId, draft, 'ECHEC-PRODUCTEUR');
      } catch (discardError) {
        // Jamais avalé : le brouillon reste OPEN (orphelin), levé plus tard par `discardOrphans`.
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(
          `jet du brouillon ${draft} échoué après l'échec de son écriture (${why.slice(0, 120)}) : ` +
            (discardError instanceof Error ? discardError.message : String(discardError)),
          { cause: discardError },
        );
      }
      throw error;
    }
    return draft;
  }

  async discard(operatorId: string, draft: number, reason: string): Promise<void> {
    await this.tx.run(operatorId, (client) =>
      client.query('SELECT discard_offline_snapshot_draft($1, $2)', [draft, reason]),
    );
  }

  /** Jette les brouillons OPEN|READY du grand livre (jamais PUBLISHED) ; rend leur nombre. */
  async discardOrphans(operatorId: string, ledgerId: string): Promise<number> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'SELECT discard_open_offline_snapshot_drafts($1) AS n',
        [ledgerId],
      );
      return rows[0]!.n;
    });
  }

  async purge(operatorId: string, ledgerId: string): Promise<number> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'SELECT purge_offline_snapshot_content($1) AS n',
        [ledgerId],
      );
      return rows[0]!.n;
    });
  }
}
