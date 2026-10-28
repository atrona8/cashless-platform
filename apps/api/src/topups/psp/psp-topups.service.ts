// Demande, suivi et annulation d'une recharge PSP (`initiatePspTopup`, `getPspTopup`, `cancelPspTopup`, mission 6,
// lot WP11, T054 et T055 ; FR-012, FR-013, FR-016, FR-017 ; A13, A20, A25, A31).
//
// Demande en TROIS temps, jamais un appel réseau sous transaction :
//   1. transaction courte, base seule : autorisation, portefeuille, grand livre `LIVE`, devise, portefeuille
//      actif, configuration, plafonds estimés (refus anticipé, non garanti), `create_psp_topup`, audit ;
//   2. HORS transaction : secrets par le port, `adapter.initiate` ;
//   3. transaction courte : `mark_psp_topup_initiated` (référence du PSP, échéance).
// L'identifiant de la recharge est DÉTERMINISTE (portée et clé d'idempotence) : la reprise d'une même clé
// retrouve la ligne au lieu d'en créer une (`create_psp_topup` rejoue, ou refuse un autre contenu : CL029).
// Un échec de l'adaptateur laisse la recharge `PENDING` (l'interrogation tranche) ; aucune erreur brute de
// l'adaptateur ne sort (code normalisé seulement), aucun secret n'est journalisé.
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import { AuditService } from '../../audit/audit.service';
import { requestCustomer } from '../../customer-identity/customer-identity.port';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { assertDeviceMode, requestDevice } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { requestPrincipal } from '../../identity/principal';
import { readTopupHeadroom } from '../../ledger/db/ledger-queries';
import { CONFIG_RESOLVER, type ConfigResolver } from '../../ledger/ports/config-resolver';
import { fee } from '../../ledger/money';
import { CounterAccess } from '../../media/lifecycle/counter-access';
import { TapService } from '../../media/taps/tap.service';
import { conflict } from '../../organization/platform/platform.dto';
import { pspProblem, PspProviderError } from '../../psp/psp-errors';
import { PspAdapterRegistry } from '../../psp/psp-adapter-registry';
import {
  PspSecretError,
  type PspSecretStore,
  type PspSecrets,
} from '../../psp/psp-secret-store.port';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../psp/psp.tokens';
import {
  PROVIDER_PATH_SEGMENT,
  type PaymentAction,
  type PspProviderName,
} from '../../psp/psp.types';
import { FEE_CHANNEL, type PspMethod } from '../../psp-configurations/psp-configurations.dto';
import {
  parsePspTopupRequest,
  topupView,
  type PspTopupInput,
  type PspTopupView,
} from './psp-topups.dto';
import { requestPspCaller, type PspCallerKind } from './psp-topup-caller.guard';
import { PspTopupLookup, type PspTopupRow } from './psp-topup-lookup';

/** Durée de la recharge avant que le PSP en fixe une (la base la borne à [maintenant, 7 jours]). */
const INITIAL_LIFETIME_MS = 30 * 60_000;
const MAX_PSP_LIFETIME_MS = 6 * 24 * 3_600_000;

