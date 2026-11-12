// Règles de la mission 7 appliquées par la passerelle à UNE opération d'un lot de terminal (WP23, T103/T104).
// Aucune règle n'est recopiée : conformité, période, heure corrigée, issue de conflit et répartition de la
// dépense viennent de `@cashless/shared-rules` ; ce fichier ne fait que LIRE les faits dans la copie
// locale (statut du bracelet RÉPLIQUÉ, blocage répliqué, lot du bracelet, `event.status`, plafonds de la
// configuration citée `policy_in_force`, état du snapshot cité) et les passer aux règles. Un fait absent
// REFUSE l'opération, jamais l'inverse.
//
// Le verdict est PROVISOIRE : le central rejoue chaque opération (toutes sont relayées, dans l'ordre) avec
// les mêmes règles et reste seul juge. Limites locales, toutes dans le sens prudent :
//  - pas d'historique daté du bracelet : un bracelet bloqué dans la copie est traité comme bloqué à une
//    date INCONNUE (part couverte nulle, `MEDIA_BLOCKED_AFTER_SNAPSHOT`) ;
//  - statut du terminal : celui de la copie (le garde refuse déjà un terminal révoqué ou suspendu) ;
//  - `CONFIRMED` n'exempte jamais (le central seul connaît l'opération en ligne) ;
//  - pas de compteur écrit localement : `counter <= counter_last` lu seulement (CLONE_SUSPECTED, part nulle).
import { createHash } from 'node:crypto';
import {
  checkCompliance,
  checkPeriod,
  conflictOutcome,
  resolveOfflineTime,
  spendSplit,
  type ComplianceInput,
  type OfflineRejectReason,
  type OperationType,
  type ShortfallReason,
  type TapResult,
} from '@cashless/shared-rules';
import type { TxClient } from '../../db/gateway-tx';
import type { WalletDelta } from '../../queue/edge-queue';
import { readEffectiveBalance } from '../../replication/effective-balance';
import type { ReceivedOperation } from './batch-verifier';

/** Tolérance d'horloge de la mission (120 s, sync_protocol.md §7.4). */
export const TOLERANCE_MS = 120_000;
const HEX32 = /^[0-9a-f]{64}$/;
const UID = /^[0-9a-f]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RulesEnv {
  deviceId: string;
  serial: string;
  eventId: string;
  receivedAt: Date;
  eventStatus: string;
  eventCurrency: string | null;
  promoFirst: boolean;
  policyInForce: Array<{
    device_id: string;
    config_id: number;
    in_force: boolean;
    offline_policy: Record<string, unknown>;
  }>;
}

export type LocalStatus = 'ACCEPTED' | 'ACCEPTED_WITH_SHORTFALL' | 'REJECTED';

/** Issue locale d'une opération (rien n'est écrit par ce fichier : l'appelant écrit file et résultat). */
export interface LocalVerdict {
  status: LocalStatus;
  rejectReason: OfflineRejectReason | null;
  detail: string[];
  tapResult: TapResult | null;
  amount: bigint;
  covered: bigint;
  shortfall: bigint;
  shortfallReason: ShortfallReason | null;
  paid: bigint;
  promo: bigint;
  walletId: string | null;
  mediaId: string | null;
  deltas: WalletDelta[];
  /** Vente annulée par cette opération (REVERSAL accepté). */
  reverses: number | null;
}

const rejected = (
  reason: OfflineRejectReason,
  detail: string[] = [],
  extra: Partial<LocalVerdict> = {},
): LocalVerdict => ({
  status: 'REJECTED',
  rejectReason: reason,
  detail,
  tapResult: null,
  amount: 0n,
  covered: 0n,
  shortfall: 0n,
  shortfallReason: null,
  paid: 0n,
  promo: 0n,
  walletId: null,
  mediaId: null,
  deltas: [],
  reverses: null,
  ...extra,
});

const safeInt = (value: unknown, min: number): bigint | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? BigInt(value) : null;

interface Fields {
  occurredAt: string | null;
  amount: bigint | null;
  currency: string | null;
  tap: {
    uid: Buffer;
    tokenHash: Buffer;
    counter: number;
    signature: Buffer | null;
    packVerified: boolean;
  } | null;
  tapMalformed: boolean;
  snapshotVersion: bigint | null;
  configId: bigint | null;
  vendorSessionId: string | null;
  reversesSeq: bigint | null;
  reversesTransactionId: string | null;
}

