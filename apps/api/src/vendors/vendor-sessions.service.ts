// Sessions de vendeur sur un terminal (mission 5b, lot WP09, T040 à T042 ; FR-003 à FR-006,
// FR-026, NFR-002 à NFR-004 ; contracts/vendors.md ; research R-11 A6, A7, A15, A22).
//
// Ouverture « compter d'abord » (A6), sous le verrou d'essai du terminal (pin-attempt-lock.ts, pris
// avant l'idempotence par la route, request-lock.ts) :
//   A. transaction validée : `begin_vendor_pin_check` compte l'essai AVANT la vérification et rend
//      `check_id` + empreinte, ou rien (vendeur inconnu, d'un autre commerçant, désactivé, bloqué :
//      rien n'est écrit) ;
//   ·  hors transaction, aucun verrou de ligne tenu : argon2id sur l'empreinte réelle, ou sur
//      l'empreinte FACTICE quand A n'a rien rendu (même coût, NFR-004) ;
//   B. seulement si le PIN est bon, qu'un `check_id` existe et que A n'a pas posé le blocage :
//      `open_vendor_session` (revérifie tout ; ferme la session précédente, `REPLACED`), audit
//      `VENDOR_SESSION_OPENED`, dans la transaction de la requête idempotente ;
//   C. toute autre issue où un essai a été compté : audit `VENDOR_PIN_FAILED` (et `VENDOR_LOCKED`
//      si A a posé le blocage) dans une transaction séparée et validée, puis
//      `401 VENDOR_PIN_INVALID`, même corps pour toutes les causes. Un essai non compté n'écrit
//      aucune ligne d'audit sur un vendeur.
//
// Limite consignée (A15, OP-N76, ADR-121) : l'API lit l'empreinte par `begin_vendor_pin_check`,
// et par lui seul ; la base ouvre la session sur la foi de B. Rien ici ne l'élargit : aucune autre
// lecture de `pin_hash`, aucune ouverture hors `open_vendor_session`. L'empreinte ne vit que le
// temps de la vérification ; elle n'est ni journalisée, ni jointe à une erreur. Un plantage entre
// A et B laisse l'essai compté (échec sûr, voulu).
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService, type AuditAction, type AuditContext } from '../audit/audit.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import type { DeviceContext } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import { requestIdOf } from '../http/request-id.middleware';
import type { IdempotentTx } from '../idempotency/idempotent.decorator';
import { VendorPinHasher } from '../vendor-pin/vendor-pin.hasher';
import { attemptInProgress } from './pin-attempt-lock';
import {
  terminalVendorDto,
  vendorSessionDto,
  type TerminalVendorList,
  type TerminalVendorRow,
  type VendorSession,
  type VendorSessionOpenInput,
  type VendorSessionRow,
} from './vendors.dto';

/**
 * Index « une session ouverte par terminal » (0031) ; deux ouvertures simultanées (relecture
 * WP02).
 */
export const OPEN_SESSION_INDEX = 'vendor_session_open_per_device';

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

interface PinCheck {
  check_id: string;
  pin_hash: string;
  locked: boolean;
}

type Outcome =
  | { kind: 'opened'; session: VendorSession }
  | { kind: 'refused' }
  | { kind: 'concurrent' };

const sqlstate = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

@Injectable()
export class VendorSessionsService {
  constructor(
    private readonly tx: TenantTx,
    private readonly hasher: VendorPinHasher,
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
   * Ouverture « compter d'abord » ; mode et corps déjà contrôlés par le contrôleur. Le verrou
   * d'essai du terminal est déjà tenu par la requête (`RequestLock` de la route).
   */
  async open(
    device: DeviceContext,
    input: VendorSessionOpenInput,
    tx: IdempotentTx,
    audit: AuditContext,
  ): Promise<VendorSession> {
    // A : essai compté et validé avant toute vérification.
    const check = await this.tx.run(device.operatorId, async (client) => {
      const { rows } = await client.query<PinCheck>(
        'SELECT check_id, pin_hash, locked FROM begin_vendor_pin_check($1, $2)',
        [input.vendorId, device.deviceId],
      );
      return rows[0] ?? null;
    });
    // Hors transaction : toujours un calcul argon2 (empreinte factice si A n'a rien rendu).
    const matches = await this.hasher.verify(check?.pin_hash ?? null, input.pin);
    let outcome: Outcome = { kind: 'refused' };
    if (matches && check && !check.locked)
      outcome = await this.openSession(device, check, tx, audit);
    if (outcome.kind === 'opened') return outcome.session;
    // C : essai compté, aucune session : audit validé avant le refus.
    if (check) await this.recordFailure(device, input.vendorId, check.locked, audit);
    throw outcome.kind === 'concurrent' ? attemptInProgress() : pinInvalid();
  }

  /** B : ouverture dans la transaction de la requête idempotente ; refus de la base → issue. */
  private async openSession(
    device: DeviceContext,
    check: PinCheck,
    tx: IdempotentTx,
    audit: AuditContext,
  ): Promise<Outcome> {
    try {
      const session = await tx.run(async (client) => {
        const { rows } = await client.query<VendorSessionRow>(
          `SELECT vendor_session_id, vendor_id, vendor_display_name, expires_at
             FROM open_vendor_session($1, $2)`,
          [check.check_id, device.deviceId],
        );
        const row = rows[0]!;
        await this.record(client, device, audit, 'VENDOR_SESSION_OPENED', {
          objectType: 'vendor_session',
          objectId: row.vendor_session_id,
          after: { vendor_id: row.vendor_id, device_id: device.deviceId },
        });
        return vendorSessionDto(row);
      });
      return { kind: 'opened', session };
    } catch (error) {
      if (sqlstate(error) === 'CL033') return { kind: 'refused' };
      // Deux ouvertures simultanées sur le même terminal (hors du verrou d'essai) : jamais un 500.
      if (
        sqlstate(error) === '23505' &&
        (error as { constraint?: unknown }).constraint === OPEN_SESSION_INDEX
      )
        return { kind: 'concurrent' };
      throw error;
    }
  }

  private recordFailure(
    device: DeviceContext,
    vendorId: string,
    locked: boolean,
    audit: AuditContext,
  ): Promise<void> {
    return this.tx.run(device.operatorId, async (client) => {
      const target = {
        objectType: 'vendor',
        objectId: vendorId,
        after: { device_id: device.deviceId },
      };
      await this.record(client, device, audit, 'VENDOR_PIN_FAILED', target);
      if (locked) await this.record(client, device, audit, 'VENDOR_LOCKED', target);
    });
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
