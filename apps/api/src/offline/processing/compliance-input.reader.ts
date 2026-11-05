// Lecture des FAITS d'une opération pour les règles pures de WP17 (contracts/compliance.md). Aucune règle ici : le
// lecteur construit `ComplianceInput` (et les entrées de période et de conflit) par les fonctions de la base ; les
// règles (`checkCompliance`, `checkPeriod`, `conflictOutcome`) restent pures. Un fait introuvable est rendu « absent »
// (null, faux) : la règle REFUSE alors l'opération, jamais l'inverse.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import { deviceKey } from '../../idempotency/device-key';
import { isSqlError } from '../../errors/sqlstate-map';
import type { BatchContext } from '../batches/batch.types';
import type { ComplianceInput, OperationType } from '../rules/types';
import type { OperationFields } from './operation-input';
import { inSavepoint } from './savepoint';

/** Tolérance d'horloge de la mission (120 s, sync_protocol.md §7.4). */
export const TOLERANCE_MS = 120_000;

export interface TerminalFacts {
  deviceStatus: string;
  providedBy: 'PLATFORM' | 'OPERATOR' | 'ORGANIZER' | 'MERCHANT';
  eventId: string | null;
  participationId: string | null;
  eventCurrency: string | null;
  eventStatus: string;
  ledgerCurrency: string;
  ledgerStatus: string;
  lockedUntil: Date | null;
}

export interface SnapshotFacts {
  version: bigint;
  generatedAt: Date;
  validUntil: Date | null;
  publishedAt: Date;
  wrapped: boolean;
}

/** Bracelet désigné par la lecture (ou par la vente visée d'une annulation). */
export interface MediaFacts {
  mediaId: string;
  tokenHash: Buffer;
  walletId: string | null;
  walletCurrency: string | null;
}

export interface ReversalTargetFacts {
  transactionId: string;
  mediaId: string | null;
  alreadyReversed: boolean;
}

@Injectable()
export class ComplianceInputReader {
  async terminal(client: TxClient, ctx: BatchContext): Promise<TerminalFacts> {
    const { rows } = await client.query<{
      device_status: string;
      provided_by: TerminalFacts['providedBy'];
      event_id: string | null;
      participation_id: string | null;
      event_currency: string | null;
      event_status: string;
      ledger_currency: string;
      ledger_status: string;
      locked_until: Date | null;
    }>(
      `SELECT d.status AS device_status, d.provided_by, d.event_id, pos.participation_id,
              e.currency AS event_currency, e.status::text AS event_status,
              l.currency AS ledger_currency, l.status AS ledger_status, l.locked_until
         FROM device d
         LEFT JOIN point_of_sale pos ON pos.id = d.pos_id AND pos.operator_id = d.operator_id
         LEFT JOIN event e ON e.id = d.event_id
         JOIN ledger l ON l.id = $3
        WHERE d.id = $1 AND d.operator_id = $2`,
      [ctx.deviceId, ctx.operatorId, ctx.ledgerId],
    );
    const r = rows[0];
    if (!r) throw new Error('lot hors ligne : terminal ou grand livre introuvable');
    return {
      deviceStatus: r.device_status,
      providedBy: r.provided_by,
      eventId: r.event_id,
      participationId: r.participation_id,
      eventCurrency: r.event_currency?.trim() ?? null,
      eventStatus: r.event_status,
      ledgerCurrency: r.ledger_currency.trim(),
      ledgerStatus: r.ledger_status,
      lockedUntil: r.locked_until,
    };
  }

