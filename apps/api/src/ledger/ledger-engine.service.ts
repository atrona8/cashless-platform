// Moteur d'écritures (SPECIFICATION §5.4, contracts/engine-command.md, research R-06) : le seul composant applicatif
// qui écrit au grand livre. Il travaille dans la transaction de l'appelant (client de TenantTx.run ou IdempotentTx.run).
//
// Ordre : (1) valider la commande ; (2) idempotence d'abord, comme post_transaction : une clé déjà écrite renvoie sa
// transaction sans rien recalculer (un rejeu après la clôture ou après un changement de soldes reste un rejeu) ;
// (3) grand livre, événement, devise, matrice des statuts ; (4) configuration figée ; (5) soldes si nécessaires ;
// (6) constructeur → lignes contrôlées ; (7) comptes résolus ; (8) un seul appel d'écriture.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import canonicalize from 'canonicalize';
import { ProblemException } from '../errors/problem';
import { BUILDERS, plan, type DelegatedFunction, type RegistryEntry } from './builders/registry';
import {
  findTransactionId,
  forfeitDeposit,
  jsonWithBigint,
  linesJson,
  lockIdempotencyKey,
  postTransaction,
  preloadMedia,
  readLedgerContext,
  readMediaDepositState,
  readOriginalLines,
  readSignedBalances,
  readTopupHeadroom,
  refundCashDue,
  refundDeposit,
  takeDeposit,
  type LedgerContextRow,
} from './db/ledger-queries';
import { ACCOUNT_RESOLVER, type AccountResolver, type Queryable } from './ports/account-resolver';
import { CONFIG_RESOLVER, type ConfigResolver } from './ports/config-resolver';
import { isAccepted, type EventStatus } from './status-matrix';
import {
  BuildError,
  SOURCES,
  TRANSACTION_TYPES,
  type AccountRef,
  type BuildContext,
  type LedgerCommand,
  type Line,
  type WalletBalances,
} from './types';

/** Résultat d'une commande. `transactionId` est null quand une fonction déléguée n'a rien écrit (voir `outcome`). */
export interface EngineResult {
  transactionId: string | null;
  /** La transaction existait déjà sous cette clé : rien n'a été écrit. */
  replayed: boolean;
  /** Fonctions déléguées : `take_deposit` → NONE | DUE | HELD ; les autres → WRITTEN | NOOP. */
  outcome?: string;
}

/** Charge utile des types délégués (caution, préchargement, espèces dues). */
export interface DelegatedPayload {
  variant?: string;
  /** Code du compte d'encaissement ou de remboursement d'une caution `SEPARATE` (ex. `A-CAISSE-C1`). */
  moneyAccount?: string;
  /** Code du compte de caisse d'un rendu d'espèces dues. */
  cashAccount?: string;
}