function readFields(raw: Record<string, unknown>): Fields {
  let tap: Fields['tap'] = null;
  let tapMalformed = false;
  if (raw.tap !== undefined && raw.tap !== null) {
    const t = raw.tap as Record<string, unknown>;
    if (
      typeof t !== 'object' ||
      Array.isArray(t) ||
      typeof t.nfc_uid !== 'string' ||
      !UID.test(t.nfc_uid) ||
      typeof t.token_hash !== 'string' ||
      !HEX32.test(t.token_hash) ||
      typeof t.counter !== 'number' ||
      !Number.isSafeInteger(t.counter) ||
      (t.originality_signature !== undefined &&
        (typeof t.originality_signature !== 'string' || !HEX32.test(t.originality_signature)))
    ) {
      tapMalformed = true;
    } else {
      tap = {
        uid: Buffer.from(t.nfc_uid, 'hex'),
        tokenHash: Buffer.from(t.token_hash, 'hex'),
        counter: t.counter,
        signature:
          typeof t.originality_signature === 'string'
            ? Buffer.from(t.originality_signature, 'hex')
            : null,
        packVerified: t.pack_verified === true,
      };
    }
  }
  return {
    occurredAt: typeof raw.occurred_at === 'string' ? raw.occurred_at : null,
    amount: safeInt(raw.amount, 1),
    currency:
      typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null,
    tap,
    tapMalformed,
    snapshotVersion: safeInt(raw.snapshot_version, 1),
    configId: safeInt(raw.config_id, 1),
    vendorSessionId:
      typeof raw.vendor_session_id === 'string' && UUID.test(raw.vendor_session_id)
        ? raw.vendor_session_id.toLowerCase()
        : null,
    reversesSeq: safeInt(raw.reverses_seq, 1),
    reversesTransactionId:
      typeof raw.reverses_transaction_id === 'string' && UUID.test(raw.reverses_transaction_id)
        ? raw.reverses_transaction_id.toLowerCase()
        : null,
  };
}

interface MediaRow {
  media_id: string | null;
  wallet_id: string | null;
  status: string;
  batch_status: string | null;
  uid: Buffer | null;
  counter_last: string;
  originality_sig_sha256: Buffer | null;
}

export class OfflineRulesRunner {
  /** Faits communs à toutes les opérations du lot (lus une fois). */
  async prepare(
    tx: TxClient,
    deviceId: string,
    serial: string,
    receivedAt: Date,
  ): Promise<RulesEnv> {
    const { rows } = await tx.query<{
      event_id: string;
      status: string | null;
      currency: string | null;
      terminal_settings: Record<string, unknown> | null;
      edge_terms: Record<string, unknown> | null;
      policy_in_force: RulesEnv['policyInForce'] | null;
    }>(
      `SELECT m.event_id, e.status, e.currency, e.terminal_settings, e.edge_terms, e.policy_in_force
         FROM edge_meta m LEFT JOIN edge_event_setting e ON true`,
    );
    const r = rows[0];
    if (!r) throw new Error('edge_meta absent : passerelle non enrôlée');
    return {
      deviceId,
      serial,
      eventId: r.event_id,
      receivedAt,
      eventStatus: r.status ?? 'UNKNOWN',
      eventCurrency: r.currency,
      // Ordre de dépense répliqué (décision 45, ADR-185), le même que celui du rejeu central.
      promoFirst: (r.edge_terms?.spend_order ?? r.terminal_settings?.spend_order) !== 'PAID_FIRST',
      policyInForce: Array.isArray(r.policy_in_force) ? r.policy_in_force : [],
    };
  }

