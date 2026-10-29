// Faux coffre en mémoire, hors production seulement. Aucune lecture d'environnement ni de fichier.
import {
  PspSecretError,
  type PspSecretBinding,
  type PspSecretStore,
  type PspSecrets,
} from '../psp-secret-store.port';
import { Secret } from '../secret';

const REF_PATTERN =
  /^psp\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/([A-Za-z0-9._-]+)$/;

function parseRef(secretRef: string): { holder: string; name: string } {
  const match = REF_PATTERN.exec(secretRef);
  // Un nom qui commence par un point (`.`, `..`, `.x`) est refusé : aucun chemin hors du titulaire.
  const holder = match?.[1];
  const name = match?.[2];
  if (holder === undefined || name === undefined || name.startsWith('.'))
    throw new PspSecretError('REF_INVALID');
  return { holder: holder.toLowerCase(), name };
}

const asSecret = (value: string | Secret): Secret =>
  typeof value === 'string' ? Secret.of(value) : value;

export class FakePspSecretStore implements PspSecretStore {
  readonly isFake = true;
  private readonly entries = new Map<string, PspSecrets>();

  put(
    secretRef: string,
    value: {
      adapter?: string | Secret;
      current: string | Secret;
      previous?: string | Secret;
      previousValidUntil?: Date;
    },
  ): void {
    const { holder, name } = parseRef(secretRef);
    // Un précédent sans échéance vaudrait sans limite (A23).
    if (value.previous !== undefined && value.previousValidUntil === undefined)
      throw new Error('secret précédent sans échéance refusé');
    this.entries.set(`${holder}/${name}`, {
      adapter: value.adapter === undefined ? null : asSecret(value.adapter),
      notification: {
        current: asSecret(value.current),
        previous: value.previous === undefined ? null : asSecret(value.previous),
        previousValidUntil: value.previousValidUntil ?? null,
      },
    });
  }

  get(binding: PspSecretBinding): Promise<PspSecrets> {
    try {
      const { holder, name } = parseRef(binding.secretRef);
      if (holder !== binding.holderPartyId.toLowerCase())
        throw new PspSecretError('HOLDER_MISMATCH');
      const found = this.entries.get(`${holder}/${name}`);
      if (found === undefined) throw new PspSecretError('NOT_FOUND');
      return Promise.resolve({ adapter: found.adapter, notification: { ...found.notification } });
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
