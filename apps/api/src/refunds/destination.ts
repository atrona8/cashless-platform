// Destination d'une demande de remboursement du festivalier (mission 9a, WP03 ; FR-011, FR-012, ADR-76). Appelée par
// la création de la demande (WP04), APRÈS les refus peu coûteux (fenêtre, éligibilité) et AVANT l'insertion : le code
// d'un autre numéro est vérifié et CONSOMMÉ ici, dans une transaction propre de `verifyChallenge`.
import type { components } from '@cashless/contracts';
import type { CustomerAuthService } from '../customer-auth/customer-auth.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';

type RefundRequestCreate = components['schemas']['RefundRequestCreate'];

export interface ResolvedDestination {
  method: 'WAVE' | 'ORANGE_MONEY';
  msisdn: string;
  newNumber: boolean;
  /** Numéro vérifié du titulaire, s'il existe. */
  holderPhone: string | null;
}

const notAllowed = () => new ProblemException('REFUND_NOT_ALLOWED');

/**
 * Résout le numéro de paiement :
 * - `BANK_TRANSFER` : refus (réservé au back-office), avant toute lecture ;
 * - numéro absent ou égal à celui du titulaire : le numéro vérifié, sans code (un `new_number_otp` joint est ignoré
 *   et n'est pas consommé) ;
 * - autre numéro : `new_number_otp` obligatoire, vérifié pour ce numéro et ce prestataire (usage `LOGIN`), consommé.
 */
export async function resolveDestination(
  client: TxClient,
  input: {
    operatorId: string;
    walletId: string;
    customerId: string;
    destination: RefundRequestCreate['destination'];
  },
  verify: CustomerAuthService['verifyChallenge'],
): Promise<ResolvedDestination> {
  const { destination } = input;
  if (destination.method !== 'WAVE' && destination.method !== 'ORANGE_MONEY') throw notAllowed();
  const { rows } = await client.query<{ phone: string | null }>(
    'SELECT phone FROM customer_identity WHERE customer_id = $1 AND operator_id = $2',
    [input.customerId, input.operatorId],
  );
  const holderPhone = rows[0]?.phone ? rows[0].phone : null;
  const msisdn = destination.msisdn ?? holderPhone;
  if (!msisdn) throw notAllowed();
  if (holderPhone !== null && msisdn === holderPhone)
    return { method: destination.method, msisdn, newNumber: false, holderPhone };
  const otp = destination.new_number_otp;
  if (!otp) throw notAllowed();
  await verify({
    otpRequestId: otp.otp_request_id,
    code: otp.code,
    expectedPhone: msisdn,
    purpose: 'LOGIN',
    operatorId: input.operatorId,
  });
  return { method: destination.method, msisdn, newNumber: true, holderPhone };
}