/** Clé de métadonnée portant l'empreinte de la commande (détection « même clé, autre contenu »). */
export const COMMAND_FINGERPRINT_KEY = 'engine_command_sha256';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class LedgerEngineService {
  constructor(
    @Inject(CONFIG_RESOLVER) private readonly configResolver: ConfigResolver,
    @Inject(ACCOUNT_RESOLVER) private readonly accountResolver: AccountResolver,
  ) {}

  async execute(client: Queryable, command: LedgerCommand): Promise<EngineResult> {
    try {
      validate(command);
      const delegatedFn = delegation(command);
      return delegatedFn ? await this.delegate(client, command, delegatedFn) : await this.writeLines(client, command);
    } catch (error) {
      // Erreurs de construction → code stable ; les erreurs SQL remontent telles quelles au filtre (WP10).
      if (error instanceof BuildError) {
        throw new ProblemException(error.code, { status: 422, detail: error.message });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- types à lignes

  private async writeLines(client: Queryable, command: LedgerCommand): Promise<EngineResult> {
    const fingerprint = commandFingerprint(command);
    // Deux commandes de même clé passent l'une après l'autre : la lecture qui suit est donc exacte.
    await lockIdempotencyKey(client, command.ledgerId, command.idempotencyKey);
    const existing = await readExisting(client, command.ledgerId, command.idempotencyKey);
    if (existing) {
      if (existing.type !== command.type || (existing.fingerprint !== null && existing.fingerprint !== fingerprint)) {
        throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
      }
      return { transactionId: existing.id, replayed: true };
    }

    const context = await this.ledgerContext(client, command);
    const deferPurposeCheck = command.type === 'PAYOUT_INITIATED';
    if (!deferPurposeCheck) checkStatus(context, command);

    const config = await this.configResolver.resolve({
      ledgerId: command.ledgerId,
      eventId: context.eventId ?? undefined,
      occurredAt: command.occurredAt,
      participationId: participationOf(command),
    });
    const { command: enriched, balances } = await enrich(client, command);
    const buildContext: BuildContext = { config, ...(balances ? { balances } : {}) };
    if (command.type === 'REVERSAL') {
      buildContext.original = await readOriginalLines(client, command.ledgerId, command.reversesId!);
    }

    const built = plan(enriched, buildContext);
    if (built.kind !== 'lines') throw new BuildError('VALIDATION_FAILED', `${command.type} : type délégué`);
    const lines = checkLines(built.lines);
    if (deferPurposeCheck) checkStatus(context, command, debitPurposes(lines));

    const ids = await this.accountResolver.resolve(client, command.ledgerId, lines.map((line) => line.account));
    const transactionId = await postTransaction(client, {
      ledgerId: command.ledgerId,
      type: command.type,
      key: command.idempotencyKey,
      occurredAt: command.occurredAt,
      source: command.source,
      linesJson: linesJson(
        lines.map((line) => ({ accountId: ids.get(line.account)!, amount: line.amount, ...(line.memo ? { memo: line.memo } : {}) })),
      ),
      eventId: command.eventId ?? context.eventId ?? undefined,
      reversesId: command.reversesId,
      createdBy: command.createdBy,
      approvedBy: command.approvedBy,
      configVersionId: config.configVersionId,
      deviceId: command.deviceId,
      mediaId: command.mediaId,
      metadataJson: jsonWithBigint({ ...(command.metadata ?? {}), [COMMAND_FINGERPRINT_KEY]: fingerprint }),
    });
    return { transactionId, replayed: false };
  }

  // ---------------------------------------------------------------- types délégués à la base

  private async delegate(client: Queryable, command: LedgerCommand, fn: DelegatedFunction): Promise<EngineResult> {
    const mediaId = command.mediaId;
    if (!mediaId || !UUID.test(mediaId)) throw new BuildError('VALIDATION_FAILED', `${command.type} : support (mediaId) requis`);
    const payload = (command.payload ?? {}) as DelegatedPayload;
    const media = await readMediaDepositState(client, mediaId);
    if (!media) throw new ProblemException('NOT_FOUND');
    // Clé interne écrite par la fonction (voir le schéma) ; refund_cash_due reçoit la clé de la commande.
    const internalKey = {
      take_deposit: `deposit:${mediaId}:${media.assignments}`,
      refund_deposit: `deposit-refund:${mediaId}:${media.assignments}`,
      forfeit_deposit: `deposit-forfeit:${mediaId}:${media.assignments}`,
      preload_media: `preload:${mediaId}:${media.assignments}`,
      refund_cash_due: command.idempotencyKey,
    }[fn];
    await lockIdempotencyKey(client, command.ledgerId, internalKey);
    const before = await findTransactionId(client, command.ledgerId, internalKey);

    // Idempotence d'abord : une opération déjà faite ne repasse ni par la matrice ni par la fonction. Une caution est
    // déjà faite si son statut le dit, ou si la fonction a déjà écrit sous sa clé interne pour ce détenteur (une prise
    // de caution rejouée après la confiscation ne doit pas en reprendre une).
    const isDeposit = fn === 'take_deposit' || fn === 'refund_deposit' || fn === 'forfeit_deposit';
    const alreadyDone =
      (isDeposit && before !== undefined) ||
      (fn === 'take_deposit' && media.depositStatus === 'HELD') ||
      (fn === 'refund_deposit' && media.depositStatus === 'REFUNDED') ||
      (fn === 'forfeit_deposit' && media.depositStatus === 'FORFEITED');
    if (alreadyDone) {
      return { transactionId: null, replayed: false, outcome: fn === 'take_deposit' ? media.depositStatus : 'NOOP' };
    }
    if (before && (fn === 'preload_media' || fn === 'refund_cash_due')) {
      return { transactionId: before, replayed: true, outcome: 'WRITTEN' };
    }

    const context = await this.ledgerContext(client, command);
    checkStatus(context, command);
    const account = async (code: string | undefined): Promise<string | null> => {
      if (code === undefined) return null;
      const ref: AccountRef = { code };
      return (await this.accountResolver.resolve(client, command.ledgerId, [ref])).get(ref)!;
    };

    switch (fn) {
      case 'take_deposit': {
        const outcome = await takeDeposit(client, mediaId, await account(payload.moneyAccount));
        const transactionId = outcome === 'HELD' ? ((await findTransactionId(client, command.ledgerId, internalKey)) ?? null) : null;
        return { transactionId, replayed: false, outcome };
      }
      case 'refund_deposit':
      case 'forfeit_deposit': {
        if (fn === 'refund_deposit') await refundDeposit(client, mediaId, await account(payload.moneyAccount));
        else await forfeitDeposit(client, mediaId);
        const transactionId = (await findTransactionId(client, command.ledgerId, internalKey)) ?? null;
        return { transactionId, replayed: false, outcome: transactionId ? 'WRITTEN' : 'NOOP' };
      }
      case 'preload_media': {
        const transactionId = await preloadMedia(client, mediaId);
        return { transactionId, replayed: false, outcome: transactionId ? 'WRITTEN' : 'NOOP' };
      }
      case 'refund_cash_due': {
        if (!command.createdBy) throw new BuildError('VALIDATION_FAILED', 'rendu d’espèces dues : auteur (createdBy) requis');
        const cashAccountId = await account(payload.cashAccount);
        if (!cashAccountId) throw new BuildError('VALIDATION_FAILED', 'rendu d’espèces dues : compte de caisse requis');
        const transactionId = await refundCashDue(client, {
          mediaId,
          cashAccountId,
          key: command.idempotencyKey,
          actor: command.createdBy,
          approver: command.approvedBy,
          deviceId: command.deviceId,
        });
        return { transactionId, replayed: false, outcome: 'WRITTEN' };
      }
    }
  }

  private async ledgerContext(client: Queryable, command: LedgerCommand): Promise<LedgerContextRow & { eventStatus: EventStatus }> {
    const context = await readLedgerContext(client, command.ledgerId, command.eventId, command.mediaId);
    if (!context) throw new ProblemException('NOT_FOUND');
    if (context.currency !== command.currency) {
      throw new BuildError('VALIDATION_FAILED', `devise ${command.currency} différente de celle du grand livre (${context.currency})`);
    }
    if (!context.eventStatus) throw new BuildError('VALIDATION_FAILED', 'événement du grand livre introuvable');
    return { ...context, eventStatus: context.eventStatus };
  }
}

// ------------------------------------------------------------------ fonctions du service (pures ou de lecture)

function validate(command: LedgerCommand): void {
  const fail = (message: string): never => {
    throw new BuildError('VALIDATION_FAILED', message);
  };
  if (!(TRANSACTION_TYPES as readonly string[]).includes(command.type)) fail(`type de transaction inconnu : ${command.type}`);
  if (!(SOURCES as readonly string[]).includes(command.source)) fail(`source inconnue : ${command.source}`);
  if (!command.idempotencyKey || command.idempotencyKey.length > 255) fail('clé d’idempotence : 1 à 255 caractères');
  if (!UUID.test(command.ledgerId ?? '')) fail('grand livre (ledgerId) invalide');
  if (!(command.occurredAt instanceof Date) || Number.isNaN(command.occurredAt.getTime())) fail('date de l’opération invalide');
  if (!/^[A-Z]{3}$/.test(command.currency ?? '')) fail('devise ISO 4217 attendue');
  if (command.source === 'BACKOFFICE') {
    if (!command.createdBy || !command.approvedBy) fail('back-office : auteur et valideur obligatoires');
    if (command.createdBy === command.approvedBy) fail('back-office : le valideur doit être distinct de l’auteur');
  }
  if (command.type === 'REVERSAL' && !UUID.test(command.reversesId ?? '')) fail('contre-passation : reversesId requis');
}

function variantOf(command: LedgerCommand): string | undefined {
  const payload = command.payload as { variant?: unknown } | null | undefined;
  return typeof payload?.variant === 'string' ? payload.variant : undefined;
}

function delegation(command: LedgerCommand): DelegatedFunction | undefined {
  const entry = (BUILDERS as Record<string, RegistryEntry>)[command.type];
  if (!entry || entry.kind === 'lines') return undefined;
  if (entry.kind === 'delegated') return entry.fn;
  const variant = variantOf(command);
  return variant === undefined ? undefined : entry.delegated[variant];
}

function checkStatus(context: LedgerContextRow & { eventStatus: EventStatus }, command: LedgerCommand, purposes?: string[]): void {
  const check = isAccepted({
    eventStatus: context.eventStatus,
    ledgerStatus: context.ledgerStatus,
    type: command.type,
    source: command.source,
    variant: variantOf(command),
    ...(context.depositMode ? { depositMode: context.depositMode } : {}),
    ...(purposes ? { debitPurposes: purposes } : {}),
  });
  if (!check.ok) throw new BuildError('VALIDATION_FAILED', check.reason);
}

function participationOf(command: LedgerCommand): string | undefined {
  const payload = command.payload as { participationId?: unknown } | null | undefined;
  return typeof payload?.participationId === 'string' ? payload.participationId : undefined;
}

/** ≥ 2 lignes, somme nulle, aucun montant nul (vérifié de nouveau par la base). */
function checkLines(lines: Line[]): Line[] {
  if (lines.length < 2) throw new BuildError('VALIDATION_FAILED', 'écriture : au moins deux lignes');
  if (lines.some((line) => line.amount === 0n)) throw new BuildError('VALIDATION_FAILED', 'écriture : montant nul');
  if (lines.reduce((sum, line) => sum + line.amount, 0n) !== 0n) throw new BuildError('VALIDATION_FAILED', 'écriture déséquilibrée');
  return lines;
}

function debitPurposes(lines: readonly Line[]): string[] {
  return lines.filter((line) => line.amount > 0n && 'purpose' in line.account).map((line) => (line.account as { purpose: string }).purpose);
}

/** Empreinte de ce qui fait le sens de la commande (ni la date, ni les métadonnées, comme request_hash du schéma). */
export function commandFingerprint(command: LedgerCommand): string {
  const meaning = {
    type: command.type,
    source: command.source,
    ledgerId: command.ledgerId,
    eventId: command.eventId ?? null,
    currency: command.currency,
    payload: command.payload ?? null,
    deviceId: command.deviceId ?? null,
    mediaId: command.mediaId ?? null,
    reversesId: command.reversesId ?? null,
    createdBy: command.createdBy ?? null,
    approvedBy: command.approvedBy ?? null,
  };
  const canonical = canonicalize(bigintsAsText(meaning)) ?? 'null';
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Copie où chaque bigint devient sa forme décimale exacte (`"6000n"`), sans passer par `number`. */
function bigintsAsText(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map(bigintsAsText);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bigintsAsText(item)]));
  }
  return value;
}

