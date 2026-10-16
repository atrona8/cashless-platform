// Codes de rattachement d'un lot (SPECIFICATION §7.8 ; ADR-56 ; contracts/claim-codes.md ; FR-015, FR-017).
// Fichier de commande : un code par bracelet, tiré ici, remis UNE fois dans la réponse. La base ne reçoit que des
// empreintes à clé (`ClaimHasher`) ; les codes ne passent par aucun journal, ni par l'audit (qui note leur nombre),
// ni par le registre d'idempotence (route `transient`). Import : correspondance code ↔ UID de l'imprimeur, ligne par
// ligne ; une ligne refusée n'annule pas les autres et la réponse ne renvoie jamais un code.
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { claimCodeUrl, formatClaimCode, generateClaimCode } from '@cashless/tag-format';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { TxClient } from '../../db/tenant-tx';
import { isSqlError } from '../../errors/sqlstate-map';
import { ClaimHasher } from '../../kms/claim-hash';
import { conflict, invalid } from '../../organization/platform/platform.dto';
import type { MediaBatchRow } from './batches.dto';

/** Lignes de données acceptées par envoi du fichier de correspondance ; au-delà, l'appelant découpe son fichier. */
export const MAX_ASSOCIATION_LINES = 10_000;
const ISSUE_ATTEMPTS = 3;
const UID = /^[0-9a-fA-F]{14}$/;

export const ASSOCIATION_REASONS = [
  'MALFORMED_LINE',
  'BAD_CLAIM_CODE',
  'BAD_UID',
  'MEDIA_UNKNOWN',
  'CLAIM_CODE_UNKNOWN',
  'CLAIM_CODE_OTHER_BATCH',
  'CLAIM_CODE_ALREADY_ASSOCIATED',
  'CLAIM_CODE_INVALIDATED',
  'MEDIA_ALREADY_HAS_CODE',
] as const;
export type AssociationReason = (typeof ASSOCIATION_REASONS)[number];

export interface AssociationResult {
  accepted: number;
  rejected: Array<{ line: number; reason: AssociationReason }>;
}

@Injectable()
export class ClaimCodesService {
  private readonly domain: string;

  constructor(
    @Inject(APP_CONFIG) config: Pick<AppConfig, 'claimCodeDomain' | 'production'>,
    private readonly hasher: ClaimHasher,
    private readonly audit: AuditService,
  ) {
    // Sans domaine, chaque QR imprimé serait faux : refus au démarrage plutôt qu'à la première commande.
    if (config.production && config.claimCodeDomain === '') {
      throw new Error(
        'CLAIM_CODE_DOMAIN manquant : domaine des liens imprimés sur les bracelets, obligatoire en production',
      );
    }
    this.domain = config.claimCodeDomain;
  }

  /** Tire les codes du lot, enregistre leurs empreintes et rend le fichier de commande (`rank,code,url`). */
  async issueOrder(client: TxClient, batch: MediaBatchRow, actor: AuditContext): Promise<string> {
    if (batch.kind !== 'PUBLIC')
      throw conflict('Seuls les lots PUBLIC portent un code de rattachement.');
    if (batch.claim_codes_issued_at !== null)
      throw conflict(
        'Le fichier de commande de ce lot a déjà été produit ; il n’est pas conservé et ne peut pas être produit une seconde fois.',
      );
    if (batch.status === 'CLOSED') throw conflict('Lot clos.');
    let codes: string[] = [];
    for (let attempt = 1; ; attempt += 1) {
      const drawn = await this.draw(client, batch.quantity);
      await client.query('SAVEPOINT claim_codes');
      try {
        await client.query('SELECT issue_claim_codes($1, $2::bytea[])', [batch.id, drawn.hashes]);
        await client.query('RELEASE SAVEPOINT claim_codes');
        codes = drawn.codes;
        break;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT claim_codes');
        // Empreinte déjà prise par un code invisible d'ici (autre prestataire) : nouveau tirage.
        if (!(isSqlError(error) && error.code === '23505') || attempt >= ISSUE_ATTEMPTS)
          throw error;
      }
    }
    await this.audit.record(client, {
      ...actor,
      operatorId: batch.operator_id,
      action: 'CLAIM_CODES_ISSUED',
      objectType: 'media_batch',
      objectId: batch.id,
      after: { count: codes.length },
    });
    const lines = ['rank,code,url'];
    codes.forEach((code, index) =>
      lines.push(`${index + 1},${formatClaimCode(code)},${claimCodeUrl(this.domain, code)}`),
    );
    return `${lines.join('\n')}\n`;
  }

