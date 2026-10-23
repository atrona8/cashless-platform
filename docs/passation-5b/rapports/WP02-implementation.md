# Compte rendu du lot WP02 — Vendeurs, sessions et set_device_status (migration 0031)

Mission `terminaux-paiement-en-ligne-01M52QB9`, lane-b, commit **`b5641a30`**
(`kitty/mission-terminaux-paiement-en-ligne-01M52QB9-lane-b`). Sous-tâches T006 à T010 marquées `done`
(`spec-kitty agent tasks mark-status`, accepté). Lot non déplacé (`move-task` laissé à l'orchestrateur).

## Reprise

Un implémenteur précédent avait laissé `0031_vendors.sql` et `tests_vendors.sql` non commités. Je les ai
relus contre T006 à T010, les arbitrages et la Definition of Done ; le fond était complet et conforme
(diff du corps de `set_device_status` contre 0022 : seule la fermeture des sessions est ajoutée).
Corrections faites :

1. **Échec ligne 586 (`vendor_pin_check_ttl`)** : ce n'était ni une date en dur ni un TTL faux, mais
   `clock_timestamp()` appelée **deux fois** dans le même `UPDATE` (pour `created_at` puis
   `expires_at`) : deux instants distincts, donc `expires_at <> created_at + 30 s`. Corrigé dans le
   test : l'heure de référence est lue une fois (sous-requête `FROM (SELECT clock_timestamp() - … AS t)`).
   Contrainte inchangée (égalité stricte). Aucun test ne suppose « aujourd'hui » (la seule date fixe,
   `2026-01-01` pour `updated_at`, sert à prouver « sans effet » et vaut n'importe quel jour).
2. **Lignes de 100 caractères** : commentaires et code des deux fichiers rewrappés. Exceptions
   volontaires : 2 lignes de `set_device_status` (0031 l. 464 et 479) gardées mot pour mot de 0022 pour
   que le diff du corps reste lisible par le relecteur.

## Écarts au plan (et leur sens)

- **5e essai « compter d'abord »** (arbitrage) : suivi du contrat ; 4 PIN faux puis le bon PIN bloquent le
  vendeur (le 5e essai est bloqué avant vérification). **Plus strict** que la lettre de FR-004. Testé
  (« compter d'abord : 5e essai rendu avec locked = true »).
- **`vendor_admin_allowed`** : la base revérifie l'auteur que l'API a contrôlé. **Renforcement.**
- **`set_vendor_status` vers le statut déjà en place** : sans effet, sans erreur (arbitrage). Neutre.
- **`assert_vendor_session` sans prestataire de session** : `P0002` (comme toutes les fonctions de 0022),
  `CL032` pour toute autre cause. Neutre (aucune session n'est acceptée).
- **`close_vendor_session`** ne contrôle pas le statut du terminal (fermer ne donne aucun droit). Neutre.
- **Purge** : `purge_device_enrollment_attempts()` remplacée à signature égale (arbitrage), elle rend
  désormais la somme des lignes retirées des deux tables (0022 : essais d'enrôlement seuls). Neutre.

Aucun écart qui affaiblit la sécurité. Aucune contradiction entre sources relevée.

## Retouches hors carte

Aucune. Seuls les deux fichiers du lot sont commités.

## Points soumis au porteur / à l'orchestrateur

- 5e essai : variante « 5 PIN faux exactement » non codée ; ne la coder qu'après décision du porteur.
- Purge : arbitrage appliqué ; si refusé, une nouvelle fonction devrait être accordée (WP07) et branchée
  (WP09).

## Signatures finales (pour WP07 et WP09)

À accorder à `cashless_app` (WP07, `post-roles.sql`) ; aucune `GRANT` dans la migration, `REVOKE ALL …
FROM PUBLIC` sur chacune :

- `create_vendor(p_merchant uuid, p_display_name text, p_pin_hash text, p_actor uuid) RETURNS uuid`
- `set_vendor_pin(p_vendor uuid, p_pin_hash text, p_actor uuid) RETURNS void`
- `set_vendor_status(p_vendor uuid, p_status text, p_actor uuid) RETURNS void`
- `begin_vendor_pin_check(p_vendor uuid, p_device uuid) RETURNS TABLE (check_id uuid, pin_hash text,
  locked boolean)`
- `open_vendor_session(p_check uuid, p_device uuid) RETURNS TABLE (vendor_session_id uuid, vendor_id
  uuid, vendor_display_name text, expires_at timestamptz)`
- `close_vendor_session(p_device uuid) RETURNS uuid` (NULL si aucune session ouverte)
- `assert_vendor_session(p_device uuid, p_session uuid) RETURNS uuid` (rend `vendor_id`)
- Déjà accordées, remplacées à signature égale : `set_device_status(uuid, text, text, uuid)`,
  `purge_device_enrollment_attempts() RETURNS bigint`.
- **Jamais accordée** : `vendor_admin_allowed(uuid, uuid, uuid)` (comme `device_admin_allowed`).
- Vue `vendor_public` (`id, operator_id, merchant_id, display_name, status, locked`) : `SELECT` à
  accorder, `INSERT`/`UPDATE` à retirer ; lecture de `locked_at`, `pin_hash`, `failed_attempts` sur
  `vendor` à retirer.
- Erreurs pour `sqlstate-map.ts` : `CL032` → 409 `VENDOR_SESSION_INVALID`, `CL033` → 401
  `VENDOR_PIN_INVALID` ; `begin_vendor_pin_check` rend aussi `CL030`, `42501` et `P0002`.

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0031_vendors.sql` : fonctions `SECURITY DEFINER` ; ordre des verrous
(terminal → vendeur → session) ; vue `vendor_public` exécutée avec les droits du propriétaire et filtrée
sur `app.operator_id` ; `set_device_status` remplacée (diff du corps contre 0022). L'agent qui a écrit le
code ne vaut pas relecture indépendante.

## Validation (base `cashless_wp02`, supprimée à la fin)

- `bash packages/ledger-sql/scripts/reset-db.sh` → migrations 0001 à 0031, `roles.sql` et
  `post-roles.sql` rejoués (code 0).
- `pg_prove -d cashless_wp02 tests/tests_vendors.sql` → **156 tests, PASS** (cas pgrowlocks exécuté, pas
  sauté).
- `reset-db` puis `bash scripts/test-pgtap.sh` → **34 fichiers, 2 239 tests, PASS**, dont les suites de
  non-régression `tests_device_enrollment`, `tests_device_tokens`, `tests_execute_grants`,
  `tests_definer_search_path`, `tests_device_purge_window`.
- Pas lancés : `lint`, `typecheck` (aucun fichier TS ou JS modifié), Jest de l'API (base partagée réservée
  à l'orchestrateur).

## Critères d'acceptation couverts (fichier `packages/ledger-sql/tests/tests_vendors.sql`, nom du cas)

- **FR-001** (vendeurs) : « create_vendor : MERCHANT_ADMIN du commerçant », « … OPERATOR_ADMIN du
  prestataire », « … MERCHANT_ADMIN d'un autre commerçant -> P0002 », « … commerçant d'un autre
  prestataire -> P0002 », « set_vendor_status : désactivation, sessions fermées (VENDOR_DISABLED) »,
  « set_vendor_status : réactivation », « … statut déjà en place, sans effet ».
- **FR-002** (PIN, empreinte) : « create_vendor : empreinte non PHC argon2id -> CL001, message sans
  l'empreinte », « vendor : empreinte non PHC refusée », « set_vendor_pin : nouvelle empreinte, compteur
  à 0, blocage levé ».
- **FR-003** (session) : « ouverture : vendeur, nom et fin à 12 h rendus », « ouverture : session
  précédente du terminal fermée (REPLACED) », « vendor_session : deuxième session ouverte sur un terminal
  refusée (index unique) », cas « ouverture : … -> CL033 » (check utilisé, expiré, autre terminal,
  vendeur désactivé/bloqué entre A et B, terminal suspendu, autre commerçant, autre prestataire).
- **FR-004 / NFR-003** (blocage) : « compter d'abord : compteur à 1 avant toute vérification »,
  « … 5e essai rendu avec locked = true », « … le blocage ferme la session du vendeur (VENDOR_LOCKED) »,
  « … 6e essai, zéro ligne », « … le compteur reste à 5 (jamais au-delà) », « vendor : compteur 6
  refusé », « set_vendor_status : réactiver ne débloque pas ». (Concurrence réelle : WP09/WP14.)
- **FR-005** (fin de session) : « close_vendor_session : motif LOGOUT », « garde : session expirée ->
  CL032 », « set_device_status : suspension, session du terminal fermée (DEVICE_SUSPENDED) », « …
  révocation, … (DEVICE_REVOKED) », « … retour à ACTIVE, aucune session rouverte », « set_vendor_pin :
  sessions ouvertes du vendeur fermées (PIN_CHANGED) ».
- **FR-006** (attribution par le serveur, côté base) : « garde : session valide, rend le vendeur »,
  « garde : autre identifiant de session -> CL032 », « garde : session d'un autre terminal -> CL032 »,
  « garde : vendeur désactivé -> CL032 », « garde : vendeur bloqué -> CL032 ».
- **FR-026** (audit) : côté base, `begin_vendor_pin_check` rend `locked` pour l'audit `VENDOR_LOCKED`
  (cas « 5e essai rendu avec locked = true ») ; l'audit lui-même est écrit par l'API (WP09).
- **NFR-002** (aucune empreinte exposée) : « vendor_public : ni pin_hash, ni failed_attempts, ni
  locked_at », messages sans écho (« … CL001, message sans l'empreinte », « set_vendor_pin : empreinte
  invalide -> CL001 sans écho »).
- **NFR-007** (isolation) : « RLS activée et forcée sur les trois tables », « vendor_public : vendeur
  d'un autre prestataire invisible (propriétaire qui ignore la RLS) », « vendor_public : sans prestataire
  de session, aucune ligne », « refus : vendeur d'un autre commerçant jamais compté », « refus : vendeur
  d'un autre prestataire non compté », « begin_vendor_pin_check : terminal d'un autre prestataire ->
  P0002 », « garde : session d'un autre prestataire -> CL032 ».
- **C-001 / structure** : « dix fonctions SECURITY DEFINER, search_path public, pg_temp », « aucune des
  dix fonctions n'est exécutable par PUBLIC », « verrous : terminal pris en partage », « verrous : ligne
  du terminal en FOR SHARE (pgrowlocks) ».

## Cycle 2 (après rejet du cycle 1, `review-feedback-1.md`)

Commit `f08f1394` dans lane-b (deux fichiers du lot seulement, aucune retouche hors carte, aucune
signature changée : WP04/WP07/WP09 non impactés). Le prompt rendu par
`spec-kitty agent action implement WP02` n'incluait pas le retour de relecture ; lu directement dans
`tasks/WP02-base-vendeurs-sessions/review-feedback-1.md`.

### Constat 1 (bloquant) : corrigé, c'est un renforcement (règle 1 : fait, puis consigné)
- `set_vendor_pin`, `set_vendor_status` au passage à DISABLED, et `begin_vendor_pin_check` au blocage
  (5e essai) : `DELETE FROM vendor_pin_check WHERE vendor_id = v.id AND operator_id = v_operator AND
  used_at IS NULL`, sous le `FOR UPDATE` du vendeur déjà pris. Ordre des verrous inchangé
  (vendeur, puis checks, puis sessions). Les checks déjà utilisés sont gardés (historique).
  Au blocage, les checks des essais 1 à 4 sont retirés, celui du 5e est inséré après (rendu à l'API,
  refusé par `open_vendor_session` tant que le vendeur est bloqué, retiré par le nouveau PIN).
- `open_vendor_session` : rien à changer ; un check retiré n'est plus trouvé, donc `CL033` (même
  message que les autres causes).
- Autres chemins examinés :
  - réactivation (DISABLED -> ACTIVE) : les essais antérieurs ont été retirés à la désactivation ;
    rien à faire ;
  - déblocage : seul `set_vendor_pin` débloque ; il retire les essais ;
  - `create_vendor` : pas d'essai antérieur possible ;
  - changement de commerçant du vendeur ou de point de vente du terminal : aucune fonction ne le
    fait, et `open_vendor_session` revérifie le commerçant ;
  - `set_device_status` (SUSPENDED puis ACTIVE en moins de 30 s) : l'empreinte reste juste, le check
    a été vérifié contre le PIN courant du vendeur ; je n'y ai PAS ajouté de purge, volontairement :
    cette fonction ne prend pas le vendeur, et retirer les checks du terminal là risquerait un
    interblocage (40P01) avec une purge par vendeur concurrente, chacune verrouillant les mêmes
    lignes de check dans un ordre différent. Risque résiduel jugé négligeable (fenêtre de 30 s, PIN
    juste, terminal revenu ACTIVE par un administrateur). À trancher par l'orchestrateur si besoin.
  - aucune autre fonction (migrations ou API) n'écrit `pin_hash` ou `vendor_pin_check` (grep).

### Constat 3 (mineur) : corrigé
Le 5e essai est capturé (`t_lock5`) et passé à `open_vendor_session` : `CL033`, vendeur toujours
bloqué, compteur à 5.

### Constat 2 (mineur) : rien de codé, à reporter vers WP09
Deux ouvertures simultanées sur un même terminal pour deux vendeurs différents : la seconde échoue sur
l'index `vendor_session_open_per_device` (`23505`), pas en `CL033`. Issue sûre (refus) mais non
traduite (500). WP09 : garder le `429` du contrat pour un second essai simultané du même terminal,
ou traduire ce `23505` (contrainte `vendor_session_open_per_device`) en `401 VENDOR_PIN_INVALID`.

### Tests ajoutés (`tests_vendors.sql`), 156 -> 166
- « compter d'abord : le blocage retire les checks des essais 1 à 4, seul celui du 5e reste »
- « compter d'abord : check du 5e essai passé à open_vendor_session -> CL033 » (+ vendeur reste
  bloqué)
- « set_vendor_pin : essais non utilisés du vendeur retirés », « … le check déjà utilisé est gardé »,
  « … check émis avant le déblocage -> CL033 »
- « set_vendor_pin : essai compté avant le changement de PIN (ancien PIN) -> CL033 », « … aucune
  session ouverte avec l'ancien PIN »
- « set_vendor_status : désactivation, essais non utilisés du vendeur retirés », « … essai antérieur
  à la désactivation, après réactivation -> CL033 »
- Ajustés : nombres de checks (6 -> 2, 7 -> 3) ; la purge (§13) crée deux essais neufs au lieu de
  reprendre ceux de Awa, retirés désormais par `set_vendor_pin`.
- Contre-épreuve : la suite rejouée sur la migration du cycle 1 échoue sur 11 cas (dont les quatre
  `CL033` des scénarios du relecteur) ; elle passe sur la migration corrigée.

### Validation (base `cashless_wp02`, supprimée à la fin)
- `reset-db` -> 0001 à 0031, roles.sql, post-roles.sql : OK.
- `pg_prove -d cashless_wp02 tests/tests_vendors.sql` -> 166 tests, PASS.
- `reset-db` puis `bash scripts/test-pgtap.sh` -> 34 fichiers, 2 249 tests, PASS.
- Lignes <= 100 caractères (comptées en caractères) dans les zones modifiées ; exceptions 474 et 489
  de 0031 inchangées (copie de 0022, déjà déclarées).
- T006 à T010 remarquées done (`mark-status`, accepté). Pas de `move-task`.

### À faire relire par une personne
`0031_vendors.sql` (inchangé dans le principe : SECURITY DEFINER, verrous) ; en plus, les trois
`DELETE` ajoutés sous le verrou du vendeur.
