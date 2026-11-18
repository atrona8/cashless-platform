---
work_package_id: WP14
title: Preuves, consignation et documentation
dependencies: [WP01, WP02, WP03, WP04, WP05, WP06, WP07, WP08, WP09, WP10, WP11, WP12, WP13]
requirement_refs: [FR-021, NFR-004, SC-001, SC-004, SC-005, C-003]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T053, T054, T055, T056]
phase: Phase 3 - Preuves
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: docs/POINTS_OUVERTS.md
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- docs/POINTS_OUVERTS.md
- docs/DECISIONS_ADR.md
- PROMPTS-A-ENVOYER.md
- PRD.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 : Preuves, consignation et documentation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- `kitty-specs/durcissements-serveur-01M7QAJD/spec.md` (FR-021, NFR-003 à NFR-005, SC-001 à SC-005, C-003, section des
  décisions du porteur du 18/11/2026) ; `plan.md` (« Décisions différées », tableau « Écarts de sécurité »,
  « Amendements de la spec », IC-10) ; `interfaces.md` (version fusionnée, **signatures réelles**) ;
- les **notes de lane de WP01 à WP13** (`status.events.jsonl` de la mission ou notes des `move-task`) : les fiches sont
  rédigées à partir de ce qui a été réellement fait (noms, signatures, mutations et leurs résultats, retouches hors
  carte, limites signalées par chaque lot), pas à partir des prompts ;
- les quatre recherches `research/R-*.md` (seulement les sections « Points à signaler » et « Risques ») ;
- `docs/POINTS_OUVERTS.md` : vue d'ensemble l. 12-134 (colonnes : bloque la production / lève avant la production),
  fiches OP-N60 (l. 556), OP-N64 (l. 675), OP-N76 (l. 1704), OP-N79 (l. 972), OP-N116 (l. 228), OP-N137, OP-N140,
  OP-N141,
  OP-N145 (l. 2031-2134) et modèle de levée : fiche OP-N147 (« LEVÉ le 17/11/2026 », l. 2110) et section 10 (l. 1968) ;