  /** Version citée du snapshot : `null` si inconnue de ce grand livre (SNAPSHOT_VERSION_UNKNOWN en conformité). */
  async snapshot(
    client: TxClient,
    ctx: BatchContext,
    version: bigint | null,
  ): Promise<SnapshotFacts | null> {
    if (version === null) return null;
    const { rows } = await client.query<{
      generated_at: Date;
      valid_until: Date | null;
      published_at: Date;
      wrapped_for_device: boolean;
    }>(
      `SELECT generated_at, valid_until, published_at, wrapped_for_device
         FROM offline_snapshot_meta($1, $2::bigint, $3)`,
      [ctx.ledgerId, version.toString(), ctx.deviceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      version,
      generatedAt: r.generated_at,
      validUntil: r.valid_until,
      publishedAt: r.published_at,
      wrapped: r.wrapped_for_device,
    };
  }

  async media(client: TxClient, tokenHash: Buffer): Promise<MediaFacts | null> {
    const { rows } = await client.query<{
      id: string;
      token_hash: Buffer;
      wallet_id: string | null;
      currency: string | null;
    }>(
      `SELECT m.id, m.token_hash, m.wallet_id, l.currency
         FROM media m LEFT JOIN wallet w ON w.id = m.wallet_id LEFT JOIN ledger l ON l.id = w.ledger_id
        WHERE m.token_hash = $1`,
      [tokenHash],
    );
    const r = rows[0];
    return r
      ? {
          mediaId: r.id,
          tokenHash: r.token_hash,
          walletId: r.wallet_id,
          walletCurrency: r.currency?.trim() ?? null,
        }
      : null;
  }

  async mediaById(client: TxClient, mediaId: string): Promise<MediaFacts | null> {
    const { rows } = await client.query<{
      id: string;
      token_hash: Buffer;
      wallet_id: string | null;
      currency: string | null;
    }>(
      `SELECT m.id, m.token_hash, m.wallet_id, l.currency
         FROM media m LEFT JOIN wallet w ON w.id = m.wallet_id LEFT JOIN ledger l ON l.id = w.ledger_id
        WHERE m.id = $1`,
      [mediaId],
    );
    const r = rows[0];
    return r
      ? {
          mediaId: r.id,
          tokenHash: r.token_hash,
          walletId: r.wallet_id,
          walletCurrency: r.currency?.trim() ?? null,
        }
      : null;
  }

  /** Vente visée par une annulation : du MÊME terminal seulement (clé `<série>:<numéro>` ou identifiant). */
  async reversalTarget(
    client: TxClient,
    ctx: BatchContext,
    fields: OperationFields,
  ): Promise<ReversalTargetFacts | null> {
    if (fields.reversesSeq === null && fields.reversesTransactionId === null) return null;
    const key = fields.reversesSeq === null ? null : deviceKey(ctx.serial, fields.reversesSeq);
    const { rows } = await client.query<{ id: string; media_id: string | null; reversed: boolean }>(
      `SELECT t.id, t.media_id,
              EXISTS (SELECT 1 FROM journal_transaction r
                       WHERE r.ledger_id = t.ledger_id AND r.reverses_id = t.id) AS reversed
         FROM journal_transaction t
        WHERE t.ledger_id = $1 AND t.device_id = $2 AND t.type = 'PURCHASE'
          AND ($3::text IS NULL OR t.idempotency_key = $3)
          AND ($4::uuid IS NULL OR t.id = $4)`,
      [ctx.ledgerId, ctx.deviceId, key, fields.reversesTransactionId],
    );
    const r = rows[0];
    return r ? { transactionId: r.id, mediaId: r.media_id, alreadyReversed: r.reversed } : null;
  }

  /** Transaction en ligne citée par un `CONFIRMED` : existe-t-elle au journal, pour CE terminal ? (R-30.1) */
  async confirmedTransaction(
    client: TxClient,
    ctx: BatchContext,
    onlineTransactionId: string | null,
  ): Promise<string | null> {
    if (onlineTransactionId === null) return null;
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM journal_transaction WHERE ledger_id = $1 AND device_id = $2 AND id = $3',
      [ctx.ledgerId, ctx.deviceId, onlineTransactionId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * `blockTime` de la table de conflit. `p_before` = heure de l'opération + tolérance : un blocage postérieur n'est pas
   * « en vigueur » (un 2e blocage ne masque pas le 1er, et un blocage tardif ne prive pas la vente de sa couverture).
   * `'-infinity'` (bloqué sans date connue) devient `'UNKNOWN'` ; « pas bloqué à cette date » (NULL) devient une date
   * postérieure à l'usage (`undefined` rendu ici, l'appelant choisit la date neutre).
   */
  async blockTime(
    client: TxClient,
    mediaId: string,
    walletId: string | null,
    occurredAt: Date,
  ): Promise<Date | 'UNKNOWN' | null> {
    const { rows } = await client.query<{ unknown: boolean | null; at: Date | null }>(
      `SELECT (t = '-infinity'::timestamptz) AS unknown,
              CASE WHEN t = '-infinity'::timestamptz THEN NULL ELSE t END AS at
         FROM (SELECT offline_block_time($1, $2, $3) AS t) x`,
      [mediaId, walletId, new Date(occurredAt.getTime() + TOLERANCE_MS)],
    );
    const r = rows[0]!;
    if (r.unknown === true) return 'UNKNOWN';
    return r.at;
  }

  async spendable(client: TxClient, walletId: string): Promise<bigint> {
    const { rows } = await client.query<{ s: string }>('SELECT wallet_spendable($1)::text AS s', [
      walletId,
    ]);
    return BigInt(rows[0]!.s);
  }

  async walletStatus(client: TxClient, walletId: string): Promise<string> {
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM wallet WHERE id = $1',
      [walletId],
    );
    return rows[0]?.status ?? 'BLOCKED';
  }

  /** Construit `ComplianceInput` (contracts/compliance.md, dix contrôles). */
  async complianceInput(
    client: TxClient,
    ctx: BatchContext,
    args: {
      type: OperationType;
      seq: bigint;
      fields: OperationFields;
      terminal: TerminalFacts;
      snapshot: SnapshotFacts | null;
      media: MediaFacts | null;
      reversal: ReversalTargetFacts | null;
      corrected: Date;
      exempt: boolean;
    },
  ): Promise<ComplianceInput> {
    const { fields, terminal, snapshot, media, corrected } = args;
    const at = corrected;
    // Terminal : statut daté ; une révocation avant l'heure de l'opération prime (canal IMPORT).
    const statusRow = await client.query<{ status: string | null; revoked_at: Date | null }>(
      'SELECT device_status_at($1, $2) AS status, device_revoked_at($1) AS revoked_at',
      [ctx.deviceId, at],
    );
    const revokedAt = statusRow.rows[0]!.revoked_at;
    const statusAt =
      revokedAt !== null && at.getTime() >= revokedAt.getTime()
        ? 'REVOKED'
        : statusRow.rows[0]!.status;
    // Configuration en vigueur (R-30.4). Les plafonds sont lus en texte : aucun passage par un nombre JS.
    const cfg = await client.query<{
      found: boolean;
      enabled: boolean | null;
      ps: string | null;
      pm: string | null;
      pt: string | null;
      age_ms: string | null;
    }>(
      `SELECT (p IS NOT NULL) AS found, (p->>'offline_enabled')::boolean AS enabled,
              p->>'max_per_sale' AS ps, p->>'max_per_media_per_device' AS pm,
              p->>'max_total_per_device' AS pt,
              (extract(epoch FROM (p->>'max_snapshot_age')::interval) * 1000)::bigint::text AS age_ms
         FROM (SELECT offline_config_in_force($1, $2::bigint, $3, make_interval(secs => $4)) AS p) x`,
      [
        ctx.deviceId,
        fields.configId === null ? null : fields.configId.toString(),
        at,
        TOLERANCE_MS / 1000,
      ],
    );
    const c = cfg.rows[0]!;
    const configInForce =
      c.found && fields.configId !== null
        ? {
            configId: fields.configId.toString(),
            offlineEnabled: c.enabled === true,
            maxPerSale: BigInt(c.ps ?? '0'),
            maxPerMedia: BigInt(c.pm ?? '0'),
            maxPerDevice: BigInt(c.pt ?? '0'),
          }
        : null;
    const maxAgeMs = c.age_ms === null ? 0 : Number(c.age_ms);

    // Plancher d'accusé (R-30.4).
    const floor = await client.query<{ f: string }>(
      `SELECT offline_snapshot_ack_floor($1, $2)::text AS f`,
      [ctx.deviceId, new Date(at.getTime() - TOLERANCE_MS)],
    );

    // État du bracelet à la version citée (jamais l'état courant).
    let mediaAtVersion: ComplianceInput['mediaAtVersion'] = {
      present: false,
      mediaUsable: false,
      batchUsable: false,
      walletUsable: false,
      batchBelongsToEvent: false,
    };
    // Annulation sans lecture (contrat : ni `tap`, ni devise, ni montant) : le bracelet est celui de la vente visée.
    const reversal = args.type === 'REVERSAL';
    const tokenHash = fields.tap?.tokenHash ?? (reversal ? (media?.tokenHash ?? null) : null);
    // Cible introuvable et aucune lecture : rien à évaluer aux contrôles 6 à 9, et le contrôle 10 REFUSE de toute
    // façon. Ces faits sont posés « favorables » pour que la raison rapportée soit `REVERSAL_TARGET_NOT_FOUND`.
    const targetLost = reversal && args.reversal === null && fields.tap === null;
    if (targetLost) {
      mediaAtVersion = {
        present: true,
        mediaUsable: true,
        batchUsable: true,
        walletUsable: true,
        batchBelongsToEvent: true,
      };
    } else if (tokenHash !== null && snapshot !== null) {
      const st = await client.query<{
        in_snapshot: boolean;
        media_status: string | null;
        batch_status: string | null;
        batch_event_id: string | null;
        wallet_status: string | null;
      }>(
        `SELECT in_snapshot, media_status, batch_status, batch_event_id, wallet_status
           FROM offline_media_state_at($1, $2, $3::bigint)`,
        [ctx.ledgerId, tokenHash, snapshot.version.toString()],
      );
      const s = st.rows[0];
      if (s) {
        mediaAtVersion = {
          present: s.in_snapshot === true,
          mediaUsable: s.media_status === 'ACTIVE',
          // Un bracelet sans lot n'a pas de contrainte de lot (register_tap ne contrôle le lot que s'il existe).
          batchUsable: s.batch_status === null || s.batch_status === 'ACTIVE',
          walletUsable: s.wallet_status === 'ACTIVE',
          batchBelongsToEvent: s.batch_event_id === null || s.batch_event_id === terminal.eventId,
        };
      }
    }

    // Session de vendeur à l'heure de l'opération (CL032 devient le détail VENDOR_SESSION).
    let vendorSessionOpen = false;
    if (fields.vendorSessionId !== null) {
      try {
        await inSavepoint(client, () =>
          client.query('SELECT assert_vendor_session_at($1, $2, $3)', [
            ctx.deviceId,
            fields.vendorSessionId,
            at,
          ]),
        );
        vendorSessionOpen = true;
      } catch (error) {
        if (!(isSqlError(error) && error.code === 'CL032')) throw error;
      }
    }

    // Exposition (R-30.3) : lue par la base, jamais sommée en mémoire.
    let exposure = { mediaCumulative: 0n, deviceCumulative: 0n };
    if (args.type === 'PURCHASE') {
      const reference = new Date(Math.min(at.getTime(), ctx.receivedAt.getTime()));
      const ex = await client.query<{ per_media: string; per_device: string }>(
        `SELECT per_media::text, per_device::text
           FROM offline_device_exposure($1, $2::uuid, $3::bigint, $4, make_interval(secs => $5))`,
        [ctx.deviceId, media?.mediaId ?? null, args.seq.toString(), reference, TOLERANCE_MS / 1000],
      );
      exposure = {
        mediaCumulative: BigInt(ex.rows[0]!.per_media),
        deviceCumulative: BigInt(ex.rows[0]!.per_device),
      };
    }
    return {
      exempt: args.exempt,
      type: args.type,
      amount: fields.amount ?? 0n,
      occurredAtCorrected: corrected,
      tolMs: TOLERANCE_MS,
      // Bracelet inconnu du serveur ou sans portefeuille : la devise annoncée par l'opération est comparée, et la table de
      // conflit rejette ensuite (`MEDIA_NOT_IN_SNAPSHOT`) ; un portefeuille connu d'une autre devise reste refusé.
      // Annulation sans devise annoncée : celle du grand livre (une annulation rend dans la devise de la vente).
      walletCurrency: ((currency) =>
        media?.walletCurrency != null
          ? currency === media.walletCurrency
            ? media.walletCurrency
            : null
          : currency)(fields.currency ?? (reversal ? terminal.ledgerCurrency : null)),
      eventCurrency: terminal.eventCurrency,
      device: { statusAtOccurred: statusAt, vendorSessionOpen },
      tapConfigId: fields.configId === null ? null : fields.configId.toString(),
      configInForce,
      exposure,
      snapshot:
        snapshot === null
          ? null
          : {
              version: snapshot.version,
              registeredAt: snapshot.publishedAt,
              envelopedForDevice: snapshot.wrapped,
              generatedAt: snapshot.generatedAt,
              validUntil: snapshot.validUntil,
              maxSnapshotAgeMs: maxAgeMs,
            },
      ackFloor: BigInt(floor.rows[0]!.f),
      mediaAtVersion,
      // Une annulation sans lecture n'a pas de pack à vérifier (la lecture n'existe pas) ; avec lecture, `pack_verified`
      // faux reste un refus.
      packVerified: fields.tap === null ? (reversal ? true : null) : fields.packVerified,
      reversalTarget:
        args.type === 'REVERSAL'
          ? {
              foundOnThisDevice: args.reversal !== null,
              alreadyReversed: args.reversal?.alreadyReversed ?? false,
            }
          : null,
    };
  }
}
