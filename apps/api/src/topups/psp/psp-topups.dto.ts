// Corps de `POST /topups/psp` (`initiatePspTopup`, contrat `PspTopupRequest`, lot WP11, T054) et réponse
// `PspTopup`. Tout champ inconnu est refusé (422). Le champ `provider` du corps désigne le MOYEN
// (`WAVE|ORANGE_MONEY|CARD`) dans le contrat, alors que le schéma de la base nomme `method` le moyen et
// `provider` le fournisseur : le contrat est appliqué, l'ambiguïté est signalée dans le compte rendu du lot.
import { PSP_METHODS, type PspMethod } from '../../psp-configurations/psp-configurations.dto';
import {
  amountField,
  intField,
  invalid,
  isUuid,
  objectBody,
} from '../../organization/platform/platform.dto';
import type { PspTopupRow } from './psp-topup-lookup';

const FIELDS = new Set([
  'wallet_id',
  'tap_id',
  'amount',
  'currency',
  'provider',
  'payer_msisdn',
  'return_url',
]);
const MSISDN = /^\+[1-9][0-9]{6,14}$/;

export interface PspTopupInput {
  walletId: string | null;
  tapId: number | null;
  amount: bigint;
  currency: string;
  method: PspMethod;
  payerMsisdn: string | null;
  returnUrl: string | null;
}

export function parsePspTopupRequest(raw: unknown): PspTopupInput {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((key) => !FIELDS.has(key));
  if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
  const walletId = body.wallet_id;
  if (walletId !== undefined && !isUuid(walletId)) throw invalid('wallet_id : UUID attendu.');
  const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional');
  if ((walletId === undefined) === (tapId === undefined))
    throw invalid('wallet_id ou tap_id : exactement un des deux attendu.');
  const amount = amountField(body, 'amount', false);
  if (amount === undefined || amount === null) throw invalid('Champ obligatoire : amount.');
  if (BigInt(amount) <= 0n) throw invalid('amount : montant strictement positif attendu.');
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))
    throw invalid('currency : devise ISO 4217 attendue.');
  if (
    typeof body.provider !== 'string' ||
    !(PSP_METHODS as readonly string[]).includes(body.provider)
  )
    throw invalid(`provider : valeurs permises ${PSP_METHODS.join(', ')}.`);
  const msisdn = body.payer_msisdn;
  if (msisdn !== undefined && (typeof msisdn !== 'string' || !MSISDN.test(msisdn)))
    throw invalid('payer_msisdn : numéro international attendu (+ et 7 à 15 chiffres).');
  const returnUrl = body.return_url;
  if (returnUrl !== undefined) {
    let scheme: string | null = null;
    try {
      scheme = typeof returnUrl === 'string' ? new URL(returnUrl).protocol : null;
    } catch {
      scheme = null;
    }
    if (
      typeof returnUrl !== 'string' ||
      returnUrl.length > 2000 ||
      (scheme !== 'https:' && scheme !== 'cashless:')
    )
      throw invalid('return_url : URL en https: ou cashless: attendue.');
  }
  return {
    walletId: (walletId as string | undefined) ?? null,
    tapId: tapId ?? null,
    amount: BigInt(amount),
    currency: body.currency,
    method: body.provider as PspMethod,
    payerMsisdn: (msisdn as string | undefined) ?? null,
    returnUrl: (returnUrl as string | undefined) ?? null,
  };
}

export interface PspTopupView {
  topup_id: string;
  status: PspTopupRow['status'];
  provider: PspMethod;
  psp_config_id: string;
  provider_reference: string | null;
  amount: number;
  currency: string;
  wallet_id: string;
  checkout_url: string | null;
  /** Instruction de paiement (adaptateur sans redirection) ; absente sinon. */
  payment_instruction?: string;
  expires_at: string;
  transaction_id: string | null;
  failure_reason?: string;
  /** Frais estimés, seulement si le festivalier les supporte (`psp_fee_bearer = CUSTOMER`). */
  estimated_fee?: number;
}

export interface PspTopupExtras {
  action: { kind: 'REDIRECT'; url: string } | { kind: 'INSTRUCTION'; text: string } | null;
  estimatedFee: bigint | null;
}

export function topupView(row: PspTopupRow, extras?: Partial<PspTopupExtras>): PspTopupView {
  const action = extras?.action ?? null;
  return {
    topup_id: row.topupId,
    status: row.status,
    provider: row.method,
    psp_config_id: row.configurationId,
    provider_reference: row.providerPaymentRef,
    amount: Number(row.amount),
    currency: row.currency,
    wallet_id: row.walletId,
    checkout_url: action?.kind === 'REDIRECT' ? action.url : null,
    ...(action?.kind === 'INSTRUCTION' ? { payment_instruction: action.text } : {}),
    expires_at: row.expiresAt.toISOString(),
    transaction_id: row.topupTxId,
    ...(row.status === 'FAILED' || row.status === 'EXPIRED' || row.status === 'CANCELLED'
      ? { failure_reason: row.failureReason ?? undefined }
      : {}),
    ...(extras?.estimatedFee != null ? { estimated_fee: Number(extras.estimatedFee) } : {}),
  };
}
