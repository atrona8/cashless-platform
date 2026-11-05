// Import du journal d'un terminal révoqué, côté demande et lecture (mission 7, lot WP20, T084 ; FR-034, FR-035 ;
// R-30.10). Ordre de la demande : corps (texte source, numéros exacts) -> terminal sous la RLS du prestataire ->
// RÔLE de la personne sur l'événement du terminal (la base ne contrôle PAS `p_actor`) -> terminal `REVOKED` -> aucun
// lot du terminal en cours -> signatures, chaîne et raccords -> synthèse et empreinte -> `create_device_journal_import`
// et demande `DEVICE_JOURNAL_IMPORT`. Rien n'est créé si un contrôle échoue.
import { Injectable } from '@nestjs/common';
import type { ApprovalClosure } from '../../approval/action-registry';
import { ApprovalService, type ApprovalActor } from '../../approval/approval.service';
import type { ApprovalRequestDto } from '../../approval/approval.mapper';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { exercisedRole, resolveChain } from '../../identity/scope-resolver';
import { isUuid, notFound, unprocessable } from '../../organization/platform/platform.dto';
import type { TenantActor } from '../../organization/tenant/tenant-access';
import { inProgress } from '../batches/batch-runner';
import { SEQ_FIELDS } from '../batches/batch.types';
import { parseWithSafeIntegers } from '../batches/raw-json';
import { MAX_IMPORT_BYTES } from './journal-body';
import { JournalImportActions, type JournalImportPayload } from './journal-import.action';
import {
  batchesSha256,
  parseImportBatches,
  readImportTerminal,
  summarize,
  verifyImportBatches,
  type ImportSummary,
  type ImportTerminal,
  type StoredBatch,
} from './journal-verify';

export const IMPORT_REASON_MIN = 10;

/** Corps analysé, avant toute lecture en base. */
export interface PreparedImport {
  reason: string;
  parsed: ReturnType<typeof parseImportBatches>['parsed'];
  stored: StoredBatch[];
}

/** Corps vérifié contre le terminal : prêt à écrire. */
export interface CheckedImport extends PreparedImport {
  terminal: ImportTerminal;
  eventId: string;
  sha256: Buffer;
  summary: ImportSummary;
}

/** `DeviceJournalImportResult` du contrat. */
export interface JournalImportView {
  device_id: string;
  status: 'PROCESSING' | 'APPLIED' | 'FAILED';
  results: unknown[];
}

