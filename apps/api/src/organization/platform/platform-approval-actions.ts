// Actions à deux personnes de niveau plateforme (research R-09, contrat platform-access règle 5) : nouvelle version
// du contrat plateforme–prestataire et nouvelle version d'un profil de législation qui change un plafond
// réglementaire. Demande sans prestataire, décidée par un autre PLATFORM_ADMIN, exécutée dans la transaction de la
// plateforme. Le payload figé porte la version de référence : si elle n'est plus la dernière à l'exécution, la
// demande passe FAILED (CONFLICT_STATE), rien n'est écrit.
import { Injectable } from '@nestjs/common';
import {
  ApprovalActionRegistry,
  type ApprovalActionDefinition,
} from '../../approval/action-registry';
import type { AuditContext } from '../../audit/audit.service';
import { JurisdictionService } from '../../configuration/jurisdiction.service';
import type { CompletedJurisdictionProfile } from '../../configuration/provisional-defaults';
import { ProblemException } from '../../errors/problem';
import { OperatorsService } from './operators.service';
import { isUuid, parsePlatformContractVersion } from './platform.dto';

export interface PlatformContractVersionPayload {
  operator_id: string;
  /** Version de référence : la dernière au moment de la demande. */
  contract_id: string;
  changes: { valid_from: string; platform_fee_mode?: string };
}

export interface JurisdictionLimitsPayload {
  /** Version de référence : la dernière du pays au moment de la demande. */
  profile_id: string;
  profile: CompletedJurisdictionProfile;
}

const PLATFORM_SCOPE = () => ({ type: 'PLATFORM' as const });
const refused = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });
const record = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

/** Auteur de la demande : c'est lui qui agit, le valideur est porté par `approver_id`. */
const requester = (requestedBy: string): AuditContext => ({
  actorId: requestedBy,
  actorRole: 'PLATFORM_ADMIN',
  origin: null,
  requestId: null,
});

@Injectable()
export class PlatformApprovalActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly operators: OperatorsService,
    private readonly jurisdictions: JurisdictionService,
  ) {
    registry.register(this.contractVersion() as ApprovalActionDefinition);
    registry.register(this.limitsChange() as ApprovalActionDefinition);
  }

  private contractVersion(): ApprovalActionDefinition<PlatformContractVersionPayload> {
    return {
      action: 'PLATFORM_CONTRACT_VERSION',
      requiredRole: 'PLATFORM_ADMIN',
      platform: true,
      scopeOf: PLATFORM_SCOPE,
      validate: (raw) => {
        const payload = record(raw);
        if (!isUuid(payload.operator_id) || !isUuid(payload.contract_id))
          throw refused('operator_id et contract_id attendus.');
        return {
          operator_id: payload.operator_id,
          contract_id: payload.contract_id,
          changes: parsePlatformContractVersion(payload.changes),
        };
      },
      execute: async (client, { payload, requestedBy, approvedBy }) => ({
        result: await this.operators.createContractVersion(
          client,
          payload.operator_id,
          payload.contract_id,
          payload.changes,
          requester(requestedBy),
          approvedBy,
        ),
      }),
    };
  }

  private limitsChange(): ApprovalActionDefinition<JurisdictionLimitsPayload> {
    return {
      action: 'JURISDICTION_LIMITS_CHANGE',
      requiredRole: 'PLATFORM_ADMIN',
      platform: true,
      scopeOf: PLATFORM_SCOPE,
      validate: (raw) => {
        const payload = record(raw);
        const profile = record(payload.profile);
        if (
          !isUuid(payload.profile_id) ||
          typeof profile.country_code !== 'string' ||
          typeof profile.valid_from !== 'string'
        ) {
          throw refused('profile_id et profile attendus.');
        }
        return {
          profile_id: payload.profile_id,
          profile: profile as unknown as CompletedJurisdictionProfile,
        };
      },
      execute: async (client, { payload, requestedBy, approvedBy }) => ({
        result: await this.jurisdictions.writeVersion(
          client,
          payload.profile_id,
          payload.profile,
          requester(requestedBy),
          approvedBy,
        ),
      }),
    };
  }
}
