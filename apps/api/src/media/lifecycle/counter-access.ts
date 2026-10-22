// Accès aux routes de guichet (contrat : `deviceToken` ET `humanBearer`) : un terminal enrôlé ET une personne. La garde
// globale authentifie la personne, `DeviceGuard` le terminal ; ce service vérifie ensuite que la personne a le droit
// d'agir sur l'événement de CE terminal : CASHIER ou SUPERVISOR de l'événement, ou de son organisateur. L'auteur
// rendu sert à l'audit et à l'historique des bracelets.
import { applyDecorators, Injectable, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import type { AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { DeviceGuard } from '../../device-identity/device.guard';
import { requestDevice, type DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { requestPrincipal, type Role } from '../../identity/principal';
import type { RolesRequest } from '../../identity/roles.guard';
import { StaffToken } from '../../identity/staff-token.decorator';
import { conflict } from '../../organization/platform/platform.dto';

/**
 * Route de guichet : jeton d'une personne (garde globale, lu dans `X-Staff-Authorization`, contrat
 * `staffBearer`) et identité du terminal (`Authorization` et les deux autres preuves).
 */
export const CounterAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(StaffToken(), UseGuards(DeviceGuard));

const COUNTER_ROLES: readonly Role[] = ['CASHIER', 'SUPERVISOR'];

export interface CounterActor {
  device: DeviceContext;
  operatorId: string;
  userId: string;
  eventId: string;
  organizerId: string;
  /** Grand livre de l'événement du terminal, et sa devise. */
  ledgerId: string;
  currency: string;
  debitAuthority: 'CENTRAL' | 'EDGE';
  activationModes: string[];
  identityMode: 'ANONYMOUS_ALLOWED' | 'ACCOUNT_REQUIRED';
  /** Code du compte de caisse de ce terminal (`A-CAISSE-<n° de série>`), s'il existe : créé par les sessions de caisse. */
  cashDeskCode: string | null;
  audit: AuditContext;
}

interface CounterRow {
  organizer_id: string;
  activation_modes: string[];
  identity_mode: 'ANONYMOUS_ALLOWED' | 'ACCOUNT_REQUIRED';
  ledger_id: string | null;
  currency: string | null;
  debit_authority: 'CENTRAL' | 'EDGE' | null;
  cash_desk_code: string | null;
}

@Injectable()
export class CounterAccess {
  /** À appeler dans la transaction de la requête : terminal, événement, droit de la personne. */
  async authorize(client: TxClient, req: Request): Promise<CounterActor> {
    const device = requestDevice(req);
    const principal = requestPrincipal(req);
    // Une personne n'agit qu'avec un terminal de son prestataire (sinon : comme un terminal inconnu).
    if (principal.operatorId !== device.operatorId) throw new ProblemException('NOT_FOUND');
    if (!device.eventId) throw conflict('Ce terminal n’est affecté à aucun événement.');
    // Statut relu dans la transaction de l'écriture (mission 5a, R-14) : une révocation ou une
    // suspension validée après la garde est vue ici (FOR SHARE, avant toute écriture).
    await client.query('SELECT assert_device_active($1)', [device.deviceId]);
    const { rows } = await client.query<CounterRow>(
      `SELECT e.organizer_id, e.activation_modes, e.identity_mode, l.id AS ledger_id, l.currency, l.debit_authority,
              (SELECT a.code FROM account a WHERE a.ledger_id = l.id AND a.purpose = 'CASH_DESK' AND a.is_active AND a.code = 'A-CAISSE-' || d.serial) AS cash_desk_code
         FROM device d JOIN event e ON e.id = d.event_id
         LEFT JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id
        WHERE d.id = $1`,
      [device.deviceId],
    );
    const row = rows[0];
    if (!row) throw new ProblemException('NOT_FOUND');
    const role = COUNTER_ROLES.find((candidate) =>
      principal.assignments.some(
        (a) =>
          a.role === candidate &&
          ((a.scopeType === 'EVENT' && a.scopeId === device.eventId) ||
            (a.scopeType === 'ORGANIZER' && a.scopeId === row.organizer_id)),
      ),
    );
    if (!role) throw new ProblemException('FORBIDDEN');
    if (!row.ledger_id || !row.currency)
      throw conflict('L’événement de ce terminal n’a pas de grand livre.');
    (req as RolesRequest).exercisedRole = role;
    return {
      device,
      operatorId: device.operatorId,
      userId: principal.userId,
      eventId: device.eventId,
      organizerId: row.organizer_id,
      ledgerId: row.ledger_id,
      currency: row.currency.trim(),
      debitAuthority: row.debit_authority ?? 'CENTRAL',
      activationModes: row.activation_modes,
      identityMode: row.identity_mode,
      cashDeskCode: row.cash_desk_code,
      // L'origine d'une action de guichet est le terminal, pas l'adresse du réseau.
      audit: { ...auditContext(req), origin: `device:${device.deviceId}` },
    };
  }
}

/** Portée d'idempotence d'une route de guichet : le terminal (`Idempotency-Key = serial:seq`). */
export const counterScope = (req: Request): string => `device:${requestDevice(req).deviceId}:`;
