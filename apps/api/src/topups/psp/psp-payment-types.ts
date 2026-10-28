// Types du contrat de service « traitement d'un paiement PSP » (mission 6, lot WP11, T056) : lus par WP12
// (réception, travailleur) et WP13 (contestations). Noms et formes à ne pas renommer.
import type { NormalizedNotification } from '../../psp/psp.types';

export interface PaymentInput {
  configurationId: string;
  origin: 'NOTIFICATION' | 'POLL';
  /** Heure de réception : seule date du traitement (jour UTC de la carte, `occurredAt` du crédit). */
  receivedAt: Date;
  pspEventId: string | null;
  notification: NormalizedNotification;
}

export interface UnpaidInput {
  configurationId: string;
  topupId: string;
  verdict: 'FAILED' | 'EXPIRED';
  observedAt: Date;
}

/** Valeurs de `psp_event.outcome` (`CHARGEBACK` est à WP13). */
export type PaymentResult =
  | 'CREDITED'
  | 'NOT_CREDITED'
  | 'MISMATCH'
  | 'DUPLICATE_PAYMENT'
  | 'NO_EFFECT';

export interface PaymentOutcome {
  disposition: 'PROCESSED' | 'UNMATCHED';
  outcome: PaymentResult | null;
  topupId: string | null;
  walletId: string | null;
  operatorId: string;
  depositDue: boolean;
}