- `docs/DECISIONS_ADR.md` : ADR-97, 106, 121, 127 et 201 à 205 (ce qu'elles disent des limites) ; modèle de forme : les
  ADR-214 et ADR-215 (fin du fichier : statut, décision, risque, tests, suite, fichiers à faire relire) ;
- `PROMPTS-A-ENVOYER.md` : section « Mission 11a » (l. 530-580), « Mission 12 » (l. 596) et « Mission 12b » (l. 638) ;
  `PRD.md` : paragraphes qui citent la 11a (l. 324-340, 405-435).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Consigner la mission : chaque point levé passe « levé » avec son test de levée et son test de borne inversé ; OP-N64
passe « côté serveur prêt » ; chaque limite résiduelle nommée a son entrée, son ADR et son test ; les missions 12 et 12b
héritent de ce qui les concerne ; le porteur reçoit la liste des fichiers à faire relire par une personne. Aucun fichier
de code n'est touché. **Règle 3 de `CLAUDE.md`** : un écart accepté sans entrée dans `POINTS_OUVERTS.md`, sans ADR et
sans
report est un constat bloquant de la revue post-fusion.

## Context

- Lot de la phase 3 : toutes ses dépendances sont fusionnées avant son démarrage. Lis le code fusionné quand une fiche
  cite une fonction, un fichier ou un test : **chaque nom cité doit exister** (`grep` avant d'écrire).
- Écarts acceptés par le porteur le 18/11/2026 (à consigner, jamais en silence) : (1) clé de chiffrement de l'IBAN lue
  en configuration de l'API ; (2) `refund_deposit(uuid, uuid)` gardée interne, exécutable par personne, écart à FR-012 ;
  (3) un seul `EXECUTE` nouveau pour `cashless_app` hors OP-N60 : `advance_app_attest_counter`.
- Amendements de la spec faits au plan : NFR-003 (les `EXECUTE` ajoutés sont des fonctions `DEFINER` listées et
  figées), FR-016 (`409 APPROVAL_INVALID`, pas `403`), FR-010 (trois emplacements de l'IBAN), FR-012 (FR-012 gardée).
- **`docs/SPECIFICATION.md` : retiré des fichiers du lot.** Aucune contradiction trouvée : `SPECIFICATION.md` l. 522
  décrit déjà `CL023` comme `APPROVAL_INVALID`. Si en lisant le code fusionné tu trouves un amendement nécessaire,
  **ne le fais pas** : signale-le à l'orchestrateur, qui ajoutera le fichier aux tiens.
- **Matrice d'acceptation** `kitty-specs/durcissements-serveur-01M7QAJD/acceptance-matrix.json` : tenue par
  l'**orchestrateur**, pas par ce lot. Ne la crée pas et ne la modifie pas ; cite-la dans les fiches comme source des
  preuves (commande et résultat par FR, NFR, SC).
- **Fichiers à ne pas toucher** : la migration, le code, les tests, `kitty-specs/**` (sauf rien), `docs/passation-*`.
  `docs/06-docs-status.md` et les docs transverses relèvent du skill `spec-kitty-docs-maintain` (jalon post-review),
  pas de ce lot.

## Subtasks

### T053 : `POINTS_OUVERTS.md` : huit levées, OP-N64 « côté serveur prêt », limites résiduelles

- **But** : FR-021, SC-004. Suivre exactement le modèle d'OP-N147 (ligne du tableau en « **LEVÉ le 18/11/2026 par la
  mission 11a** », fiche de la section 2 mise à jour, ligne de la section 6 ou 7 si elles existent pour ce point).
- **Étapes** :
  1. Lignes du tableau de la section 2, une par point, **LEVÉ** avec la mission et l'ADR : OP-N60 (lots et statut des
     bracelets par fonctions), OP-N76 (processus `vendor-pin`), OP-N79 (clé composite), OP-N116 (grand livre rendu),
     OP-N137 (a à d), OP-N140 (masque et chiffrement au repos), OP-N141 (plafond), OP-N145 (garde d'insertion, ancienne
     signature retirée). Colonnes « bloque la production » passées à **Non** pour OP-N60 (ADR-97 le disait bloquant).
  2. Fiche de chaque point (section détaillée) : ajouter « **LEVÉ le 18/11/2026 (mission 11a)** » avec : le mécanisme
     réel (noms des fonctions, des migrations `0090` à `0095`, des tests), **le test de levée** (chemin et ce qu'il
     refuse) et **le test de borne inversé** (l'ancien test qui acceptait la limite et ce qu'il exige maintenant :
     `limits-9b.spec.ts`, `blacklist.spec.ts`, `tests_payment_rights.sql`, `vendor-sessions.spec.ts`, etc.), puis la
     **mutation vérifiée** de la note de lane (retrait du contrôle, test qui échoue). Ne pas supprimer l'historique des
     fiches : elles restent lisibles.
  3. **OP-N64 : « côté serveur prêt, non levé »** : clé et keyId gardés à l'enrôlement, vérificateur d'assertions
     interne non branché, borne iOS gardée (`/media/auth-keys` refuse toujours iOS, tests `device-auth-matrix.spec.ts`
     et
     `media-port-swap.spec.ts` inchangés). Reste pour la mission 12 : envoyer les assertions (tout en gardant la borne
     jusqu'à ce que l'app le fasse), puis retirer la borne iOS. **Limite à écrire en toutes lettres** : vecteur réel
     d'Apple exigé avant la mission 12 (double hachage ECDSA invisible avec des vecteurs auto-générés, R1).
  4. **Nouveaux points ouverts** (numéros : le suivant du dernier OP du fichier, `grep` de `OP-N1[5-9]`), chacun avec
     constat, risque, test de borne, mission qui le lève, condition de levée, fichier à faire relire, « bloque la
     production » (oui/non) :
     - **clé de l'IBAN dans le processus public** : la clé d'anneau (`IBAN_KEYRING`) est lue par l'API, donc par le
       processus qui exporte le CSV ; gain : base, sauvegardes, réplicas, autres rôles, injection SQL en lecture ;
       limite : une API compromise lit la clé. Levée : vrai KMS (OP-N41, **mission 12b**) ; test de borne : production
       refusée sans anneau, `CHECK` d'IBAN chiffré, aucun clair en base ;
     - **PIN en transit** : l'API voit le PIN avant de l'envoyer au processus `vendor-pin` ; une API compromise peut
       tester des PIN, au rythme du décompte d'essais existant (même limite qu'avant, désormais **nommée**) ; levée :
       preuve du PIN que l'API ne peut pas voir (app, mission 12) ;
     - **compteur App Attest : déni de service** : `cashless_app` peut faire avancer le compteur d'un appareil et
       bloquer
       ses assertions, sans gagner d'accès ; levée : aucune demandée (risque accepté) ou signature de l'avance (mission
       12) ;
       test de borne : la liste figée des `EXECUTE` (`tests_execute_grants.sql`) contient cette fonction et rien
       d'autre ;
     - **`refund_deposit(uuid, uuid)` gardée** : fonction interne appelée par `refund_deposit_from_balance`, le
       générateur `gen_tests.py` et le schéma de référence ; exécutable par aucun rôle applicatif (test pgTAP) ; levée :
       retrait avec le prochain remaniement du générateur et du schéma (qui ne se modifient pas ici, C-004).
  5. Section 10 modèle : ajouter une **section 11** « Mission 11a (durcissements serveur hérités) : consignation du
     18/11/2026 » : source (notes de lane de WP01 à WP13, décisions du porteur du 18/11/2026), liste des lots avec
     migrations et tests, retouches hors carte relevées, instabilités connues rencontrées.
  6. Le tableau « points tranchés » (section 5) reçoit les trois décisions du porteur du 18/11/2026 avec leur ADR.
