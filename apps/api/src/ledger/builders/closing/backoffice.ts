// ANOMALY_RESOLUTION, ADJUSTMENT, BREAKAGE, BREAKAGE_REVERSAL — SPECIFICATION §5.4, §12.1 (ADR-67, ADR-75).
import { roundDiv, splitShare } from '../../money';
import {
  BuildError,
  cashDue,
  legalBreakage,
  partyAccounts,
  suspense,
  wallet,
  type BuildContext,
  type LedgerCommand,
  type Line,
} from '../../types';
import { balanced, push, requireId, requirePositive } from '../festival/lines';

/** Écriture manuelle : source `BACKOFFICE`, auteur et valideur présents et distincts (deux personnes). */
export function requireBackoffice(command: LedgerCommand): void {
  if (command.source !== 'BACKOFFICE') {
    throw new BuildError('VALIDATION_FAILED', `${command.type} : source BACKOFFICE obligatoire`);
  }
  requireApprovers(command);
}

/** Toute commande `BACKOFFICE` porte un auteur et un valideur distincts (contrainte de journal_transaction). */
export function requireApprovers(command: LedgerCommand): void {
  if (!command.createdBy || !command.approvedBy || command.createdBy === command.approvedBy) {
    throw new BuildError('VALIDATION_FAILED', 'back-office : auteur et valideur distincts requis');
  }
}

export interface AnomalyResolutionPayload {
  amount: bigint;
}

/** Perte hors ligne : le compte d'attente est soldé par les pertes de `offline_loss_bearer`. */
export function buildAnomalyResolution(
  command: LedgerCommand<'ANOMALY_RESOLUTION', AnomalyResolutionPayload>,
  ctx: BuildContext,
): Line[] {
  requireBackoffice(command);
  const amount = requirePositive(command.payload.amount, 'résolution d’anomalie');
  const { config } = ctx;
  const { org, ope } = partyAccounts(config);
  return balanced([
    { account: config.offlineLossBearer === 'OPERATOR' ? ope('OPE_PERTES') : org('ORG_PERTES'), amount },
    { account: suspense(), amount: -amount },
  ]);
}

export interface AdjustmentPayload {
  lines: Line[];
}

/** Ajustement : lignes fournies par la commande, motif obligatoire (`metadata.reason`). */
export function buildAdjustment(command: LedgerCommand<'ADJUSTMENT', AdjustmentPayload>, _ctx: BuildContext): Line[] {
  requireBackoffice(command);
  const reason = command.metadata?.['reason'];
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new BuildError('VALIDATION_FAILED', 'ajustement : motif obligatoire (metadata.reason)');
  }
  const lines = command.payload.lines ?? [];
  const sum = lines.reduce((total, line) => total + line.amount, 0n);
  if (lines.length < 2 || sum !== 0n || lines.some((line) => line.amount === 0n)) {
    throw new BuildError('VALIDATION_FAILED', 'ajustement : au moins deux lignes non nulles, de somme nulle');
  }
  return lines.map((line) => ({ ...line }));
}

export interface BreakagePayload {
  /** Soldes restants à la date limite de remboursement (positif = dû au festivalier). */
  wallets: { walletId: string; paid: bigint; cashDue?: bigint }[];
}

/** Casse : soldes payés (et espèces dues) des portefeuilles, partagés selon la destination légale. */
export function buildBreakage(command: LedgerCommand<'BREAKAGE', BreakagePayload>, ctx: BuildContext): Line[] {
  const { config } = ctx;
  if (config.breakageDestination === 'NONE') throw new BuildError('VALIDATION_FAILED', 'casse : destination NONE, aucune casse');
  const { org, ope } = partyAccounts(config);
  const lines: Line[] = [];
  for (const item of command.payload.wallets ?? []) {
    requireId(item.walletId, 'portefeuille');
    push(lines, wallet(item.walletId, 'P'), item.paid);
    push(lines, cashDue(item.walletId), item.cashDue ?? 0n);
  }
  const total = requirePositive(lines.reduce((sum, line) => sum + line.amount, 0n), 'casse');
  if (config.breakageDestination === 'LEGAL_ACCOUNT') {
    push(lines, legalBreakage(), -total);
  } else {
    const [organizer, operator] = splitShare(total, config.breakageOrganizerBps);
    push(lines, org('ORG_CASSE'), -organizer);
    push(lines, ope('OPE_CASSE'), -operator);
  }
  return balanced(lines);
}

export interface BreakageReversalPayload {
  walletId: string;
  amount: bigint;
  /** Parts de la casse initiale du portefeuille : organisateur et prestataire, ou compte légal. */
  originalShares: { organizer: bigint; operator: bigint } | { legal: bigint };
}

/** Réclamation tardive : chaque bénéficiaire de la casse est débité au prorata de sa part initiale (± 1). */
export function buildBreakageReversal(
  command: LedgerCommand<'BREAKAGE_REVERSAL', BreakageReversalPayload>,
  ctx: BuildContext,
): Line[] {
  requireBackoffice(command);
  const { walletId, amount, originalShares } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'réclamation tardive');
  const { org, ope } = partyAccounts(ctx.config);
  const lines: Line[] = [];
  if ('legal' in originalShares) {
    push(lines, legalBreakage(), amount);
  } else {
    const shares = requirePositive(originalShares.organizer + originalShares.operator, 'casse initiale');
    const organizer = roundDiv(amount * originalShares.organizer, shares);
    push(lines, org('ORG_CASSE'), organizer);
    push(lines, ope('OPE_CASSE'), amount - organizer);
  }
  push(lines, wallet(walletId, 'P'), -amount);
  return balanced(lines);
}
