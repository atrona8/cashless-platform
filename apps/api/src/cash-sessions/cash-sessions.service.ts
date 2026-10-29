// Sessions de caisse : ouverture, comptage à l'aveugle, fermeture (mission 6, lot WP08, T037 à T039 ;
// FR-001, FR-002, FR-003, FR-029, FR-031 ; contracts/cash.md règles 1 à 6). La base fait foi (migration 0036 :
// garde de caisse sur `posting`, `begin_cash_close` sous verrou, `finish_cash_close`) ; l'API refuse AVANT
// d'écrire pour donner le bon code, et la base reste le filet.
//
// Valeurs lues sous verrou, jamais du client : le théorique est celui que `begin_cash_close` rend, le compté
// est le dernier comptage, le compte de caisse vient de la session, `occurredAt` de `clock_timestamp()`.
// Aucun montant de caisse dans un message d'erreur : les problèmes viennent du catalogue.
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { assertDeviceMode } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import { requestPrincipal, type Principal } from '../identity/principal';
import type { RolesRequest } from '../identity/roles.guard';
import { exercisedRole } from '../identity/scope-resolver';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { CounterAccess, type CounterActor } from '../media/lifecycle/counter-access';
import { conflict, notFound, unprocessable } from '../organization/platform/platform.dto';
import { eventChain, loadSession, viewOf } from './cash-session-read.service';
import {
  toDto,
  type CashSessionDto,
  type CashSessionRow,
  type CountInput,
} from './cash-sessions.dto';

const CASH_DESK_PREFIX = 'A-CAISSE-';