@Injectable()
export class JournalImportService {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    private readonly actions: JournalImportActions,
  ) {}

  /** Corps brut -> lots analysés. `400` (JSON, numéro hors 2^53 - 1, schéma), `413` (taille), `422` (motif, champs). */
  prepare(rawBody: Buffer | undefined, tooLarge: boolean): PreparedImport {
    if (tooLarge || (rawBody !== undefined && rawBody.length > MAX_IMPORT_BYTES))
      throw new ProblemException('BATCH_TOO_LARGE', { status: 413 });
    if (rawBody === undefined || rawBody.length === 0)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 400,
        detail: 'Corps de l’import absent.',
      });
    const body = parseWithSafeIntegers(rawBody.toString('utf8'), SEQ_FIELDS);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw unprocessable('Corps JSON (objet) attendu.');
    const record = body as Record<string, unknown>;
    const foreign = Object.keys(record).filter((key) => key !== 'batches' && key !== 'reason');
    if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
    if (typeof record.reason !== 'string' || record.reason.trim().length < IMPORT_REASON_MIN)
      throw unprocessable(`reason : au moins ${IMPORT_REASON_MIN} caractères attendus.`);
    const { parsed, stored } = parseImportBatches(record.batches);
    return { reason: record.reason.trim(), parsed, stored };
  }

  /**
   * Contrôles qui lisent la base (lecture seule, transaction du prestataire) puis vérification des lots.
   * `404` terminal inconnu ou d'un autre prestataire ; `403` sans `SUPERVISOR` sur l'événement du terminal ;
   * `409 CONFLICT_STATE` terminal non révoqué (CL052) ; `409 BATCH_IN_PROGRESS` lot récent en cours.
   */
  async check(
    read: <T>(fn: (client: TxClient) => Promise<T>) => Promise<T>,
    actor: TenantActor,
    deviceId: string,
    prepared: PreparedImport,
  ): Promise<CheckedImport> {
    const terminal = await read(async (client) => {
      const found = await readImportTerminal(client, deviceId);
      if (!found) throw notFound();
      // Le rôle AVANT tout indice sur le terminal, et sans révéler son existence (porteur,
      // 04/11/2026) : sans
      // rôle sur l'événement, ou sans événement, la réponse est celle d'un terminal inconnu (404 neutre).
      if (found.eventId === null) throw notFound();
      const chain = await resolveChain(client, { type: 'EVENT', id: found.eventId });
      if (!exercisedRole(actor.principal, ['SUPERVISOR'], chain)) throw notFound();
      if (found.status !== 'REVOKED')
        throw new ProblemException('CONFLICT_STATE', {
          status: 409,
          detail: 'Seul le journal d’un terminal révoqué s’importe.',
        });
      const { rows } = await client.query(
        `SELECT 1 FROM offline_batch
          WHERE device_id = $1 AND status = 'PROCESSING'
            AND received_at >= clock_timestamp() - interval '15 minutes'`,
        [deviceId],
      );
      if (rows.length > 0) throw inProgress();
      return found;
    });
    verifyImportBatches(prepared.parsed, terminal);
    return {
      ...prepared,
      terminal,
      eventId: terminal.eventId!,
      sha256: batchesSha256(prepared.stored),
      summary: summarize(prepared.parsed, terminal.lastSeenAt),
    };
  }

  /** Crée l'import (`PENDING`) et la demande `DEVICE_JOURNAL_IMPORT` portant empreinte et synthèse. */
  async request(
    client: TxClient,
    actor: ApprovalActor,
    checked: CheckedImport,
  ): Promise<ApprovalRequestDto> {
    const { terminal } = checked;
    await this.releaseClosed(
      client,
      terminal.operatorId,
      terminal.deviceId,
      actor.principal.userId,
    );
    const { rows } = await client.query<{ id: string }>(
      'SELECT create_device_journal_import($1, $2::jsonb, $3, $4::jsonb, $5, $6) AS id',
      [
        terminal.deviceId,
        JSON.stringify(checked.stored),
        checked.sha256,
        JSON.stringify(checked.summary),
        checked.reason,
        actor.principal.userId,
      ],
    );
    const importId = rows[0]!.id;
    const payload: JournalImportPayload = {
      import_id: importId,
      device_id: terminal.deviceId,
      batches_sha256: checked.sha256.toString('hex'),
      summary: checked.summary,
      reason: checked.reason,
      scope_type: 'EVENT',
      scope_id: checked.eventId,
    };
    const request = await this.approvals.request(
      client,
      terminal.operatorId,
      { action: 'DEVICE_JOURNAL_IMPORT', targetId: importId, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: terminal.operatorId,
      action: 'DEVICE_JOURNAL_IMPORT_REQUESTED',
      objectType: 'device_journal_import',
      objectId: importId,
      after: {
        import_id: importId,
        device_id: terminal.deviceId,
        batches_sha256: payload.batches_sha256,
        summary: checked.summary,
        reason: checked.reason,
        approval_request_id: request.approval_request_id,
      },
    });
    return request;
  }

  /**
   * Libère l'import `PENDING` du terminal dont la demande d'approbation est fermée sans que personne ne l'ait
   * décidée (échue sans jamais être touchée) : sans cela l'index d'unicité refuserait la nouvelle demande. Les
   * refus et les échecs sont déjà traités à leur décision (`onClosed`) ; l'appel est idempotent.
   */
  private async releaseClosed(
    client: TxClient,
    operatorId: string,
    deviceId: string,
    actorId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ target_id: string; outcome: ApprovalClosure }>(
      `SELECT target_id,
              CASE WHEN status = 'PENDING' THEN 'EXPIRED' ELSE status END AS outcome
         FROM approval_request
        WHERE action = 'DEVICE_JOURNAL_IMPORT' AND payload->>'device_id' = $1
          AND (status IN ('REJECTED', 'EXPIRED', 'FAILED')
               OR (status = 'PENDING' AND expires_at < clock_timestamp()))
        ORDER BY requested_at DESC LIMIT 5`,
      [deviceId],
    );
    for (const row of rows) {
      if (row.target_id !== null)
        await this.actions.cancel(client, operatorId, row.target_id, row.outcome, actorId);
    }
  }

  /**
   * `getDeviceJournalImport` : `SUPERVISOR` ou `ORGANIZER_ADMIN` sur l'événement du terminal. `404` neutre pour un
   * terminal ou un import inconnu, d'un autre prestataire, qui n'est pas celui de ce terminal, sans rôle sur
   * l'événement, ou pas encore approuvé (`PENDING`, jamais exposé : le contrat ne connaît que PROCESSING, APPLIED,
   * FAILED).
   */
  async view(
    client: TxClient,
    actor: TenantActor,
    deviceId: string,
    importId: string,
  ): Promise<JournalImportView> {
    if (!isUuid(deviceId) || !isUuid(importId)) throw notFound();
    const terminal = await readImportTerminal(client, deviceId);
    if (!terminal || terminal.eventId === null) throw notFound();
    const chain = await resolveChain(client, { type: 'EVENT', id: terminal.eventId });
    if (!exercisedRole(actor.principal, ['SUPERVISOR', 'ORGANIZER_ADMIN'], chain)) throw notFound();
    // La fonction contrôle le prestataire elle-même (assert_tenant) ; un import inconnu ou étranger lève une erreur.
    const row = await client
      .query<{
        id: string | null;
        device_id: string;
        status: string;
        result: unknown;
      }>('SELECT id, device_id, status, result FROM device_journal_import_view($1, false)', [
        importId,
      ])
      .then(
        (r) => r.rows[0],
        () => undefined,
      );
    if (!row || row.id === null || row.device_id !== deviceId) throw notFound();
    if (row.status === 'PROCESSING')
      return { device_id: deviceId, status: 'PROCESSING', results: [] };
    if (row.status === 'APPLIED' || row.status === 'FAILED') {
      const results = (row.result as { results?: unknown } | null)?.results;
      return {
        device_id: deviceId,
        status: row.status,
        results: Array.isArray(results) ? results : [],
      };
    }
    throw notFound();
  }
}