async function readExisting(
  client: Queryable,
  ledgerId: string,
  key: string,
): Promise<{ id: string; type: string; fingerprint: string | null } | undefined> {
  const { rows } = await client.query<{ id: string; type: string; fingerprint: string | null }>(
    `SELECT id, type, metadata->>'${COMMAND_FINGERPRINT_KEY}' AS fingerprint
       FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2`,
    [ledgerId, key],
  );
  return rows[0];
}

const available = (signed: bigint): bigint => -signed;

/** `map` asynchrone, un élément après l'autre : le client `pg` de la transaction n'exécute qu'une requête à la fois. */
async function sequentially<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) results.push(await fn(item));
  return results;
}

/** Soldes nécessaires à la répartition et au découpage (SPECIFICATION §5.4) ; ajoutés à la commande ou au contexte. */
async function enrich(client: Queryable, command: LedgerCommand): Promise<{ command: LedgerCommand; balances?: WalletBalances }> {
  const ledgerId = command.ledgerId;
  const payload = (command.payload ?? {}) as Record<string, unknown>;
  const walletId = typeof payload.walletId === 'string' ? payload.walletId : undefined;
  const withPayload = (next: Record<string, unknown>): LedgerCommand => ({ ...command, payload: { ...payload, ...next } });

  switch (command.type) {
    case 'PURCHASE':
    case 'CHARGEBACK': {
      if (!walletId) return { command };
      const [promo, paid] = await readSignedBalances(client, ledgerId, [
        { purpose: 'WALLET_PROMO', walletId },
        { purpose: 'WALLET_PAID', walletId },
      ]);
      return { command, balances: { promo: available(promo!), paid: available(paid!) } };
    }
    case 'TOPUP_CASH': {
      if (!walletId || payload.headroom !== undefined) return { command };
      const headroom = await readTopupHeadroom(client, walletId, command.occurredAt);
      return { command: headroom === undefined ? command : withPayload({ headroom }) };
    }
    case 'PROMO_EXPIRY': {
      if (!walletId || payload.amount !== undefined) return { command };
      const [promo] = await readSignedBalances(client, ledgerId, [{ purpose: 'WALLET_PROMO', walletId }]);
      return { command: withPayload({ amount: available(promo!) }) };
    }
    case 'MERCHANT_DEBT_TRANSFER': {
      const participationId = payload.participationId;
      if (typeof participationId !== 'string' || payload.merchantBalance !== undefined) return { command };
      const [signed] = await readSignedBalances(client, ledgerId, [{ purpose: 'MERCHANT', participationId }]);
      return { command: withPayload({ merchantBalance: available(signed!) }) };
    }
    case 'PITCH_FEE': {
      const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];
      const filled = await sequentially(
        items, async (item) => {
          if (item.mode !== 'DEDUCT_CAPPED' || item.merchantBalance !== undefined || typeof item.participationId !== 'string') return item;
          const [signed] = await readSignedBalances(client, ledgerId, [{ purpose: 'MERCHANT', participationId: item.participationId }]);
          return { ...item, merchantBalance: available(signed!) };
        },
      );
      return { command: withPayload({ items: filled }) };
    }
    case 'BREAKAGE': {
      const wallets = Array.isArray(payload.wallets) ? (payload.wallets as Record<string, unknown>[]) : [];
      const filled = await sequentially(
        wallets, async (item) => {
          if (typeof item.walletId !== 'string' || (item.paid !== undefined && item.cashDue !== undefined)) return item;
          const [paid, due] = await readSignedBalances(client, ledgerId, [
            { purpose: 'WALLET_PAID', walletId: item.walletId },
            { purpose: 'CUSTOMER_CASH_DUE', walletId: item.walletId },
          ]);
          return {
            ...item,
            paid: item.paid ?? available(paid!),
            ...(item.cashDue === undefined && available(due!) !== 0n ? { cashDue: available(due!) } : {}),
          };
        },
      );
      return { command: withPayload({ wallets: filled }) };
    }
    default:
      return { command };
  }
}
