// Actions à deux personnes des clés de bracelet (SPECIFICATION §3.2 ; contracts/key-services.md) :
// `TAG_KEY_CREATE`, `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE`. Deux `OPERATOR_ADMIN` du prestataire. L'approbation n'appelle
// aucun service de clés (l'API publique n'en a pas le droit) : elle INSCRIT UN TRAVAIL, exécuté ensuite par la
// commande d'administration (création, désactivation) ou par la personnalisation (rotation, retrait).
// La recevabilité est revérifiée à l'exécution : l'état d'une clé peut avoir changé depuis la demande.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition, type ApprovalExecutionContext } from '../../approval/action-registry';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isUuid } from '../../organization/platform/platform.dto';
import { tagKeyJobDto, type TagKeyJobKind, type TagKeyRequestInput } from './keys.dto';
import { KeysService } from './keys.service';

export interface TagKeyCreatePayload extends TagKeyRequestInput {
  operator_id: string;
}

export interface TagKeyIndexPayload {
  operator_id: string;
  key_index: number;
}

const bad = (detail: string) => new ProblemException('VALIDATION_FAILED', { status: 422, detail });
const record = (raw: unknown): Record<string, unknown> => (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {});

function indexPayload(raw: unknown): TagKeyIndexPayload {
  const payload = record(raw);
  if (!isUuid(payload.operator_id) || !Number.isInteger(payload.key_index)) throw bad('operator_id et key_index attendus.');
  return { operator_id: payload.operator_id, key_index: payload.key_index as number };
}

@Injectable()
export class KeyApprovalActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly keys: KeysService,
  ) {
    registry.register(this.create() as ApprovalActionDefinition);
    registry.register(this.indexed('TAG_DEK_ROTATE', 'ROTATE_DEK', (client, index) => this.keys.assertRotatable(client, index)) as ApprovalActionDefinition);
    registry.register(this.indexed('TAG_KEY_RETIRE', 'RETIRE_KEY', (client, index) => this.keys.assertRetirable(client, index)) as ApprovalActionDefinition);
  }

  private create(): ApprovalActionDefinition<TagKeyCreatePayload> {
    return {
      action: 'TAG_KEY_CREATE',
      requiredRole: 'OPERATOR_ADMIN',
      scopeOf: (payload) => ({ type: 'OPERATOR', id: payload.operator_id }),
      validate: (raw) => {
        const payload = record(raw);
        const scope = payload.scope === 'DEDICATED' ? 'DEDICATED' : payload.scope === 'SHARED' ? 'SHARED' : null;
        if (!isUuid(payload.operator_id) || !scope) throw bad('operator_id et scope attendus.');
        if ((scope === 'DEDICATED') !== isUuid(payload.dedicated_event_id)) throw bad('dedicated_event_id : obligatoire pour une clé dédiée, interdit sinon.');
        return { operator_id: payload.operator_id, scope, dedicated_event_id: scope === 'DEDICATED' ? (payload.dedicated_event_id as string) : null };
      },
      execute: async (client, ctx) => {
        await this.keys.assertCreatable(client, ctx.payload);
        const job = await this.keys.enqueue(client, {
          keyIndex: await this.keys.nextKeyIndex(client),
          kind: 'CREATE_KEY',
          payload: { scope: ctx.payload.scope, dedicated_event_id: ctx.payload.dedicated_event_id },
          ...this.origin(ctx),
        });
        return { result: tagKeyJobDto(job) };
      },
    };
  }

  private indexed(
    action: 'TAG_DEK_ROTATE' | 'TAG_KEY_RETIRE',
    kind: TagKeyJobKind,
    assert: (client: TxClient, keyIndex: number) => Promise<void>,
  ): ApprovalActionDefinition<TagKeyIndexPayload> {
    return {
      action,
      requiredRole: 'OPERATOR_ADMIN',
      scopeOf: (payload) => ({ type: 'OPERATOR', id: payload.operator_id }),
      validate: indexPayload,
      execute: async (client, ctx) => {
        await assert(client, ctx.payload.key_index);
        return { result: tagKeyJobDto(await this.keys.enqueue(client, { keyIndex: ctx.payload.key_index, kind, payload: {}, ...this.origin(ctx) })) };
      },
    };
  }

  private origin(ctx: ApprovalExecutionContext<unknown>) {
    return { approvalRequestId: ctx.request.id, actors: { requested_by: ctx.requestedBy, approved_by: ctx.approvedBy } };
  }
}
