// Corps de `POST /topups/cash` (contrat `CashTopupRequest`, lot WP09, T044). Aucun champ ne désigne un compte de
// caisse ni un portefeuille : le portefeuille se déduit du bracelet, la caisse de la session ouverte du terminal.
// `source` n'est pas lu (fixée par le serveur) ; tout champ inconnu est refusé.
import {
  amountField,
  dateTimeField,
  intField,
  invalid,
  objectBody,
} from '../../organization/platform/platform.dto';
import { parseCashSessionId } from '../../media/lifecycle/lifecycle.dto';
import { parseTap, type TapInput } from '../../media/taps/taps.dto';

const FIELDS = new Set([
  'amount',
  'currency',
  'occurred_at',
  'tap',
  'tap_id',
  'cash_tendered',
  'cash_session_id',
]);

export interface CashTopupInput {
  amount: bigint;
  currency: string;
  /** Heure du terminal : informative (`metadata.device_occurred_at`), jamais l'heure d'écriture. */
  occurredAt: Date;
  tap: TapInput | null;
  tapId: number | null;
  /** Espèces remises : informatif, jamais écrit au grand livre. */
  cashTendered: number | null;
  cashSessionId: string | null;
}

export function parseCashTopup(raw: unknown): CashTopupInput {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((key) => !FIELDS.has(key));
  if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
  const amount = amountField(body, 'amount', false);
  if (amount === undefined) throw invalid('Champ obligatoire : amount.');
  if (BigInt(amount!) <= 0n) throw invalid('amount : montant strictement positif attendu.');
  if (typeof body.currency !== 'string' || body.currency === '')
    throw invalid('currency : devise attendue.');
  const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional') ?? null;
  const tap: TapInput | null =
    body.tap === undefined || body.tap === null ? null : parseTap(body.tap);
  if ((tap === null) === (tapId === null))
    throw invalid('tap ou tap_id : exactement une lecture du bracelet attendue.');
  const cashTendered = intField(body, 'cash_tendered', 0, Number.MAX_SAFE_INTEGER, 'optional');
  if (cashTendered !== undefined && BigInt(cashTendered) < BigInt(amount!))
    throw invalid('cash_tendered : au moins le montant de la recharge.');
  return {
    amount: BigInt(amount!),
    currency: body.currency,
    occurredAt: dateTimeField(body, 'occurred_at', 'required')!,
    tap,
    tapId,
    cashTendered: cashTendered ?? null,
    cashSessionId: parseCashSessionId(body),
  };
}
