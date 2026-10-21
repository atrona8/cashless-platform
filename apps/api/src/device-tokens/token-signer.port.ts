// Signataire des jetons d'appareil (contracts/device-tokens.md « Ports », research R-07, plan IC-08) : JWT ES256,
// en-tête `kid` et `typ = device+jwt`. Aujourd'hui seul un faux existe (refusé en production) ; l'adaptateur KMS
// arrive après OP-N11, hors mission (SPECIFICATION §13.2, C-004).
import type { JWK, JWTPayload } from 'jose';

export { TOKEN_SIGNER } from '../security/port-tokens';

/** Seul algorithme émis et accepté (R-07) : ni `none`, ni HMAC, ni autre courbe. */
export const DEVICE_TOKEN_ALG = 'ES256';
export const DEVICE_TOKEN_TYP = 'device+jwt';

export interface TokenSignerPort {
  readonly isFake?: boolean;
  /** Identifiant de la clé, posé dans l'en-tête `kid`. */
  readonly kid: string;
  /** Signe les claims : JWT compact, en-tête `{ alg: ES256, kid, typ: device+jwt }`. */
  sign(claims: JWTPayload): Promise<string>;
  /** Clé publique de vérification (`kty`, `crv`, `x`, `y`, `kid`, `alg`) ; jamais de partie privée. */
  publicJwk(): JWK;
}
