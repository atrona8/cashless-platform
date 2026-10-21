---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command:
reviewed_at: '2026-10-21T10:08:54Z'
reviewer_agent: claude (relecteur distinct)
wp_id: WP14
---

# Relecture WP14 — cycle 1 (21/10/2026, relecteur `claude`)

Périmètre : lane-n, `git diff e4f058a..ea218e9` (commits e2e7918, ea218e9), hors kitty-specs/.
Références : contracts/enrollment.md (étapes 1 à 10, audit, tests imposés), spec.md FR-025 / NFR-005 /
NFR-006 / NFR-008, research R-16, data-model « Essais d'enrôlement », migration 0022 (fonctions WP03).

Lancé par le relecteur (sans base) : `npm run lint` vert, `npm run typecheck` vert,
`npx jest test/unit/enrollment-code.spec.ts test/unit/idempotency/request-hash.spec.ts` 24/24.
Intégration et suite complète : vertes selon l'orchestrateur (38/38, 1554 passés / 1 sauté).

## Ce qui est conforme (vérifié)

- Ordre du contrat tenu : 1 corps, 2 clés, limites, 3+4 `check_device_enrollment_code` (lecture seule,
  STABLE), 5+6 attestation, 7 CSR, 8 certificat + jeton tiré, 9 `enroll_device` (seule écriture, verrou
  du code `FOR UPDATE`, usage/expiration revérifiés), 10 jeton d'appareil signé dans la transaction.
  Le contrôle du `serial` (CL028) n'intervient qu'à l'étape 9, après le code : jamais de 409 pour un code
  inconnu/utilisé/expiré (testé, `enrollment.spec.ts:452`).
- Inconnu / utilisé / mal formé : même SQLSTATE CL025, même requête, même corps (testé à l'égalité des
  corps, `enrollment.spec.ts:274-285`) ; mal formé → empreinte NULL, traité comme inconnu.
- Code : HMAC-SHA256 à clé (`enrollmentCodeHash(code, config.enrollmentCodeHmacKey)`), comparaison en base ;
  ni code ni empreinte dans l'audit, ni dans le registre d'idempotence (route `transient`, rejeu → 409
  `CONFLICT_STATE` sans le code, testé) ; NFR-005 testé sur base, audit, registre et journaux.
- Normalisation : refus de tout non-ASCII avant `toUpperCase` (`ſ`, `ı`, pleine chasse testés).
- CSR : ECDSA + SHA-256 exigés (SHA-1 refusé, testé), clé = `signing_public_key` octet pour octet,
  signature vérifiée. `notAfter = min(now + DEVICE_CERT_VALIDITY_DAYS, fin de l'autorité)`, borne
  1..730 dans la configuration ; refus de signer si l'autorité est expirée.
- Clés : SPKI DER réencodé et comparé (canonique, 91 octets, point non compressé, courbe P-256) ; point de
  65 octets extrait à l'offset 26 après vérification de canonicité (sûr : l'en-tête est alors fixe).
  Défis calculés sur les octets reçus ; testé (`enrollment.spec.ts:213-216`, cas compressé refusé).
- Jeton de rafraîchissement : `drt_` + 256 bits `randomBytes`, empreinte SHA-256 seule en base.
- Attestation réelle dans les tests (Android et iOS) ; faux en production : la fabrique refuse sans
  racines, et `assertProcessIsSafe` refuse un `FakeAttestation` injecté dans le graphe de
  `PublicProcessModule` (`enrollment.spec.ts:612-666`). Racine iOS absente en production : refus.
  Racines documentées dans `tools/dev-db/env.sh` et `env.test.example` (report WP10 tenu).
- Portée : `OPERATOR_ADMIN` / `ORGANIZER_ADMIN` ; hors portée → 404 (contrôle redoublé par
  `device_admin_allowed` en base) ; autres rôles 403 ; liste filtrée par organisateurs, sans code ni
  empreinte (colonnes nommées), isolation à deux prestataires testée.
