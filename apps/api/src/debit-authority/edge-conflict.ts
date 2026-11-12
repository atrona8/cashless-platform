// Corps complet du `409 DEBIT_AUTHORITY_EDGE` (mission passerelle-locale, lot WP11, T049 ; edge-routes.md « Corps du
// 409 »). Le contrat illustre `edge_base_url` et `authority_epoch` ; le central DOIT les renseigner. Un seul point
// d'accroche : le filtre d'erreurs (`errors/problem.filter.ts`), pour tout `CL006` et tout `ProblemException`
// `DEBIT_AUTHORITY_EDGE` levé à la main. Aucun code, aucun statut ni aucune route nouvelle.
//
// Le filtre s'exécute APRÈS l'annulation de la transaction métier : la lecture se fait dans une transaction neuve du
// prestataire de la requête. Règle d'or : jamais un champ faux. Si le grand livre n'est pas retrouvé avec certitude,
// ou n'est plus `EDGE` à la lecture, le corps garde son ancienne forme. Les champs ne sont rendus qu'à un appelant
// authentifié (le contexte de prestataire est celui de la garde ; sans lui, rien).
import type { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import type { DeviceRequest } from '../device-identity/device-identity.port';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';

export interface EdgeConflictExtensions {
  edge_base_url: string | null;
  authority_epoch: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Autorité du grand livre lue par `get_debit_authority` ; `null` si le grand livre n'est pas (ou plus) `EDGE`. */
export async function edgeConflictExtensions(
  client: TxClient,
  ledgerId: string,
): Promise<EdgeConflictExtensions | null> {
  const { rows } = await client.query<{ authority: string; epoch: string; lan_url: string | null }>(
    'SELECT authority, epoch, lan_url FROM get_debit_authority($1)',
    [ledgerId],
  );
  const row = rows[0];
  if (!row || row.authority !== 'EDGE') return null;
  return { edge_base_url: row.lan_url, authority_epoch: Number(row.epoch) };
}

/**
 * Retrouve le grand livre refusé depuis la requête, sans jamais le deviner : (1) le `ledger_id` du chemin ;
 * (2) l'événement du terminal authentifié ; (3) à défaut, l'unique grand livre `EDGE` du prestataire (un refus
 * `CL006` ne peut venir que d'un grand livre `EDGE` : s'il est unique, c'est lui ; s'il y en a plusieurs, rien).
 */
async function ledgerOf(client: TxClient, req: Request): Promise<string | null> {
  const path = (req.params as Record<string, string | undefined> | undefined)?.ledger_id;
  if (path !== undefined) return UUID.test(path) ? path : null;
  const eventId = (req as DeviceRequest).device?.eventId;
  if (eventId) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = $1`,
      [eventId],
    );
    return rows.length === 1 ? rows[0]!.id : null;
  }
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM ledger WHERE debit_authority = 'EDGE' LIMIT 2`,
  );
  return rows.length === 1 ? rows[0]!.id : null;
}

/** Complète un `DEBIT_AUTHORITY_EDGE` à partir de la requête ; toute difficulté rend `null` (ancienne forme). */
export class EdgeConflictEnricher {
  constructor(private readonly moduleRef: ModuleRef) {}

  async extensionsFor(req: Request): Promise<EdgeConflictExtensions | null> {
    try {
      const tenant = this.moduleRef.get<TenantContextProvider>(TENANT_CONTEXT, { strict: false });
      const tx = this.moduleRef.get(TenantTx, { strict: false });
      const { operatorId } = tenant.current(req);
      return await tx.run(operatorId, async (client) => {
        const ledgerId = await ledgerOf(client, req);
        return ledgerId === null ? null : edgeConflictExtensions(client, ledgerId);
      });
    } catch {
      return null;
    }
  }
}
