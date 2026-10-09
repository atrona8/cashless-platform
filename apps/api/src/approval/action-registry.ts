// Registre des actions à deux personnes du back-office (contracts/approvals.md, règle 1). Chaque mission déclare ses
// actions (rôle exigé de l'auteur et du valideur, portée, validation des paramètres, exécuteur) et les enregistre
// par `registerApprovalActions(...)` dans son module. Aucune action métier n'est enregistrée par cette mission.
import { Injectable, type DynamicModule, type Provider } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import type { TxClient } from '../db/tenant-tx';
import type { StaffRole } from '../identity/roles.decorator';
import type { ScopeRef } from '../identity/scope-resolver';
import type { ApprovalRequestRow } from './approval.mapper';

/** Action d'une demande d'approbation (liste fermée du contrat et du schéma). */
export type ApprovalAction = components['schemas']['ApprovalAction'];

export interface ApprovalExecutionContext<P> {
  request: ApprovalRequestRow;
  payload: P;
  requestedBy: string;
  approvedBy: string;
}

export interface ApprovalExecutionResult {
  result: unknown;
  executedTxId?: string;
}

export interface ApprovalActionDefinition<P = unknown> {
  action: ApprovalAction;
  /** Rôle exigé de l'auteur comme du valideur, sur la portée de l'action (ou une portée englobante). */
  requiredRole: StaffRole;
  scopeOf(payload: P, targetId: string | null): ScopeRef;
  /** Paramètres validés et figés ; refus : ProblemException 422. */
  validate(payload: unknown): P;
  /**
   * Exécution unique, dans la transaction de l'approbation (sous un point de sauvegarde). Une ProblemException ou
   * une erreur SQL traduisible fait passer la demande FAILED ; toute autre erreur annule tout.
   */
  execute(client: TxClient, ctx: ApprovalExecutionContext<P>): Promise<ApprovalExecutionResult>;
}

@Injectable()
export class ApprovalActionRegistry {
  private readonly actions = new Map<ApprovalAction, ApprovalActionDefinition>();

  register(definition: ApprovalActionDefinition): void {
    if (this.actions.has(definition.action)) {
      throw new Error(`Action à deux personnes déjà enregistrée : ${definition.action}`);
    }
    this.actions.set(definition.action, definition);
  }

  get(action: string): ApprovalActionDefinition | undefined {
    return this.actions.get(action as ApprovalAction);
  }

  /** Actions enregistrées (filtrage des listes). */
  all(): ApprovalActionDefinition[] {
    return [...this.actions.values()];
  }
}

let registrations = 0;

/**
 * Module qui enregistre des actions dans le registre global au démarrage (une mission l'importe dans son module).
 * Un doublon fait échouer le démarrage.
 */
export function registerApprovalActions(...definitions: Array<ApprovalActionDefinition>): DynamicModule {
  registrations += 1;
  const token = Symbol(`APPROVAL_ACTIONS_${registrations}`);
  const provider: Provider = {
    provide: token,
    inject: [ApprovalActionRegistry],
    useFactory: (registry: ApprovalActionRegistry) => {
      for (const definition of definitions) registry.register(definition);
      return definitions.map((d) => d.action);
    },
  };
  return { module: class ApprovalActionsRegistration {}, providers: [provider] };
}
