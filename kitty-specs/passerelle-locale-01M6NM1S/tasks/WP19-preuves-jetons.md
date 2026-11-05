---
work_package_id: WP19
title: Preuves du terminal et jetons d'appareil sur la passerelle
dependencies: [WP18]
requirement_refs:
- FR-010
- FR-026
- FR-039
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T084, T085, T086, T087, T088]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/device-proofs/device-proofs.guard.ts
create_intent: [apps/gateway/src/device-proofs/device-proofs.guard.ts, apps/gateway/src/device-proofs/request-signature.ts, apps/gateway/src/device-proofs/nonce-store.ts, apps/gateway/src/device-proofs/device-proofs.module.ts, apps/gateway/src/device/device-token.service.ts, apps/gateway/src/device/device.controller.ts, apps/gateway/src/device/idempotency.service.ts, apps/gateway/src/device/device.module.ts, apps/gateway/test/device/proofs.spec.ts, apps/gateway/test/device/tokens.spec.ts, apps/gateway/test/device/refresh.spec.ts, apps/gateway/test/device/reads.spec.ts, apps/gateway/test/device/idempotency.spec.ts, apps/gateway/test/device/authority-separation.spec.ts, apps/gateway/test/device/contract.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/device-proofs/**, apps/gateway/src/device/**, apps/gateway/test/device/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP19 – Preuves du terminal et jetons

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/gateway-served-operations.md` : section « Preuves exigées sur toute opération de
  terminal » et les lignes 1 à 5 du tableau (`refreshDeviceToken`, `getDeviceConfig`,
  `postDeviceHeartbeat`, `getDeviceSeqStatus`, `getMediaAuthKey` : cette dernière est **WP23**, pas
  ici), notes 1 à 3, « Comportements communs » ;
- `contracts/interfaces.md` § 4 (`HARDWARE_KEYSTORE`), § 10 (`DeviceProofsGuard`), § 7 ;
- `research.md` **R-19 en entier**, R-21 (nonces, `@authority`, A20), R-25 (verdicts des lignes 1 à
  4) ;
- `data-model.md` B.4 (`edge_device`, `edge_device_token_family`), B.5 (`edge_device_nonce`,
  `edge_idempotency`, `edge_device_seq`), B.6 (`edge_token_key`) ;
- `docs/passation-8/rapports/plan-adversarial.md` A01, A20 ; `docs/passation-8/contexte-m8.md`
  décisions 2 et 11.

Code de référence de l'API (à lire, **ne pas modifier**) : `apps/api/src/devices/`
(`device-token.service.ts` : contrôle du `kid` l.118 et de l'audience l.124 ; `request-signature.ts`
: `@authority` l.133-137 ;
`nonce-store.ts` : `CLOCK_TOLERANCE_SECONDS`), `apps/api/test/support/fake-device.ts`. Priorité des
sources : SPECIFICATION §0.3 ; contradiction signalée.

## Objective

Authentifier un terminal **sans le central** : les trois preuves du contrat (certificat, jeton
d'appareil, signature de requête RFC 9421), des jetons à clé propre valables sur la passerelle seule
(décision 2),
le renouvellement sans rotation (décision 11), et les trois lectures `getDeviceConfig`,
`postDeviceHeartbeat`, `getDeviceSeqStatus`. Ce lot est une surface d'authentification : toute
erreur se paie en sécurité.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP19 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; **le central n'est pas modifié** (le refus des jetons de la passerelle
est prouvé par test, pas par code) ;
un écart qui affaiblit la sécurité s'arrête et remonte au porteur.

## T084 – `DeviceProofsGuard` : trois preuves, `@authority`, nonces

**But** : `class DeviceProofsGuard implements CanActivate` (`interfaces.md` § 10) pose `req.device`.

1. **Certificat** : chaîne vérifiée contre `GATEWAY_DEVICE_CA_FILE` ; empreinte SHA-256 égale à
   `edge_device.cert_sha256`. Un certificat de **passerelle** ou un certificat hors chaîne : `401`.
2. **Jeton d'appareil** : ES256 ; `kid` doit être l'un des `edge_token_key` **propres**
   (`edge:<gateway_id>:<n>`) ; `aud = cashless-edge/<gateway_id>` ; `cnf.jkt` égal à
   `edge_device.public_key` ; `exp` au plus 900 s. Un jeton signé par le central (autre `kid`)
   reçoit `401` **avant toute cryptographie** (même ordre que le central,
   `device-token.service.ts:118`) et le terminal rafraîchit.
3. **Signature de requête** (RFC 9421) : clé `edge_device.public_key` ; `@authority` égal à
   `GATEWAY_REQUEST_AUTHORITY` (**égalité exacte, aucun joker, y compris dans les tests**, A20) ;
   nonce à usage unique dans `edge_device_nonce` ; `created` dans `CLOCK_TOLERANCE_SECONDS` mesuré
   sur `GatewayClock.now()` (pas l'heure système).
- Ordre : certificat, jeton, signature, puis statut du terminal relu dans la copie : `SUSPENDED` ->
  `403 DEVICE_SUSPENDED`, `REVOKED` -> `403 DEVICE_REVOKED` (sauf `allowSuspended` pour
  `getDeviceConfig` et `getDeviceSeqStatus`).
- Toute preuve échouée : `401` sans dire laquelle (`UNAUTHENTICATED` ou `DEVICE_SIGNATURE_INVALID`
  selon la forme du contrat), temps de réponse sans lien avec la preuve en cause (compare avec
  `timingSafeEqual`).
- Le nonce est consommé **dans la transaction de l'opération** pour les écritures (WP20 à WP23
  l'appellent dans leur transaction, `NonceStore.consume(tx, ...)`) ; pour les lectures, dans sa
  propre transaction courte.
- `GatewayAuthorityPort` (lecture seule) : le garde ne décide jamais de l'autorité de débit, c'est
  `AuthorityService` (WP17) ; il l'ignore.
- Le garde est un fichier **propre à la passerelle** : ne copie pas le code de l'API par import
  (test d'architecture de WP16) ; reprends les algorithmes et les constantes, et compare aux
  vecteurs de l'API dans un test.

**Cas limites** : en-têtes en double ; `Content-Digest` absent sur un corps ; `created` dans le
futur ; nonce déjà vu après redémarrage de la passerelle ; certificat valide d'un autre événement.

## T085 – Jetons de la passerelle : clé propre, `kid`, `refreshDeviceToken` sans rotation

- `device-token.service.ts` : émet des jetons ES256 signés par `HARDWARE_KEYSTORE.sign('token',
  ...)` ; `kid = edge:<gateway_id>:<n>` ; la clé publique est enregistrée dans `edge_token_key`
  (`public_jwk`, `status`) ; rotation de clé : `n + 1`, l'ancienne reste valable jusqu'à
  l'expiration de ses jetons. `aud = cashless-edge/<gateway_id>`, `iss` = identifiant de la
  passerelle, mêmes `typ`, `exp` (900 s au plus), `cnf.jkt`, `fid`. La clé privée ne sort jamais du
  port (aucune méthode d'export).
- `refreshDeviceToken` (`POST /device-tokens/refresh`, preuve `deviceMtls` seule plus preuve de
  possession) : vérifie le certificat du terminal, la **signature de possession** et que
  `SHA-256(jeton de rafraîchissement présenté)` **égale**
  `edge_device_token_family.refresh_token_sha256_current` (comparaison à temps constant). Émet un
  jeton d'accès court. **Ne consomme pas, ne fait pas tourner, ne renvoie pas de nouveau jeton de
  rafraîchissement** (la réponse ne porte aucun champ de rafraîchissement : test sur la forme
  exacte). Famille `REVOKED` ou terminal suspendu : `401 REFRESH_TOKEN_INVALID` / `403`. Chaque
  émission est auditée (`edge_audit`).
- Écarts acceptés `OP-N101` et `OP-N102` (`ADR-156`, `ADR-157`) : consigne-les dans l'en-tête du
  fichier ; chaque test de borne ci-dessous est la preuve qu'ils ne s'élargissent pas.

## T086 – Lectures du terminal

- `getDeviceConfig` : construit la réponse depuis `edge_device`, `device_config`,
  `edge_event_setting`, catalogues et état d'autorité local ; `ETag` = `config_id` du central ;
  `304` sur `If-None-Match` ; `edge_base_url` = `lan_url` ; `config.snapshot_keys` publie la clé
  propre de la passerelle (`owner = EDGE`, WP23 les alimente : prévois le champ, rempli par un
  fournisseur injecté, vide tant que WP23 n'est pas là).
- `postDeviceHeartbeat` : met à jour l'état local du terminal ; `latest_snapshot_version` = celle du
  snapshot local (fournie par WP23 via un jeton d'injection, `null` sinon) ; corps invalide : `400`.
- `getDeviceSeqStatus` : renvoie le `contiguous_acked_seq` **du central**, dernière valeur répliquée
  avec sa date (périmée plutôt que provisoire, FR-026), `acked_known = false` si aucune passe n'a eu
  lieu ; jamais un accusé local. Servie à un terminal `SUSPENDED` ; `403 DEVICE_REVOKED` sinon.
- Heure servie (`server_time`, en-tête `Date`) = `GatewayClock.now()`.

## T087 – Idempotence locale, schémas du contrat

- `idempotency.service.ts` : `edge_idempotency` (`device_id`, `idempotency_key`) ; même clé et même
  empreinte de requête : même réponse rendue ; autre empreinte : `422 IDEMPOTENCY_KEY_REUSED`.
  L'écriture se fait dans la transaction de l'opération (fourni aux lots 21 à 23 :
  `IdempotencyService.lookup(tx, ...)` et `.record(tx, ...)`).
- Toute réponse de ce lot valide le schéma de `openapi.yaml` (utilise
  `apps/api/test/support/contract-schema.ts` comme **référence de méthode** ; ta propre copie dans
  `test/device/`, sans import de l'API).

## T088 – Tests (`apps/gateway/test/device/`)

- `proofs.spec.ts` : chaque preuve manquante ou fausse seule (certificat d'un autre terminal, d'une
  passerelle, hors chaîne ; jeton altéré, expiré, autre `aud`, autre `cnf.jkt` ; signature fausse,
  rejouée, `created` hors tolérance, `@authority` différente) : `401` identique ; terminal
  `SUSPENDED` / `REVOKED`. Chacune doit échouer sur un garde qui n'en vérifie que deux sur trois.
- `authority-separation.spec.ts` (A20) : une requête signée pour l'adresse de la passerelle est
  **refusée par le vérificateur du central** et inversement, dans les deux sens, avec des listes
  d'autorités disjointes et sans joker ; le test échoue si les listes se recouvrent.
- `tokens.spec.ts` : (i) la clé de la passerelle ne signe que des jetons `aud =
  cashless-edge/<gateway_id>` et **un tel jeton est refusé par le vérificateur du central** (par
  `kid`, puis forgé avec le `kid` du central : refusé par signature, puis par audience) ; (ii) un
  jeton émis par le central reçoit `401` sur la passerelle ; (iii) rotation de clé : ancien jeton
  valable jusqu'à `exp`, jamais après.
- `refresh.spec.ts` : (ii) empreinte différente de l'empreinte courante refusée ; (iii) la réponse
  ne contient jamais de jeton de rafraîchissement ; l'empreinte courante n'est pas modifiée par
  l'appel ; jeton de rafraîchissement rejoué 100 fois : toujours valable, jamais un second jeton ;
  famille révoquée refusée. Le test (iv) (rotation forcée au retour, détection de réutilisation)
  relève du central et du banc de WP25.
- `reads.spec.ts` : `304`, `ETag`, `edge_base_url`, accusé jamais provisoire, terminal suspendu
  servi pour `getDeviceSeqStatus`.
- `idempotency.spec.ts`, `contract.spec.ts` : cas ci-dessus ; schémas du contrat sur les réponses
  200, 304, 401, 403, 422.

## Sécurité

- Faux interdits : le faux du port matériel reste refusé en production (WP16) ; aucun vérificateur «
  de test » dans ce lot.
- Aucun journal ne contient un jeton, une empreinte de jeton de rafraîchissement ou une clé ;
  messages sans cause précise côté client.
- Fichiers à faire relire par une personne (cryptographie, jetons) : `device-proofs.guard.ts`,
  `request-signature.ts`, `device-token.service.ts`.

## Definition of Done

- [ ] Trois preuves, ordre, `401` uniforme ; `@authority` exacte ; nonce transactionnel.
- [ ] Tests de borne (i) à (iii) et (v) de R-19 verts ; jeton de la passerelle refusé au central (test).
- [ ] Trois lectures conformes au schéma ; `getDeviceSeqStatus` jamais provisoire.
- [ ] Aucune modification de `apps/api/**` ; lignes de 100 caractères ; contradictions signalées.

## Ce que le relecteur doit casser

- Présenter un jeton du central sur la passerelle et un jeton de la passerelle au central (par
  `kid`, audience, signature).
- Rejouer une requête signée d'un côté vers l'autre ; modifier `@authority` d'un caractère ; ajouter
  un joker dans la configuration de test.
- Rafraîchir avec l'empreinte de la veille ; rafraîchir un million de fois : aucun nouveau jeton de
  rafraîchissement.
- Mesurer le temps de réponse d'un `401` pour chacune des trois preuves : il ne doit pas révéler
  laquelle a échoué.
- Redémarrer entre deux requêtes portant le même nonce.