  async evaluate(tx: TxClient, env: RulesEnv, op: ReceivedOperation): Promise<LocalVerdict> {
    const raw = op.raw;
    const fields = readFields(raw);
    const type: OperationType = op.type;

    // C-006 : aucune recharge en espèces hors ligne, quelle que soit la confirmation. Aucun delta.
    if (type === 'TOPUP_CASH') return rejected('OFFLINE_NOT_ALLOWED', ['TOPUP_CASH']);
    // Numéro consommé sans effet comptable, ou référence à une opération en ligne : le central tranche.
    if (type === 'VOID' || type === 'ONLINE_REF') {
      return { ...rejected('MALFORMED_OPERATION'), status: 'ACCEPTED', rejectReason: null };
    }

    if (fields.occurredAt === null || fields.tapMalformed) return rejected('MALFORMED_OPERATION');
    if (type === 'PURCHASE' && (fields.amount === null || fields.currency === null || !fields.tap))
      return rejected('MALFORMED_OPERATION');
    if (type === 'REVERSAL' && fields.reversesSeq === null && fields.reversesTransactionId === null)
      return rejected('MALFORMED_OPERATION');

    // Snapshot cité (version, génération, enveloppe pour CE terminal) puis heure corrigée.
    const snapshot = await this.snapshot(tx, env, fields.snapshotVersion);
    let corrected: Date;
    try {
      ({ corrected } = resolveOfflineTime(
        fields.occurredAt,
        env.receivedAt,
        snapshot?.generatedAt ?? null,
        TOLERANCE_MS,
      ));
    } catch {
      return rejected('MALFORMED_OPERATION');
    }

    // Cible d'une annulation : vente de CE terminal seulement.
    const target = type === 'REVERSAL' ? await this.reversalTarget(tx, env, fields) : null;
    const tokenHash =
      fields.tap?.tokenHash ?? (target?.mediaId ? await this.tokenOf(tx, target.mediaId) : null);
    const media = tokenHash ? await this.media(tx, tokenHash) : null;

    const input = await this.complianceInput(tx, env, {
      type,
      seq: op.seq,
      fields,
      snapshot,
      media,
      target,
      corrected,
      tokenHash,
    });
    const verdict = checkCompliance(input);
    if (!verdict.ok)
      return rejected(verdict.reason, verdict.detail, { amount: fields.amount ?? 0n });

    const period = checkPeriod({
      occurredAt: corrected,
      lockedUntil: null,
      ledgerStatus: 'ACTIVE',
      eventStatus: env.eventStatus,
      type,
    });
    if (!period.ok) return rejected(period.reason, [], { amount: fields.amount ?? 0n });

    if (type === 'REVERSAL') {
      // `target` existe et n'est pas annulée (contrôle 10 passé).
      const t = target!;
      return {
        ...rejected('MALFORMED_OPERATION'),
        status: 'ACCEPTED',
        rejectReason: null,
        amount: t.amount,
        covered: t.paid + t.promo,
        paid: t.paid,
        promo: t.promo,
        walletId: t.walletId,
        mediaId: t.mediaId,
        reverses: t.seq,
        deltas:
          t.walletId && t.paid + t.promo > 0n
            ? [{ walletId: t.walletId, paidDelta: t.paid, promoDelta: t.promo }]
            : [],
      };
    }
    return this.sale(tx, env, fields, snapshot!, media, corrected);
  }

  // ------------------------------------------------------------------------------------------ vente

  private async sale(
    tx: TxClient,
    env: RulesEnv,
    fields: Fields,
    snapshot: SnapshotFacts,
    media: MediaRow | null,
    corrected: Date,
  ): Promise<LocalVerdict> {
    const amount = fields.amount!;
    const tapResult = this.tapResult(fields, media);
    const walletId = media?.wallet_id ?? null;
    let spendable = 0n;
    let balances = { paid: 0n, promo: 0n };
    let walletStatus = 'ACTIVE';
    if (walletId !== null) {
      balances = await readEffectiveBalance(tx, walletId);
      spendable = balances.paid + balances.promo;
      walletStatus = await this.walletStatus(tx, walletId);
    }
    const outcome = conflictOutcome({
      tapResult: media === null || walletId === null ? 'UNKNOWN' : tapResult,
      amount,
      spendable,
      walletStatus,
      // Blocage répliqué sans date : traité comme bloqué avant la vente (part couverte nulle).
      blockTime: 'UNKNOWN',
      occurredAt: corrected,
      snapshotGeneratedAt: snapshot.generatedAt,
      tolMs: TOLERANCE_MS,
    });
    if (outcome.kind === 'REJECT') return rejected(outcome.reason, [], { amount, tapResult });
    const split = spendSplit({
      amount,
      promoBalance: balances.promo,
      paidBalance: balances.paid,
      promoFirst: env.promoFirst,
      mode: 'OFFLINE',
      coveredCap: outcome.covered,
    });
    const covered = split.fromPaid + split.fromPromo;
    return {
      ...rejected('MALFORMED_OPERATION'),
      status: outcome.shortfall > 0n ? 'ACCEPTED_WITH_SHORTFALL' : 'ACCEPTED',
      rejectReason: null,
      tapResult,
      amount,
      covered,
      shortfall: amount - covered,
      shortfallReason: outcome.shortfall > 0n ? (outcome.shortfallReason ?? null) : null,
      paid: split.fromPaid,
      promo: split.fromPromo,
      walletId,
      mediaId: media?.media_id ?? null,
      deltas:
        walletId !== null && covered > 0n
          ? [{ walletId, paidDelta: -split.fromPaid, promoDelta: -split.fromPromo }]
          : [],
    };
  }

