// Amorçage des suites des vendeurs (mission 5b, lot WP09) : commerçant, participation et point de
// vente posés directement par le propriétaire ; vendeurs créés par la fonction de la base
// (`create_vendor`, auteur OPERATOR_ADMIN du prestataire) avec une empreinte calculée par le
// hacheur de l'application sous test (même secret). Écritures directes : amorçage seulement.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export interface SeededPos {
  merchantId: string;
  participationId: string;
  posId: string;
}

/** Transaction du propriétaire sous le prestataire `operatorId` (fonctions SECURITY DEFINER). */
export async function asOperator<T>(
  db: Client,
  operatorId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** Commerçant (nouveau, ou `merchantId` existant), participation à l'événement, point de vente. */
export async function seedPos(
  db: Client,
  input: { operatorId: string; eventId: string; merchantId?: string; name?: string },
): Promise<SeededPos> {
  const merchantId = input.merchantId ?? randomUUID();
  const participationId = randomUUID();
  const posId = randomUUID();
  if (!input.merchantId)
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
       VALUES ($1, 'MERCHANT', $2, $3, 'SN')`,
      [merchantId, input.operatorId, input.name ?? 'Commerçant de test'],
    );
  await db.query(
    `INSERT INTO merchant_participation
       (id, operator_id, event_id, merchant_id, link_type, payout_to)
     VALUES ($1, $2, $3, $4, 'EXTERNAL', $4)`,
    [participationId, input.operatorId, input.eventId, merchantId],
  );
  await db.query(
    `INSERT INTO point_of_sale (id, operator_id, participation_id, name)
     VALUES ($1, $2, $3, $4)`,
    [posId, input.operatorId, participationId, `Comptoir ${posId.slice(0, 8)}`],
  );
  return { merchantId, participationId, posId };
}

/** Vendeur créé par `create_vendor` ; rend son identifiant. */
export function seedVendor(
  db: Client,
  input: {
    operatorId: string;
    merchantId: string;
    actorId: string;
    displayName: string;
    pinHash: string;
  },
): Promise<string> {
  return asOperator(db, input.operatorId, async () => {
    const { rows } = await db.query<{ id: string }>('SELECT create_vendor($1, $2, $3, $4) AS id', [
      input.merchantId,
      input.displayName,
      input.pinHash,
      input.actorId,
    ]);
    return rows[0]!.id;
  });
}

/** Affecte un terminal déjà enrôlé à un point de vente (amorçage du propriétaire). */
export async function assignPos(db: Client, deviceId: string, posId: string): Promise<void> {
  await db.query('UPDATE device SET pos_id = $2 WHERE id = $1', [deviceId, posId]);
}
