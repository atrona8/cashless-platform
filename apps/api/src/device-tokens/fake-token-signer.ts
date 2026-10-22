// Faux signataire des jetons d'appareil (plan IC-08) : paire P-256 générée en mémoire (clé privée non exportable),
// jamais lue de l'environnement ni du dépôt ; refusé en production (fabrique de `device-tokens.module.ts`,
// `assertProcessIsSafe`).
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from 'jose';
import { DEVICE_TOKEN_ALG, DEVICE_TOKEN_TYP, type TokenSignerPort } from './token-signer.port';

export class FakeTokenSigner implements TokenSignerPort {
  readonly isFake = true;

  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly jwk: JWK,
    readonly kid: string,
  ) {}

  static async create(): Promise<FakeTokenSigner> {
    const { publicKey, privateKey } = await generateKeyPair(DEVICE_TOKEN_ALG, {
      extractable: false,
    });
    const { kty, crv, x, y } = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint({ kty: kty!, crv: crv!, x: x!, y: y! }, 'sha256');
    return new FakeTokenSigner(
      privateKey,
      Object.freeze({ kty, crv, x, y, kid, alg: DEVICE_TOKEN_ALG }),
      kid,
    );
  }

  sign(claims: JWTPayload): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: DEVICE_TOKEN_ALG, kid: this.kid, typ: DEVICE_TOKEN_TYP })
      .sign(this.privateKey);
  }

  publicJwk(): JWK {
    return { ...this.jwk };
  }
}
