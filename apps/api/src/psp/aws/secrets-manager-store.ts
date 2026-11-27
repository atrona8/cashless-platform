// Coffre des secrets PSP adossé à AWS Secrets Manager (IC-06, R-08). Un secret par configuration, nommé
// `psp/<holder_party_id>/<nom>`, valeur JSON `{ provider, credentials, notification, previous_valid_until }`.
// Aucun secret, aucune référence ni aucun détenteur attendu dans un message ou un journal ; les valeurs ne vivent
// que dans `Secret`. Les identifiants AWS viennent de la chaîne par défaut du SDK (rôle du processus).
import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Logger } from '@nestjs/common';
import {
  PspSecretError,
  type PspCredentials,
  type PspSecretBinding,
  type PspSecretStore,
  type PspSecrets,
} from '../psp-secret-store.port';
import { Secret } from '../secret';

/** Durée de conservation en mémoire d'un secret lu, par référence (une révocation joue au plus 60 s plus tard). */
export const SECRETS_CACHE_TTL_MS = 60_000;

const REF_PATTERN = /^[A-Za-z0-9/_+=.@-]{1,512}$/;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(text: string): Json {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isObject(parsed)) return parsed;
  } catch {
    // tombe sur le refus ci-dessous ; le texte (qui contient le secret) n'est jamais repris
  }
  throw new PspSecretError('REF_INVALID');
}

/** Chaîne non vide obligatoire, rendue en `Secret` ; sinon `REF_INVALID`. */
function requiredSecret(source: Json, field: string): Secret {
  const value = source[field];
  if (typeof value !== 'string' || value.length === 0) throw new PspSecretError('REF_INVALID');
  return Secret.of(value);
}

function optionalSecret(source: Json, field: string): Secret | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  return requiredSecret(source, field);
}

function buildCredentials(provider: string, credentials: unknown): PspCredentials {
  if (!isObject(credentials)) throw new PspSecretError('REF_INVALID');
  switch (provider) {
    case 'WAVE':
      return {
        provider: 'WAVE',
        apiKey: requiredSecret(credentials, 'api_key'),
        requestSigningSecret: optionalSecret(credentials, 'request_signing_secret'),
      };
    case 'PAYDUNYA':
      return {
        provider: 'PAYDUNYA',
        masterKey: requiredSecret(credentials, 'master_key'),
        privateKey: requiredSecret(credentials, 'private_key'),
        token: requiredSecret(credentials, 'token'),
      };
    case 'STRIPE':
      return { provider: 'STRIPE', secretKey: requiredSecret(credentials, 'secret_key') };
    default:
      throw new PspSecretError('REF_INVALID'); // fournisseur inconnu (y compris FAKE : jamais dans le coffre)
  }
}

/** Échéance du secret précédent : absente ou nulle → `null` ; date illisible → `REF_INVALID`. */
function parseValidUntil(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new PspSecretError('REF_INVALID');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PspSecretError('REF_INVALID');
  return date;
}

/** Contrôle de forme et du détenteur, avant tout appel : le segment après `psp/` est celui du détenteur. */
function assertRefBelongsToHolder(binding: PspSecretBinding): void {
  const { secretRef, holderPartyId } = binding;
  if (typeof secretRef !== 'string' || !REF_PATTERN.test(secretRef))
    throw new PspSecretError('REF_INVALID');
  const segments = secretRef.split('/');
  if (
    segments.length < 3 ||
    segments[0] !== 'psp' ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  )
    throw new PspSecretError('REF_INVALID');
  if (holderPartyId === '' || segments[1] !== holderPartyId)
    throw new PspSecretError('HOLDER_MISMATCH');
}

interface CacheEntry {
  expiresAt: number;
  provider: string;
  secrets: PspSecrets;
}

export class AwsSecretsManagerStore implements PspSecretStore {
  readonly isFake = false;
  readonly service = 'psp.secrets' as const;
  private readonly logger = new Logger('AwsSecretsManagerStore');
  /** Clé : référence complète (jamais journalisée). Seules les lectures réussies y entrent. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly client: SecretsManagerClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async get(binding: PspSecretBinding): Promise<PspSecrets> {
    assertRefBelongsToHolder(binding); // avant tout appel et avant le cache
    const now = this.clock().getTime();
    const cached = this.cache.get(binding.secretRef);
    if (cached !== undefined && cached.expiresAt > now) {
      if (cached.provider !== binding.provider) throw new PspSecretError('REF_INVALID');
      return this.copy(cached.secrets);
    }
    this.cache.delete(binding.secretRef);

    const text = await this.fetchString({ SecretId: binding.secretRef });
    const document = parseJson(text);
    const provider = document.provider;
    if (typeof provider !== 'string' || provider !== binding.provider)
      throw new PspSecretError('REF_INVALID');
    const credentials = buildCredentials(provider, document.credentials);
    const current = requiredSecret(document, 'notification');
    // PayDunya : la preuve d'origine est le SHA-512 de la clé maître ; un autre secret de notification
    // serait une configuration ambiguë (analyse L4).
    if (credentials.provider === 'PAYDUNYA' && current.reveal() !== credentials.masterKey.reveal())
      throw new PspSecretError('REF_INVALID');
    const validUntil = parseValidUntil(document.previous_valid_until);

    let previous: Secret | null = null;
    if (credentials.provider !== 'PAYDUNYA' && validUntil !== null && validUntil.getTime() > now)
      previous = await this.readPrevious(binding.secretRef);

    const secrets: PspSecrets = {
      credentials,
      notification: {
        current,
        previous,
        previousValidUntil: previous === null ? null : validUntil,
      },
    };
    this.cache.set(binding.secretRef, {
      expiresAt: now + SECRETS_CACHE_TTL_MS,
      provider,
      secrets,
    });
    return this.copy(secrets);
  }

  private copy(secrets: PspSecrets): PspSecrets {
    return {
      credentials: { ...secrets.credentials },
      notification: { ...secrets.notification },
    };
  }

  /** Version précédente : seul `notification` est lu ; toute erreur donne `null` (pas d'échec global). */
  private async readPrevious(secretRef: string): Promise<Secret | null> {
    try {
      const text = await this.fetchString({ SecretId: secretRef, VersionStage: 'AWSPREVIOUS' });
      return optionalSecret(parseJson(text), 'notification');
    } catch {
      this.logger.warn('secret de notification précédent illisible : ignoré');
      return null;
    }
  }

  private async fetchString(input: { SecretId: string; VersionStage?: string }): Promise<string> {
    let secretString: string | undefined;
    try {
      const out = await this.client.send(new GetSecretValueCommand(input));
      secretString = out.SecretString;
    } catch (error) {
      const name = isObject(error) ? error.name : undefined;
      throw new PspSecretError(name === 'ResourceNotFoundException' ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
    if (typeof secretString !== 'string' || secretString.length === 0)
      throw new PspSecretError('REF_INVALID');
    return secretString;
  }
}
