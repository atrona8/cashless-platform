---
work_package_id: WP11
title: Preuves, consignation et documentation
dependencies: [WP01, WP02, WP03, WP04, WP05, WP06, WP07, WP08, WP09, WP10]
requirement_refs:
- C-002
- C-004
- C-005
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
subtasks: [T046, T047, T048]
phase: Phase 3 - Consignation
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: docs/POINTS_OUVERTS.md
create_intent:
- docs/passation-10a/preuves.md
execution_mode: code_change
model: sonnet
owned_files:
- docs/POINTS_OUVERTS.md
- docs/DECISIONS_ADR.md
- PROMPTS-A-ENVOYER.md
- PRD.md
- docs/passation-10a/preuves.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 : Preuves, consignation et documentation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/serveur-app-festivalier-01M7WB69/spec.md` (FR-001 à FR-013, NFR-001 à NFR-005, SC-001
  à SC-005, C-001 à C-007), `plan.md` (« Décisions du porteur », « Écarts de sécurité », «
  Contradiction signalée », IC-07) et `interfaces.md` (**version fusionnée**, signatures réelles) ;
- les **notes de lane de WP01 à WP10** (`status.events.jsonl` de la mission ou notes des
  `move-task`) : les fiches se rédigent d'après ce qui a été fait (noms, signatures, mutations et
  résultats, retouches hors carte, écarts, limites), pas d'après les prompts. Chaque lot a signalé
  des écarts : ils sont tous à consigner (règle 3) ;
- `docs/POINTS_OUVERTS.md` : vue d'ensemble l. 12-141 (colonnes « bloque le code » et « bloque la
  production »), lignes **OP-N43** (l. 24), **OP-N47** (l. 28), fiches OP-N43 (l. 210) et OP-N47
  (l. 214), OP-N120 (l. 1717-1745), section 5 « Points tranchés » (l. 1881), section 11 (l. 2343,
  **modèle de forme** : lots, tests de borne, limites, fichiers à faire relire) ; derniers numéros :
  **OP-N162** (l. 141) ;
- `docs/DECISIONS_ADR.md` : ADR-87 (l. 1010), ADR-104 (index l. 116), ADR-180 (envoi des codes,
  OP-N120) ; modèle de forme : ADR-216 (l. 3171) et ADR-223 à ADR-224 (l. 3387-3440) ; dernier
  numéro : **ADR-224** ;
- `PROMPTS-A-ENVOYER.md` : « Mission 10a » (l. 438-501), « Mission 10c » (l. 503), « Mission 10b »
  (l. 522), « Mission 11 » (l. 606), « Mission 12 » (l. 627), « Mission 12b » (l. 684), « Mission 13
  » (l. 751) ; `PRD.md` l. 140-152 (10a, dont la rotation OP-N47) et l. 464-475 ;
- `docs/passation-11a/preuves-nfr.md` et le `acceptance-matrix.json` de la 11a (forme d'un tableau
  de preuves) ; `docs/POINTS_OUVERTS.md` OP-N161 et ADR-216 (« Tests » : levée, borne inversée,
  mutations).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Consigner la mission : OP-N47 passe « levé » avec son test de levée et son test de borne inversé ;
chaque limite nommée (règle de l'agent titulaire C-005, contradiction §6.3, et celles des notes de
lane) a son point ouvert, son ADR, son test de borne cité et son report ; les missions 10b, 11, 12b
et 13 héritent de ce qui les concerne ; la liste des fichiers à faire relire par une personne est
donnée au porteur ; le tableau de preuves est écrit. **Aucun fichier de code n'est touché.** Règle 3
de `CLAUDE.md` : un écart accepté sans point ouvert, sans ADR et sans report est un constat bloquant
de la revue post-fusion.

## Context

- Lot de la phase 3 : toutes ses dépendances sont fusionnées. **Chaque nom cité doit exister** :
  `grep` avant d'écrire (fonction, migration, test, variable, libellé de refus).
- **Décisions du porteur (20/11/2026)** à consigner : périmètre ; agent titulaire par égalité du
  numéro vérifié et de `app_user.phone` (limite C-005) ; rotation immédiate sans double empreinte,
  version du secret sur chaque empreinte ; réémission par commande d'exploitation sous le rôle
  `cashless_claimadmin` ; code OTP en mémoire seulement ; `printed_number` en 3e colonne facultative
  (ajout au contrat). Aucun écart qui affaiblit la sécurité n'était prévu au plan : **tout écart de
  ce type remonté par une note de lane doit porter la décision du porteur** (sinon constat bloquant
  : signale-le à l'orchestrateur au lieu de le consigner comme accepté).
- **Points déjà tranchés par l'orchestrateur (`interfaces.md`), à consigner d'après les notes** :
  (a) contradiction SPECIFICATION §6.3 point 5 / contrat (deux personnes) ; (b) code OTP gardé 35 s
  au plus (effacé à la confirmation ou au dernier envoi), délais bornés ; (c) `id_last4` admis dans
  l'audit (`KYC_VERIFIED`, `APPROVAL_EXECUTED`), jamais dans les journaux applicatifs ; (d) deux
  valeurs ajoutées à l'énumération des motifs de ligne (ADR-225) ; (e) `claim_key_version_max` et
  `reissuable_media` : droits et fonctions confirmés ; (f) fichier de réémission en clair, fichier
  orphelin (WP08) ; (g) personnalisation : aucune empreinte écrite, rien à consigner. D'autres
  limites peuvent venir des notes : toutes à consigner.
- **`docs/SPECIFICATION.md` : retiré des fichiers du lot.** Si §6.3 demande un amendement, **ne le
  fais pas** : signale-le à l'orchestrateur, qui ajoutera le fichier aux tiens.
- **Matrice d'acceptation** (`kitty-specs/serveur-app-festivalier-01M7WB69/acceptance-matrix.json`)
  : tenue par l'**orchestrateur** ; ne la crée pas, ne la modifie pas, cite-la.
  `docs/06-docs-status.md` et les docs transverses relèvent du skill `spec-kitty-docs-maintain` :
  pas de ce lot.
- **Coordination** : WP09 inscrit une « Décision du porteur : 20/11/2026 ADR-225 » dans son commit
  (contrat de `contract-baseline.json`). **ADR-225 est donc réservée** au sujet « contrat : colonne
  `printed_number` et deux motifs de ligne » ; vérifie que cette ligne existe dans l'historique et
  que le numéro correspond.

## Subtasks

### T046 : `POINTS_OUVERTS.md` : OP-N47 levé, limites nommées, section 12

Modèle : OP-N156 (« LEVÉ le 19/11/2026 »), OP-N147, section 11.

1. **OP-N47 « LEVÉ le 20/11/2026 par la mission 10a »** : ligne du tableau (l. 28 : colonnes «
   bloque » inchangées à `Non`, « qui décide » remplacé par « Levé ») et fiche (l. 214) : mécanisme
   réel (version du secret `CLAIM_CODE_HMAC_KEY_VERSION`, colonnes de version, fonctions
   versionnées, `reissue_claim_codes`, rôle `cashless_claimadmin`, commande `reissue-claim-codes`,
   procédure `docs/procedure-rotation-codes-rattachement.md`) ; **test de levée**
   (`media/claim-rotation.spec.ts`, `cli/reissue-claim-codes.spec.ts`,
   `tests_claim_key_version.sql`) et **test de borne inversé** : l'ancienne condition de levée
   disait « double empreinte pendant une période » ; la décision du 20/11/2026 l'écarte (rotation
   immédiate) : écris-le en toutes lettres ; **mutations** des notes de lane. Ne supprime pas
   l'historique de la fiche.
2. **OP-N43** (l. 24 et fiche l. 210) : « Reste : KYC au guichet, OP-N47 » devient « KYC et OP-N47
   levés par la 10a ; reste l'envoi réel du code (OP-N120, 12b) ». **OP-N120** (l. 1717) : libellés
   de refus (trois, au lieu de « l'envoi des codes à usage unique »), tests de borne
   (`otp-chain.spec.ts`, `production-refusals.spec.ts`), condition de levée (les trois fournisseurs
   réels branchés ; `X-Test-Otp-Code` retiré).
3. **Nouveaux points** (numéros : le suivant du dernier réel,
   `grep -n "OP-N16" docs/POINTS_OUVERTS.md` ; probablement OP-N163 et suivants), chacun avec
   constat, risque, test de borne, mission qui le lève, condition de levée, fichier à faire relire,
   « bloque la production » (oui ou non, avec la raison) :
   - **C-005 : agent titulaire non détecté** (agent sans téléphone ou avec un autre numéro) : limite
     de la décision du porteur ; test de borne `tests_kyc_functions.sql` (« l'agent sans numéro
     passe », échoue si la règle s'élargit ou se resserre) ; mission qui lève : à décider par le
     porteur (lien agent ↔ compte, écarté au specify) ;
   - **contradiction §6.3 point 5** contre le contrat (deux personnes), contrat prioritaire (§0.3) :
     question au porteur, amendement de `SPECIFICATION.md` à demander à l'orchestrateur ;
   - les limites de la liste (b) à (f) du « Context » **confirmées par les notes**, une entrée par
     limite (regroupe celles qui ont la même cause et la même levée) ; celles qui sont des écarts
     qui affaiblissent la sécurité sans accord du porteur : **ne pas les consigner comme
     acceptées**, les remonter.
4. **Section 12** « Mission 10a (serveur de l'app festivalier) : consignation du 20/11/2026 » sur le
   modèle de la section 11 : source (notes de lane de WP01 à WP10, décisions du porteur du
   20/11/2026), lots avec migrations (`0096` à `0099`) et tests principaux, FR/NFR/SC couverts
   (renvoi à la matrice et à `docs/passation-10a/preuves.md`), tests de borne, retouches hors carte
   relevées, instabilités rencontrées, **fichiers à faire relire par une personne** (T048). Section
   5 : les décisions du 20/11/2026 avec leur ADR.

Validation : `grep -c "LEVÉ le 20/11/2026" docs/POINTS_OUVERTS.md` ≥ 1 ; chaque `OP-N` cité existe ;
chaque fichier, test et fonction cités existe (`ls`, `grep`).

Piège : ne pas mêler « bloque la production » (le point) et « avant la production » (la date de
levée).

### T047 : `DECISIONS_ADR.md` et reports (`PROMPTS-A-ENVOYER.md`, `PRD.md`)

1. **ADR** (numéros à partir de **ADR-225**, `grep -n "^## ADR-2" docs/DECISIONS_ADR.md` d'abord) au
   format d'ADR-216 (Statut, Contexte, Décision, Risque, Tests, Suite, Report, Fichiers à faire
   relire) :
   - ADR-225 : contrat (description du corps `text/csv`, deux valeurs d'énumération, entrées de
     `contract-baseline.json`, « Décision du porteur : 20/11/2026 ADR-225 ») ;
   - identification au guichet (fonctions `DEFINER`, règles §6.3, agent titulaire et sa limite
     C-005, révocation à deux, contradiction §6.3, renforcements : pièce expirée refusée à la
     saisie) ;
   - rotation du secret des codes (OP-N47 levé ; version par empreinte ; rôle `cashless_claimadmin`
     et ses droits ; commande ; **renforcement** : réémission hors de portée de `cashless_app`) ;
   - chaîne d'envoi (mémoire du processus, plafond de 35 s, `deliveryRef`, faux et libellés de
     refus, `X-Test-Otp-Code` conservé, mise à jour d'ADR-180) ;
   - `/me` (numéro imprimé, avis de solde provisoire par terminal et grand livre : approximation
     assumée, `wallet_pending_offline_notice`) ;
   - décisions du porteur du 20/11/2026 (courte, renvoie aux autres).
   Chaque ADR d'écart porte : risque, raison, mission qui le lève, condition de levée, **test qui
   échoue si la limite s'élargit** (chemin vérifié par `ls`), report. Ligne « Mise à jour du
   20/11/2026 (mission 10a) » en tête d'ADR-87, d'ADR-104 (index l. 116 : « Proposée » devient la
   mission de levée effective) et d'ADR-180.
2. **`PROMPTS-A-ENVOYER.md`** : « Mission 10a » : cases cochées selon l'état réel (specify, plan,
   tasks…), renvoi à `serveur-app-festivalier-01M7WB69` ; encadrés « Hérité de la 10a » pour **10b**
   (routes servies : KYC, `/me` complet, chaîne d'envoi avec faux, `X-Test-Otp-Code` encore là),
   **11** (écran d'identification et de révocation à deux personnes, règle de l'agent titulaire à
   expliquer à l'agent), **12b** (trois fournisseurs réels derrière `OtpProvider` : accusés de
   livraison, `deliveryRef`, lien du titulaire, retrait de `X-Test-Otp-Code`, libellés de
   `bootstrap.ts` et `COVERAGE` ; limites propres à la 12b parmi celles de T046) et **13** (recette
   : exécuter `docs/procedure-rotation-codes-rattachement.md` sur un lot réel ; passe réelle des
   délais 10 s et 20 s). Pas de point levé laissé comme « à faire ».
3. **`PRD.md`** : l. 140-152 et 464-475 : statut réel (« livrée »), OP-N47 **levé** (retire « double
   empreinte »), nouvelles limites nommées, reports ; périmètre fonctionnel (rôle
   `cashless_claimadmin`, commande d'exploitation, fournisseurs d'envoi) ; flux critiques
   (identification, révocation à deux, rotation et réémission, bascule des canaux). Le PRD reste la
   source de vérité du besoin, pas un instantané.

Validation : `grep -n "OP-N47" PRD.md PROMPTS-A-ENVOYER.md docs/POINTS_OUVERTS.md` ne montre plus de
« à faire » ; chaque OP et chaque ADR nouveaux sont cités dans les deux fichiers de report.

### T048 : preuves et liste des fichiers à faire relire

1. **`docs/passation-10a/preuves.md`** (créé) : un tableau par groupe (FR, NFR, SC, puis C-002 à
   C-007 s'il y a un test) : identifiant, lot, **test** (chemin vérifié), **commande exacte**,
   **résultat** (nombre d'assertions ou de cas, commit), **mutation** (contrôle retiré, test qui
   échoue), renvoi à la matrice. Source : notes de lane et batterie finale de l'orchestrateur ;
   **n'invente aucun résultat** : une preuve absente d'une note est écrite « non établie » et
   signalée. NFR-001 (bascules) et NFR-004 (p95 de `/me`) citent les valeurs mesurées.
2. **Fichiers à faire relire par une personne** (règle 4) : dans la section 12 et dans l'ADR
   concernée, au minimum : `0096` (fonctions `DEFINER` d'identification), `0097` (version du secret,
   `reissue_claim_codes`), `0099` ; `post-roles.sql` section 14 et `roles.sql` (rôle
   `cashless_claimadmin`) ; `apps/api/src/cli/ reissue-claim-codes.ts` (codes en clair, fichier de
   sortie) ; `kms/claim-hash.ts` et la configuration du secret ; `customer-auth/otp-chain.ts` (code
   en mémoire) et `bootstrap.ts` ; `contract-baseline.json` (décision du porteur). Complète d'après
   les notes de lane (chaque lot signale les siens).
3. Avant de rendre la main : (1) tout OP, ADR, fichier, test cité existe (`grep`, `ls`) ; (2)
   `git diff --stat` : seuls les cinq fichiers du lot changent ; (3) lignes de 120 caractères au
   plus dans les fichiers de prose où la convention est suivie (ne reformate pas l'existant) ; (4)
   aucun faux ajouté, aucune limite oubliée : relis une dernière fois chaque note de lane et coche
   chaque écart signalé.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP01 à WP10.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP11 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.
- Aucun test à lancer (documentation), aucune base requise ; `PROMPTS-A-ENVOYER.md` et `PRD.md` sont
  à la racine : `execution_mode: code_change` les fait passer par la lane.

## Definition of Done

- [ ] OP-N47 « LEVÉ le 20/11/2026 » (tableau, fiche, OP-N43, OP-N120), avec test de levée, borne
  inversée, mutation.
- [ ] Limites nommées (C-005, contradiction §6.3, celles des notes) : point ouvert, ADR, test de
  borne cité, report.
- [ ] ADR numérotées à la suite (ADR-225 pour le contrat) ; ADR-87, ADR-104, ADR-180 mises à jour.
- [ ] Décisions du porteur du 20/11/2026 consignées ; section 5 à jour ; section 12 écrite.
- [ ] `PROMPTS-A-ENVOYER.md` (10a, 10b, 11, 12b, 13) et `PRD.md` à jour ; `preuves.md` complet, sans
  invention.
- [ ] Liste des fichiers à faire relire présente ; seuls les cinq fichiers du lot modifiés ;
  `SPECIFICATION.md` et `acceptance-matrix.json` intacts.

## Risks

- Fiche écrite d'après un prompt et non d'après le code fusionné : un nom faux est un constat. Tout
  se vérifie.
- Écart non soumis consigné comme « accepté » : la règle 1 impose la décision du porteur, pas
  l'agent.
- Oublier une limite d'une note de lane (retouche hors carte, instabilité, écart) : constat bloquant
  (règle 3).
- Collision de numéros d'ADR ou d'OP si une autre branche a fusionné : relire les fichiers au moment
  d'écrire.

## Ce que le relecteur doit casser

1. Prendre chaque note de lane de WP01 à WP10 et chercher son écart ou sa limite dans
   `POINTS_OUVERTS.md` et les ADR : toute limite absente est bloquante.
2. Pour chaque « LEVÉ » (OP-N47), ouvrir le test cité, vérifier qu'il existe, qu'il échoue sans le
   contrôle (mutation) et que l'ancienne condition (double empreinte) n'est plus présentée comme à
   faire.
3. Chercher un écart de sécurité consigné « accepté » sans décision du porteur citée.
4. Contrôler numéros (ADR, OP), renvois croisés, noms de fonctions, de variables, de fichiers
   (`grep`).
5. Vérifier que les trois libellés de refus de `bootstrap.ts` sont ceux cités, et que les reports
   10b, 11, 12b, 13 existent.
6. Chercher les fichiers sensibles absents de la liste de relecture humaine (clés, droits de la
   base, code OTP).
7. Écart non signalé : fichier hors des cinq modifié, matrice créée par le lot, `SPECIFICATION.md`
   touché, résultat de preuve inventé.