  /** Résultat de lecture, depuis la copie répliquée (jamais d'écriture, jamais d'état plus favorable). */
  private tapResult(fields: Fields, media: MediaRow | null): TapResult {
    const tap = fields.tap!;
    if (media === null || media.media_id === null) return 'UNKNOWN';
    if (media.wallet_id === null) return 'NOT_ACTIVATED';
    if (media.uid !== null && !media.uid.equals(tap.uid)) return 'UID_MISMATCH';
    if (media.originality_sig_sha256 !== null) {
      if (tap.signature === null) return 'SIGNATURE_MISSING';
      const sha = createHash('sha256').update(tap.signature).digest();
      if (!sha.equals(media.originality_sig_sha256)) return 'SIGNATURE_MISMATCH';
    }
    if (BigInt(tap.counter) <= BigInt(media.counter_last) && BigInt(media.counter_last) > 0n)
      return 'CLONE_SUSPECTED';
    switch (media.status) {
      case 'ACTIVE':
        break;
      case 'RETIRED':
      case 'REPLACED':
      case 'RELEASED':
        return media.status;
      case 'SUSPENDED':
      case 'BLACKLISTED':
      default:
        return 'BLOCKED';
    }
    if (media.batch_status !== null && media.batch_status !== 'ACTIVE') return 'BATCH_INACTIVE';
    return 'OK';
  }

  // -------------------------------------------------------------------------------- lecture des faits

