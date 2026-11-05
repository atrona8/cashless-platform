// Types partagés de la réception des lots hors ligne (mission 7, lot WP18 ; contracts/interfaces.md § 8,
// « Types du processeur »). WP19 (processeur d'une opération) et WP20 (import du journal) les importent : leur forme
// est figée, un champ réclamé en plus se signale au lot WP18, il ne se devine pas.
import type { components } from '@cashless/contracts';
import type { TxClient } from '../../db/tenant-tx';
import type { EngineOptions } from '../../ledger/ledger-engine.service';
import type { ReferenceMemo } from '../../ledger/ports/reference-memo';

/** Opération d'un lot, résultat rendu au terminal : forme `OfflineOperationResult` du contrat (WP01). */
export type OperationResult = components['schemas']['OfflineOperationResult'];
export type OfflineBatchResult = components['schemas']['OfflineBatchResult'];

/** Types admis à l'entrée d'un lot terminal (`TOPUP_CASH` entre, puis le processeur le rejette : R-02). */
export const ENTRY_OPERATION_TYPES = [
  'PURCHASE',
  'REVERSAL',
  'TOPUP_CASH',
  'VOID',
  'ONLINE_REF',
] as const;
export type EntryOperationType = (typeof ENTRY_OPERATION_TYPES)[number];

/** Ce que le processeur sait du lot en cours. `IMPORT` (avec `importId`) est posé par WP20, `DEVICE` ici. */
export interface BatchContext {
  batchId: string;
  deviceId: string;
  operatorId: string;
  ledgerId: string;
  serial: string;
  receivedAt: Date;
  receivedVia: 'DEVICE' | 'IMPORT';
  importId: string | null;
  authorityEpoch: number;
  /**
   * Numéros dont la date recule de plus de la tolérance par rapport à la plus grande date vue avant eux
   * (`detectInversions`, calculé par la boucle du lot sur TOUTES ses opérations). Le processeur en tire une anomalie
   * `CLOCK_SKEW` ; le résultat de l'opération ne change pas (contracts/compliance.md « Temps »).
   */
  inversions: readonly bigint[];
  /**
   * Mémoire de données de référence IMMUABLES, propre à l'exécution de CE lot (créée par la boucle, jetée à sa fin).
   * Absente pour un appelant qui n'en passe pas (tests, import) : tout est alors relu, comme avant.
   */
  reference?: ReferenceMemo;
  /**
   * Garde posée par la boucle du lot : relit l'état du lot DANS la transaction de l'opération et lève
   * `BatchNotProcessing` s'il n'est plus `PROCESSING`. Le processeur l'appelle juste après `lock_device`, avant toute
   * lecture ou écriture de l'opération.
   */
  assertProcessing?: (client: TxClient) => Promise<void>;
}

/** Options du moteur pour une opération d'un lot : mémoire de lot et droits de place non lus (jamais en ligne). */
export function engineOptions(ctx: BatchContext): EngineOptions | undefined {
  return ctx.reference ? { memo: ctx.reference, skipPitchFees: true } : undefined;
}

/** Le lot n'est plus `PROCESSING` : l'opération n'écrit rien (sa transaction est annulée) et la boucle s'arrête. */
export class BatchNotProcessing extends Error {
  /** `null` : lot introuvable. */
  constructor(readonly status: string | null) {
    super(`lot hors ligne : statut ${status ?? 'inconnu'}, traitement arrêté`);
  }
}

/** Contexte tel que l'ouvre le réceptionneur ; la boucle de WP18 y ajoute `inversions`. */
export type BatchOpening = Omit<BatchContext, 'inversions' | 'reference' | 'assertProcessing'>;

/** Une opération reçue : objet JSON tel que reçu (intact), numéro exact, empreinte recalculée par le serveur. */
export interface ParsedOperation {
  seq: bigint;
  raw: Record<string, unknown>;
  type: EntryOperationType;
  contentSha256: Buffer;
}

/** Processeur d'une opération (WP19) : sa propre transaction `TenantTx`, jamais celle d'une autre opération. */
export interface OfflineOperationProcessor {
  /** Marqueur lu par la garde de production : un faux n'est jamais servi en production (règle 2). */
  readonly isFake?: boolean;
  process(ctx: BatchContext, op: ParsedOperation): Promise<OperationResult>;
}

/** Jeton d'injection du processeur. */
export const OFFLINE_OPERATION_PROCESSOR = Symbol('OFFLINE_OPERATION_PROCESSOR');

/** Jeton du verrou de lot (pool dédié, R-30.7). */
export const OFFLINE_BATCH_LOCK = Symbol('OFFLINE_BATCH_LOCK');

/** Limites du contrat (`batches.md`, contrôles 1 et 3). */
export const MAX_BATCH_BYTES = 1_048_576;
export const MAX_BATCH_OPERATIONS = 500;
/** Champs numéro lus sur le texte source (refus au-delà de 2^53 - 1). */
export const SEQ_FIELDS = ['seq', 'seq_from', 'seq_to', 'reverses_seq'] as const;

/** En-tête signé du lot (`OfflineBatchHeader`), valeurs déjà validées par le contrôle 3. */
export interface ParsedHeader {
  /** En-tête tel que reçu : la signature porte sur `JCS(header)`. */
  raw: Record<string, unknown>;
  /** Identifiant du lot en minuscules (clé de l'état, du verrou et de l'audit). */
  batchId: string;
  deviceSerial: string;
  ledgerId: string;
  authorityEpoch: number;
  seqFrom: bigint;
  seqTo: bigint;
  prevChainHash: Buffer;
  lastChainHash: Buffer;
}

export interface ReceivedOperation {
  seq: bigint;
  raw: Record<string, unknown>;
  type: EntryOperationType;
  /** `chain_hash` déclaré par le terminal (comparé au recalcul, jamais cru). */
  chainHash: Buffer;
}

export interface ParsedBatch {
  header: ParsedHeader;
  operations: ReceivedOperation[];
  /** Signature telle que reçue (base64 standard) : décodée et vérifiée au contrôle 6, jamais avant. */
  signature: string;
}
