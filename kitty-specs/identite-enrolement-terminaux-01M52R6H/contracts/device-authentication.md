# Contrat — authentification d'une requête de terminal

S'applique à toute route marquée `@DeviceAuth()` dans l'API publique et dans le processus des clés de bracelet
(`/media/auth-keys`, `/taps`, `/device/config`, `/device/heartbeat`, et toutes celles des missions suivantes).

## Entrées

| Preuve | Où | Exigence |
|---|---|---|
| Certificat client | connexion TLS (`req.socket`) | `authorized === true` contre l'autorité des terminaux seule ; non expiré |
| Jeton d'appareil | `Authorization: Bearer <jwt>` | ES256, `aud = cashless-device`, `iss` attendu, non expiré, `sub` = terminal, `cnf.jkt` |
| Signature | `Signature-Input`, `Signature`, `Content-Digest`, `X-Request-Id`, `Idempotency-Key` (écritures) | profil R-04 de `research.md` |

## Ordre des contrôles (le premier échec arrête ; tous rendent `401` sauf mention)

1. Certificat présent (`getPeerX509Certificate()`), `authorized`, `validTo` non dépassé ; empreinte SHA-256 calculée.
2. Jeton : ES256 seul, `typ = device+jwt`, `iss`, `aud`, `exp`, `sub` → `device_id`, `operator_id` → prestataire
   annoncé (relu en base, jamais cru).
3. Terminal relu en base sous le rôle du processus (`device_id`, prestataire) avec l'état de la famille `fid` :
   inconnu ou famille révoquée → `401`.
4. `cert_sha256` du terminal = empreinte du certificat présenté ; `cnf.jkt` = empreinte JWK de `device.public_key`.
5. `Content-Digest` (`sha-256` seul) = SHA-256 des octets bruts du corps (`rawBody`).
6. Signature : `keyid` = `device_id` ; composants exacts (dont `@authority` et `idempotency-key` sur une écriture) ;
   vérification ECDSA (`ieee-p1363`) avec `device.public_key` → sinon `401 DEVICE_SIGNATURE_INVALID`.
7. `consume_device_nonce` (heure de la base) : `created` hors tolérance → `400 CLOCK_SKEW_TOO_LARGE` avec en-tête
   `Date` ; nonce déjà vu → `401 DEVICE_SIGNATURE_INVALID`. Rien n'est écrit avant cette étape.
8. Statut : `REVOKED` → `403 DEVICE_REVOKED` ; `SUSPENDED` → `403 DEVICE_SUSPENDED` sauf route
   `allowSuspended`. Toute écriture faite ensuite pour ce terminal relit son statut dans sa propre transaction
   (`assert_device_active` ou contrôle de la fonction de base).
9. `req.device` posé (prestataire, événement, point de vente, clé d'accord, `os`, `nfc_enabled`) ; la transaction pose
   `app.operator_id` = prestataire du terminal.

Les contrôles 1 à 7 passent avant toute lecture du corps par le contrôleur. Une réponse d'échec ne dit pas quelle preuve
a échoué ; la raison exacte va au journal technique (sans jeton, ni signature, ni certificat complet).

## Base de signature (RFC 9421, profil restreint)

```
"@method": POST
"@authority": api.cashless.example
"@path": /v1/taps
"@query": ?
"content-digest": sha-256=:<base64>:
"x-request-id": <uuid>
"idempotency-key": <clé>           # sur une route d'écriture
"@signature-params": ("@method" "@authority" "@path" "@query" "content-digest" "x-request-id" "idempotency-key");created=1797000000;nonce="<b64url>";keyid="<device_id>";alg="ecdsa-p256-sha256"
```

Signature ECDSA P-256 / SHA-256 au format brut `r ‖ s` (64 octets), base64 dans `Signature: dev=:<b64>:`.

## Garde de production

`createDeviceIdentity` construit `RealDeviceIdentity` ; le faux n'est construit que si `production = false` **et**
`DEVICE_IDENTITY_FAKE=1` (tests). En production, la garde de démarrage refuse un faux d'identité, d'autorité, de
signataire ou d'attestation (NFR-001).

## Tests imposés

- Matrice route × (preuve absente, fausse, expirée, d'un autre terminal) : 100 % refusés (NFR-002).
- Rejeu exact d'une requête signée : refusé (NFR-004) ; requête signée pour une autre autorité : refusée.
- Horloge du terminal décalée au-delà de la tolérance : `400 CLOCK_SKEW_TOO_LARGE` avec `Date`.
- Requête non authentifiée : aucune ligne écrite dans `device_request_nonce`.
- Révocation pendant une requête en cours : aucune écriture acceptée après.
- Révocation entre deux requêtes : la seconde refusée avec un jeton encore valide (NFR-003).
- `media-port-swap.spec.ts` : les routes de la mission 4 servies par l'identité réelle sans changement de leur code.
