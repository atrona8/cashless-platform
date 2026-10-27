# Compte rendu du lot WP06 : OP-N74, enrôlement et état de l'événement (migration 0035)

- Lane : `.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-f`, commit `a7525775`.
- Fichiers : `packages/ledger-sql/migrations/0035_enrollment_event_state.sql`,
  `packages/ledger-sql/tests/tests_enrollment_event_state.sql` (seuls fichiers du commit).
- Sous-tâches T025, T026, T027 marquées `done` (mark-status accepté depuis le checkout principal).
  `move-task` non lancé (c'est à l'orchestrateur).
- Dépendance à 0031–0034 : **aucune**. La migration 0035 ne touche que des objets de 0022, 0027
  et du schéma. Le numéro laisse un trou dans la lane ; `migrate.ts` applique les fichiers triés,
  donc le trou est sans effet.

## Ce qui est fait

1. `create_device_enrollment_code` : `CREATE OR REPLACE`, même signature et mêmes noms de
   paramètres, `SECURITY DEFINER`, `search_path = public, pg_temp`. Corps de 0022 §3a à
   l'identique. **Après** le contrôle de l'auteur, la fonction relit `event.status` `FOR SHARE`,
   puis refuse en `CL031` un événement `CLOSED` (tout mode), et un état de clôture avec le mode
   effectif `coalesce(p_mode,'CATALOG_POS')` égal à `CATALOG_POS` ou `KEYPAD_TPE`.
2. `enroll_device` : `CREATE OR REPLACE`, même signature, `p_device_id DEFAULT NULL` gardé,
   `#variable_conflict use_column` gardé. Corps de 0022 §3c à l'identique. Entre le mode (étape 3)
   et le verrou du `serial` (étape 4), deux blocs sont ajoutés :
   - 3a : événement du code lu `FOR SHARE`, après le `FOR UPDATE` du code. Un événement
     introuvable, `CLOSED`, ou en clôture pour une caisse donne `CL031`.
   - 3b : point de vente du code relu. Il doit exister et appartenir au prestataire du code et à
     l'événement du code (`merchant_participation.event_id`), sinon `CL031`.
3. Trace du refus (arbitrage ADR-117) : la contrainte `device_enrollment_attempt_result` est
   élargie à la seule valeur `EVENT_CLOSED`. `record_enrollment_attempt` (0027 §2) est remplacée
   à l'identique, avec `EVENT_CLOSED` ajouté à sa liste. Sans ce remplacement, la fonction
   refusait la valeur en `CL001` avant d'atteindre la contrainte.
4. `REVOKE ALL … FROM PUBLIC` rejoué pour les trois fonctions. Aucun `GRANT`.

Diff du corps de chaque fonction avec son original (seuls les blocs ajoutés et la mise en page de
l'en-tête diffèrent) : `/private/tmp/claude-501/-Users-xaamga-Documents-omar-sylla-work-cashless-cashless-platform/f0e7d624-1029-4794-b279-4fb517530391/scratchpad/rapports/WP06-diff-fonctions.diff`.

## Écarts au plan (avec leur sens)

- **Renforcement** : `record_enrollment_attempt` est remplacée en plus des deux fonctions prévues.
  C'est la seule façon de rendre l'arbitrage ADR-117 effectif, et la seule modification est
  l'ajout de la valeur `EVENT_CLOSED`.
- **Renforcement** : à l'enrôlement, un événement introuvable dans le prestataire du code donne
  `CL031` : le refus est fermé au lieu de laisser passer. Le cas est impossible avec la clé
  étrangère, mais le refus est codé quand même.
- **Renforcement** : à l'émission, la relecture `FOR SHARE` reprend `operator_id = v_operator`
  (`P0002` si absent). Le cas est déjà couvert plus haut, mais la ligne verrouillée est ainsi
  toujours celle du prestataire.
- Code du refus « point de vente hors de l'événement du code » : `CL031`, comme proposé et
  retenu par l'arbitrage.
- Preuve du verrou : le prompt demande `pg_locks`, mais un verrou de ligne n'apparaît pas dans
  `pg_locks` tant que personne n'attend. La suite utilise donc l'extension `pgrowlocks`
  (présente sur le serveur Docker, créée dans la transaction de test puis annulée) et vérifie
  aussi le texte de la fonction (`prosrc`). Un essai en retirant les deux `FOR SHARE` fait
  échouer 4 cas (8, 9, 45, 91). Les tests distinguent donc bien les deux versions.
- Lignes de plus de 100 caractères : les lignes recopiées de 0022 sont gardées telles quelles, pour
  que le diff reste propre. La suite suit le style de `tests_device_enrollment.sql`, avec ses
  longues signatures `regprocedure`. Prettier ne formate pas le SQL.

## Retouches hors carte

- **Non faite** : la ligne `ENROLLMENT_EVENT_CLOSED: 'EVENT_CLOSED'` de `ATTEMPT_RESULTS`
  (`apps/api/src/devices/enrollment/enrollment.service.ts`), pourtant autorisée par l'arbitrage.
  Raison : la lane f ne contient pas l'ajout de `ENROLLMENT_EVENT_CLOSED` à `ProblemCode` (WP01,
  lane a, pas encore dans la branche de mission). La clé ferait donc échouer `typecheck` ici. Par
  ailleurs, tant que WP08 ne traduit pas `CL031` en 422, l'API rend une erreur 5xx et
  `recordRefusal` ne trace pas, quelle que soit la ligne. **À ajouter par l'orchestrateur ou par
  WP08 une fois WP01 fusionné.** Côté base, tout est prêt et testé (section 7 de la suite).
