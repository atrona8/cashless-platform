// Sessions de vendeur sur un terminal (mission 5b, lot WP09, T040 à T042 ; mission 11a, lot WP07 ;
// FR-003 à FR-006, FR-026, NFR-002 à NFR-004 ; contracts/vendors.md ; research R-11 A6, A7, A15, A22).
//
// Depuis la mission 11a (OP-N76, ADR-121), l'ouverture « compter d'abord » (essai compté avant la
// vérification, argon2id, `open_vendor_session`, audit `VENDOR_SESSION_OPENED` / `VENDOR_PIN_FAILED` /
// `VENDOR_LOCKED`) est faite par le processus `vendor-pin`, sous le rôle `cashless_pin`. L'API ne
// fait que : tenir le verrou d'essai du terminal (pris par la route avant l'idempotence), appeler le
// processus par `VendorPinClient` (signé, sans relance, SANS repli) et traduire l'issue.
// Processus indisponible : erreur de service, jamais de vérification locale ni de session. Un essai
// compté avant une panne reste compté (échec sûr, voulu). L'API n'exécute plus
// `begin_vendor_pin_check` ni `open_vendor_session`.
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService, type AuditAction, type AuditContext } from '../audit/audit.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import type { DeviceContext } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import { requestIdOf } from '../http/request-id.middleware';
import type { IdempotentTx } from '../idempotency/idempotent.decorator';
import { attemptInProgress } from './pin-attempt-lock';
import { VendorPinClient } from './vendor-pin.client';
import {
  terminalVendorDto,
  type TerminalVendorList,
  type TerminalVendorRow,
  type VendorSession,
  type VendorSessionOpenInput,
} from './vendors.dto';

/** Refus unique de l'ouverture (NFR-004) : aucun détail propre au cas. */
export const pinInvalid = (): ProblemException => new ProblemException('VENDOR_PIN_INVALID');

/** Contexte d'audit d'une requête de terminal : aucun acteur humain, origine = le terminal. */
export function deviceAudit(req: Request, device: DeviceContext): AuditContext {
  return {
    actorId: null,
    actorRole: null,
    origin: `device:${device.deviceId}`,
    requestId: requestIdOf(req) || null,
  };
}

@Injectable()
export class VendorSessionsService {
  constructor(
    private readonly tx: TenantTx,
    private readonly pin: VendorPinClient,
    private readonly audit: AuditService,
  ) {}

  /** Vendeurs `ACTIVE`, non bloqués, du commerçant du point de vente du terminal (A22). */
  async listForTerminal(device: DeviceContext): Promise<TerminalVendorList> {
    // Terminal sans point de vente (ou point de vente sans commerçant) : liste vide.
    if (!device.merchantId) return { data: [] };
    const rows = await this.tx.run(device.operatorId, async (client) => {
      const result = await client.query<TerminalVendorRow>(
        `SELECT v.id, v.display_name
           FROM vendor_public v
          WHERE v.operator_id = $1 AND v.merchant_id = $2
            AND v.status = 'ACTIVE' AND NOT v.locked
          ORDER BY v.display_name, v.id`,
        [device.operatorId, device.merchantId],
      );
      return result.rows;
    });
    return { data: rows.map(terminalVendorDto) };
  }

  /**
   * Ouverture : mode et corps déjà contrôlés par le contrôleur. Le verrou d'essai du terminal est
   * déjà tenu par la requête (`RequestLock` de la route) : un second essai simultané n'arrive pas
   * jusqu'ici (`429` sans appel au processus). Le contexte d'audit part avec la requête
   * (`X-Request-Id`) : le processus écrit lui-même l'audit.
   */
  async open(
    device: DeviceContext,
    input: VendorSessionOpenInput,
    tx: IdempotentTx,
    audit: AuditContext,
  ): Promise<VendorSession> {
    const outcome = await this.pin.open({
      operatorId: device.operatorId,
      deviceId: device.deviceId,
      vendorId: input.vendorId,
      pin: input.pin,
      requestId: audit.requestId ?? null,
    });
    // Transaction vide, ouverte APRÈS l'appel (aucune transaction pendant argon2) : elle ne fait
    // qu'enregistrer, avec la clé, le refus de rejeu de la route `transient` (409 au renvoi).
    if (outcome.kind === 'opened') return tx.run(async () => outcome.session);
    throw outcome.kind === 'concurrent' ? attemptInProgress() : pinInvalid();
  }

  /** Fermeture demandée par le terminal (`LOGOUT`) ; sans session ouverte : rien d'écrit. */
  async close(device: DeviceContext, tx: IdempotentTx, audit: AuditContext): Promise<void> {
    await tx.run(async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        'SELECT close_vendor_session($1) AS id',
        [device.deviceId],
      );
      const closed = rows[0]?.id ?? null;
      if (closed !== null)
        await this.record(client, device, audit, 'VENDOR_SESSION_CLOSED', {
          objectType: 'vendor_session',
          objectId: closed,
          after: { reason: 'LOGOUT', device_id: device.deviceId },
        });
    });
  }

  private record(
    client: TxClient,
    device: DeviceContext,
    audit: AuditContext,
    action: Extract<
      AuditAction,
      'VENDOR_SESSION_OPENED' | 'VENDOR_SESSION_CLOSED' | 'VENDOR_PIN_FAILED' | 'VENDOR_LOCKED'
    >,
    entry: { objectType: string; objectId: string; after: unknown },
  ): Promise<void> {
    return this.audit.record(client, {
      ...audit,
      operatorId: device.operatorId,
      action,
      ...entry,
    });
  }
}
