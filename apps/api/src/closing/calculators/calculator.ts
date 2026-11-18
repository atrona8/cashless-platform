// Calcul d'une étape de clôture (mission 9b, R-03) : UN calcul par étape, partagé par l'aperçu et l'exécution.
// `compute` ne fait que lire (aucune écriture, aucun verrou d'écriture) et rend les commandes que l'exécution
// passera au moteur ; les lignes d'aperçu viennent des lignes que les constructeurs produisent eux-mêmes.
import type { TxClient } from '../../db/tenant-tx';
import { plan } from '../../ledger/builders/registry';
import type {
  BuildContext,
  LedgerCommand,
  Line,
  ResolvedConfig,
  TransactionType,
} from '../../ledger/types';
import type { ClosingStep } from '../closing-steps.dto';

/** Étape déjà enregistrée dans `closing_step`, lue par le service avant tout calcul. */
export interface RecordedStep {
  status: 'DONE' | 'NOT_APPLICABLE';
  summary: Record<string, unknown>;
  transactionIds: string[];
}

export interface ClosingContext {
  client: TxClient;
  eventId: string;
  operatorId: string;
  organizerId: string;
  ledgerId: string;
  currency: string;
  config: ResolvedConfig;
  /** Assiette des frais du prestataire du contrat de l'événement (`GROSS` ou `NET_OF_REFUNDS`). */
  operatorFeeBasis: 'GROSS' | 'NET_OF_REFUNDS';
  /** Auteur de l'exécution ; absent pour un aperçu. */
  actorId?: string;
  now: Date;
  /** Étapes déjà faites de l'événement. */
  recorded: ReadonlyMap<ClosingStep, RecordedStep>;
}

export interface CalcLine {
  partyId: string;
  label: string;
  amount: bigint;
  reference?: string | null;
}

export interface CalcResult {
  applicable: boolean;
  lines: CalcLine[];
  /** Total de l'étape (somme de ce qui s'écrit ; les lignes sans écriture n'y comptent pas). */
  total: bigint;
  commands: LedgerCommand[];
  /** Données gardées dans `closing_step.summary` en plus des lignes (assiettes, ids de portefeuille comptés…). */
  summary: Record<string, unknown>;
}

export interface ClosingCalculator {
  readonly step: ClosingStep;
  compute(ctx: ClosingContext): Promise<CalcResult>;
}

export const notApplicable = (summary: Record<string, unknown> = {}): CalcResult => ({
  applicable: false,
  lines: [],
  total: 0n,
  commands: [],
  summary,
});

/** Commande de l'étape : source `BATCH`, auteur = la personne, sans valideur (comme le scénario de référence). */
export function closingCommand(
  ctx: ClosingContext,
  type: TransactionType,
  keySuffix: string,
  payload: unknown,
  extra: Partial<LedgerCommand> = {},
): LedgerCommand {
  return {
    type,
    idempotencyKey: `closing:${ctx.eventId}:${keySuffix}`,
    occurredAt: ctx.now,
    source: 'BATCH',
    ledgerId: ctx.ledgerId,
    eventId: ctx.eventId,
    currency: ctx.currency,
    payload,
    ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
    ...extra,
  };
}

/** Lignes que le constructeur écrirait (même fonction que le moteur). */
export function builtLines(command: LedgerCommand, ctx: ClosingContext): Line[] {
  const context: BuildContext = { config: ctx.config };
  const built = plan(command, context);
  if (built.kind !== 'lines') throw new Error(`${command.type} : type délégué`);
  return built.lines;
}

/** Somme (positive) des lignes dont le compte a l'une des fonctions données, au crédit (négatif) ou au débit. */
export function sumByPurpose(lines: readonly Line[], purposes: readonly string[], sign: 1 | -1) {
  return lines
    .filter((l) => 'purpose' in l.account && purposes.includes(l.account.purpose))
    .reduce((sum, l) => sum + (sign === 1 ? l.amount : -l.amount), 0n);
}

/** Entier lu de la base (texte ou nombre) en bigint. */
export const big = (value: unknown): bigint => BigInt(String(value ?? 0));
