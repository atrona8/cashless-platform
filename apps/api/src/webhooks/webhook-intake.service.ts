// Réception d'une notification de PSP (mission 6, lot WP12, T060 et T061 ; R-10, R-20 ; A2, A4, A9, A19, A22).
// Ordre, sans exception (arbitrage de l'orchestrateur du 27/10/2026) :
//   (1) taille ; (2) configuration retrouvée par `psp_webhook_context`, ACTIVE, du fournisseur du chemin ;
//   (3) secrets rendus par le coffre ; (4) signature ; (5) horodatage ; (6) seulement alors, lecture du JSON
//   (faite par l'adaptateur, après (4) et (5)). Aucun champ du corps n'est lu avant la signature.
// Un refus n'écrit que le compteur sans corps et un journal (WebhookRejections). Une notification authentifiée est
// CONSERVÉE (transaction 1) puis traitée (transaction 2 ; échec : événement `RETRY`, la réponse reste `200`, A4).
import { Inject, Injectable } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { PspAdapter } from '../psp/psp-adapter.port';
import type { PspAdapterRegistry } from '../psp/psp-adapter-registry';
import type { PspSecretStore, PspSecrets } from '../psp/psp-secret-store.port';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../psp/psp.tokens';
import { providerFromPathSegment, type PspProviderName } from '../psp/psp.types';
import { PspStatusConfirmer } from '../topups/psp/psp-status-confirmer';
import { EventDispatcher } from './event-dispatcher';
import { encodeNormalized, NORMALIZED_MAX_BYTES, normalizedSize } from './normalized-codec';
import { WebhookRejections, type WebhookRejectionReason } from './webhook-rejections';
import { verifyWebhook, type WebhookVerification } from './webhook-verifier';

/** Taille maximale du corps brut (octets), contrôlée sur `Content-Length` ET sur la longueur réelle. */
export const WEBHOOK_MAX_BODY_BYTES = 65_536;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReceiveInput {
  providerSegment: string;
  configId: string;
  rawBody: Buffer | undefined;
  headers: Record<string, string | string[] | undefined>;
  ip: string | undefined;
  /**
   * Exécute la tâche une fois la réponse envoyée (le contrôleur la branche sur `finish`). Absent : tâche différée
   * par `setImmediate`. La relecture d'un signal ne s'exécute jamais dans la requête.
   */
  afterResponse?: (task: () => void) => void;
}

export interface ReceiveResult {
  received: true;
  duplicate: boolean;
}

interface WebhookContextRow {
  operator_id: string;
  provider: PspProviderName;
  status: string;
  holder_party_id: string;
  secret_ref: string;
}

/** `application/json` (ou absent) -> `json` ; formulaire -> `form` ; autre -> `null`. */
export function bodyFormatOf(header: string | string[] | undefined): 'json' | 'form' | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim() === '') return 'json';
  const type = raw.split(';')[0]!.trim().toLowerCase();
  if (type === 'application/json') return 'json';
  if (type === 'application/x-www-form-urlencoded') return 'form';
  return null;
}

/** Réponse de chaque motif de refus (contrat `receivePspWebhook`). */
export function problemForRejection(reason: WebhookRejectionReason): ProblemException {
  switch (reason) {
    case 'BODY_TOO_LARGE':
      return new ProblemException('PAYLOAD_TOO_LARGE', { status: 413 });
    case 'UNKNOWN_CONFIG':
    case 'CONFIG_NOT_ACTIVE':
    case 'PROVIDER_MISMATCH':
    case 'SECRET_UNAVAILABLE':
      // Réponse neutre : mêmes corps et mêmes en-têtes, quelle que soit la cause.
      return new ProblemException('NOT_FOUND', { status: 404 });
    case 'SIGNATURE_MISSING':
    case 'SIGNATURE_MALFORMED':
    case 'SIGNATURE_INVALID':
      return new ProblemException('WEBHOOK_SIGNATURE_INVALID', { status: 401 });
    case 'TIMESTAMP_OUT_OF_TOLERANCE':
      return new ProblemException('WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE', { status: 401 });
    case 'BODY_MALFORMED':
      return new ProblemException('VALIDATION_FAILED', { status: 400 });
  }
}

@Injectable()
export class WebhookIntake {
  constructor(
    private readonly tx: TenantTx,
    private readonly rejections: WebhookRejections,
    private readonly dispatcher: EventDispatcher,
    private readonly confirmer: PspStatusConfirmer,
    @Inject(PSP_ADAPTERS) private readonly adapters: PspAdapterRegistry,
    @Inject(PSP_SECRET_STORE) private readonly secrets: PspSecretStore,
  ) {}