- **Validation** : `grep -c "LEVÉ le 18/11/2026" docs/POINTS_OUVERTS.md` : 8 points levés ; chaque nom de fichier ou de
  test cité existe (`ls`/`grep`) ; aucun `OP-N` cité qui n'existe pas.
- **Piège** : ne pas écrire « levé » pour OP-N64 ; ne pas mélanger « bloque la production » (le point) et « avant la
  production » (la date de levée).

### T054 : `DECISIONS_ADR.md` : ADR de levée et de renforcement

- **But** : un ADR par groupe de décisions, dans le format des ADR-214 et 215 (Statut, Décision, Risque, Tests, Suite,
  Fichiers à faire relire). **Numéros** : ADR-215 existe, la suite commence à **ADR-216** (`grep "^## ADR-2"` avant, le
  dernier est peut-être plus haut si une autre branche a fusionné : prends le suivant du dernier réel).
- **Contenu proposé** (regrouper si deux sujets tiennent en un) :
  1. Lots et statut des bracelets par fonctions, clé vendeur-session (OP-N60, OP-N79 ; suite d'ADR-97 et 127) :
     fonctions `create_media_batch`, `update_media_batch`, passage en `DEFINER` de trois fonctions à corps identique,
     `media_set_status` limité à `SUSPENDED` et `BLACKLISTED` (**renforcement fait puis consigné**), `UPDATE` de `media`
     réduit à deux colonnes, `EXECUTE` ajoutés **listés** (NFR-003 amendé), historique de création avec auteur.
  2. Processus `vendor-pin` (OP-N76 ; suite d'ADR-121) : rôle `cashless_pin`, appel interne authentifié par HMAC sans
     repli, `VENDOR_PIN_SECRET` lu par ce seul processus, dérivé d'idempotence resté dans l'API ; **limite résiduelle :
     le
     PIN en transit** (risque, raison, mission qui le lève, condition de levée).
  3. IBAN (OP-N140 ; suite d'ADR-203) : masque par champ et par forme ; coffre AES-256-GCM `enc:v1:<kid>:…`, anneau en
     configuration de l'API, `CHECK … NOT VALID`, `iban_mask` ; **écart accepté par le porteur le 18/11/2026** : la clé
     est dans le processus public (risque, raison : aucun port KMS dans ce processus et seul un faux existe, mission
     12b, condition : vrai KMS) ; options écartées (KMS, masque seul).
  4. Remboursements (OP-N145 ; suite d'ADR-201) : `INSERT` par colonne, déclencheur d'insertion `CL057`,
     `refund_deposit_for_session(uuid, uuid)` retirée ; **écart à FR-012 accepté** : `refund_deposit(uuid, uuid)`
     gardée,
     exécutable par personne (test).
  5. Versements et frais (OP-N137, OP-N141 ; suite d'ADR-204 et 205) : `guardDecision`, refus par classe, audit
     `PAYOUT_CONFIRM_REPLAYED`, auto-approbation exactement `409 APPROVAL_INVALID` (**amendement de FR-016**), plafond
     de la régularisation.
  6. Inscription des passerelles (OP-N116) : retour `(gateway_id, ledger_id)`, `CL058`, `--ledger` refusé.
  7. App Attest côté serveur (OP-N64 ; **mise à jour datée d'ADR-106**, pas un remplacement) : table
     `device_app_attest_key`, clé gardée à l'enrôlement, vérificateur non branché, **un seul `EXECUTE` nouveau accepté**
     (`advance_app_attest_counter`), risque de déni de service, vecteur réel d'Apple exigé avant la mission 12.
  8. Décisions du porteur du 18/11/2026 et amendements de la spec (NFR-003, FR-010, FR-012, FR-016) : une ADR courte qui
     renvoie aux autres.
- **Chaque ADR d'écart** porte : risque, raison, mission qui le lève, condition de levée, **test qui échoue si la limite
  s'élargit** (chemin du test, vérifié par `ls`), report (`PROMPTS-A-ENVOYER.md`, `PRD.md`).
- Ajouter une ligne « Mise à jour du 18/11/2026 (mission 11a) » en tête d'ADR-97, 106, 121, 127, 201, 203, 204, 205 qui
  renvoie à l'ADR de levée (le texte historique reste).
- **Fichiers à faire relire par une personne** : à la fin de chaque ADR concernée (voir T056).

### T055 : `PROMPTS-A-ENVOYER.md` et `PRD.md` : reports

- **`PROMPTS-A-ENVOYER.md`** :
  - section « Mission 11a » : cocher/mettre à jour l'état et ajouter une ligne qui renvoie à la mission
    `durcissements-serveur-01M7QAJD` (les commandes réelles y sont déjà) ;
  - **Mission 12** (App terminal) : ajouter un encadré « Hérité de la 11a (OP-N64) » : le serveur garde la clé et sait
    vérifier une assertion (`IosAppAttestAssertionVerifier`, signature réelle de la note de WP13), **la borne iOS reste
    en place** ; la mission 12 doit **envoyer les assertions App Attest** (choix des champs de la requête liée par
    `clientDataHash`, ajout de ce transport au contrat `openapi.yaml` soumis au porteur avant, puis inscrit dans
    `contract-baseline.json`, ADR-215), brancher le vérificateur sur les routes, **retirer la borne iOS** de
    `/media/auth-keys`, et fournir un **vecteur d'assertion réel d'Apple** avant de se fier au vérificateur ; test : un
    terminal iOS sans assertion valide est refusé, avec assertion valide et compteur croissant accepté ;
  - **Mission 12b** : encadré « Hérité de la 11a (OP-N140) » : **vrai KMS pour la clé de l'IBAN** (retirer
    `IBAN_KEYRING`
    de la configuration de l'API, rouvrir par un port du service de clés, ce qui impose de lever la règle d'architecture
    du processus public ou de déplacer l'export : décision du porteur sur le contrat) ; et, avec OP-N56, preuve
    infalsifiable du PIN (OP-N76 résiduel) si la mission 12 la fournit ;
  - **Mission 13** : une ligne si un balayage manque (relevé des lots, droits de `cashless_pin`) ; sinon rien ;
  - ne pas toucher aux autres missions.
- **`PRD.md`** : mettre à jour les paragraphes qui annoncent la 11a (« spécifiée le 18/11/2026 ») : points levés,
  OP-N64 « côté serveur prêt », nouvelles limites nommées (clé de l'IBAN, PIN en transit, compteur, `refund_deposit`
  gardée), reports vers 12 et 12b ; périmètre fonctionnel : le processus `vendor-pin` (processus et rôle de plus), les
  fonctions de lot, le chiffrement de l'IBAN ; flux critiques : ouverture de session de vendeur par le processus, export
  du lot de virements avec ouverture de l'IBAN. Le PRD reste la source de vérité du besoin, pas un instantané.
- **Validation** : `grep -n "OP-N64" PRD.md PROMPTS-A-ENVOYER.md` montre le report ; chaque OP nouveau de T053 est cité
  dans les deux fichiers ; les listes d'« hérités » de la 12, 12b et 13 ne mentionnent plus de point levé comme à faire.

### T056 : preuves et liste des fichiers à faire relire

- **Matrice** : l'orchestrateur tient `acceptance-matrix.json`. Dans la note de lane et dans la section 11 de
  `POINTS_OUVERTS.md`, renvoie à elle pour les preuves par FR, NFR et SC ; vérifie que chaque FR de `spec.md` apparaît
  quelque part dans tes fiches (levée ou renvoi). Si la matrice manque une ligne, **signale-la**, ne la crée pas.
- **Liste des fichiers à faire relire par une personne** (règle 4 de `CLAUDE.md` : l'agent qui a écrit le code ne vaut
  pas relecture indépendante) : la mettre dans la section 11 de `POINTS_OUVERTS.md` et dans l'ADR concernée, avec au
  minimum : `errors/redact.ts` ; `common/iban-vault.ts` et la configuration de l'anneau ; les migrations `0090` à
  `0095` ; `post-roles.sql` section 13 et `roles.sql` (rôle `cashless_pin`) ; `main.vendor-pin.ts` et la signature
  HMAC de l'appel interne ; `attestation/ios-app-attest-assertion.ts` et la fonction SQL `advance_app_attest_counter`
  (cryptographie : la relecture humaine est la seule garantie avant un vecteur d'Apple) ;
  `refund_request_insert_guard()` ;
  les fonctions de lot `DEFINER`. Complète d'après les notes de lane (chaque lot signale les siens).
- **Vérifications avant de rendre la main** : (1) `grep` : tout OP cité existe, tout ADR cité existe, tout chemin de
  test
  cité existe ; (2) `git diff --stat` : seuls les quatre fichiers du lot changent ; (3) lignes de 120 caractères au plus
  dans les fichiers de prose où la convention est suivie (ne pas reformater l'existant) ; (4) aucun faux ajouté, aucune
  limite oubliée par rapport aux notes de lane (relis-les une dernière fois et coche chaque écart signalé).

## Branch Strategy

Planification et fusion sur `feat/durcissements-serveur`. Le worktree de lane est calculé par `lanes.json`
(`.worktrees/durcissements-serveur-01M7QAJD-lane-x`) ; travaille uniquement dedans. Implémentation :

```
LC_ALL=C LANG=C spec-kitty agent action implement WP14 --agent claude --mission durcissements-serveur-01M7QAJD
```

Aucun test à lancer (documentation) ; pas de base requise. Les fichiers `PROMPTS-A-ENVOYER.md` et `PRD.md` sont à la
racine du dépôt, `execution_mode: code_change` sert à les faire passer par la lane.

## Definition of Done

- [ ] Les huit points (OP-N60, N76, N79, N116, N137, N140, N141, N145) sont « LEVÉ le 18/11/2026 », avec test de levée,
      test de borne inversé et mutation tirés des notes de lane.
- [ ] OP-N64 est « côté serveur prêt », non levé, avec la limite du vecteur réel d'Apple et le report à la mission 12.
- [ ] Quatre limites nommées ont chacune une entrée, un ADR, un test de borne cité et un report : clé de l'IBAN dans le
      processus public, PIN en transit, compteur App Attest (déni de service), `refund_deposit(uuid, uuid)` gardée.
- [ ] ADR numérotées à la suite de la dernière, chacune avec risque, raison, mission qui lève, condition de levée, test.
- [ ] Les trois décisions du porteur du 18/11/2026 et les quatre amendements de la spec sont consignés.
- [ ] `PROMPTS-A-ENVOYER.md` : missions 12 (assertions envoyées, borne retirée, vecteur réel) et 12b (vrai KMS de
      l'IBAN).
- [ ] `PRD.md` à jour (périmètre, flux critiques, limites, reports).
- [ ] Liste des fichiers à faire relire par une personne présente et complète d'après les notes de lane.
- [ ] Seuls les quatre fichiers du lot modifiés ; `docs/SPECIFICATION.md` non touché, `acceptance-matrix.json` non
      touché.

## Risks

- Écrire une fiche d'après un prompt et non d'après le code fusionné : un nom faux est un constat. Tout se vérifie par
  `grep`.
- Passer un point à « levé » sans test de borne inversé : la levée n'est pas prouvée (NFR-004).
- Oublier une limite signalée dans une note de lane (retouche hors carte, instabilité, écart) : constat bloquant (règle
  3).
- Collision de numéros d'ADR ou d'OP si une autre branche a fusionné : relire le fichier au moment d'écrire.

## Ce que le relecteur doit casser

1. Prendre chaque note de lane de WP01 à WP13 et chercher son écart ou sa limite dans `POINTS_OUVERTS.md` et les ADR :
   toute limite absente est bloquante.
2. Pour chaque « LEVÉ », ouvrir le test de levée cité et vérifier qu'il existe, qu'il échoue sans le contrôle (mutation
   de la note) et que la limite ancienne n'est plus acceptée par un test de borne.
3. Chercher l'écart de sécurité non soumis : droit plus large, secret plus exposé, faux plus long (clé de l'IBAN,
   compteur,
   `refund_deposit`) sans l'accord du 18/11/2026 cité.
4. Vérifier que OP-N64 n'est pas déclaré levé et que la mission 12 hérite bien des assertions et du retrait de la borne.
5. Contrôler les numéros (ADR, OP), les renvois croisés, les noms de fonctions et de fichiers (`grep`).
6. Chercher les fichiers sensibles qui manquent à la liste de relecture humaine (clés, droits de la base,
   cryptographie).
7. Écart non signalé : fichier hors des quatre modifié, matrice créée par le lot, `SPECIFICATION.md` touché.
