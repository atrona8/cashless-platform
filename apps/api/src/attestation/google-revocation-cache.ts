// Liste de révocation des attestations Android (research R-05) : https://android.googleapis.com/attestation/status.
// Chargée et rafraîchie toutes les heures ; la dernière liste valide est gardée. Échec fermé : sans liste chargée, ou
// plus de 24 h sans rafraîchissement réussi, TOUTE attestation Android est refusée. Une réponse illisible ne remplace
// jamais la liste valide précédente.
import { AttestationError } from './attestation.port';

export const GOOGLE_ATTESTATION_STATUS_URL = 'https://android.googleapis.com/attestation/status';

const HOUR_MS = 3_600_000;
/** Taille maximale acceptée de la liste (renforcement : une réponse démesurée est un échec de rafraîchissement). */
const MAX_LIST_BYTES = 16 * 1024 * 1024;

/** Source de la liste : le JSON brut. En test, une source injectée (aucun appel réseau). */
export type RevocationSource = () => Promise<unknown>;

/** Source HTTPS (production) : URL réglable, HTTPS exigé, délai borné. */
export function httpRevocationSource(
  url: string = GOOGLE_ATTESTATION_STATUS_URL,
  timeoutMs = 10_000,
): RevocationSource {
  if (new URL(url).protocol !== 'https:')
    throw new Error(`liste de révocation Android : URL HTTPS attendue (reçu « ${url} »)`);
  return async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`liste de révocation Android : HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_LIST_BYTES)
      throw new Error('liste de révocation Android : réponse trop volumineuse');
    return JSON.parse(text) as unknown;
  };
}

/** Numéro de série en hexadécimal minuscule, sans zéros de tête (format des clés de la liste Google). */
export function normalizeSerial(hex: string): string {
  const lower = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(lower))
    throw new Error(`numéro de série hexadécimal attendu (« ${hex} »)`);
  const stripped = lower.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

/**
 * Lit `{ "entries": { "<série>": { "status": "REVOKED" | "SUSPENDED", … } } }`. Toute entrée bloque le numéro :
 * `REVOKED` et `SUSPENDED` (R-05), et par échec fermé tout statut inconnu. Lève si le format n'est pas celui attendu.
 */
export function parseRevocationList(raw: unknown): Map<string, string> {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('liste de révocation : objet attendu');
  const entries = (raw as { entries?: unknown }).entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries))
    throw new Error('liste de révocation : champ « entries » attendu');
  const blocked = new Map<string, string>();
  for (const [serial, entry] of Object.entries(entries as Record<string, unknown>)) {
    const status = (entry as { status?: unknown } | null)?.status;
    if (typeof status !== 'string')
      throw new Error(`liste de révocation : statut absent pour ${serial}`);
    blocked.set(normalizeSerial(serial), status);
  }
  return blocked;
}

export interface RevocationCacheOptions {
  source: RevocationSource;
  /** Horloge en millisecondes (tests). */
  now?: () => number;
  refreshIntervalMs?: number;
  /** Âge maximal de la dernière liste valide avant refus de toute attestation Android (24 h). */
  maxAgeMs?: number;
}

/** Vue de la liste utilisée par le vérificateur Android. */
export interface RevocationCheck {
  assertNotRevoked(serials: readonly string[]): Promise<void>;
}

export class GoogleRevocationCache implements RevocationCheck {
  private readonly source: RevocationSource;
  private readonly now: () => number;
  private readonly refreshIntervalMs: number;
  private readonly maxAgeMs: number;
  private blocked: Map<string, string> | null = null;
  private loadedAt: number | null = null;
  private inFlight: Promise<boolean> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: RevocationCacheOptions) {
    this.source = options.source;
    this.now = options.now ?? Date.now;
    this.refreshIntervalMs = options.refreshIntervalMs ?? HOUR_MS;
    this.maxAgeMs = options.maxAgeMs ?? 24 * HOUR_MS;
  }

  /** Charge la liste ; `false` si l'essai échoue (la liste précédente est gardée). Un seul essai à la fois. */
  refresh(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const blocked = parseRevocationList(await this.source());
        this.blocked = blocked;
        this.loadedAt = this.now();
        return true;
      } catch {
        return false;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Rafraîchissement horaire en tâche de fond (le minuteur ne retient pas le processus). */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Refuse si un numéro est dans la liste, ou si la liste manque ou a plus de 24 h. Une liste de plus d'une heure est
   * d'abord rafraîchie (au démarrage, la première vérification charge la liste).
   * Échec fermé si l'horloge a reculé : un âge négatif ne dit rien de l'âge réel ; la liste est
   * rafraîchie, et refusée si ce rafraîchissement échoue.
   */
  async assertNotRevoked(serials: readonly string[]): Promise<void> {
    const age = (): number => this.now() - (this.loadedAt ?? 0);
    if (this.loadedAt === null || age() < 0 || age() >= this.refreshIntervalMs)
      await this.refresh();
    if (this.blocked === null || this.loadedAt === null)
      throw new AttestationError('liste de révocation Android indisponible');
    if (age() < 0)
      throw new AttestationError('liste de révocation Android : horloge antérieure au chargement');
    if (age() > this.maxAgeMs)
      throw new AttestationError('liste de révocation Android périmée (plus de 24 h)');
    for (const serial of serials) {
      const status = this.blocked.get(normalizeSerial(serial));
      if (status !== undefined)
        throw new AttestationError(`certificat ${normalizeSerial(serial)} : statut ${status}`);
    }
  }
}