- NFR-008 (20 simultanés → un seul 201) et code non consommé par chaque refus : testés.
- Description OpenAPI de `signing_public_key` / `agreement_public_key` (SPKI DER canonique, 91 octets,
  point de 65 octets stocké) et dérivés (`generated/openapi.ts`, modèle Dart) : conformes, cohérents
  avec data-model et avec le code. Seul `contracts/enrollment.md` étape 2 reste muet (voir N2).

## Constats

### B1 — BLOQUANT — Audit `DEVICE_ENROLLMENT_REFUSED` absent pour la plupart des refus (FR-025, contrat), sans consignation

`apps/api/src/devices/enrollment/enrollment.service.ts:7-9, 133-135, 333-338`

L'audit d'un refus n'est écrit que si `attempt.operatorId` est connu, c'est-à-dire seulement si
`check_device_enrollment_code` a RÉUSSI. Or cette fonction lève elle-même CL026 (expiré) et CL027 (mode
refusé), et CL025 pour un code utilisé : dans ces trois cas le prestataire est connu de la base
(`record_enrollment_attempt` rattache d'ailleurs l'essai au prestataire), mais aucune ligne d'audit
n'est écrite. Idem pour VALIDATION_FAILED et RATE_LIMITED. Il ne reste que `device_enrollment_attempt`,
purgée à 24 h. Le commentaire d'en-tête (« dès que le prestataire du code est connu, c'est-à-dire après
l'étape 3 ») est inexact pour les étapes 3 et 4.

Contrat (enrollment.md l. 39-40) : « `DEVICE_ENROLLMENT_REFUSED` (raison, adresse …), écrit avec
l'essai » ; FR-025 : « une ligne d'audit pour chaque … enrôlement … refusé ». C'est un contrôle retiré
(règle du porteur n° 1) : ni soumis au porteur, ni consigné (ADR / POINTS_OUVERTS), ni testé.
Conséquence concrète : un code qui fuit essayé sur un mauvais appareil (mode refusé) ou après expiration
ne laisse aucune trace durable chez le prestataire.

Correction attendue :
1. Refus d'un code CONNU (utilisé, expiré, mode refusé, et VALIDATION_FAILED / RATE_LIMITED dont
   l'empreinte désigne un code existant) : audit dans la chaîne du prestataire du code. Par exemple,
   `record_enrollment_attempt` rend le prestataire rattaché (nouvelle migration ; `post-roles.sql` 4a et
   `tests_execute_grants.sql` dans le même commit, relecture WP07), et `recordRefusal` écrit l'audit dans
   `tx.run(operator)` quand il est non nul — l'attaquant ne voit rien de plus (même réponse).
2. Refus sans prestataire (code inconnu ou mal formé) : soumettre au porteur — chaîne de la plateforme
   (`operator_id` NULL, possible dans `audit_log`, mais écriture sans compte dans une chaîne sérialisée,
   risque de contention) ou essai seul, limite consignée (ADR + POINTS_OUVERTS + test de borne).
3. Tests : refus expiré, mode refusé et code utilisé → une ligne `DEVICE_ENROLLMENT_REFUSED` chez le
   prestataire, sans code ni empreinte.

### B2 — À SOUMETTRE AU PORTEUR (non bloquant pour le code du lot, bloquant pour la fusion tant que non décidé et consigné) — Oracle « code utilisé / inconnu » par la limite par code

`packages/ledger-sql/migrations/0022_device_enrollment.sql:186-197, 531-567` (WP03), exercé par
`enrollment.service.ts:233-244` ; le test NFR-006 l'évite volontairement (`enrollment.spec.ts:593-594`).