interface BeginRow {
  cash_account_id: string;
  account_code: string;
  ledger_id: string;
  event_id: string;
  counted_amount: string;
  expected_amount: string;
}

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly counter: CounterAccess,
    private readonly audit: AuditService,
    private readonly engine: LedgerEngineService,
  ) {}

  /** Chemin terminal + personne commun à l'ouverture et au comptage : mode `TOPUP_DESK`, puis droits. */
  private async terminalActor(client: TxClient, req: Request): Promise<CounterActor> {
    const actor = await this.counter.authorize(client, req);
    assertDeviceMode(actor.device, ['TOPUP_DESK']);
    return actor;
  }

  // ------------------------------------------------------------------ ouverture (T037)

  async open(
    client: TxClient,
    req: Request,
    input: { cashAccountId: string | null },
  ): Promise<CashSessionDto> {
    const actor = await this.terminalActor(client, req);
    if (input.cashAccountId !== null) {
      // Le terminal décide de la caisse : l'identifiant fourni doit être celle de CE terminal. Première
      // ouverture : le compte n'existe pas encore, aucun identifiant ne peut donc le désigner.
      const { rows } = await client.query<{ id: string }>(
        `SELECT a.id FROM account a
          WHERE a.ledger_id = $1 AND a.purpose = 'CASH_DESK' AND a.code = $2`,
        [actor.ledgerId, `${CASH_DESK_PREFIX}${actor.device.serial ?? ''}`],
      );
      if (rows[0]?.id !== input.cashAccountId)
        throw unprocessable('cash_account_id : ce n’est pas la caisse de ce terminal.');
    }
    const { rows } = await client.query<{ cash_session_id: string }>(
      'SELECT cash_session_id FROM open_cash_session($1, $2)',
      [actor.device.deviceId, actor.userId],
    );
    const sessionId = rows[0]!.cash_session_id;
    const row = await this.reload(client, sessionId);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'CASH_SESSION_OPENED',
      objectType: 'cash_session',
      objectId: sessionId,
      after: {
        device_id: actor.device.deviceId,
        cash_account_id: row.cash_account_id,
        opened_by: actor.userId,
      },
    });
    return toDto(row, 'AGENT');
  }

  // ------------------------------------------------------------------ comptage (T038)

  async count(
    client: TxClient,
    req: Request,
    sessionId: string,
    input: CountInput,
  ): Promise<CashSessionDto> {
    const actor = await this.terminalActor(client, req);
    const row = await loadSession(client, sessionId);
    // Absente, d'un autre événement ou d'un autre terminal que celui de l'acteur : neutre.
    if (!row || row.event_id !== actor.eventId || row.device_id !== actor.device.deviceId)
      throw notFound();
    if (row.status !== 'OPEN') throw conflict('Cette session de caisse n’est pas ouverte.');
    // L'heure du comptage est celle de la base (`count_cash_session` n'a pas de paramètre d'heure déclarée) :
    // `counted_at` du corps est validé mais non retenu.
    const { rows } = await client.query<{ n: number }>(
      'SELECT count_cash_session($1, $2, $3, $4, $5) AS n',
      [sessionId, input.amount.toString(), actor.userId, actor.device.deviceId, input.note],
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'CASH_SESSION_COUNTED',
      objectType: 'cash_session',
      objectId: sessionId,
      // Le montant compté n'est pas le théorique.
      after: { count_no: rows[0]!.n, counted_amount: input.amount, counted_by: actor.userId },
    });
    return toDto(await this.reload(client, sessionId), 'AGENT');
  }

  // ------------------------------------------------------------------ fermeture (T039)

  /**
   * Fermeture par un `SUPERVISOR` de l'événement n'ayant fait aucun comptage. Chemin terminal
   * (`terminal` vrai : trois preuves + personne, terminal actif relu en base, session de CE terminal) ou
   * chemin back-office (personne seule ; le terminal peut être suspendu ou révoqué).
   */
  async close(
    client: TxClient,
    req: Request,
    sessionId: string,
    terminal: boolean,
  ): Promise<CashSessionDto> {
    const principal = requestPrincipal(req);
    let actor: CounterActor | null = null;
    if (terminal) {
      actor = await this.counter.authorize(client, req);
      assertDeviceMode(actor.device, ['TOPUP_DESK']);
    }
    const found = await loadSession(client, sessionId);
    if (!found || (actor && found.device_id !== actor.device.deviceId)) throw notFound();
    await this.assertSupervisor(client, req, principal, found.event_id);
    // Contrôles d'API, avant tout appel d'écriture (la base les refait sous verrou).
    if (found.status !== 'OPEN') throw conflict('Cette session de caisse n’est pas ouverte.');
    const counts = await client.query<{ counted_by: string }>(
      'SELECT counted_by FROM cash_session_count WHERE cash_session_id = $1',
      [sessionId],
    );
    if (counts.rows.length === 0)
      throw conflict('Aucun comptage n’a été saisi pour cette session.');
    if (counts.rows.some((count) => count.counted_by === principal.userId))
      throw new ProblemException('FORBIDDEN');

    const { rows } = await client.query<BeginRow>(
      `SELECT cash_account_id, account_code, ledger_id, event_id, counted_amount::text AS counted_amount,
              expected_amount::text AS expected_amount
         FROM begin_cash_close($1, $2)`,
      [sessionId, principal.userId],
    );
    const begin = rows[0]!;
    const counted = BigInt(begin.counted_amount);
    const expected = BigInt(begin.expected_amount);
    let closeTx: string | null = null;
    if (counted !== 0n || expected !== 0n) {
      const { rows: ctx } = await client.query<{ currency: string; now: Date }>(
        `SELECT trim(l.currency) AS currency, clock_timestamp() AS now FROM ledger l WHERE l.id = $1`,
        [begin.ledger_id],
      );
      const written = await this.engine.execute(client, {
        type: 'CASH_CLOSE',
        source: 'ONLINE',
        idempotencyKey: `cash-close:${sessionId}`,
        occurredAt: ctx[0]!.now,
        ledgerId: begin.ledger_id,
        eventId: begin.event_id,
        currency: ctx[0]!.currency,
        createdBy: principal.userId,
        ...(actor ? { deviceId: actor.device.deviceId } : {}),
        payload: {
          cashDesk: begin.account_code.slice(CASH_DESK_PREFIX.length),
          counted,
          expected,
        },
      });
      if (!written.transactionId || written.replayed)
        throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
      closeTx = written.transactionId;
    }
    // `finish_cash_close` ouvre l'anomalie `CASH_DIFF` (compté ≠ théorique) et rattache la transaction.
    await client.query('SELECT finish_cash_close($1, $2, $3)', [
      sessionId,
      principal.userId,
      closeTx,
    ]);
    const row = await this.reload(client, sessionId);
    await this.audit.record(client, {
      ...this.auditOf(req, actor),
      operatorId: actor?.operatorId ?? principal.operatorId,
      action: 'CASH_SESSION_CLOSED',
      objectType: 'cash_session',
      objectId: sessionId,
      after: {
        closed_by: principal.userId,
        device_id: row.device_id,
        expected_amount: expected,
        counted_amount: counted,
        difference: counted - expected,
        cash_close_transaction_id: closeTx,
        cash_diff_anomaly_id: row.cash_diff_anomaly_id,
      },
    });
    return toDto(row, 'MANAGER');
  }

  /** Contexte d'audit : le terminal pour le chemin terminal, sinon la requête de la personne. */
  private auditOf(req: Request, actor: CounterActor | null) {
    return actor ? { ...actor.audit, actorRole: 'SUPERVISOR' } : auditContext(req);
  }

  /**
   * `SUPERVISOR` de l'événement de la session, contrôlé ici (`CounterAccess` retient `CASHIER` avant
   * `SUPERVISOR` : on ne s'y fie pas). Aucun rôle de caisse sur cet événement : 404 ; un autre rôle : 403.
   */
  private async assertSupervisor(
    client: TxClient,
    req: Request,
    principal: Principal,
    eventId: string,
  ): Promise<void> {
    const chain = await eventChain(client, eventId);
    if (exercisedRole(principal, ['SUPERVISOR'], chain)) {
      (req as RolesRequest).exercisedRole = 'SUPERVISOR';
      return;
    }
    throw viewOf(principal, chain) === null ? notFound() : new ProblemException('FORBIDDEN');
  }

  private async reload(client: TxClient, sessionId: string): Promise<CashSessionRow> {
    const row = await loadSession(client, sessionId);
    if (!row) throw notFound();
    return row;
  }
}
