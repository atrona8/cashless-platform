// Niveau NFC d'un modèle de téléphone (mission 11b, WP09 ; interfaces.md §4). La normalisation est
// celle de la base (`normalize_phone_model`) : la règle n'est pas recopiée ici. Un fabricant ou un
// modèle absent, ou une paire absente de `phone_model`, donne `UNTESTED`.
import type { TxClient } from '../../db/tenant-tx';
import type { NfcLevel } from './phone-models.dto';

/** Jointure SQL des listes : `d.manufacturer` et `d.model` sont déjà normalisés par la base. */
export const NFC_LEVEL_JOIN =
  'LEFT JOIN phone_model pm ON pm.manufacturer = d.manufacturer AND pm.model = d.model';

/** Niveau du modèle déclaré, pour un client de transaction (`cashless_app` lit `phone_model`). */
export async function nfcLevelFor(
  client: TxClient,
  manufacturer?: string | null,
  model?: string | null,
): Promise<NfcLevel> {
  if (!manufacturer || !model) return 'UNTESTED';
  const { rows } = await client.query<{ nfc_level: NfcLevel }>(
    `SELECT nfc_level FROM phone_model
      WHERE manufacturer = normalize_phone_model($1) AND model = normalize_phone_model($2)`,
    [manufacturer, model],
  );
  return rows[0]?.nfc_level ?? 'UNTESTED';
}