`record_enrollment_attempt` ne garde l'empreinte que si le code EXISTE (utilisé ou non) ; un code inconnu
est stocké avec `code_hash` NULL (data-model l. 101, contrainte `device_enrollment_attempt_known_code`).
Donc la limite « 10 essais par code et par heure » ne s'applique qu'aux codes existants : depuis une
seule adresse, 11 essais d'un code UTILISÉ donnent `429`, 11 essais d'un code INCONNU donnent `422`.
Réponses non identiques → contradiction entre NFR-006 / contrat étape 3 (« même corps ») et
R-16 + data-model ; non signalée, non consignée. Risque pratique faible (il faut déjà un code candidat,
p. ex. une photo d'un ancien QR, pour savoir s'il a servi), mais c'est exactement l'oracle que NFR-006
interdit.

Options pour le porteur :
- (a) Renforcement : garder l'empreinte HMAC de tout code bien formé, connu ou non (prestataire NULL
  pour un inconnu ; l'empreinte à clé ne révèle rien), retirer la contrainte `known_code`, et compter la
  limite par empreinte pour tous. Migration + data-model + test « 11e essai d'un code inconnu → 429 ».
  Peut se faire dans la reprise de WP14 (même migration que B1) ou dans WP18.
- (b) Accepter la limite : ADR + POINTS_OUVERTS + test qui échoue si l'écart s'élargit.

### N1 — Non bloquant (report WP15, WP17, WP18) — `DELETE FROM device_enrollment_attempt` global dans les tests

`apps/api/test/integration/devices/enrollment.spec.ts:77, 166, 594`

Aujourd'hui sans effet (seule suite à lire ou écrire cette table ; la purge de WP12 n'a pas de test
d'intégration qui en dépend). Mais toutes les suites HTTPS partagent l'adresse 127.0.0.1, donc la limite
de 30 essais par adresse et par heure : dès qu'une autre suite enrôlera par la route (`enrollByRoute`,
probable en WP15/WP17/WP18), (i) cette suite effacera les essais de l'autre en plein test, (ii) l'autre
fera passer le « 31e essai → 429 » trop tôt (le test attend 30 × 422), (iii) l'autre suite elle-même
recevra 429 au-delà de 30 enrôlements dans l'heure. Options : enrôler les autres suites par
`TestTerminal.enroll` (propriétaire, sans la route) ; ou n'effacer que les lignes postérieures au
début de la suite et rattachées à ses empreintes ; ou isoler les tests de limite par adresse (::1 contre
127.0.0.1). À écrire dans le prompt de WP15/WP17/WP18.

### N2 — Non bloquant (orchestrateur) — `contracts/enrollment.md` étape 2 à aligner sur `openapi.yaml`

Le report de la relecture WP11 demandait d'écrire le format au contrat. L'implémenteur l'a écrit dans
`packages/contracts/openapi.yaml` (source de rang supérieur, conforme et cohérent avec data-model et le
code) ; l'étape 2 de `contracts/enrollment.md` (kitty-specs, hors de sa main) dit seulement « SPKI P-256
valides ». Ajouter : « SPKI DER canonique (point non compressé, 91 octets), réencodé et comparé ; les
défis hachent ces octets tels que reçus ; la base garde le point de 65 octets ».

### N3 — Non bloquant (porteur, WP18) — Écriture sans compte non bornée

Chaque requête qui passe les étapes 1-2 écrit une ligne d'essai, y compris une fois la limite atteinte
(`RATE_LIMITED` est enregistré). Rien ne borne le volume d'une source distribuée (la purge par lots de
500 suit). À couvrir par une limite en amont (répartiteur) ou consigner.

### N4 — Non bloquant — Limite lue puis essai écrit, sans atomicité

`enrollment.service.ts:235-244` puis `recordRefusal` : N requêtes simultanées passent toutes le contrôle
(le test NFR-008 le montre : 20 essais du même code dans la même seconde). Avec 60 bits d'entropie le
risque de force brute reste nul ; à mentionner dans l'ADR des limites si B2 est consigné.

### N5 — Non bloquant (porteur) — La limite par adresse compte les réussites

`ENROLLED` compte dans les 30 essais par adresse : une installation de plus de 30 terminaux en une heure
derrière une même adresse publique (Wi-Fi du site, NAT) sera bloquée. Décision du contrat (R-16), à
connaître avant le premier événement.

