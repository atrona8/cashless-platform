---
work_package_id: WP01
title: 'Contrat : ajouts sous /edge/* et contrôle de stabilité'
dependencies: []
requirement_refs:
- FR-009
- NFR-012
- C-002
- SC-006
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004]
phase: Phase 1 - Contrat et code partagé
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/openapi.yaml
create_intent: [tools/contract-stability/check.mjs, tools/contract-stability/check.test.mjs, tools/contract-stability/contract-baseline.json, tools/contract-stability/check-baseline-decision.mjs]
execution_mode: code_change
model: sonnet
owned_files: [packages/contracts/openapi.yaml, packages/contracts/generated/**, packages/contracts/dart/**, tools/contract-stability/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Contrat, ajouts sous `/edge/*` et contrôle de stabilité

> **Corrections après analyse** : `contracts/interfaces.md` § 13.7 : tu crées `check-baseline-decision.mjs` et le script racine `check:stability` ; la CI et `CODEOWNERS` sont à WP25.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : « Décisions après la passe contradictoire » 7, 11, 12, 18 ;
- `contracts/replication-page-additions.yaml` en entier (la définition UNIQUE des ajouts) ;
- `contracts/contract-stability-check.md` en entier (référence, règles de comparaison, tests T1 à T14) ;
- `contracts/interfaces.md` § 6 (noms et chemins figés) et § 11 ;
- `research.md` R-24 et R-29 ; constats `A02`, `A11`, `A18`, `A23` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code : `packages/contracts/openapi.yaml` lignes 6968-7015 (route `getEdgeReplicationFeed`), 14485 (`EdgeSyncBatch`),
  14690 (`ReplicationPage`) ; `packages/contracts/scripts/generate.mjs`, `check.mjs`, `generate-dart.sh`.

Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` >
SPECIFICATION > `PRD.md`. Contradiction : tu la signales, tu ne choisis pas en silence. En cas de désaccord entre
`tasks.md`, `interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Deux livrables liés. (1) Appliquer à `openapi.yaml` les seuls ajouts facultatifs admis par la mission (décisions 7, 11,
12, 18 du porteur), puis régénérer les types TypeScript et Dart. (2) Écrire l'outil qui prouve, à chaque CI, que le
contrat n'a bougé que par ces ajouts, avec un témoin positif : un contrôle qui ne peut pas échouer ne prouve rien.
Aucune autre route, aucun autre schéma, aucune valeur d'énumération, aucun code d'erreur ne change (C-002, NFR-012).

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP01 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Seul ce lot touche `openapi.yaml` (`tasks.md`, règles communes). Aucune route nouvelle, même sous `/edge/*`.
- **Chemins : `interfaces.md` § 6 fait foi.** L'outil est `tools/contract-stability/check.mjs` (pas
  `packages/contracts/scripts/check-stability.mjs` comme l'écrit `contract-stability-check.md`). La référence épinglée
  est `tools/contract-stability/contract-baseline.json` (le lot ne possède pas `packages/contracts/package.json`).
  **Signale cette contradiction** dans le rapport, avec le script npm `check:stability`, `.github/CODEOWNERS` et l'étape
  de CI : ils n'appartiennent à aucun lot de la carte avant WP25 (CI) ; tu n'y touches pas.
- Sorties : `0` admis, `2` refus, `1` panne (usage, fichier absent, syntaxe, module absent, référence introuvable ou
  falsifiée). Seul `2` prouve un refus.
- Dépendances : aucune nouvelle (C-011). Le module `yaml` 2.9.1 est déjà dans le dépôt ; tests avec `node --test`.
- La phrase de `replication-page-additions.yaml` sur la sémantique de `to_posting_id` (A18) est un COMMENTAIRE YAML. Ne
  modifie PAS la `description` de `ReplicationPage` ni de la route : une description changée est refusée par le contrôle
  (cas T6). La sémantique va dans le code des lots suivants. Signale-le.
- Tu peux lancer `npm run generate -w @cashless/contracts`, `npm run check -w @cashless/contracts` et
  `node --test tools/contract-stability/`. Ni Jest, ni pgTAP, ni reset-db.

## Subtasks

### T001 : Appliquer `replication-page-additions.yaml` à `openapi.yaml`

**But** : fusion exacte, sous forme d'ajouts seuls.

**Étapes**
- Paramètre `after_change_seq` ajouté EN FIN de la liste `parameters` de `GET /edge/replication-feed`
  (`in: query`, `required: false`, `int64`, `minimum: 0`). Les quatre paramètres existants ne bougent pas.
- `ReplicationPage` : ajouter `edge_seq_applied`, `device_seq_acked`, `pwd_pack_key`, `reference` à `properties` ; sur
  `wallets.items.properties` : `kyc_verified`, `topup_month_paid`. Le tableau `required` (de la page et des portefeuilles)
  reste IDENTIQUE, élément par élément.
- `EdgeSyncBatch.properties.staff_token_audit` (`maxItems: 500`, `$ref` vers `EdgeStaffTokenAudit`), absent de `required`.
- Quinze schémas nouveaux : `EdgeReference`, `EdgeGatewaySelf`, `EdgeWalletState`, `EdgeEventSettings`, `EdgeDevice`,
  `EdgeDeviceSeqAcked`, `EdgeDeviceConfig`, `EdgeCashSession`, `EdgeVendor`, `EdgeVendorSession`, `EdgeStaff`,
  `EdgeCatalog`, `EdgeMediaRef`, `EdgeUnassignedMedia`, `EdgeStaffTokenAudit`.
- Vérifie que chaque `$ref` cible existe (`Hex32`, `Amount`, `Timestamp`, `NfcUid`, `Currency`, `DeviceKind`,
  `DeviceAppMode`, `DeviceStatus`, `MediaStatus`, `WrappedKey`, `EncryptedBlob`, `OfflinePolicy`, et le pointeur
  `DeviceConfig/properties/terminal_settings`). Une cible absente : tu ne crées PAS de schéma partagé (il serait refusé) ;
  tu arrêtes et signales.
- Aucune valeur d'énumération ajoutée nulle part (A11) : relis `ShortfallReason` et `OfflineRejectReason`.

**Cas limites** : `EdgeWalletState.status` est une chaîne libre dans l'extrait (pas d'énumération partagée touchée).
`EdgeDevice.token_family` et `EdgeDevice.public_key` ne sont servis que sous `/edge/*` : n'ajoute aucun exemple.

### T002 : Régénérer les types TypeScript et Dart

- `npm run generate -w @cashless/contracts` puis `npm run check -w @cashless/contracts` ; `generated/` et `dart/` sont
  produits, jamais édités. Si la chaîne Dart manque sur le poste, dis-le dans le rapport (ne simule pas).
- Vérifie par `git diff --stat` que seuls des fichiers de `generated/` et `dart/` correspondant aux schémas ajoutés
  changent. Un type existant modifié est un signal d'alarme : cherche pourquoi avant de poursuivre.

### T003 : `tools/contract-stability/check.mjs` et `contract-baseline.json`

**But** : comparaison sémantique du contrat courant à la référence `d2a7c538` (SHA-256 épinglée dans
`contract-stability-check.md`).

**Étapes**
- Récupérer la référence par `git show d2a7c538c81a2a790c1aec6902aaf09283bab58f:packages/contracts/openapi.yaml`, recalculer
  sa SHA-256 et la comparer à `7c93e918f4d1d524278431051c5963e78eade10e7621e0fbe2240a66932d2787`. Écart, commit absent :
  code `1`, jamais « rien à comparer ». Options : `--candidate <fichier>` et `--baseline-file <fichier>` (pour les tests ;
  la SHA-256 de ce fichier est vérifiée aussi).
- Charger les deux documents avec `yaml`, énumérer les différences (pointeur JSON, ajout | retrait | changement), les classer
  `ADMISE` ou `REFUSÉE` selon les cinq conditions de `contract-stability-check.md` (ajout seul ; sous un des trois motifs de
  la liste blanche ; aucun tableau `required` PRÉEXISTANT touché ; aucun `$ref` hors périmètre vers un schéma nouveau ;
  aucun schéma partagé hors `/edge/*` touché, même en ajout).
- **Interprétation à signaler** : la condition 3 vise les tableaux `required` déjà présents dans la référence ; un schéma
  `Edge*` nouveau porte légitimement son propre `required` (sous-arbre entièrement nouveau).
- `contract-baseline.json` : commit, SHA-256, et la liste blanche aux pointeurs EXACTS (racines de sous-arbre ajoutées :
  les vingt-trois pointeurs de T001 : 1 paramètre, 4 propriétés de la page, 2 de portefeuille, 1 de lot, 15 schémas). Un ajout non listé est refusé tant que le plan n'est pas mis à jour.
- Refuser aussi : le décompte des opérations `x-edge-available` doit rester 16, même ensemble (il y a 18 lignes qui
  contiennent le texte, 16 opérations : compte les opérations, pas les lignes) ; toute route ou opération nouvelle ; tout
  changement de `description`, `summary`, `operationId`, exemples, `info`, `servers`, tags, sécurité.
- Sortie : une ligne par différence, le total, le nom de chaque pointeur refusé.
- `check-baseline-decision.mjs` (A23) : échoue si `contract-baseline.json` diffère de celui de `main` sans ligne
  `Décision du porteur : <date> <référence ADR>` dans le dernier commit qui le touche ou dans `docs/DECISIONS_ADR.md`.
  Sortie `0`/`2`/`1` comme l'outil principal. Livre-le ; son branchement en CI est WP25.

### T004 : Tests T1 à T14 et témoin positif

`tools/contract-stability/check.test.mjs` (`node:test`). Chaque cas fabrique un contrat d'essai EN MÉMOIRE ou dans un
dossier temporaire à partir de la référence (jamais le dépôt) et appelle l'outil comme un processus (le code de sortie fait
partie de la preuve). Cas T1 à T14 de `contract-stability-check.md` :

- T1 `operationId` renommé ; T2 `409` retiré de `POST /payments` ; T3 `required` ajouté à `ReplicationPage` ;
  T4 propriété ajoutée à `OfflineSnapshot` ; T5 paramètre obligatoire ajouté ; T6 description de `getEdgeReplicationFeed` ;
  T7 `x-edge-available` retiré ; T8 route `POST /edge/nouvelle` ; T9 valeur retirée de `DeviceStatus` : code `2` et pointeur nommé.
- T10 copie identique : `0`, zéro différence. T11 copie portant les seuls ajouts de l'extrait (fusion programmatique de
  `replication-page-additions.yaml` dans la référence, indépendante de ta propre édition) : `0`, uniquement des `ADMISE` ;
  ET le `openapi.yaml` réel du dépôt : `0`.
- T12 SHA-256 épinglée fausse : code `1`. T13 valeur ajoutée à `ShortfallReason` ou `OfflineRejectReason` : `2`.
  T14 autre propriété que `staff_token_audit` ajoutée à `EdgeSyncBatch`, ou `staff_token_audit` ajoutée à `required` : `2`.
- Ajoute des cas qui visent les trous : ajout d'une propriété à `EdgeDevice` hors de la liste blanche exacte ; `$ref` d'un
  schéma existant (`DeviceConfig`) vers `EdgeDevice` ; nouveau schéma sans préfixe `Edge` ; nouveau schéma `Edge*` atteint
  depuis une route hors `/edge/*` ; commentaire ou ordre de clés changés (doit passer : le contrôle est sémantique) ;
  `x-edge-available` ajouté à une 17e opération.
- Chaque cas de refus doit échouer sur un contrôle faux : vérifie, en commentaire du test, ce qu'un comparateur
  « toujours 0 » ferait (le test échoue).

## Tests attendus

- `tools/contract-stability/check.test.mjs` : T1 à T14 et les cas additionnels ci-dessus ; la mutation est vérifiée avant
  l'appel (le fichier muté diffère de la référence), sinon le test échoue au lieu de passer.
- `npm run check -w @cashless/contracts` vert (types TypeScript et Dart à jour). Aucun test Jest.

## Sécurité

- Le contrat est une surface d'attaque pour les clients : un champ retiré ou rendu obligatoire casse un terminal en
  production. Le contrôle doit refuser dans le doute (liste blanche stricte, pas de liste noire).
- Aucun secret dans le flux (`replication-page-additions.yaml`, « Ce que le flux ne porte jamais ») : relis les
  descriptions que tu copies, aucun champ `pin_hash`, clé maître, PWD en clair, courriel ou téléphone.
- `token_family` expose l'empreinte du jeton de rafraîchissement (décision 11) : écart accepté (OP-N102, ADR-157), à ne
  pas élargir. N'ajoute aucun autre champ sensible « par commodité ».
- Fichier à faire relire par une personne : `contract-baseline.json` et `check.mjs` (ils décident de ce qui passe en CI).
- Règle 1 de `CLAUDE.md` : un écart qui affaiblit la sécurité (liste blanche élargie, code de sortie ambigu) est soumis
  au porteur AVANT d'être codé.

## Definition of Done

- [ ] `openapi.yaml` : seuls les ajouts de T001 ; `required` existants intacts ; aucune valeur d'énumération ajoutée.
- [ ] `generated/` et `dart/` régénérés ; `npm run check -w @cashless/contracts` vert.
- [ ] `check.mjs` : codes `0/2/1`, garde-fou de SHA-256, liste blanche exacte dans `contract-baseline.json`.
- [ ] `check.test.mjs` vert (`node --test`) : T1 à T14 plus les cas additionnels ; T10/T11 réussissent.
- [ ] `check-baseline-decision.mjs` livré et testé sur un cas passant et un cas refusé.
- [ ] Rapport : contradictions (chemins de l'outil, CODEOWNERS, script npm, condition 3, description A18), fichiers à
      relire, `$ref` manquants éventuels, commandes lancées.
- [ ] Aucun `.sql` généré touché ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Ajouter une propriété facultative à `DeviceConfig` ou `OfflineSnapshot` : refus attendu (schéma partagé).
2. Renommer un `operationId`, retirer un code de réponse, ajouter `required` à un schéma préexistant : refus `2`.
3. Ajouter une valeur à `ShortfallReason` ou `OfflineRejectReason` : refus `2`.
4. Remplacer le fichier de référence ou fausser la SHA-256 épinglée : code `1`, jamais `0`.
5. Passer un chemin de candidat inexistant ou un YAML invalide : code `1`, pas `0` ni `2`.
6. Ajouter un `Edge*` nouveau référencé depuis une route de terminal : refus.
7. Changer seulement l'ordre des clés ou un commentaire : le contrôle ne refuse pas à tort.
8. Vérifier que `EdgeSyncBatch.required` et `ReplicationPage.required` sont identiques à la référence.
