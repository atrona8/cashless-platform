// Ouverture de session de vendeur par le processus `vendor-pin` (mission 11a, lot WP06 ; FR-005 ;
// OP-N76, ADR-121). Le parcours « compter d'abord » de `vendors/vendor-sessions.service.ts` (mission
// 5b, A6) est déplacé tel quel, sous le rôle `cashless_pin` :
//   A. transaction validée : `begin_vendor_pin_check` compte l'essai AVANT la vérification et rend
//      `check_id` + empreinte, ou rien (vendeur inconnu, d'un autre commerçant, désactivé, bloqué :
//      rien n'est écrit) ;
//   ·  hors transaction, aucun verrou de ligne tenu : argon2id sur l'empreinte réelle, ou sur
//      l'empreinte FACTICE quand A n'a rien rendu (même coût, NFR-004) ;
//   B. seulement si le PIN est bon, qu'un `check_id` existe et que A n'a pas posé le blocage :
//      `open_vendor_session` (revérifie tout ; ferme la session précédente, `REPLACED`) et audit
//      `VENDOR_SESSION_OPENED`, dans UNE transaction ;
//   C. toute autre issue où un essai a été compté : audit `VENDOR_PIN_FAILED` (et `VENDOR_LOCKED`
//      si A a posé le blocage) dans une transaction séparée et validée.
// Le contexte d'audit vient de la charge (origine `device:<id>`), jamais d'un acteur humain.
// L'empreinte ne vit que le temps de la vérification ; ni le PIN ni l'empreinte ne sont journalisés
// ni joints à une erreur. Un plantage entre A et B laisse l'essai compté (échec sûr, voulu).
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditAction, type AuditContext } from '../audit/audit.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { VendorPinDigester } from './vendor-pin.digester';

/** Index « une session ouverte par terminal » (0031) : deux ouvertures simultanées. */
export const OPEN_SESSION_INDEX = 'vendor_session_open_per_device';

export interface VendorPinOpenInput {
  vendorId: string;
  deviceId: string;
  operatorId: string;
  pin: string;
  /** `X-Request-Id` de la requête, repris dans l'audit. */
  requestId: string | null;
}

/** Session ouverte : mêmes champs que `VendorSession` du contrat. */
export interface OpenedVendorSession {
  vendor_session_id: string;
  vendor_id: string;
  vendor_display_name: string;
  expires_at: string;
}

export type VendorPinOpenOutcome =
  | { kind: 'opened'; session: OpenedVendorSession }
  | { kind: 'refused' }
  | { kind: 'concurrent' };

interface PinCheck {
  check_id: string;
  pin_hash: string;
  locked: boolean;
}

interface SessionRow {
  vendor_session_id: string;
  vendor_id: string;
  vendor_display_name: string;
  expires_at: Date;
}

type VendorAction = Extract<
  AuditAction,
  'VENDOR_SESSION_OPENED' | 'VENDOR_PIN_FAILED' | 'VENDOR_LOCKED'
>;

const sqlstate = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

@Injectable()
export class VendorPinOpenService {
  constructor(
    private readonly tx: TenantTx,
    private readonly digester: VendorPinDigester,
    private readonly audit: AuditService,
  ) {}

  async open(input: VendorPinOpenInput): Promise<VendorPinOpenOutcome> {
    const ctx: AuditContext = {
      actorId: null,
      actorRole: null,
      origin: `device:${input.deviceId}`,
      requestId: input.requestId,
    };
    // A : essai compté et validé avant toute vérification.
    const check = await this.tx.run(input.operatorId, async (client) => {
      const { rows } = await client.query<PinCheck>(
        'SELECT check_id, pin_hash, locked FROM begin_vendor_pin_check($1, $2)',
        [input.vendorId, input.deviceId],
      );
      return rows[0] ?? null;
    });
    // Hors transaction : toujours un calcul argon2 (empreinte factice si A n'a rien rendu).
    const matches = await this.digester.verify(check?.pin_hash ?? null, input.pin);
    let outcome: VendorPinOpenOutcome = { kind: 'refused' };
    if (matches && check && !check.locked) outcome = await this.openSession(input, check, ctx);
    if (outcome.kind === 'opened') return outcome;
    // C : essai compté, aucune session : audit validé avant le refus.
    if (check) await this.recordFailure(input, check.locked, ctx);
    return outcome;
  }

  /** B : ouverture et audit dans une transaction ; refus de la base → issue. */
  private async openSession(
    input: VendorPinOpenInput,
    check: PinCheck,
    ctx: AuditContext,
  ): Promise<VendorPinOpenOutcome> {
    try {
      const session = await this.tx.run(input.operatorId, async (client) => {
        const { rows } = await client.query<SessionRow>(
          `SELECT vendor_session_id, vendor_id, vendor_display_name, expires_at
             FROM open_vendor_session($1, $2)`,
          [check.check_id, input.deviceId],
        );
        const row = rows[0]!;
        await this.record(client, input, ctx, 'VENDOR_SESSION_OPENED', {
          objectType: 'vendor_session',
          objectId: row.vendor_session_id,
          after: { vendor_id: row.vendor_id, device_id: input.deviceId },
        });
        return {
          vendor_session_id: row.vendor_session_id,
          vendor_id: row.vendor_id,
          vendor_display_name: row.vendor_display_name,
          expires_at: row.expires_at.toISOString(),
        };
      });
      return { kind: 'opened', session };
    } catch (error) {
      if (sqlstate(error) === 'CL033') return { kind: 'refused' };
      // Deux ouvertures simultanées sur le même terminal : jamais un 500.
      if (
        sqlstate(error) === '23505' &&
        (error as { constraint?: unknown }).constraint === OPEN_SESSION_INDEX
      )
        return { kind: 'concurrent' };
      throw error;
    }
  }

  private recordFailure(
    input: VendorPinOpenInput,
    locked: boolean,
    ctx: AuditContext,
  ): Promise<void> {
    return this.tx.run(input.operatorId, async (client) => {
      const target = {
        objectType: 'vendor',
        objectId: input.vendorId,
        after: { device_id: input.deviceId },
      };
      await this.record(client, input, ctx, 'VENDOR_PIN_FAILED', target);
      if (locked) await this.record(client, input, ctx, 'VENDOR_LOCKED', target);
    });
  }

  private record(
    client: TxClient,
    input: VendorPinOpenInput,
    ctx: AuditContext,
    action: VendorAction,
    entry: { objectType: string; objectId: string; after: unknown },
  ): Promise<void> {
    return this.audit.record(client, { ...ctx, operatorId: input.operatorId, action, ...entry });
  }
}
