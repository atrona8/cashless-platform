// Recherche d'une recharge PSP sous verrou (mission 6, lot WP11, T056 ; A2, A13) : contrat de service lu par
// WP12 et WP13. Corrélation d'abord par la référence marchande (= `psp_topup_id`), puis par la référence du PSP,
// TOUJOURS dans la configuration qui a authentifié la notification (isolation entre fournisseurs et
// organisateurs : une référence d'une autre configuration ne correspond à rien).
//
// Verrou : `cashless_app` n'a que `SELECT` sur `psp_topup` (post-roles.sql 7a), donc `SELECT ... FOR UPDATE`
// est refusé (`42501`). Le verrou de ligne est remplacé par un verrou consultatif de transaction sur
// l'identifiant de la recharge, pris AVANT toute lecture de solde (ordre : recharge, portefeuille, comptes). Il
// sérialise tous les chemins qui passent par ici (traitement, annulation, contestation, interrogation) ; les
// fonctions de la base prennent en plus leur propre `FOR UPDATE` à l'intérieur. Aucun droit n'est élargi.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PspTopupRow {
  topupId: string;
  operatorId: string;
  ledgerId: string;
  eventId: string;
  walletId: string;
  configurationId: string;
  method: 'WAVE' | 'ORANGE_MONEY' | 'CARD';
  provider: string;
  amount: bigint;
  currency: string;
  feeAmount: bigint | null;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  providerPaymentRef: string | null;
  expiresAt: Date;
  requestedByKind: 'DESK' | 'CUSTOMER';
  deviceId: string | null;
  personId: string | null;
  customerId: string | null;
  cardFingerprint: string | null;
  threeDs: string | null;
  topupTxId: string | null;
  failureReason: string | null;
  anomalyId: string | null;
  createdAt: Date;
  succeededAt: Date | null;
}

interface Raw {
  psp_topup_id: string;
  operator_id: string;
  ledger_id: string;
  event_id: string;
  wallet_id: string;
  psp_configuration_id: string;
  method: PspTopupRow['method'];
  provider: string;
  amount: string;
  currency: string;
  fee_amount: string | null;
  status: PspTopupRow['status'];
  provider_payment_ref: string | null;
  expires_at: Date;
  requested_by_kind: PspTopupRow['requestedByKind'];
  device_id: string | null;
  person_id: string | null;
  customer_id: string | null;
  card_fingerprint: string | null;
  three_ds: string | null;
  topup_tx_id: string | null;
  failure_reason: string | null;
  anomaly_id: string | null;
  created_at: Date;
  succeeded_at: Date | null;
}

const COLUMNS = `psp_topup_id, operator_id, ledger_id, event_id, wallet_id, psp_configuration_id, method,
  provider, amount::text AS amount, currency, fee_amount::text AS fee_amount, status,
  provider_payment_ref, expires_at, requested_by_kind, device_id, person_id, customer_id,
  card_fingerprint, three_ds, topup_tx_id, failure_reason, anomaly_id, created_at, succeeded_at`;

function toRow(raw: Raw): PspTopupRow {
  return {
    topupId: raw.psp_topup_id,
    operatorId: raw.operator_id,
    ledgerId: raw.ledger_id,
    eventId: raw.event_id,
    walletId: raw.wallet_id,
    configurationId: raw.psp_configuration_id,
    method: raw.method,
    provider: raw.provider,
    amount: BigInt(raw.amount),
    currency: raw.currency.trim(),
    feeAmount: raw.fee_amount === null ? null : BigInt(raw.fee_amount),
    status: raw.status,
    providerPaymentRef: raw.provider_payment_ref,
    expiresAt: raw.expires_at,
    requestedByKind: raw.requested_by_kind,
    deviceId: raw.device_id,
    personId: raw.person_id,
    customerId: raw.customer_id,
    cardFingerprint: raw.card_fingerprint,
    threeDs: raw.three_ds,
    topupTxId: raw.topup_tx_id,
    failureReason: raw.failure_reason,
    anomalyId: raw.anomaly_id,
    createdAt: raw.created_at,
    succeededAt: raw.succeeded_at,
  };
}

export interface TopupReference {
  configurationId: string;
  merchantRef?: string | null;
  providerRef?: string | null;
}

@Injectable()
export class PspTopupLookup {
  /** La recharge sous verrou (relue après le verrou), ou `null` si aucune ne correspond. */
  async findForUpdate(client: TxClient, ref: TopupReference): Promise<PspTopupRow | null> {
    const id = await this.resolveId(client, ref);
    if (id === null) return null;
    await this.lock(client, id);
    return this.read(client, id);
  }

  /** Verrou de la recharge, par identifiant (annulation, suivi : l'identifiant vient de la route). */
  async lock(client: TxClient, topupId: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `psp-topup:${topupId}`,
    ]);
  }

  /** Lecture simple, sans verrou (suivi par le demandeur). */
  async find(client: TxClient, topupId: string): Promise<PspTopupRow | null> {
    return UUID.test(topupId) ? this.read(client, topupId) : null;
  }

  private async read(client: TxClient, id: string): Promise<PspTopupRow | null> {
    const { rows } = await client.query<Raw>(
      `SELECT ${COLUMNS} FROM psp_topup WHERE psp_topup_id = $1`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  private async resolveId(client: TxClient, ref: TopupReference): Promise<string | null> {
    if (ref.merchantRef && UUID.test(ref.merchantRef)) {
      const { rows } = await client.query<{ psp_topup_id: string }>(
        'SELECT psp_topup_id FROM psp_topup WHERE psp_topup_id = $1 AND psp_configuration_id = $2',
        [ref.merchantRef, ref.configurationId],
      );
      if (rows[0]) return rows[0].psp_topup_id;
    }
    if (ref.providerRef) {
      const { rows } = await client.query<{ psp_topup_id: string }>(
        `SELECT psp_topup_id FROM psp_topup
          WHERE psp_configuration_id = $1 AND provider_payment_ref = $2`,
        [ref.configurationId, ref.providerRef],
      );
      if (rows[0]) return rows[0].psp_topup_id;
    }
    return null;
  }
}