  private async snapshot(
    tx: TxClient,
    env: RulesEnv,
    version: bigint | null,
  ): Promise<SnapshotFacts | null> {
    if (version === null) return null;
    const { rows } = await tx.query<{
      version: string;
      header: { generated_at: string; valid_until: string };
      created_at: Date;
      wrapped: boolean;
    }>(
      `SELECT s.version, s.header, s.created_at,
              EXISTS (SELECT 1 FROM edge_snapshot_key k
                       WHERE k.version = s.version AND k.device_id = $2) AS wrapped
         FROM edge_snapshot s WHERE s.version = $1::bigint`,
      [version.toString(), env.deviceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      version,
      generatedAt: new Date(r.header.generated_at),
      validUntil: new Date(r.header.valid_until),
      registeredAt: r.created_at,
      wrapped: r.wrapped,
    };
  }

  private async media(tx: TxClient, tokenHash: Buffer): Promise<MediaRow | null> {
    const { rows } = await tx.query<MediaRow>(
      `SELECT media_id, wallet_id, status, batch_status, uid, counter_last, originality_sig_sha256
         FROM edge_media WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  private async tokenOf(tx: TxClient, mediaId: string): Promise<Buffer | null> {
    const { rows } = await tx.query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM edge_media WHERE media_id = $1 ORDER BY token_hash LIMIT 1',
      [mediaId],
    );
    return rows[0]?.token_hash ?? null;
  }

  private async walletStatus(tx: TxClient, walletId: string): Promise<string> {
    const { rows } = await tx.query<{ status: string }>(
      `SELECT COALESCE(
                (SELECT s.status FROM edge_wallet_state s WHERE s.wallet_id = $1),
                (SELECT w.status FROM edge_wallet w WHERE w.wallet_id = $1)) AS status`,
      [walletId],
    );
    return rows[0]?.status ?? 'BLOCKED';
  }

  private async reversalTarget(
    tx: TxClient,
    env: RulesEnv,
    fields: Fields,
  ): Promise<TargetFacts | null> {
    // Une vente locale n'a pas d'identifiant de transaction centrale : seule la clé `reverses_seq` ouvre.
    if (fields.reversesSeq === null) return null;
    const { rows } = await tx.query<{
      seq: string;
      wallet_id: string | null;
      media_id: string | null;
      amount: string;
      paid_covered: string;
      promo_covered: string;
      reversed_by_seq: string | null;
    }>(
      `SELECT seq, wallet_id, media_id, amount, paid_covered, promo_covered, reversed_by_seq
         FROM edge_offline_op_result
        WHERE device_id = $1 AND seq = $2::bigint AND type = 'PURCHASE'
          AND status IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL')`,
      [env.deviceId, fields.reversesSeq.toString()],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      seq: Number(r.seq),
      walletId: r.wallet_id,
      mediaId: r.media_id,
      amount: BigInt(r.amount),
      paid: BigInt(r.paid_covered),
      promo: BigInt(r.promo_covered),
      alreadyReversed: r.reversed_by_seq !== null,
    };
  }

  private async complianceInput(
    tx: TxClient,
    env: RulesEnv,
    args: {
      type: OperationType;
      seq: number;
      fields: Fields;
      snapshot: SnapshotFacts | null;
      media: MediaRow | null;
      target: TargetFacts | null;
      corrected: Date;
      tokenHash: Buffer | null;
    },
  ): Promise<ComplianceInput> {
    const { fields, snapshot, media, target, corrected } = args;
    const reversal = args.type === 'REVERSAL';
    const at = corrected;

    // Terminal : copie locale (le garde a déjà refusé un terminal révoqué ou suspendu).
    const dev = await tx.query<{ status: string }>(
      'SELECT status FROM edge_device WHERE device_id = $1',
      [env.deviceId],
    );

    // Configuration citée, parmi l'historique répliqué des politiques effectives de CE terminal.
    const cited = env.policyInForce.find(
      (c) =>
        c.device_id === env.deviceId &&
        fields.configId !== null &&
        BigInt(c.config_id) === fields.configId,
    );
    const cfg = cited
      ? {
          configId: fields.configId!.toString(),
          offlineEnabled: cited.offline_policy.offline_enabled === true,
          maxPerSale: BigInt(Number(cited.offline_policy.max_per_sale ?? 0)),
          maxPerMedia: BigInt(Number(cited.offline_policy.max_per_media_per_device ?? 0)),
          maxPerDevice: BigInt(Number(cited.offline_policy.max_total_per_device ?? 0)),
        }
      : null;
    const maxAgeMs = Number(cited?.offline_policy.max_snapshot_age_seconds ?? 0) * 1000;

    // Session de vendeur ouverte à l'heure de l'opération.
    let vendorSessionOpen = false;
    if (fields.vendorSessionId !== null) {
      const s = await tx.query(
        `SELECT 1 FROM edge_vendor_session
          WHERE vendor_session_id = $1 AND device_id = $2 AND expires_at > $3
            AND (closed_at IS NULL OR closed_at > $3)`,
        [fields.vendorSessionId, env.deviceId, at],
      );
      vendorSessionOpen = (s.rowCount ?? 0) > 0;
    }

    // Plancher d'accusé : dernière version accusée avant `occurred − tol`.
    const floor = await tx.query<{ f: string | null }>(
      `SELECT max(version) AS f FROM edge_snapshot_ack WHERE device_id = $1 AND acked_at <= $2`,
      [env.deviceId, new Date(at.getTime() - TOLERANCE_MS)],
    );

    // État du bracelet À LA VERSION CITÉE (jamais l'état courant) : dernier FULL <= v, puis ses DELTA.
    let mediaAtVersion: ComplianceInput['mediaAtVersion'] = {
      present: false,
      mediaUsable: false,
      batchUsable: false,
      walletUsable: false,
      batchBelongsToEvent: false,
    };
    const targetLost = reversal && target === null && fields.tap === null;
    if (targetLost) {
      mediaAtVersion = {
        present: true,
        mediaUsable: true,
        batchUsable: true,
        walletUsable: true,
        batchBelongsToEvent: true,
      };
    } else if (args.tokenHash !== null && snapshot !== null) {
      const st = await tx.query<{ entry: Record<string, unknown>; removed: boolean }>(
        `SELECT e.entry, e.removed FROM edge_snapshot_entry e
          WHERE e.token_hash = $1 AND e.version <= $2::bigint
            AND e.version >= COALESCE((SELECT max(f.version) FROM edge_snapshot f
                                        WHERE f.kind = 'FULL' AND f.version <= $2::bigint), 0)
          ORDER BY e.version DESC LIMIT 1`,
        [args.tokenHash, snapshot.version.toString()],
      );
      const s = st.rows[0];
      if (s && !s.removed) {
        mediaAtVersion = {
          present: true,
          mediaUsable: s.entry.status === 'ACTIVE',
          batchUsable: s.entry.batch_status === null || s.entry.batch_status === 'ACTIVE',
          walletUsable: s.entry.wallet_status === 'ACTIVE',
          batchBelongsToEvent:
            s.entry.batch_event_id === null || s.entry.batch_event_id === env.eventId,
        };
      }
    }

    // Exposition cumulée (R-30.3) : opérations de numéro inférieur de ce terminal, acceptées, non annulées,
    // dont le résultat n'a pas été rendu avant `min(occurred_corrigé, reçu) − tol`.
    let exposure = { mediaCumulative: 0n, deviceCumulative: 0n };
    if (args.type === 'PURCHASE') {
      const reference = new Date(Math.min(at.getTime(), env.receivedAt.getTime()) - TOLERANCE_MS);
      const ex = await tx.query<{ per_media: string; per_device: string }>(
        `SELECT COALESCE(sum(amount) FILTER (WHERE media_id = $2::uuid), 0)::text AS per_media,
                COALESCE(sum(amount), 0)::text AS per_device
           FROM edge_offline_op_result
          WHERE device_id = $1 AND type = 'PURCHASE' AND seq < $3::bigint
            AND status IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL')
            AND reversed_by_seq IS NULL AND rendered_at >= $4`,
        [env.deviceId, media?.media_id ?? null, args.seq, reference],
      );
      exposure = {
        mediaCumulative: BigInt(ex.rows[0]!.per_media),
        deviceCumulative: BigInt(ex.rows[0]!.per_device),
      };
    }

    const declared = fields.currency ?? (reversal ? env.eventCurrency : null);
    return {
      exempt: false,
      type: args.type,
      amount: fields.amount ?? 0n,
      occurredAtCorrected: corrected,
      tolMs: TOLERANCE_MS,
      // Un seul grand livre par passerelle : un bracelet rattaché a la devise de l'événement.
      walletCurrency: media?.wallet_id ? env.eventCurrency : declared,
      eventCurrency: env.eventCurrency,
      device: { statusAtOccurred: dev.rows[0]?.status ?? null, vendorSessionOpen },
      tapConfigId: fields.configId === null ? null : fields.configId.toString(),
      configInForce: cfg,
      exposure,
      snapshot:
        snapshot === null
          ? null
          : {
              version: snapshot.version,
              registeredAt: snapshot.registeredAt,
              envelopedForDevice: snapshot.wrapped,
              generatedAt: snapshot.generatedAt,
              validUntil: snapshot.validUntil,
              maxSnapshotAgeMs: maxAgeMs,
            },
      ackFloor: BigInt(floor.rows[0]?.f ?? '0'),
      mediaAtVersion,
      packVerified: fields.tap === null ? (reversal ? true : null) : fields.tap.packVerified,
      reversalTarget: reversal
        ? { foundOnThisDevice: target !== null, alreadyReversed: target?.alreadyReversed ?? false }
        : null,
    };
  }
}

interface SnapshotFacts {
  version: bigint;
  generatedAt: Date;
  validUntil: Date;
  registeredAt: Date;
  wrapped: boolean;
}

interface TargetFacts {
  seq: number;
  walletId: string | null;
  mediaId: string | null;
  amount: bigint;
  paid: bigint;
  promo: bigint;
  alreadyReversed: boolean;
}