/** Identifiant déterministe d'une recharge : SHA-256 de (portée, clé d'idempotence), mis en forme d'UUID. */
export function deterministicTopupId(scope: string, key: string): string {
  const hex = createHash('sha256')
    .update(`psp-topup\u0000${scope}\u0000${key}`, 'utf8')
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

interface Requester {
  kind: Exclude<PspCallerKind, 'PERSON'>;
  operatorId: string;
  deviceId: string | null;
  personId: string | null;
  customerId: string | null;
}

interface Prepared {
  row: PspTopupRow;
  replayed: boolean;
  holderPartyId: string;
  secretRef: string;
  estimatedFee: bigint | null;
}

function requesterOf(req: Request): Requester | null {
  const caller = requestPspCaller(req);
  if (caller.kind === 'DESK') {
    const device = requestDevice(req);
    return {
      kind: 'DESK',
      operatorId: device.operatorId,
      deviceId: device.deviceId,
      personId: requestPrincipal(req).userId,
      customerId: null,
    };
  }
  if (caller.kind === 'CUSTOMER') {
    const customer = requestCustomer(req);
    return {
      kind: 'CUSTOMER',
      operatorId: customer.operatorId,
      deviceId: null,
      personId: null,
      customerId: customer.customerId,
    };
  }
  return null;
}

@Injectable()
export class PspTopupsService {
  private readonly log = new Logger(PspTopupsService.name);

  constructor(
    private readonly tx: TenantTx,
    private readonly counter: CounterAccess,
    private readonly taps: TapService,
    private readonly lookup: PspTopupLookup,
    private readonly audit: AuditService,
    @Inject(PSP_ADAPTERS) private readonly adapters: PspAdapterRegistry,
    @Inject(PSP_SECRET_STORE) private readonly secrets: PspSecretStore,
    @Inject(CONFIG_RESOLVER) private readonly config: ConfigResolver,
  ) {}

  // ------------------------------------------------------------------------------ T054 : la demande

  async request(req: Request, body: unknown, scope: string, key: string): Promise<PspTopupView> {
    const input = parsePspTopupRequest(body);
    const requester = requesterOf(req);
    if (requester === null) throw new ProblemException('FORBIDDEN');
    const topupId = deterministicTopupId(scope, key);
    // Temps 1 : base seule.
    const prepared = await this.tx.run(requester.operatorId, (client) =>
      this.prepare(client, req, requester, input, topupId),
    );
    const row = prepared.row;
    // Rejeu : la recharge a déjà quitté l'état initial ou porte déjà sa référence du PSP.
    if (prepared.replayed && (row.status !== 'PENDING' || row.providerPaymentRef !== null))
      return topupView(row, { estimatedFee: prepared.estimatedFee });
    // Temps 2 : HORS transaction. Aucune erreur brute de l'adaptateur ne sort.
    const result = await this.callAdapter(row, prepared, input);
    // Temps 3 : la référence du PSP et l'échéance.
    const expiresAt =
      result.expiresAt.getTime() > Date.now() &&
      result.expiresAt.getTime() < Date.now() + MAX_PSP_LIFETIME_MS
        ? result.expiresAt
        : null;
    const updated = await this.tx.run(requester.operatorId, async (client) => {
      await client.query('SELECT mark_psp_topup_initiated($1, $2, $3)', [
        row.topupId,
        result.providerPaymentRef,
        expiresAt,
      ]);
      return (await this.lookup.find(client, row.topupId))!;
    });
    return topupView(updated, { action: result.action, estimatedFee: prepared.estimatedFee });
  }

  private async prepare(
    client: TxClient,
    req: Request,
    requester: Requester,
    input: PspTopupInput,
    topupId: string,
  ): Promise<Prepared> {
    const desk = requester.kind === 'DESK';
    // a. contexte et portefeuille.
    let ledgerId: string;
    let audit = auditContext(req);
    let actorUserId: string | null = null;
    let walletId: string;
    if (desk) {
      const actor = await this.counter.authorize(client, req);
      assertDeviceMode(actor.device, ['TOPUP_DESK']);
      ledgerId = actor.ledgerId;
      audit = actor.audit;
      actorUserId = actor.userId;
      walletId =
        input.walletId ??
        (await this.walletOfTap(client, actor.device, input.tapId!, actor.currency));
    } else {
      if (input.tapId !== null)
        throw new ProblemException('VALIDATION_FAILED', {
          status: 422,
          detail: 'tap_id : réservé au guichet.',
        });
      walletId = input.walletId!;
      ledgerId = '';
    }
    const wallet = await client.query<{
      status: string;
      ledger_id: string;
      customer_id: string | null;
    }>('SELECT status, ledger_id, customer_id FROM wallet WHERE id = $1', [walletId]);
    const w = wallet.rows[0];
    // Autre prestataire (invisible), autre événement, portefeuille d'un autre festivalier : 404 neutre.
    if (!w || (desk ? w.ledger_id !== ledgerId : w.customer_id !== requester.customerId))
      throw new ProblemException('NOT_FOUND');
    ledgerId = w.ledger_id;
    const context = await client.query<{
      ledger_status: string;
      currency: string;
      event_id: string;
      event_status: string;
    }>(
      `SELECT l.status AS ledger_status, l.currency, l.scope_id AS event_id, e.status::text AS event_status
         FROM ledger l JOIN event e ON e.id = l.scope_id WHERE l.id = $1 AND l.scope_type = 'EVENT'`,
      [ledgerId],
    );
    const ctx = context.rows[0];
    if (!ctx) throw new ProblemException('NOT_FOUND');
    const existing = await this.lookup.find(client, topupId);
    if (existing === null) {
      // b. grand livre LIVE, devise, portefeuille actif.
      if (ctx.event_status !== 'LIVE' || ctx.ledger_status !== 'OPEN')
        throw new ProblemException('EVENT_CLOSING');
      if (input.currency !== ctx.currency.trim()) throw new ProblemException('CURRENCY_MISMATCH');
      if (w.status !== 'ACTIVE') throw new ProblemException('WALLET_BLOCKED', { status: 422 });
      // c. configuration (CL042 -> 409 PSP_NOT_CONFIGURED).
      await client.query('SELECT 1 FROM resolve_psp_configuration($1, $2)', [
        ctx.event_id,
        input.method,
      ]);
      // d. plafonds estimés (refus anticipé, non garanti : le contrôle qui fait foi est à la notification).
      const headroom = await readTopupHeadroom(client, walletId, new Date());
      if (headroom !== undefined && input.amount > headroom)
        throw new ProblemException('WALLET_LIMIT_EXCEEDED', { status: 422 });
    }
    // e. création (ou rejeu au même contenu) : trois PENDING par portefeuille et vingt par terminal au plus.
    const created = await client.query<{ psp_topup_id: string; replayed: boolean }>(
      'SELECT psp_topup_id, replayed FROM create_psp_topup($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        topupId,
        walletId,
        input.method,
        input.amount.toString(),
        requester.kind,
        requester.deviceId,
        requester.personId,
        requester.customerId,
        new Date(Date.now() + INITIAL_LIFETIME_MS),
      ],
    );
    const row = (await this.lookup.find(client, created.rows[0]!.psp_topup_id))!;
    const replayed = created.rows[0]!.replayed;
    const holder = await client.query<{ holder_party_id: string }>(
      'SELECT holder_party_id FROM psp_configuration WHERE psp_configuration_id = $1',
      [row.configurationId],
    );
    const ref = await client.query<{ secret_ref: string }>(
      'SELECT psp_configuration_secret_ref($1) AS secret_ref',
      [row.configurationId],
    );
    // Frais estimés, seulement si le festivalier les supporte (règle figée de la configuration, ADR-133).
    const resolved = await this.config.resolve({
      ledgerId,
      eventId: ctx.event_id,
      occurredAt: new Date(),
      pspConfigurationId: row.configurationId,
      client,
    });
    const estimatedFee =
      resolved.pspFeeBearer === 'CUSTOMER'
        ? fee(row.amount, resolved.pspFees[FEE_CHANNEL[row.method]] ?? {})
        : null;
    if (!replayed)
      await this.audit.record(client, {
        ...audit,
        operatorId: requester.operatorId,
        actorId: actorUserId ?? requester.customerId,
        action: 'PSP_TOPUP_REQUESTED',
        objectType: 'psp_topup',
        objectId: row.topupId,
        after: {
          topup_id: row.topupId,
          wallet_id: walletId,
          amount: row.amount,
          currency: row.currency,
          method: row.method,
          psp_configuration_id: row.configurationId,
          device_id: requester.deviceId,
          requested_by: requester.kind,
        },
      });
    return {
      row,
      replayed,
      holderPartyId: holder.rows[0]!.holder_party_id,
      secretRef: ref.rows[0]!.secret_ref,
      estimatedFee,
    };
  }

  /** Portefeuille de l'attribution ouverte du bracelet cité (sans consommer la lecture). */
  private async walletOfTap(
    client: TxClient,
    device: ReturnType<typeof requestDevice>,
    tapId: number,
    currency: string,
  ): Promise<string> {
    const tap = await this.taps.byId(client, device, tapId);
    if (!tap.mediaId) throw new ProblemException('TAP_UNUSABLE');
    const { rows } = await client.query<{ status: string; wallet_id: string | null }>(
      `SELECT m.status, ma.wallet_id
         FROM media m
         LEFT JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
                                      AND ma.wallet_id = m.wallet_id AND ma.currency = $2
        WHERE m.id = $1`,
      [tap.mediaId, currency],
    );
    const row = rows[0];
    if (!row) throw new ProblemException('NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new ProblemException('MEDIA_STATE_INVALID', { status: 409 });
    if (!row.wallet_id) throw new ProblemException('MEDIA_NOT_ACTIVATED');
    return row.wallet_id;
  }

  /** Appel de l'adaptateur, HORS transaction. Erreur brute jamais rendue ni journalisée avec son message. */
  private async callAdapter(
    row: PspTopupRow,
    prepared: Prepared,
    input: PspTopupInput,
  ): Promise<{ providerPaymentRef: string; action: PaymentAction; expiresAt: Date }> {
    try {
      const adapter = this.adapters.forProvider(row.provider as PspProviderName);
      const secrets = await this.secrets.get({
        configurationId: row.configurationId,
        holderPartyId: prepared.holderPartyId,
        secretRef: prepared.secretRef,
      });
      return await adapter.initiate(
        {
          pspTopupId: row.topupId,
          method: input.method,
          amount: row.amount,
          currency: row.currency,
          payerMsisdn: input.payerMsisdn,
          returnUrl: input.returnUrl,
          notificationUrl: `/webhooks/${PROVIDER_PATH_SEGMENT[row.provider as PspProviderName]}/${row.configurationId}`,
        },
        secrets,
      );
    } catch (error) {
      throw this.adapterProblem(error, row.topupId);
    }
  }

  /** Code normalisé seulement : le message d'une erreur d'adaptateur ou du coffre ne sort jamais. */
  private adapterProblem(error: unknown, topupId: string): ProblemException {
    if (error instanceof ProblemException) return error;
    if (error instanceof PspProviderError) return pspProblem(error);
    // Coffre indisponible, erreur inattendue d'un adaptateur : la recharge reste PENDING (503).
    const name = error instanceof PspSecretError ? error.code : 'ADAPTER_ERROR';
    this.log.warn(`adaptateur PSP en échec : topup_id=${topupId} code=${name}`);
    return new ProblemException('PSP_UNAVAILABLE', { status: 503 });
  }

  // ------------------------------------------------------------------------------ T055 : suivi, annulation

  async get(req: Request, topupId: string): Promise<PspTopupView> {
    const caller = requestPspCaller(req);
    const operatorId = this.operatorOf(req);
    return this.tx.run(operatorId, async (client) => {
      const row = await this.lookup.find(client, topupId);
      if (!row || !(await this.visible(client, req, caller.kind, row)))
        throw new ProblemException('NOT_FOUND');
      return topupView(row);
    });
  }

  async cancel(req: Request, topupId: string): Promise<PspTopupView> {
    const requester = requesterOf(req);
    if (requester === null) throw new ProblemException('NOT_FOUND');
    // Temps 1 : lecture, droit du demandeur, état.
    const first = await this.tx.run(requester.operatorId, async (client) => {
      const row = await this.lookup.find(client, topupId);
      if (!row || !(await this.visible(client, req, requester.kind, row)))
        throw new ProblemException('NOT_FOUND');
      if (row.status === 'CANCELLED') return { row, done: true as const };
      if (row.status !== 'PENDING') throw conflict('Cette recharge ne peut plus être annulée.');
      const holder = await client.query<{ holder_party_id: string }>(
        'SELECT holder_party_id FROM psp_configuration WHERE psp_configuration_id = $1',
        [row.configurationId],
      );
      const ref = await client.query<{ secret_ref: string }>(
        'SELECT psp_configuration_secret_ref($1) AS secret_ref',
        [row.configurationId],
      );
      return {
        row,
        done: false as const,
        holderPartyId: holder.rows[0]!.holder_party_id,
        secretRef: ref.rows[0]!.secret_ref,
      };
    });
    if (first.done) return topupView(first.row);
    // HORS transaction : l'annulation doit être CONFIRMÉE par l'adaptateur.
    const secrets = await this.secretsFor(first.row, first.holderPartyId, first.secretRef);
    let cancelled: boolean;
    try {
      const adapter = this.adapters.forProvider(first.row.provider as PspProviderName);
      ({ cancelled } = await adapter.cancel(
        { merchantReference: first.row.topupId, providerPaymentRef: first.row.providerPaymentRef },
        secrets,
      ));
    } catch (error) {
      throw this.adapterProblem(error, first.row.topupId);
    }
    if (!cancelled) throw conflict('Le PSP n’a pas confirmé l’annulation de cette recharge.');
    // Temps 2 : sous le verrou de la recharge, re-contrôle puis annulation.
    return this.tx.run(requester.operatorId, async (client) => {
      await this.lookup.lock(client, topupId);
      const row = (await this.lookup.find(client, topupId))!;
      if (row.status === 'CANCELLED') return topupView(row);
      if (row.status !== 'PENDING') throw conflict('Cette recharge ne peut plus être annulée.');
      await client.query('SELECT cancel_psp_topup($1)', [row.topupId]);
      await this.audit.record(client, {
        ...auditContext(req),
        operatorId: requester.operatorId,
        actorId: requester.personId ?? requester.customerId,
        action: 'PSP_TOPUP_CANCELLED',
        objectType: 'psp_topup',
        objectId: row.topupId,
        after: { topup_id: row.topupId, requested_by: requester.kind },
      });
      return topupView((await this.lookup.find(client, topupId))!);
    });
  }

  private async secretsFor(
    row: PspTopupRow,
    holderPartyId: string,
    secretRef: string,
  ): Promise<PspSecrets> {
    try {
      return await this.secrets.get({
        configurationId: row.configurationId,
        holderPartyId,
        secretRef,
      });
    } catch (error) {
      throw this.adapterProblem(error, row.topupId);
    }
  }

  private operatorOf(req: Request): string {
    const caller = requestPspCaller(req);
    if (caller.kind === 'DESK') return requestDevice(req).operatorId;
    if (caller.kind === 'CUSTOMER') return requestCustomer(req).operatorId;
    const operatorId = requestPrincipal(req).operatorId;
    if (operatorId === null) throw new ProblemException('NOT_FOUND');
    return operatorId;
  }

  /**
   * Visible du demandeur seulement (même terminal ET même personne, ou même festivalier) ou d'un
   * `ORGANIZER_ADMIN` de l'organisateur de l'événement. Autrement : comme une recharge inexistante.
   */
  private async visible(
    client: TxClient,
    req: Request,
    kind: PspCallerKind,
    row: PspTopupRow,
  ): Promise<boolean> {
    if (kind === 'DESK')
      return (
        row.requestedByKind === 'DESK' &&
        row.deviceId === requestDevice(req).deviceId &&
        row.personId === requestPrincipal(req).userId
      );
    if (kind === 'CUSTOMER')
      return (
        row.requestedByKind === 'CUSTOMER' && row.customerId === requestCustomer(req).customerId
      );
    const principal = requestPrincipal(req);
    if (principal.operatorId !== row.operatorId) return false;
    const event = await client.query<{ organizer_id: string }>(
      'SELECT organizer_id FROM event WHERE id = $1',
      [row.eventId],
    );
    const organizer = event.rows[0]?.organizer_id;
    return (
      organizer !== undefined &&
      principal.assignments.some(
        (a) =>
          a.role === 'ORGANIZER_ADMIN' && a.scopeType === 'ORGANIZER' && a.scopeId === organizer,
      )
    );
  }
}

export type { PspMethod };
