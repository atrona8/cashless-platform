# Correctif post-fusion n° 1 — mission identite-enrolement-terminaux-01M52R6H (21/10/2026)

Source : `mission-review-report.md` (verdict PASS WITH NOTES). Décisions du porteur du 21/10/2026 : deux renforcements
à coder (SEC-2, DRIFT-2) ; les autres constats sont consignés (OP-N74 / ADR-120, OP-N75, SEC-2 dans ADR-105 et OP-N56,
SEC-3 dans OP-N69). Le travail se fait directement sur `feat/identite-enrolement-terminaux` (mission déjà fusionnée).

## 1. SEC-2 : lecture de `device_enrollment_code.code_hash` retirée à `cashless_app` (renforcement)

**Constat.** `cashless_app` peut lire `device_enrollment_code.code_hash` (empreinte HMAC du code d'enrôlement). Avec la
connexion de l'API compromise, ces empreintes servent à préparer un enrôlement (la base croit l'auteur et les preuves
que l'API lui donne : ADR-105, OP-N56).

**Correction attendue.**
1. Vérifier d'abord tous les lecteurs de `code_hash` sous `cashless_app` : route `listDeviceEnrollmentCodes`
   (`GET /v1/device-enrollment-codes`), création, contrôle, enrôlement, limites (`device_enrollment_attempt`), tests.
   Les fonctions SECURITY DEFINER qui lisent `code_hash` pour le compte de l'API restent possibles.
2. `post-roles.sql` : `SELECT` de `cashless_app` sur `device_enrollment_code` accordé colonne par colonne, sans
   `code_hash` (ou `SELECT` retiré si toutes les lectures passent par des fonctions) ; jamais de `.sql` généré modifié.
   Si une requête de l'API lit `code_hash` directement, la faire passer par une fonction existante ou en signaler le
   besoin avant de créer une nouvelle fonction.
3. Test pgTAP de droits : `cashless_app` ne lit pas `code_hash` (refus à l'appel, et liste exacte des colonnes
   lisibles) ; les chemins légitimes (liste des codes, création, enrôlement) restent verts.

## 2. DRIFT-2 : durée du jeton d'appareil bornée à 900 s en production (renforcement)

**Constat.** `apps/api/src/config/config.ts` (~585-590) accepte en production une durée du jeton d'appareil de 60 à
3600 s ; la spécification et le contrat disent 15 min.

**Correction attendue.** En production, une durée supérieure à 900 s refuse le démarrage (message clair) ; hors
production, la plage actuelle reste permise. Test unitaire de `config.ts` : 901 s refusé en production, 900 s accepté,
défaut inchangé.

## Règles
- Règle de sécurité du projet (`CLAUDE.md`) : tout point qui ne tiendrait qu'en affaiblissant la sécurité s'arrête et
  remonte au porteur avant d'être codé.
- Lignes de 100 caractères au plus, commentaires en français, `npm run format:check` vert.
- Fichiers à faire relire par une personne : `post-roles.sql`, `tests_execute_grants.sql` ou le nouveau test de droits,
  `config.ts`.

## Compte rendu de l'implémentation (22/10/2026)

- **SEC-2** (`814710c`) : lecteurs de `code_hash` sous `cashless_app` vérifiés. L'API n'en lit aucun : création,
  contrôle, enrôlement et limites passent par les fonctions SECURITY DEFINER (0022, 0027, 0030), la liste des codes
  nomme ses colonnes ; seuls des tests Jest lisent la colonne, par le propriétaire. `post-roles.sql` §4b : `SELECT`
  retiré puis accordé colonne par colonne (liste calculée, toutes sauf `code_hash`, comme pour `media`), sur
  `device_enrollment_code` **et sur `device_enrollment_attempt`** : renforcement en plus de la consigne, car un essai
  refusé d'un code valide (attestation, numéro de série) garde son empreinte. Aucune fonction créée, aucun `.sql`
  généré modifié. Test : `tests_device_rights.sql` §1 bis (listes exactes, `code_hash`, `SELECT *` et filtre sur
  `code_hash` refusés, témoin des colonnes de `listDeviceEnrollmentCodes`).
- **DRIFT-2** (`941434f`) : `DEVICE_TOKEN_TTL_MAX_PRODUCTION = 900` dans `config.ts` ; en production, 60 à 900, au-delà
  refus de démarrer (« entier de 60 à 900 attendu ») ; hors production, 60 à 3600, défaut 900. Test : `config.spec.ts`
  (901 et 3600 refusés en production, 900 accepté, 3600 accepté hors production, défaut et absence en production).
- **Tests** : pgTAP 2083/2083 ; Jest 1704 passés sur 1711 (6 ignorés), un échec de délai de `claim-code-order.spec.ts`
  (instabilité connue), vert relancé seul avec les suites des terminaux (118/118) ; lint, typecheck,
  `format:check`, `check:generated` verts.
- **À faire relire par une personne** : `packages/ledger-sql/post-roles.sql` (§4b),
  `packages/ledger-sql/tests/tests_device_rights.sql` (§1 bis), `apps/api/src/config/config.ts`.
