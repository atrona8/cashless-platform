---
work_package_id: WP01
title: Base de données — fonctions d'identification (KYC) du festivalier
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-006
- NFR-003
- C-005
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-serveur-app-festivalier-01M7WB69
base_commit: 6ff37c51900bf0cd194e1bfbb5b4ef245b4968ba
created_at: '2026-11-20T14:46:43.626212+00:00'
subtasks: [T001, T002, T003, T004, T005]
phase: Phase 1 - Base de données
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/
create_intent:
- packages/ledger-sql/migrations/0096_kyc_functions.sql
- packages/ledger-sql/tests/tests_kyc_functions.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0096_kyc_functions.sql
- packages/ledger-sql/tests/tests_kyc_functions.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Base de données, fonctions d'identification (KYC)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/serveur-app-festivalier-01M7WB69/interfaces.md` (ligne `create_kyc_verification`,
  `revoke_kyc_verification`, table des codes `CL060` à `CL063`) ; `contracts/kyc.md` ; `plan.md`
  IC-01 ; `spec.md` FR-001 à FR-003, FR-006, NFR-003, C-005 ; `research.md` R-01 ;
- `packages/ledger-sql/schema_grand_livre_cashless.sql` (lecture seule) : l. 1737-1755
  (`kyc_verification`, colonnes et `CHECK`), l. 1757-1767 (déclencheur d'ajout seul), l. 1769-1783
  (`customer_kyc_level`, `wallet_kyc_level`), l. 1785-1787 (RLS), l. 1808-1850
  (`check_wallet_limits`), l. 1706-1719 (`assert_tenant`, `tenant_of_wallet`), l. 220-228 (`wallet`)
  ;
- `packages/ledger-sql/migrations/0080_customer_auth.sql` l. 22-33 (`customer_identity`) ;
  `0003_*.sql` l. 6-25 (`app_user`, `phone` et son `CHECK` E.164) et l. 72-101 (garde des personnes)
  ;
- `packages/ledger-sql/migrations/0091_media_batch_functions.sql` l. 11-39 (forme d'une fonction
  `DEFINER` récente : `search_path`, prestataire de session, `REVOKE ... FROM PUBLIC`) ;
  `0058_edge_gateway_admin.sql` l. 125-130 (écriture d'audit depuis une fonction) ;
- `packages/ledger-sql/tests/tests_payment_rights.sql` l. 98-106 (grand livre, portefeuille) et l.
  139-141 (insertion d'une identification) ; `tests_customer_auth.sql` l. 13-33 (fixtures de
  comptes) ; `tests_media_batch_functions.sql` l. 1-50 (en-tête et assistants pgTAP à copier).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi sur les noms et signatures ;
contradiction ou manque : tu la signales, tu ne la tranches pas en silence.

## Objective

Rendre les fonctions de la base seule voie d'écriture des identifications (cashless_app n'a plus
d'écriture directe depuis la mission 5b : `post-roles.sql` l. 650) avec les règles de SPECIFICATION
§6.3 points 1 à 4 : compte au numéro vérifié, agent qui n'est pas titulaire, pièce non expirée,
quatre derniers caractères seulement. Ce lot **n'accorde ni ne retire aucun droit** : WP04 pose les
`EXECUTE`. Les fonctions sont prouvées **en propriétaire** (et en isolation de prestataire par
`app.operator_id`).

## Context

- Dernière migration existante : `0095`. La tienne : `0096_kyc_functions.sql`, la seule de ce lot.
  Aucune migration existante, aucun `.sql` généré, ni `schema_grand_livre_cashless.sql` ne se
  retouche.
- **Rien à changer dans le schéma** : `wallet_kyc_level` et `check_wallet_limits` restent tels quels
  (niveau calculé à la date de l'opération, ADR-54). `kyc_verification` est en ajout seul : le
  déclencheur (l. 1757-1767) n'admet que `VERIFIED` → `REVOKED` avec `revoked_at`, `revoked_by`,
  `revoked_reason` ; la `CHECK` de la table exige les trois ensemble.
- **Décision du porteur (20/11/2026), limite consignée C-005** : l'agent titulaire est détecté par
  égalité exacte de `app_user.phone` et de `customer_identity.phone` (tous deux E.164 par `CHECK`).
  Un agent sans téléphone, ou avec un autre numéro, n'est **pas** détecté : c'est voulu, c'est une
  dette nommée (WP11), et T005 est son test de borne. Ne l'élargis pas, ne la resserre pas.
- Codes à poser : `CL060` compte exigé (portefeuille sans client, ou client sans
  `customer_identity`) ; `CL061` agent titulaire ; `CL062` donnée de pièce ou motif invalide ;
  `CL063` déjà révoquée. `CL064` et `CL065` sont à WP02. Le mappage HTTP est à WP05, pas à toi.
- Le propriétaire des fonctions ignore la RLS (hypothèse 0022, OP-N87) : chaque lecture ou écriture
  nomme explicitement le prestataire de session. Un objet d'un autre prestataire répond
  `no_data_found` (`'Objet introuvable'`), jamais autre chose (aucun oracle d'existence).
- Les messages d'erreur **ne contiennent ni numéro, ni identifiant d'agent, ni chiffres de pièce** :
  l'API ne lit pas le texte, mais une base peut le journaliser.
- Fiche commune : `REVOKE ALL ... FROM PUBLIC` dans la migration, `SET search_path = public,
  pg_temp`, prestataire de session vérifié, aucun `GRANT`, aucun `DELETE`.

## Subtasks

### T001 : `create_kyc_verification`

Signature fixée par `interfaces.md` : `create_kyc_verification(p_wallet uuid, p_customer uuid,
p_id_type text, p_id_country text, p_id_last4 text, p_id_expires_on date, p_agent uuid) RETURNS
kyc_verification` (révision du 20/11 : contrat `oneOf`, un seul des deux premiers), `LANGUAGE
plpgsql SECURITY DEFINER SET search_path = public, pg_temp`. Étapes, dans cet ordre (l'ordre est
testé) :
1. Prestataire : `v_operator := nullif(current_setting('app.operator_id', true), '')::uuid` ; nul :
   `no_data_found`. Calque la forme de `create_media_batch` (0091, l. 17).
2. Forme : `(p_wallet IS NULL) = (p_customer IS NULL)` (aucun ou les deux) : `CL062`. Avec
   `p_wallet` : `SELECT * INTO w FROM wallet WHERE id = p_wallet AND operator_id = v_operator FOR
   UPDATE` ; absent ou d'un autre prestataire : `no_data_found` ; le verrou sérialise deux
   identifications du même portefeuille ; `v_customer := w.customer_id`, `wallet_id` = `p_wallet`.
   Avec `p_customer` : `v_customer := p_customer`, **`wallet_id` NULL** dans la ligne ; client qui
   n'est pas un `party` `CUSTOMER` de `v_operator` : `no_data_found`.
3. `v_customer IS NULL` : `CL060`. Puis `SELECT phone INTO v_phone FROM customer_identity WHERE
   customer_id = v_customer AND operator_id = v_operator` ; absent : `CL060` (client sans numéro
   vérifié : comptes antérieurs à 0080).
4. Agent : `p_agent IS NULL` : `CL001`. `SELECT phone INTO v_agent_phone FROM app_user WHERE id =
   p_agent` ; absent : `no_data_found`. Si `v_agent_phone IS NOT NULL AND v_agent_phone = v_phone` :
   `CL061`. Comparaison stricte, sans normalisation (les deux colonnes sont déjà E.164).
5. Pièce, `CL062` sur chacun : `p_id_type` hors des cinq valeurs de la `CHECK` (l. 1744) ;
   `p_id_country` hors `^[A-Z]{2}$` ; `upper(p_id_last4)` hors `^[0-9A-Z]{1,4}$` (pas de `btrim` :
   un espace est refusé) ; `p_id_expires_on` nul ou `< current_date` (pièce déjà expirée à la
   saisie).
6. `INSERT INTO kyc_verification (operator_id, customer_id, wallet_id, method, agent_id, id_type,
   id_country, id_last4, id_expires_on) VALUES (v_operator, v_customer, p_wallet, 'DESK', p_agent,
   ..., upper(p_id_last4), ...) RETURNING * INTO r` ; `RETURN r`.
- Pas de `UNIQUE` : une seconde identification valide du même client est admise (renouvellement de
  pièce). L'idempotence d'une répétition est celle de l'API (WP05), pas de la base.
- Piège : l'insertion déclenche les déclencheurs de réplication de bord `edge_ref_kyc_ins` (0063 l.
  518-521, différé). Sans effet pour toi, mais ne les contourne pas.
- Piège : `current_date` est celui du serveur ; l'expiration d'une pièce « aujourd'hui » est
  acceptée (`>=`), comme `customer_kyc_level` (`id_expires_on >= p_on`, l. 1772).
- Validation : `pg_prove -d cashless_wp01 tests/tests_kyc_functions.sql` (T004).

### T002 : `revoke_kyc_verification`

`revoke_kyc_verification(p_id uuid, p_by uuid, p_reason text) RETURNS kyc_verification`, même forme
`DEFINER`. Ordre :
1. Prestataire de session (nul : `no_data_found`) ; `p_by IS NULL` : `CL001`.
2. `SELECT * INTO r FROM kyc_verification WHERE id = p_id AND operator_id = v_operator FOR UPDATE` ;
   introuvable ou d'un autre prestataire : `no_data_found`.
3. `length(btrim(p_reason)) < 10` (nul compris) : `CL062`.
4. `r.status = 'REVOKED'` : `CL063`.
5. `UPDATE kyc_verification SET status = 'REVOKED', revoked_at = clock_timestamp(), revoked_by =
   p_by, revoked_reason = btrim(p_reason) WHERE id = p_id RETURNING * INTO r` ; `RETURN r`.
- Seules ces quatre colonnes changent : toute autre ferait lever le déclencheur d'ajout seul.
- Effet voulu et à prouver : `customer_kyc_level` (l. 1774-1775) lit `revoked_at::date > p_on` ;
  après révocation, le niveau d'aujourd'hui est `NONE` pour **tous** les portefeuilles du client.
- Le valideur de la demande à deux personnes est au journal d'audit de l'API (WP06), pas ici :
  `p_by` est l'auteur de la demande.

### T003 : codes et en-tête de migration

- En-tête de `0096` (français, 10 à 15 lignes) : objet, mission 10a WP01, « aucun droit accordé »
  (WP04), liste des codes `CL060` à `CL063` avec leur sens, rappel de la limite C-005 et des deux
  fonctions à faire relire. Pas de `BEGIN`/`COMMIT` (la série les pose).
- `REVOKE ALL ON FUNCTION create_kyc_verification(uuid, uuid, text, text, text, date, uuid) FROM
  PUBLIC;` et idem pour `revoke_kyc_verification(uuid, uuid, text)`. Aucun autre `GRANT` ou
  `REVOKE`.

### T004 : pgTAP `tests_kyc_functions.sql`

Modèle : `tests_media_batch_functions.sql` (en-tête, `\ir _grants_for_tests.sql`, `no_plan`,
assistants `pg_temp.id`, `pg_temp.as_op`, `pg_temp.state`) ; fixtures en propriétaire d'après
`tests_payment_rights.sql` l. 98-106 : deux prestataires A et B, un organisateur, un événement, un
grand livre `EVENT`, un portefeuille avec client et `customer_identity`, un portefeuille anonyme, un
`app_user` agent (sans `phone`) et un agent titulaire (`phone` = celui du client), un profil de
législation à plafonds (pour le niveau). Écris à la main ; ne touche aucun fichier généré. Cas :
- **Succès** : ligne `DESK`, `VERIFIED`, `agent_id`, `customer_id`, `wallet_id` posés ; `id_last4`
  `ab1c` rendu `AB1C` ; **valeur lue en base**, pas seulement `lives_ok`.
- **Refus, avec SQLSTATE et rien d'écrit** (compte les lignes **du prestataire du test** avant et
  après) : portefeuille anonyme `CL060` ; client sans `customer_identity` `CL060` ; agent titulaire
  `CL061` ; pièce expirée hier `CL062` ; `id_last4` de cinq caractères, vide, avec espace `CL062` ;
  type de pièce inconnu `CL062` ; pays `sn` ou `SEN` `CL062` ; agent inconnu `no_data_found`.
- **Forme `p_customer`** : mêmes cas (succès avec `wallet_id` NULL lu en base, `CL060`, `CL061`,
  `CL062`, isolation) ; `p_wallet` et `p_customer` ensemble ou absents : `CL062`.
- **Ordre des contrôles** : portefeuille anonyme avec agent titulaire et pièce expirée : `CL060`.
- **Niveau calculé** (avec `app.operator_id` posé, la fonction le lit) : `wallet_kyc_level` vaut
  `NONE` avant, `VERIFIED` après, pour **un second portefeuille du même client** aussi ; `NONE` à
  `current_date + 400` (expiration sans tâche planifiée) ; `NONE` pour une identification insérée
  par le propriétaire avec une pièce expirée hier ; après `revoke_kyc_verification`, `NONE` de
  nouveau.
- **Révocation** : succès (`status`, `revoked_by`, `revoked_reason` posés, motif rogné) ; motif de 9
  caractères et motif d'espaces `CL062` ; deuxième révocation `CL063` ; identifiant inconnu
  `no_data_found` ; `p_by` nul `CL001`.
- **Isolation** : session de B appelant avec le portefeuille de A (création) et l'identification de
  A (révocation) : `no_data_found`, aucune ligne changée.
- **Forme** : `prosecdef` vrai, `proconfig` contient `search_path=public, pg_temp`, `PUBLIC` sans
  `EXECUTE` (`has_function_privilege('public', ..., 'EXECUTE')` faux), pour les deux fonctions.
- **Ajout seul intact** : `UPDATE kyc_verification SET id_last4 = 'ZZZZ'` en propriétaire échoue (le
  déclencheur reste le juge) ; ne le répare pas.

### T005 : test de borne C-005

Dans le même fichier, bloc « Limite consignée C-005 » (le test porte ce nom, WP11 le cite) :
1. agent **sans** `phone` identifie le client : accepté ;
2. agent avec **un autre** numéro E.164 : accepté ;
3. agent dont le numéro est celui du client : `CL061` ;
4. agent dont le numéro est celui d'un client **d'un autre prestataire** : accepté (la comparaison
   est limitée au client présenté, pas à tout le prestataire). Le bloc échoue si la règle s'élargit
   (refuser l'agent sans numéro) ou se resserre en silence (comparaison par préfixe, par chiffres
   seuls, ou sans filtre de prestataire).

## Tests et preuves

Base `cashless_wp01` (jamais `cashless_test`), serveur 5433, depuis la lane (`cd <lane> || exit 1`)
:

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp01
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp01 tests/tests_kyc_functions.sql
pg_prove -d cashless_wp01 tests/tests_definer_search_path.sql tests/tests_customer_auth.sql \
  tests/tests_payment_rights.sql
```

`tests_definer_search_path.sql` doit rester vert : tes deux fonctions ont `pg_temp` en dernier. Les
suites de droits figées (`tests_execute_grants.sql`, `tests_11a_rights.sql`) échouent sur les
fonctions nouvelles tant que WP04 n'a pas fusionné : normal, ne les touche pas.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`. Worktree de lane calculé par
  `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Definition of Done

- [ ] `0096` : deux fonctions `DEFINER`, `search_path = public, pg_temp`, prestataire de session,
      `REVOKE ... FROM PUBLIC` ; codes `CL060` à `CL063` ; aucun `GRANT` ; aucune migration
      retouchée.
- [ ] `tests_kyc_functions.sql` vert sur `cashless_wp01`, avec contrôles positifs et lecture des
      valeurs écrites ; bloc C-005 nommé.
- [ ] **Mutations vérifiées**, chacune rejouée puis rétablie, résultat noté : (a) retirer le
      contrôle `CL061` : le test de l'agent titulaire échoue ; (b) retirer le contrôle d'expiration
      : le test « pièce expirée » échoue ; (c) retirer `AND operator_id = v_operator` de la lecture
      de `customer_identity` ou de `wallet` : le test d'isolation échoue ; (d) retirer le contrôle
      `CL063` : le test de seconde révocation échoue (il tomberait sinon sur l'erreur générique du
      déclencheur) ; (e) comparer les numéros sans filtre de client : le point 4 de T005 échoue.
- [ ] Aucun fichier hors `owned_files` ; `wallet_kyc_level` et `check_wallet_limits` intacts.
- [ ] Note de lane : signatures réelles, ordre des contrôles retenu, choix « agent inconnu =
      `no_data_found` », mutations et résultats, écart éventuel à `interfaces.md`.

## Risks

- Fonction `DEFINER` sous un propriétaire qui ignore la RLS : un prestataire oublié dans un `WHERE`
  fait fuir ou écrire entre locataires. Relis chaque `FROM` de tes deux fonctions.
- `p_id_country char(2)` dans `data-model.md` contre `text` dans `interfaces.md` : suis
  `interfaces.md` (`text`), la colonne `char(2)` fait le reste ; signale-le dans la note.
- `customer_kyc_level` lit `app.operator_id` : un test qui oublie de le poser voit `NONE` partout et
  croit la fonction fautive.

## Ce que le relecteur doit casser

- Identifier un portefeuille anonyme, ou un client sans numéro vérifié : jamais d'écriture.
- Agent titulaire par numéro identique ; puis la limite C-005 : l'agent sans numéro et l'agent à
  autre numéro passent, et le test le dit ; un agent d'un autre prestataire ; un agent inexistant.
- Pièce expirée la veille, expirant aujourd'hui, `id_last4` de 5 caractères, en minuscules, avec
  espace ou caractère accentué, pays en minuscules, type inconnu.
- Session de B sur un portefeuille ou une identification de A ; session sans `app.operator_id`.
- Révocation : motif court, motif d'espaces, deuxième révocation, auteur nul ; niveau d'un second
  portefeuille du même client après révocation.
- Un test qui ne prouve rien : `lives_ok` sans lire la ligne, fixture qui insère déjà l'état final,
  mutation notée mais jamais rejouée, `search_path` sans `pg_temp`, un droit accordé dans `0096`.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0096_kyc_functions.sql` (fonctions `SECURITY DEFINER`, isolation
  des prestataires, règle de l'agent titulaire). Pas de cryptographie.
