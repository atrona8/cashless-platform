# Contrat — jetons d'appareil

## Jeton d'appareil

JWT ES256, signé par `TokenSignerPort` ; en-tête `kid` du signataire.

En-tête `typ = device+jwt`.

| Claim | Valeur |
|---|---|
| `iss` | `DEVICE_TOKEN_ISSUER` (réglage) |
| `aud` | `cashless-device` |
| `sub` | `device_id` |
| `operator_id`, `serial`, `event_id` | claims du contrat, jamais crus : relus en base |
| `cnf.jkt` | empreinte JWK (RFC 7638) de la clé de signature du terminal |
| `fid` | famille de jetons ; vérifiée non révoquée à chaque requête |
| `iat`, `exp` | 15 minutes |
| `jti` | aléatoire |

Le jeton ne porte ni statut, ni rôle, ni affectation : tout est relu en base à chaque requête.

## `POST /v1/device-tokens/refresh` (`refreshDeviceToken`)

- Exige le mTLS (renforcement du contrat, `research.md` R-07) et la preuve de possession du contrat : signature ECDSA,
  par la clé du terminal, de `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ serial ‖ 0x00 ‖ refresh_token` ; le certificat présenté doit être celui du terminal de
  ce `serial`.
- `rotate_device_refresh_token` : jeton valide → consommé, nouveau jeton de la même famille ; échange en cours sur le
  même jeton → `409 CONFLICT_STATE` (à réessayer) ; jeton consommé représenté **une fois**, dans les 60 s, par le même
  terminal (même certificat) → nouvelle paire, le successeur jamais utilisé est révoqué (grâce, OP-N65, ADR-108) ;
  toute autre représentation → famille révoquée (`REUSE`), audit `DEVICE_TOKEN_REUSE`, `401` ; expiré ou révoqué → `401` ; terminal `SUSPENDED` →
  `403 DEVICE_SUSPENDED` ; `REVOKED` → `403 DEVICE_REVOKED`.
- Réponse : `access_token`, `expires_in`, `refresh_token`.

## Ports

```ts
interface TokenSignerPort { readonly isFake?: boolean; kid: string; sign(claims): Promise<string>; publicJwk(): JWK }
interface DeviceCaPort { readonly isFake?: boolean; issue(csr: Pkcs10, subject: {deviceId, operatorId}, notAfter): Promise<{ pem: string; sha256: Buffer; notAfter: Date }>; caCertificatesPem(): string[] }
```

Faux : clés jamais lues de l'environnement en production (démarrage refusé si `DEVICE_CA_FAKE_KEY_FILE` y est posé) ;
en test, clés générées à l'exécution, en mémoire ou dans des fichiers temporaires désignés par
`DEVICE_CA_CERT_FILE`/`DEVICE_CA_FAKE_KEY_FILE` (`test/support/tls.ts`), jamais écrites dans le dépôt ; `isFake = true`.
(Alignement du contrat sur WP08/WP09, décision du porteur du 19/10/2026.)

## Tests imposés

- 20 rafraîchissements simultanés du même jeton : exactement 1 réussite, les autres `409`, famille intacte.
- Réponse perdue : représentation dans les 60 s par le même terminal → nouvelle paire ; le successeur perdu est refusé.
- Seconde représentation, plus de 60 s, ou autre certificat : famille révoquée ; le jeton d'appareil de cette famille
  est refusé à la requête suivante (test de borne d'OP-N65).
- Jeton d'appareil d'un terminal présenté avec le certificat ou la signature d'un autre : refusé.
