// Références inconnues à la reprise forcée (mission 8, lot WP14 ; research R-23, décision 4 du porteur).
// Appelé par le processeur de la mission 7 AVANT les issues `ONLINE_REF` (VOID / ONLINE_NOT_EXECUTED) et `TOPUP_CASH`
// (REJECTED / OFFLINE_NOT_ALLOWED) : il n'en change JAMAIS le résultat, il ajoute l'anomalie qui rend visible ce que la
// passerelle perdue n'a pas rejoué. Hors reprise forcée : aucune écriture, comportement d'avant strictement conservé.
import { lossBearer as lossBearerOf } from '@cashless/shared-rules';
import type { TxClient } from '../../db/tenant-tx';
import { deviceKey } from '../../idempotency/device-key';
import { openEdgeReplayAnomaly } from '../../edge/journal/edge-replay-anomaly';
import { findForcedTakeover, originKeyKnown } from '../../edge/journal/forced-takeover';
import { openAnomaly } from '../anomalies/anomaly-writer';
import type { BatchContext, ParsedOperation } from '../batches/batch.types';
import { readFields } from './operation-input';

type Kind = 'ACTIVATION' | 'DEPOSIT';

/** `online_operation` d'une `ONLINE_REF` de guichet : operationId du contrat ou nom du type de guichet. */
const KINDS: Record<string, Kind> = {
  activateMedia: 'ACTIVATION',
  ACTIVATION: 'ACTIVATION',
  takeDeposit: 'DEPOSIT',
  DEPOSIT: 'DEPOSIT',
  DEPOSIT_CASH: 'DEPOSIT',
};

const parseDate = (text: string | null): Date | null => {
  if (text === null) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * `ONLINE_REF` d'une activation ou d'une caution que le central ne connaît pas, dans une reprise forcée : ouvre
 * `EDGE_REPLAY_FAILED` (une seule par clé d'origine) et rend son identifiant ; sinon `null`, sans rien écrire.
 */
export async function resolveOnlineRef(
  client: TxClient,
  ctx: BatchContext,
  op: ParsedOperation,
  providedBy: Parameters<typeof lossBearerOf>[0],
): Promise<string | null> {
  const onlineOperation = op.raw.online_operation;
  const kind = typeof onlineOperation === 'string' ? KINDS[onlineOperation] : undefined;
  if (op.type !== 'ONLINE_REF' || kind === undefined) return null;
  const fields = readFields(op);
  const base = deviceKey(ctx.serial, op.seq);
  // Critère 1. L'activation n'est connue que par sa propre clé ; une caution l'est aussi par `#deposit` (caution
  // d'une activation). La clé de la caution ne fait jamais croire que l'activation a été rejouée.
  const keys = kind === 'ACTIVATION' ? [base] : [base, `${base}#deposit`];
  if (await originKeyKnown(client, ctx, keys)) return null;
  // Critères 2 et 3.
  const takeover = await findForcedTakeover(client, ctx, parseDate(fields.occurredAt));
  if (takeover === null) return null;
  let mediaId: string | null = null;
  if (fields.tap !== null) {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM media WHERE token_hash = $1',
      [fields.tap.tokenHash],
    );
    mediaId = rows[0]?.id ?? null;
  }
  return openEdgeReplayAnomaly(client, {
    operatorId: ctx.operatorId,
    ledgerId: ctx.ledgerId,
    deviceId: ctx.deviceId,
    seq: op.seq,
    batchId: ctx.batchId,
    originKey: base,
    gatewayId: takeover.gatewayId,
    recoveryId: takeover.handoverId,
    mediaId,
    amount: fields.amount,
    lossBearer: lossBearerOf(providedBy),
    operation: kind,
  });
}

/**
 * `TOPUP_CASH` du journal d'un terminal d'une passerelle perdue : le refus existant est conservé ; cette fonction ouvre
 * AVANT lui l'anomalie `NON_COMPLIANT_OPERATION` (même clé d'idempotence que celle du refus, qui la retrouve) en y
 * ajoutant la clé d'origine et le lot de reprise. Hors reprise forcée : rien, le refus ouvre son anomalie ordinaire.
 */
export async function resolveForcedTopup(
  client: TxClient,
  ctx: BatchContext,
  op: ParsedOperation,
  providedBy: Parameters<typeof lossBearerOf>[0],
): Promise<string | null> {
  if (op.type !== 'TOPUP_CASH') return null;
  const fields = readFields(op);
  const base = deviceKey(ctx.serial, op.seq);
  if (await originKeyKnown(client, ctx, [base])) return null;
  const takeover = await findForcedTakeover(client, ctx, parseDate(fields.occurredAt));
  if (takeover === null) return null;
  return openAnomaly(client, {
    ledgerId: ctx.ledgerId,
    kind: 'NON_COMPLIANT_OPERATION',
    deviceId: ctx.deviceId,
    seq: op.seq,
    amount: fields.amount ?? 0n,
    batchId: ctx.batchId,
    lossBearer: lossBearerOf(providedBy),
    detail: {
      codes: ['TOPUP_CASH'],
      source: 'DEVICE_JOURNAL',
      origin_key: base,
      recovery_id: takeover.handoverId,
      edge_gateway_id: takeover.gatewayId,
      amount_known: fields.amount !== null,
    },
  });
}
