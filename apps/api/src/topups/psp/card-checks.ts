// Contrôles d'une recharge par carte (mission 6, lot WP11, T057 ; FR-024, FR-025, FR-026 ; A11, A12). Appelés
// par `PspPaymentProcessor` AVANT le crédit, sous le verrou de la recharge :
//   1. 3-D Secure : seul `SUCCEEDED` explicite crédite (`FAILED`, `NOT_PERFORMED`, absent : refus) ;
//   2. empreinte présente et non vide (la carte n'est jamais reçue : seule l'empreinte opaque l'est) ;
//   3. plafond par carte et par jour UTC de `receivedAt` : `card_topups_today` prend le verrou consultatif de
//      la carte (tenu jusqu'à la fin de la transaction, qui contient aussi le crédit : deux notifications
//      simultanées de la même carte sont sérialisées), puis somme + montant contre
//      `card_topup_daily_max_per_card` ; dépassement STRICT refusé, égalité acceptée.
// La base refait le même contrôle à la complétion (`complete_card_topup`) : le plus strict des deux gagne.
// L'empreinte n'est ni journalisée ni auditée par ce fichier.
import { Injectable } from '@nestjs/common';
import { CascadeService } from '../../configuration/cascade.service';
import type { TxClient } from '../../db/tenant-tx';
import type { NormalizedCard } from '../../psp/psp.types';
import type { AnomalyKind, FailureReason } from './psp-refusals';
import type { PspTopupRow } from './psp-topup-lookup';

export type CardVerdict =
  | { ok: true; fingerprint: string }
  | {
      ok: false;
      reason: FailureReason;
      anomalyKind: AnomalyKind;
      fingerprint: string | null;
      threeDs: NormalizedCard['threeDs'] | null;
    };

export interface CardVelocity {
  /** Empreinte inconnue de ce portefeuille avant ce crédit. */
  isNew: boolean;
  /** Empreintes distinctes du portefeuille, ce crédit compris. */
  distinctCards: number;
  alertThreshold: number;
}

function settingAsBigint(value: unknown, name: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`réglage ${name} : entier attendu`);
}

@Injectable()
export class CardChecks {
  constructor(private readonly cascade: CascadeService) {}

  async check(
    client: TxClient,
    topup: PspTopupRow,
    card: NormalizedCard | null,
    receivedAt: Date,
  ): Promise<CardVerdict> {
    const fingerprint = card?.fingerprint?.trim() ? card.fingerprint : null;
    const refused = (
      reason: FailureReason,
      anomalyKind: AnomalyKind = 'PSP_TOPUP_NOT_CREDITED',
    ): CardVerdict => ({
      ok: false,
      reason,
      anomalyKind,
      fingerprint,
      threeDs: card?.threeDs ?? null,
    });
    if (card === null || card.threeDs !== 'SUCCEEDED') return refused('THREE_DS');
    if (fingerprint === null) return refused('NO_FINGERPRINT');
    const view = await this.cascade.resolveForEvent(client, topup.eventId, receivedAt);
    const max = settingAsBigint(
      view.card_topup_daily_max_per_card?.value,
      'card_topup_daily_max_per_card',
    );
    const { rows } = await client.query<{ today: string }>(
      'SELECT card_topups_today($1, $2, $3)::text AS today',
      [topup.ledgerId, fingerprint, receivedAt.toISOString()],
    );
    const today = BigInt(rows[0]!.today);
    if (today + topup.amount > max) return refused('CARD_DAILY_LIMIT', 'PSP_TOPUP_OVER_LIMIT');
    return { ok: true, fingerprint };
  }

  /** À lire AVANT le crédit : après lui, l'empreinte est connue du portefeuille. */
  async velocity(
    client: TxClient,
    topup: PspTopupRow,
    fingerprint: string,
    receivedAt: Date,
  ): Promise<CardVelocity> {
    const { rows } = await client.query<{ distinct_cards: number; is_new: boolean }>(
      'SELECT distinct_cards, is_new FROM wallet_card_count($1, $2)',
      [topup.walletId, fingerprint],
    );
    const view = await this.cascade.resolveForEvent(client, topup.eventId, receivedAt);
    const threshold = settingAsBigint(
      view.card_alert_cards_per_wallet?.value,
      'card_alert_cards_per_wallet',
    );
    return {
      isNew: rows[0]!.is_new,
      distinctCards: rows[0]!.distinct_cards,
      alertThreshold: Number(threshold),
    };
  }
}