- `spec-kitty agent tasks mark-status` écrit dans `kitty-specs/` du checkout principal : c'est
  l'effet normal de cet outil, pas une écriture de ma part.

## Points soumis au porteur ou à l'orchestrateur

1. Code du refus pour le point de vente : `CL031`, retenu par l'arbitrage, à valider. Dans les
   faits, ce contrôle ne peut se déclencher qu'en contournant les gardes : le rattachement d'un
   point de vente (`point_of_sale_guard`) et l'événement d'une participation
   (`participation_guard`) sont immuables (0007). Il reste une défense en profondeur. Pour cette
   raison, aucun verrou n'est pris sur le point de vente ni sur la participation.
2. Le refus arrive **après l'attestation** : `check_device_enrollment_code` est laissée telle
   quelle, hors plan. Renforcement possible, non codé : refuser plus tôt dans cette fonction, en
   lecture seule.
3. Trace des refus : la base est prête, il manque la ligne de l'API (voir plus haut). Une
   dépendance d'ordre est à prévoir : WP01, puis WP08, puis la ligne `ATTEMPT_RESULTS`.
4. Les refus `EVENT_CLOSED` comptent dans les limites R-16 (10 par code, 30 par adresse), comme
   tout refus (`result NOT IN ('ENROLLED','RATE_LIMITED')`). Ce comportement est cohérent et je
   n'ai rien changé.

Aucun écart n'affaiblit la sécurité.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0035_enrollment_event_state.sql` : les fonctions d'enrôlement
  `SECURITY DEFINER` sont remplacées en entier, la contrainte d'essai est élargie et
  `record_enrollment_attempt` est remplacée.

## Critères d'acceptation couverts (preuves)

Suite : `packages/ledger-sql/tests/tests_enrollment_event_state.sql` (110 cas).

| Critère | Cas de la suite |
|---|---|
| FR-024, émission refusée en CLOSED (tout mode) et dès CLOSING pour CATALOG_POS, KEYPAD_TPE et NULL | §2 « émission refusée (CL031) : <état> / <mode> » (16 cas), « émission : aucun code écrit pour les 16 refus » |
| FR-024, TOPUP_DESK permis jusqu'à REFUND_WINDOW ; DRAFT et LIVE permis | §2 « émission permise : … » (12 cas), « les 12 codes permis sont écrits » |
| Auteur hors périmètre : P0002 et non CL031 | §2 « auteur hors périmètre sur un événement CLOSED -> P0002 », « … CLOSING -> P0002 » |
| FR-024, enrôlement refusé sans rien écrire | §3 « enrôlement refusé (CL031) : … » (16 cas), « les 16 refus n'écrivent rien (terminal, code consommé, jeton, historique) », « aucun code refusé consommé » |
| FR-024, enrôlement permis | §3 « enrôlement permis : … » (12 cas), « 12 réussites, chacune un terminal… » |
| TOPUP_DESK Android : REFUND_WINDOW oui, CLOSED non | §3 « TOPUP_DESK sur Android enrôlé en REFUND_WINDOW… », « … refusé en CLOSED, code non consommé » |
| Point de vente « supprimé » (hors de l'événement du code) | §4 « point de vente rattaché à un autre événement que celui du code : CL031 », « code portant le point de vente d'un autre événement : CL031 », code non consommé |
| Verrou FOR SHARE (émission et enrôlement) | §1 cas `prosrc` (ordre : auteur puis état ; code, puis mode, puis état, puis serial) ; §2 et §5 cas `pgrowlocks` |
| Structure : signatures, DEFINER, search_path, PUBLIC, droits de cashless_app gardés | §1 (7 cas) |
| Non-régression de 0022 (CL025, CL026, CL027, CL028, CL001, P0002) | §3 cas d'ordre sur un code CLOSED ; §6 « LIVE : … » (10 cas) |
| ADR-117 : trace du refus EVENT_CLOSED | §7 essai admis, rattaché au prestataire, audit `DEVICE_ENROLLMENT_REFUSED` écrit, contrainte élargie d'une seule valeur (9 valeurs exactement) |
| Suites de la 5a sans modification | `tests_device_enrollment`, `tests_enrollment_refusal`, `tests_enrollment_limits`, `tests_execute_grants`, `tests_definer_search_path` : vertes dans la batterie |

Commandes, sur la base privée `cashless_wp06` du serveur Docker 127.0.0.1:5433 (PostgreSQL 17.11),
supprimée à la fin :
- `bash packages/ledger-sql/scripts/reset-db.sh` : migrations jusqu'à 0035, puis `roles.sql` et
  `post-roles.sql` rejoués.
- `pg_prove -d cashless_wp06 tests/tests_enrollment_event_state.sql` : `1..110 All tests
  successful`.
- Après un nouveau `reset-db`, `bash packages/ledger-sql/scripts/test-pgtap.sh` : `Files=34,
  Tests=2193, Result: PASS`.
- Non lancés : `npm run lint`, `typecheck` et Jest. Aucun fichier TypeScript n'a changé, la lane
  n'a pas de `node_modules`, et la base partagée est réservée à l'orchestrateur. Les tests
  d'intégration de l'enrôlement de la 5a restent donc à rejouer par l'orchestrateur, en série.
