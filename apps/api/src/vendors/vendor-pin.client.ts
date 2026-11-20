// Client de l'API vers le processus `vendor-pin` (mission 11a, lot WP07 ; OP-N76 levée ; FR-006,
// FR-007, NFR-001). Toute vérification de PIN, ouverture de session de vendeur et hachage de PIN
// passe par ce client : l'API ne détient plus le secret des empreintes ni le droit d'exécuter
// `begin_vendor_pin_check` et `open_vendor_session`.
//
// Règles tenues ici :
// - appel signé (`signCall` de WP06) : le corps JSON est sérialisé UNE fois, signé sur ces octets
//   exacts et envoyé tel quel ; le chemin signé est celui de la requête (`/v1/internal/...`) ;
// - délai court (2 s) et AUCUNE relance : un essai de PIN ou un hachage n'est jamais rejoué ;
// - AUCUN repli : processus absent, lent, `5xx`, réponse illisible ou signature refusée → erreur de
//   service sans détail (`INTERNAL_ERROR`, code existant du contrat), jamais de vérification
//   locale, jamais de session ;
// - ni le PIN, ni le corps, ni la réponse du processus ne figurent dans une erreur ou un journal.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { API_PREFIX, APP_CONFIG, type AppConfig } from '../config/config';
import { ProblemException } from '../errors/problem';
import { PIN_SIG_HEADER, PIN_TS_HEADER, signCall } from '../vendor-pin/vendor-pin-call-signature';
import type { VendorSession } from './vendors.dto';

/** Délai d'un appel : argon2 ≈ 60 ms + marge ; le verrou d'essai du terminal est tenu pendant. */
export const VENDOR_PIN_TIMEOUT_MS = 2_000;
/** Taille maximale d'une réponse lue (les réponses réelles font moins de 1 Ko). */
const MAX_RESPONSE_BYTES = 16 * 1024;

export const OPEN_PATH = `/${API_PREFIX}/internal/vendor-pin/open`;
export const HASH_PATH = `/${API_PREFIX}/internal/vendor-pin/hash`;

export interface VendorPinOpenCall {
  operatorId: string;
  deviceId: string;
  vendorId: string;
  pin: string;
  /** `X-Request-Id` de la requête, repris dans l'audit du processus. */
  requestId: string | null;
}

export type VendorPinOpenResult =
  | { kind: 'opened'; session: VendorSession }
  | { kind: 'refused' }
  | { kind: 'concurrent' };

interface RawResponse {
  status: number;
  body: string;
}

/** Erreur de service sans détail : ni le PIN, ni le corps, ni la cause. */
const unavailable = (): ProblemException => new ProblemException('INTERNAL_ERROR');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class VendorPinClient implements OnModuleDestroy {
  private readonly agent: http.Agent | https.Agent | null;
  private readonly target: URL | null;
  private lastTs = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.target = config.vendorPinUrl ? new URL(config.vendorPinUrl) : null;
    const options = { keepAlive: true, maxSockets: 64 };
    this.agent = !this.target
      ? null
      : this.target.protocol === 'https:'
        ? new https.Agent(options)
        : new http.Agent(options);
  }

  onModuleDestroy(): void {
    this.agent?.destroy();
  }

  /** Ouvre la session du vendeur ; le processus compte l'essai, vérifie le PIN et audite. */
  async open(call: VendorPinOpenCall): Promise<VendorPinOpenResult> {
    const response = await this.post(
      OPEN_PATH,
      {
        vendorId: call.vendorId,
        deviceId: call.deviceId,
        operatorId: call.operatorId,
        pin: call.pin,
      },
      call.requestId,
    );
    if (response.status === 200) return { kind: 'opened', session: parseSession(response.body) };
    if (response.status === 403 && outcomeOf(response.body) === 'PIN_REFUSED')
      return { kind: 'refused' };
    if (response.status === 409 && outcomeOf(response.body) === 'CONCURRENT')
      return { kind: 'concurrent' };
    throw unavailable();
  }

  /** Empreinte argon2id du PIN (création de vendeur, changement de PIN). */
  async hash(pin: string): Promise<string> {
    const response = await this.post(HASH_PATH, { pin }, null);
    if (response.status === 422)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'pin : exactement 6 chiffres attendus.',
      });
    if (response.status !== 200) throw unavailable();
    const parsed = parseJson(response.body);
    const digest = isRecord(parsed) ? parsed.pin_hash : undefined;
    if (typeof digest !== 'string' || !digest.startsWith('$argon2id$')) throw unavailable();
    return digest;
  }

  private post(path: string, payload: object, requestId: string | null): Promise<RawResponse> {
    const target = this.target;
    if (!target || !this.agent) return Promise.reject(unavailable());
    // Sérialisé une seule fois : ce sont ces octets qui sont signés ET envoyés.
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    // Strictement croissant : deux appels identiques de la même milliseconde ont deux signatures
    // distinctes (le processus refuse le rejeu d'une signature).
    const ts = (this.lastTs = Math.max(Date.now(), this.lastTs + 1));
    const signature = signCall(this.config.vendorPinCallKey, ts, 'POST', path, raw);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': raw.length,
      [PIN_TS_HEADER]: String(ts),
      [PIN_SIG_HEADER]: signature,
    };
    if (requestId) headers['X-Request-Id'] = requestId;
    const transport = target.protocol === 'https:' ? https : http;
    return new Promise<RawResponse>((resolve, reject) => {
      let settled = false;
      const settle = (done: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done();
      };
      const req = transport.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || undefined,
          path,
          method: 'POST',
          headers,
          agent: this.agent!,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              settle(() => reject(unavailable()));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            settle(() =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            ),
          );
          res.on('error', () => settle(() => reject(unavailable())));
        },
      );
      // Aucune relance : le délai coupe l'appel et rend l'erreur de service.
      const timer = setTimeout(() => {
        settle(() => reject(unavailable()));
        req.destroy();
      }, VENDOR_PIN_TIMEOUT_MS);
      req.on('error', () => settle(() => reject(unavailable())));
      req.end(raw);
    });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function outcomeOf(text: string): unknown {
  const parsed = parseJson(text);
  return isRecord(parsed) ? parsed.outcome : undefined;
}

/** Session rendue par le processus : liste blanche des quatre champs, rien d'autre ne passe. */
function parseSession(text: string): VendorSession {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) throw unavailable();
  const { vendor_session_id, vendor_id, vendor_display_name, expires_at } = parsed;
  if (
    typeof vendor_session_id !== 'string' ||
    typeof vendor_id !== 'string' ||
    typeof vendor_display_name !== 'string' ||
    typeof expires_at !== 'string'
  )
    throw unavailable();
  return { vendor_session_id, vendor_id, vendor_display_name, expires_at };
}