  async receive(input: ReceiveInput): Promise<ReceiveResult> {
    const rawBody = input.rawBody ?? Buffer.alloc(0);
    const declared = Number(input.headers['content-length']);
    const size = Math.max(rawBody.length, Number.isFinite(declared) ? declared : 0);
    const refuse = async (reason: WebhookRejectionReason): Promise<never> => {
      await this.rejections.record(reason, {
        provider: input.providerSegment,
        configId: input.configId,
        size,
        rawBody,
        ip: input.ip,
      });
      throw problemForRejection(reason);
    };

    // (1) taille.
    if (size > WEBHOOK_MAX_BODY_BYTES) return refuse('BODY_TOO_LARGE');

    // (2) configuration ACTIVE du fournisseur du chemin.
    const provider = providerFromPathSegment(input.providerSegment);
    if (provider === null || !UUID.test(input.configId)) return refuse('UNKNOWN_CONFIG');
    const context = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<WebhookContextRow>(
        'SELECT operator_id, provider, status, holder_party_id, secret_ref FROM psp_webhook_context($1)',
        [input.configId.toLowerCase()],
      );
      return rows[0] ?? null;
    });
    if (context === null) return refuse('UNKNOWN_CONFIG');
    if (context.provider !== provider) return refuse('PROVIDER_MISMATCH');
    if (context.status !== 'ACTIVE') return refuse('CONFIG_NOT_ACTIVE');
    // Format du corps : le formulaire n'existe que chez PayDunya ; refus avant le coffre.
    const contentType = bodyFormatOf(input.headers['content-type']);
    if (contentType === null || (contentType === 'form' && provider !== 'PAYDUNYA'))
      return refuse('BODY_MALFORMED');

    // (3) secrets (jamais journalisés ; une panne du coffre est un refus neutre).
    let secrets: PspSecrets;
    let adapter: PspAdapter;
    try {
      adapter = this.adapters.forProvider(provider);
      secrets = await this.secrets.get({
        provider,
        configurationId: input.configId.toLowerCase(),
        holderPartyId: context.holder_party_id,
        secretRef: context.secret_ref,
      });
    } catch {
      return refuse('SECRET_UNAVAILABLE');
    }

    // (4) signature, (5) horodatage, (6) lecture du JSON (adaptateur).
    const verdict = verifyWebhook({
      adapter,
      rawBody,
      contentType,
      headers: input.headers,
      secrets,
      now: new Date(),
    });
    if (!verdict.ok) return refuse(verdict.reason);
    // Un litige « à relire » n'est pas un statut de paiement : conservé en entier puis rattaché à la recharge par
    // l'`EventDispatcher` (qui relit le PSP, hors requête) ; non rattaché, il reste `UNMATCHED` (24 h puis anomalie).
    const disputeToRead =
      verdict.kind === 'NOTIFICATION' &&
      verdict.confirmationRequired &&
      verdict.notification.kind === 'DISPUTE';
    if (verdict.kind === 'SIGNAL' || (verdict.confirmationRequired && !disputeToRead))
      return this.keepAndConfirm(input, context, verdict, rawBody);
    const { notification } = verdict;
    if (normalizedSize(notification) > NORMALIZED_MAX_BYTES) return refuse('BODY_MALFORMED');

    // Transaction 1 : conservation (avant tout traitement, A4).
    const receivedAt = new Date();
    const kept = await this.tx.run(context.operator_id, async (client) => {
      const { rows } = await client.query<{ psp_event_id: string; duplicate: boolean }>(
        'SELECT psp_event_id, duplicate FROM record_psp_event($1, $2, $3, $4, $5::jsonb)',
        [
          input.configId.toLowerCase(),
          notification.notificationId,
          notification.kind,
          rawBody,
          JSON.stringify(encodeNormalized(notification)),
        ],
      );
      return rows[0]!;
    });
    if (kept.duplicate) return { received: true, duplicate: true };

    // Transaction 2 (et 3 si elle échoue) : le traitement ne change jamais la réponse.
    const event = {
      pspEventId: kept.psp_event_id,
      operatorId: context.operator_id,
      configurationId: input.configId.toLowerCase(),
      receivedAt,
    };
    const apply = async (): Promise<void> => {
      try {
        await this.dispatcher.apply(event, notification);
      } catch {
        // `apply` attrape déjà ses erreurs ; filet : la conservation est faite, la réponse reste 200 (A4).
      }
    };
    if (disputeToRead) {
      // Relecture du PSP : jamais dans la requête.
      const task = (): void => void apply();
      if (input.afterResponse) input.afterResponse(task);
      else setImmediate(task);
    } else await apply();
    return { received: true, duplicate: false };
  }

  /**
   * Signal, ou notification dont le statut n'est pas cru : conservé SANS effet (nature `UNKNOWN`, aucun montant,
   * événement marqué traité sans effet), puis relecture authentifiée après la réponse. Aucun crédit ici. Pour un
   * signal le corps brut n'est pas conservé (il peut porter la preuve elle-même) ; une notification à relire
   * garde son corps signé, comme aujourd'hui.
   */
  private async keepAndConfirm(
    input: ReceiveInput,
    context: WebhookContextRow,
    verdict: Extract<WebhookVerification, { ok: true }>,
    rawBody: Buffer,
  ): Promise<ReceiveResult> {
    const configId = input.configId.toLowerCase();
    let notificationId: string;
    let reference: { merchantReference: string | null; providerPaymentRef: string | null };
    let body: Buffer | null = rawBody;
    if (verdict.kind === 'SIGNAL') {
      notificationId = verdict.notificationId;
      reference = verdict.reference;
      body = null;
    } else {
      notificationId = verdict.notification.notificationId;
      reference = {
        merchantReference: verdict.notification.payment.merchantReference,
        providerPaymentRef: verdict.notification.payment.providerPaymentRef,
      };
    }
    const kept = await this.tx.run(context.operator_id, async (client) => {
      const { rows } = await client.query<{ psp_event_id: string; duplicate: boolean }>(
        'SELECT psp_event_id, duplicate FROM record_psp_event($1, $2, $3, $4, $5::jsonb)',
        [configId, notificationId, 'UNKNOWN', body, JSON.stringify({ kind: 'UNKNOWN', reference })],
      );
      const row = rows[0]!;
      if (!row.duplicate)
        await client.query('SELECT mark_psp_event($1, $2, $3, $4)', [
          row.psp_event_id,
          'PROCESSED',
          'NO_EFFECT',
          null,
        ]);
      return row;
    });
    if (kept.duplicate) return { received: true, duplicate: true };
    const task = (): void =>
      this.confirmer.scheduleConfirmation(
        reference.merchantReference,
        configId,
        reference.providerPaymentRef,
      );
    if (input.afterResponse) input.afterResponse(task);
    else setImmediate(task);
    return { received: true, duplicate: false };
  }
}
