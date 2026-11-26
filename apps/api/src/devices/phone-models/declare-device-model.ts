// Écriture du modèle déclaré par un terminal (D2, C-003), dans la transaction de l'enrôlement ou du
// signal de vie. Par la fonction `set_device_model` de la base (aucun droit de colonne). Le modèle
// est informatif et non vérifié : un échec de cette écriture, quelle qu'en soit la cause, est avalé
// sous un point de reprise et ne fait JAMAIS refuser l'enrôlement ni le signal de vie.
import { Logger } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import type { DeviceModel } from './phone-models.dto';

const logger = new Logger('DeviceModel');

export async function declareDeviceModel(
  client: TxClient,
  deviceId: string,
  declared: DeviceModel | null,
): Promise<void> {
  if (declared === null) return;
  await client.query('SAVEPOINT device_model');
  try {
    await client.query('SELECT set_device_model($1, $2, $3)', [
      deviceId,
      declared.manufacturer,
      declared.model,
    ]);
    await client.query('RELEASE SAVEPOINT device_model');
  } catch (error) {
    // Trace sans la valeur déclarée : le SQLSTATE et le terminal seulement.
    const code = (error as { code?: unknown }).code;
    logger.warn(`modèle déclaré ignoré : device=${deviceId} sqlstate=${String(code ?? 'inconnu')}`);
    await client.query('ROLLBACK TO SAVEPOINT device_model');
    await client.query('RELEASE SAVEPOINT device_model');
  }
}
