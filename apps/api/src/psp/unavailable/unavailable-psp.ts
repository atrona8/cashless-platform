import {
  PspSecretError,
  type PspSecretBinding,
  type PspSecretStore,
  type PspSecrets,
} from '../psp-secret-store.port';

/** Coffre de production tant que le coffre réel n'est pas livré (OP-N81) : non faux, toujours indisponible. */
export class UnavailablePspSecretStore implements PspSecretStore {
  get(_binding: PspSecretBinding): Promise<PspSecrets> {
    return Promise.reject(new PspSecretError('UNAVAILABLE'));
  }
}