### N6 — Non bloquant — Branche `DEVICE_CERT_VALIDITY_DAYS` de `certificateNotAfter` non testée

`enrollment.service.ts:307-315` : seul le cas « borné par l'autorité » est testé (l. 192-193). Ajouter un
cas où l'autorité dure plus que la durée configurée (unitaire avec une autorité factice).

### N7 — Non bloquant (coordination) — Fichiers partagés avec WP16 (lane-p)

`apps/api/src/audit/audit.service.ts` (union `AuditAction`), `apps/api/src/devices/devices.module.ts`
(imports), `apps/api/test/support/test-terminal.ts`, `apps/api/src/attestation/attestation.module.ts`,
`packages/contracts/openapi.yaml` + `generated/openapi.ts`, `tools/dev-db/env.sh`,
`env.test.example` : aussi touchés par la lane-p. Conflits de fusion attendus (ajouts de lignes) :
les résoudre en gardant les deux côtés.

## Checklist anti-patterns

1. Code mort : PASS (modules importés par `devices.module.ts`, helpers utilisés).
2. Fixtures synthétiques : PASS (routes HTTPS réelles, vérificateur réel, base réelle).
3. Retour vide silencieux : PASS (`recordRefusal` : retour sur 5xx/non mappé documenté ; échec
   d'écriture journalisé sur stderr sans secret).
4. Couverture des FR : FAIL partiel — FR-025 (audit des refus), voir B1.
5. Surface figée : PASS (aucun `.sql` généré de `packages/ledger-sql/` touché).
6. Décision verrouillée : PASS côté code du lot ; contradiction de sources signalée en B2.
7. Fichiers partagés : note de coordination en N7.
8. Fragilité : PASS (`throw` documentés : adresse absente, autorité expirée).

## Fichiers à faire relire par une personne

- `apps/api/src/devices/enrollment/enrollment.service.ts` (ordre des étapes, CSR, borne du certificat,
  écriture unique) ; `apps/api/src/devices/enrollment/enrollment.dto.ts` (`p256Point`, canonicité SPKI) ;
  `apps/api/src/devices/enrollment/refresh-token.ts` ; `apps/api/src/enrollment-code/enrollment-code.ts`
  (normalisation avant HMAC) ; toute nouvelle migration issue de B1/B2 avec `post-roles.sql`.

VERDICT: REJECT

## Décisions du porteur (21/10/2026, ADR-117) — à appliquer dans la reprise

- B1 : audit `DEVICE_ENROLLMENT_REFUSED` pour TOUT refus (validation, limite, code inconnu, utilisé, expiré, mode) :
  chaîne du prestataire si le code est connu en base (même expiré ou utilisé), sinon chaîne de la plateforme
  (`operator_id` NULL). Nouvelle migration si besoin, avec `post-roles.sql` §4a et `tests_execute_grants.sql` dans le
  même commit ; tests pgTAP et Jest.
- B2 : l'essai garde l'empreinte HMAC de tout code bien formé (connu ou non) ; contrainte `known_code` retirée ;
  test « 11e essai d'un code inconnu → 429 » (et même corps de 429 que pour un code existant).
- N5 : la limite de 30 par adresse et par heure ne compte que les refus ; test « 31 enrôlements réussis depuis une
  adresse → aucun 429 ».
- N3 (décision de l'orchestrateur) : au-delà d'une limite, un seul essai et un seul audit `RATE_LIMITED` par adresse
  (ou par code) et par fenêtre ; les 429 suivants n'écrivent rien ; test.
- N1 : `enrollment.spec.ts` ne vide plus toute la table : n'effacer que les lignes de la suite (adresses/empreintes
  propres) ou isoler ; ne pas casser une future suite qui enrôle par la route.
- N6 : tester la branche `DEVICE_CERT_VALIDITY_DAYS` de `certificateNotAfter`.
- N2 : contrat `enrollment.md` (étape 2) déjà aligné sur feat ; réaligner la lane.
