---
work_package_id: WP24
title: Purge des secrets, passerelle de secours, image et procédure de site
dependencies: [WP21, WP22, WP23]
requirement_refs:
- FR-030
- FR-033
- FR-035
- NFR-010
- NFR-013
- C-008
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T108, T109, T110, T111]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/purge/
create_intent: [apps/gateway/src/purge/purge.service.ts, apps/gateway/src/purge/purge-trigger.ts, apps/gateway/src/purge/manual-purge.controller.ts, apps/gateway/src/purge/purge.module.ts, apps/gateway/src/standby/standby.service.ts, apps/gateway/src/standby/standby.module.ts, apps/gateway/test/purge/purge-auto.spec.ts, apps/gateway/test/purge/purge-manual.spec.ts, apps/gateway/test/purge/purge-canary.spec.ts, apps/gateway/test/purge/standby.spec.ts, apps/gateway/test/purge/image.spec.ts, apps/gateway/Dockerfile, apps/gateway/docker-compose.site.yml, docs/procedure-site-passerelle.md]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/purge/**, apps/gateway/src/standby/**, apps/gateway/test/purge/**, apps/gateway/Dockerfile, apps/gateway/docker-compose.site.yml, docs/procedure-site-passerelle.md]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP24 – Purge, secours, image et procédure

> **Corrections après analyse** : `contracts/interfaces.md` § 13.3 : pas de port propre, tu enregistres `PURGE` par `registerOrderHandler` (WP17). `ADR-161` et `OP-N106` existent déjà : complète-les seulement.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `data-model.md` **B.9 bis** (purge, limite consignée), B.7 (invariant 10), B.8 (`STANDBY`,
  `REVOKED`), B.6 (`edge_audit` `PURGE`) ;
- `research.md` R-27 **en entier** (image, dépendances, canari sous toutes ses représentations,
  purge), R-16 (`STANDBY`, promotion), R-26 (profil PostgreSQL `fsync`, `full_page_writes`,
  `synchronous_commit`) ;
- `contracts/interfaces.md` § 4 (`HARDWARE_KEYSTORE.destroy`), § 10 (`verifyTwoPersonOrder` de WP17
  dans `authority/site-order.ts`), § 11 ;
- `spec.md` FR-030, FR-033, FR-035, NFR-010, NFR-013, hypothèses de site ;
- `docs/passation-8/rapports/plan-adversarial.md` A16, A21, A22, A28 ;
  `docs/passation-8/contexte-m8.md` décisions 16, 17 ; `docs/08-pile-logicielle.md` (ADR-78,
  DIRECTIVE_051) ; ADR-161 et `OP-N106` à créer ou compléter dans `docs/`.

Produits par les lots précédents : `HARDWARE_KEYSTORE`, `edge_*` (WP16), `AuthorityService`,
`verifyTwoPersonOrder` (WP17), `QueueProbe` (WP17/WP20), colis (WP18, WP23). Priorité des sources :
SPECIFICATION §0.3 ; contradiction signalée.

## Objective

Ne rien laisser d'exploitable sur un mini-PC après l'événement (FR-035, NFR-013), garantir qu'une
passerelle `STANDBY` ne débite jamais (FR-030), et livrer une image et une procédure de site simples
à déployer (FR-033).
La limite acceptée est écrite, pas cachée : **un mini-PC volé avant la purge garde ses secrets**
(`OP-N106`, `ADR-161`).

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP24 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; aucune dépendance npm nouvelle ; **tu ne construis ni ne lances l'image
dans cet environnement partagé** (l'orchestrateur et la CI le font) ;
un écart qui affaiblit la sécurité s'arrête et remonte au porteur.

## T108 – Purge automatique et manuelle à deux, test canari

**Déclencheurs** (`purge-trigger.ts`)

1. **Automatique** : la réplication porte `event.status = CLOSED` **et** la file est vide et
   entièrement acquittée (`QueueProbe`, `edge_chain_head.acked_edge_seq = last_edge_seq`, aucun lot
   non `DONE`, aucun delta actif). Tant que la file n'est pas acquittée : pas de purge, alerte
   locale « purge en attente » (aucune perte).
2. **Manuelle** : `POST` local (hors contrat, **jamais** dans la liste des 16 : écoute sur
   l'interface d'administration locale de la passerelle, port séparé `GATEWAY_ADMIN_PORT`, protégé
   par `verifyTwoPersonOrder('PURGE', ...)` avec deux signatures distinctes d'ordre signé, nonce,
   validité 10 minutes, lien avec `gateway_id`). Refusée si la file n'est pas acquittée. **Ce port
   d'administration est un ajout** : signale-le (nom de variable, aucune route publique) et
   enregistre sa règle de production (TLS obligatoire, adresse de boucle locale ou interface
   d'administration explicite).

**Effet, dans cet ordre** (`purge.service.ts`), chaque étape journalisée dans `edge_audit` `PURGE`
(sans contenu) :

1. poser un marqueur de purge **hors base** (fichier local `purge.marker` dans le volume de la
   passerelle, écrit et synchronisé avant tout le reste) et cesser de répondre aux terminaux ; aucun
   état d'autorité nouveau n'existe dans `edge_authority_transition`, n'en ajoute pas (si une
   colonne de base devient nécessaire, signale-le : migration `edge-0002` seulement avec accord de
   l'orchestrateur) ;
2. `HARDWARE_KEYSTORE.destroy('agreement')` et `destroy('token')` (effacement cryptographique : les
   colis `pwd_pack_enc` et `pwd_pack_key` deviennent illisibles) ;
3. mettre à `NULL`/supprimer les colis (`edge_media.pwd_pack_enc`,
   `edge_snapshot_entry.pwd_pack_enc`, `edge_snapshot_key`), les empreintes de jetons de
   rafraîchissement (`edge_device_token_family`), `edge_token_key`, puis `TRUNCATE` de toutes les
   tables répliquées (R) ;
4. `VACUUM FULL` des tables concernées (hors transaction) ;
5. après le dernier lot `DONE`, `HARDWARE_KEYSTORE.destroy('batch')` et `destroy('snapshot')`.
Reprise : la purge est **idempotente et reprenable** (un arrêt au milieu laisse un état « purge
commencée » que le démarrage termine avant tout service ; test par `SIGKILL` entre chaque étape).
Après purge, la passerelle ne sert plus rien
(`404`/`503` sans détail) et refuse de redémarrer sur ces données.

## T109 – `STANDBY` : refus de tout débit, promotion par handover normal

- `standby.service.ts` : une passerelle `STANDBY` réplique l'état de service (bloc `reference`) mais
  **ne reçoit aucun mot de passe de bracelet** (WP18) et ne reçoit jamais d'accord (le central
  refuse). Tout débit reçu : `409 CONFLICT_STATE` détail `GATEWAY_NOT_AUTHORITY`, rien d'écrit,
  aucun numéro (déjà par `AuthorityService`, WP17) ; ce lot ajoute la **preuve de bout en bout** et
  le comportement de **promotion** : la passerelle apprend son nouveau rôle par
  `reference.gateway.role`, passe `STANDBY -> ARMED`, reprend une copie complète, attend le délai
  des colis (central, WP15) avant d'obtenir les mots de passe, et ne débite qu'après un accord
  complet (handover normal, C-008).
- La promotion ne passe par **aucun** chemin local : un test échoue si une écriture directe dans
  `edge_authority` mène `STANDBY` à `ACTIVE`.

## T110 – `Dockerfile`, `docker-compose.site.yml`, images épinglées, contrôle

- `apps/gateway/Dockerfile` : deux étages, base `node:22-bookworm-slim` **épinglée par condensat**
  (`@sha256:`), utilisateur non-root, `npm ci --ignore-scripts` (`.npmrc`), exécution par `tsx`
  comme l'API, **aucun secret ni clé de bracelet dans l'image**, contrôle de santé HTTP (sur le port
  d'administration ou un chemin local non contractuel : signale-le), aucun port de débogage.
  PostgreSQL 17 en **service voisin** (`docker-compose.site.yml`, image `postgres:17` épinglée par
  condensat, volume sur disque chiffré de l'hôte, `fsync=on`, `full_page_writes=on`,
  `synchronous_commit=on` explicitement posés, `log_statement` à `none`).
- **Les condensats ne sont pas devinés** : relève-les à l'implémentation (registre officiel) ; si tu
  ne peux pas, laisse un champ `REPLACE_WITH_DIGEST` **qui fait échouer** le test d'image, et
  signale-le. Je n'ai exécuté aucun contrôle de ces deux images : le résultat du balayage des
  vulnérabilités (DIRECTIVE_051) est à consigner dans `docs/08-pile-logicielle.md` (nouvelle ligne «
  Passerelle locale ») et dans l'ADR **par l'orchestrateur ou la CI** ; ce fichier n'est pas dans la
  carte de ce lot : prépare le texte de la ligne dans ton rapport, ne l'écris pas.
- `image.spec.ts` : lit `Dockerfile` et `docker-compose.site.yml` et vérifie (sans Docker) :
  condensat présent dans les deux `FROM`/`image`, non-root, pas de `COPY` de fichiers de clés
  (`*.key`, `*.pem`, `.env`), `--ignore-scripts`, aucun `ENV` secret, paramètres PostgreSQL de
  durabilité. Le canari dans `docker save` est une preuve de WP25.

## T111 – `docs/procedure-site-passerelle.md`

Procédure de site, courte et exécutable par une personne non spécialiste : disque chiffré, onduleur,
Wi-Fi dédié, source de temps locale (NTP), inscription (par une personne, alerte immédiate, **délai
de 30 minutes** avant tout mot de passe,
rien à une `STANDBY` non promue), enrôlement (fichier, clés de procédure de site pour les ordres à
deux personnes), démarrage, vérifications, bascule et rendu côté admin, **perte de la passerelle**
(reprise forcée à deux, révocation), **purge**
(automatique, manuelle à deux), retour du matériel. Elle dit en clair la limite : **un mini-PC volé
avant la purge garde ses secrets ; la révocation à distance ne joint pas une machine débranchée**,
et la limite de la mission 12b (stockage matériel
simulé jusqu'alors : **la passerelle n'est pas utilisable en production avant la 12b**). Sans tiret
cadratin.

## Tests attendus (`apps/gateway/test/purge/`)

- `purge-auto.spec.ts` : `CLOSED` + file acquittée déclenche ; `CLOSED` + file non acquittée **ne
  déclenche pas** ; arrêt entre chaque étape puis redémarrage : la purge se termine avant tout
  service.
- `purge-manual.spec.ts` : une seule signature, deux fois la même personne, ordre périmé, nonce
  rejoué, mauvais `gateway_id`, file non acquittée : refus, **rien détruit** ; ordre valide :
  exécution ; audit `PURGE` avec les deux auteurs.
- `purge-canary.spec.ts` (**NFR-013**, **NFR-010**) : un canari (PWD, clé de jeton, empreinte de
  jeton de rafraîchissement) est présent avant purge, **puis absent après**, sous toutes ses
  représentations (UTF-8, hexadécimal minuscule et majuscule, base64, base64url, échappements JSON
  et SQL), dans les fichiers de la base (`pg_dump`, recherche dans le répertoire de données si
  accessible, journaux locaux) ; `sign` et `agree` **refusés** après purge ; **contrôle positif** :
  une purge volontairement incomplète (oublie `edge_snapshot_entry`) doit faire échouer le test.
- `standby.spec.ts` : refus de tout débit, aucun colis, aucune écriture de `edge_authority` vers
  `ACTIVE`, promotion par handover seulement.
- `image.spec.ts` : comme ci-dessus.

## Décisions du porteur du 09/11/2026 (font foi sur ce prompt)

Source : `docs/passation-8/contexte-m8.md`, décisions 19 à 33, et les notes adressées à ce lot dans
`docs/passation-8/suivi-lots.md`.

- Décision 33 : la passerelle verse ses ordres locaux à deux personnes (`LOCAL_UNSTALE`, purge manuelle) au central
  au retour du lien, par le champ facultatif ajouté par WP13 (forme dans `openapi.yaml`) ; une ligne invalide n'est
  pas envoyée et déclenche une alerte, comme `STAFF_AUDIT_UNSENDABLE` (WP20).
- WP18 : réutiliser `purgeKeyMaterial(tx)` (`src/replication/pwd-pack-key.ts`) pour la purge ; aligner
  `src/testing/apply-hook.ts` sur `nodeEnv()` de shared-rules.
- WP15/décision 27 : deux titulaires distincts des clés de site (procédure de site à documenter).

## Sécurité

- Destruction irréversible : la purge ne se déclenche jamais sur un ordre à une signature, sur une
  file non acquittée, ni sur un événement non `CLOSED` (automatique).
- Écart accepté `OP-N106` : mini-PC volé avant la purge. Test de borne : l'énoncé figure dans la
  procédure et dans `docs/POINTS_OUVERTS.md` (WP25 le vérifie).
- Image sans secret ; condensats épinglés ; port d'administration non exposé au Wi-Fi des terminaux.
- À faire relire par une personne : `purge.service.ts`, `manual-purge.controller.ts`, `Dockerfile`,
  `docker-compose.site.yml`.

## Definition of Done

- [ ] Purge automatique et manuelle à deux prouvées, canari avec contrôle positif, clés inutilisables, reprise après arrêt.
- [ ] `STANDBY` sans débit ni colis ; promotion par handover seul.
- [ ] Dockerfile et compose conformes au test d'image ; condensats relevés ou test volontairement rouge et signalé.
- [ ] Procédure complète avec la limite nommée ; port d'administration signalé ; lignes de 100 caractères.

## Ce que le relecteur doit casser

- Déclencher la purge avec une signature, deux signatures du même signataire, un ordre vieux de 11
  minutes, un ordre pour une autre passerelle, une file non acquittée.
- Tuer le processus au milieu de la purge et redémarrer : le service ne doit pas reprendre avant la
  fin de la purge.
- Chercher le canari dans toute représentation après purge ; appeler `sign`/`agree` après purge.
- Promouvoir une `STANDBY` en écrivant en base ; lui envoyer un accord ; lui faire servir un colis.
- Lire le `Dockerfile` : un secret, un `latest`, un utilisateur root, un condensat absent.