  /** `quantity` codes distincts, dont aucune empreinte n'existe déjà chez ce prestataire. */
  private async draw(
    client: TxClient,
    quantity: number,
  ): Promise<{ codes: string[]; hashes: Buffer[] }> {
    const byHash = new Map<string, { code: string; hash: Buffer }>();
    while (byHash.size < quantity) {
      const fresh: Buffer[] = [];
      while (byHash.size < quantity) {
        const code = generateClaimCode(randomBytes);
        const hash = this.hasher.claimCodeHash(code);
        const key = hash.toString('hex');
        if (byHash.has(key)) continue;
        byHash.set(key, { code, hash });
        fresh.push(hash);
      }
      const { rows } = await client.query<{ code_hash: Buffer }>(
        'SELECT code_hash FROM claim_code WHERE code_hash = ANY($1::bytea[])',
        [fresh],
      );
      for (const row of rows) byHash.delete(row.code_hash.toString('hex'));
    }
    const drawn = [...byHash.values()];
    return { codes: drawn.map((d) => d.code), hashes: drawn.map((d) => d.hash) };
  }

  /** Importe le fichier `code,uid` de l'imprimeur ; chaque ligne est un point de reprise. */
  async importAssociations(
    client: TxClient,
    batch: MediaBatchRow,
    csv: string,
    actor: AuditContext,
  ): Promise<AssociationResult> {
    if (batch.kind !== 'PUBLIC')
      throw conflict('Seuls les lots PUBLIC portent un code de rattachement.');
    // Marque d'ordre des octets en tête de fichier (tableurs) : écartée.
    const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).split(/\r?\n/);
    const result: AssociationResult = { accepted: 0, rejected: [] };
    let data = 0;
    let first = true;
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index]!.trim();
      if (text === '') continue;
      const fields = text.split(',').map((field) => field.trim());
      if (first) {
        first = false;
        if (fields[0]?.toLowerCase() === 'code') continue; // ligne d'en-tête
      }
      data += 1;
      if (data > MAX_ASSOCIATION_LINES)
        throw invalid(`Fichier trop long : ${MAX_ASSOCIATION_LINES} lignes au plus par envoi.`);
      const reason = await this.associate(client, batch, fields);
      if (reason) result.rejected.push({ line: index + 1, reason });
      else result.accepted += 1;
    }
    await this.audit.record(client, {
      ...actor,
      operatorId: batch.operator_id,
      action: 'CLAIM_CODES_ASSOCIATED',
      objectType: 'media_batch',
      objectId: batch.id,
      after: { accepted: result.accepted, rejected: result.rejected.length },
    });
    return result;
  }

  /** Associe une ligne ; rend le motif du refus, ou `null` si la ligne est acceptée. */
  private async associate(
    client: TxClient,
    batch: MediaBatchRow,
    fields: string[],
  ): Promise<AssociationReason | null> {
    if (fields.length !== 2) return 'MALFORMED_LINE';
    let hash: Buffer;
    try {
      hash = this.hasher.claimCodeHash(fields[0]!);
    } catch {
      return 'BAD_CLAIM_CODE';
    }
    if (!UID.test(fields[1]!)) return 'BAD_UID';
    const uid = Buffer.from(fields[1]!, 'hex');
    const checked = await this.refusal(client, batch.id, hash, uid);
    if (typeof checked === 'string') return checked;
    await client.query('SAVEPOINT claim_line');
    try {
      await client.query('SELECT associate_claim_code($1, $2)', [hash, checked.mediaId]);
      await client.query('RELEASE SAVEPOINT claim_line');
      return null;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT claim_line');
      // Les contrôles ci-dessus ont été devancés par une écriture concurrente : la base a tranché. Le motif est relu
      // après coup (lot 20, cycle 8) : en READ COMMITTED, la nouvelle lecture voit l'écriture validée (invalidation à
      // la clôture, autre association). Motif par défaut si la relecture ne l'explique pas : déjà associé.
      if (isSqlError(error) && (error.code === 'CL020' || error.code === '23505')) {
        const reread = await this.refusal(client, batch.id, hash, uid);
        return typeof reread === 'string' ? reread : 'CLAIM_CODE_ALREADY_ASSOCIATED';
      }
      throw error;
    }
  }

  /** Motif du refus d'une ligne, lu sans verrou (`associate_claim_code` verrouille et refait ces contrôles). */
  private async refusal(
    client: TxClient,
    batchId: string,
    hash: Buffer,
    uid: Buffer,
  ): Promise<AssociationReason | { mediaId: string }> {
    const media = await client.query<{ id: string; claim_code_hash: Buffer | null }>(
      'SELECT id, claim_code_hash FROM media WHERE batch_id = $1 AND nfc_uid = $2',
      [batchId, uid],
    );
    if (!media.rows[0]) return 'MEDIA_UNKNOWN';
    const code = await client.query<{
      batch_id: string;
      media_id: string | null;
      invalidated_at: Date | null;
    }>('SELECT batch_id, media_id, invalidated_at FROM claim_code WHERE code_hash = $1', [hash]);
    const found = code.rows[0];
    if (!found) return 'CLAIM_CODE_UNKNOWN';
    if (found.invalidated_at !== null) return 'CLAIM_CODE_INVALIDATED';
    if (found.media_id !== null) return 'CLAIM_CODE_ALREADY_ASSOCIATED';
    if (found.batch_id !== batchId) return 'CLAIM_CODE_OTHER_BATCH';
    if (media.rows[0].claim_code_hash !== null) return 'MEDIA_ALREADY_HAS_CODE';
    return { mediaId: media.rows[0].id };
  }
}
