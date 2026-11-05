---
work_package_id: WP15
title: Outil d inscription des passerelles et colis de mots de passe
dependencies: [WP09, WP10]
requirement_refs:
- FR-002
- FR-037
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T066, T067, T068, T069]
phase: Phase 3 - API du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: tools/edge-admin/
create_intent: [tools/edge-admin/package.json, tools/edge-admin/tsconfig.json, tools/edge-admin/src/main.ts, tools/edge-admin/src/commands.ts, tools/edge-admin/src/enrollment-format.ts, tools/edge-admin/src/db.ts, tools/edge-admin/src/redact.ts, tools/edge-admin/test/register.spec.ts, tools/edge-admin/test/commands-other.spec.ts, tools/edge-admin/test/enrollment-file.spec.ts, tools/edge-admin/test/no-secret-in-logs.spec.ts, apps/api/src/edge/packs/edge-packs.worker.ts, apps/api/src/edge/packs/edge-packs.service.ts, apps/api/src/edge/packs/pack-sealing.ts, apps/api/src/edge/packs/edge-packs.module.ts, apps/api/test/integration/edge/packs/pack-delay.spec.ts, apps/api/test/integration/edge/packs/pack-standby.spec.ts, apps/api/test/integration/edge/packs/pack-canary.spec.ts, apps/api/test/integration/edge/packs/register-alert.spec.ts, tools/edge-admin/FORMATS.md]
execution_mode: code_change
model: sonnet
owned_files: [tools/edge-admin/**, apps/api/src/edge/packs/**, apps/api/test/integration/edge/packs/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP15 : Outil d'inscription des passerelles et colis

> **Corrections après analyse** : `contracts/interfaces.md` § 13.1 et § 13.4 : format figé, paramètres `--site-key-a` et `--site-key-b`, `FORMATS.md` n'est qu'un renvoi ; le délai vient de `edge_platform_setting`, pas de `EDGE_PACK_DELAY_SECONDS`. Mets `tools/edge-admin/FORMATS.md` dans tes fichiers créés.


> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour la dépendance à WP10, `edge_gateways_awaiting_pack`, `edge_register_snapshot_key`, `set_edge_setting`, `tools/edge-admin/FORMATS.md`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte (`docs/passation-8/contexte-m8.md`, décisions 8, 16, 17), ce prompt, puis seulement :

- `contracts/interfaces.md` § 2 (WP03 : `register_edge_gateway`, `revoke_edge_gateway`, `rotate_edge_gateway_cert`, `swap_edge_gateway_roles` ; WP08 : `deposit_edge_pwd_pack`, `deposit_edge_pwd_pack_key`), § 3 (rôle `cashless_edgeadmin`,
  `DATABASE_URL_EDGEADMIN`), § 4 (`EDGE_CA`), § 8 (`EDGE_PACK_DELAY_SECONDS`), § 11 ;
- `research.md` **R-05** (en entier : spécification de l'outil), R-04, R-08 (colis, `pwd_pack_key`), R-27 (aucune clé maître, canari) ; `data-model.md` A.1 (lignes `cashless_edgeadmin` et `cashless_tagkeys`), A.4 (lignes d'inscription), A.5 (`edge_pwd_pack_key`,
  `edge_pwd_pack`) ;
- constats `A16`, `A22`, `A25` de `docs/passation-8/rapports/plan-adversarial.md` ; `contracts/replication-page-additions.yaml` (champ `pwd_pack_key`) ;
- code existant : `apps/api/src/media/auth-keys/auth-keys.service.ts` (modèle de `getMediaAuthKey` : un colis scellé), `apps/api/src/media/keys/data-key.repository.ts`, `processes/tag-keys.module.ts`, `main.tag-keys.ts`, `db/process-db.module.ts`,
  `device-ca/device-ca.port.ts` (modèle du port d'autorité), `apps/api/src/edge/edge-ca.port.ts` et `edge/ca/` (WP10), `tools/dev-db/` (lancement d'outils locaux), `tools/export/` (modèle d'outil hors processus de service).

## Objectif

1. **Un outil d'administration** `tools/edge-admin`, hors API publique et hors processus de service, qui inscrit, révoque, fait tourner le certificat et échange les rôles d'une passerelle, par le rôle `cashless_edgeadmin`
   (EXECUTE seulement sur quatre fonctions). **Inscription par UNE personne** (choix du porteur contre la recommandation de la passerelle contradictoire, décision 16) : compensée par une **alerte immédiate** et un **délai de 30 minutes** avant l'envoi des mots de passe.
2. **Les colis** : le processus des clés (`cashless_tagkeys`) dépose, pour une passerelle `PRIMARY` seulement et passé le délai, les mots de passe de bracelet chiffrés pour la clé d'accord de cette passerelle. **Aucun colis à une `STANDBY` non promue.**

Écart accepté, dette nommée : `OP-N105`, `ADR-160`. Le test de borne de ce lot est donc obligatoire : inscription par une personne, alerte levée, aucun colis avant le délai, aucun colis à une `STANDBY`.

## Branch Strategy

- Branche de planification : `feat/passerelle-locale`. Branche de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane selon `kitty-specs/passerelle-locale-01M6NM1S/lanes.json`.

## Commande d'implémentation

```bash
LC_ALL=C LANG=C spec-kitty agent action implement WP15 --agent claude --mission passerelle-locale-01M6NM1S
```

## Règles du lot

- Tu ne lances ni Jest, ni pgTAP, ni `reset-db`. Tu ne commites pas. Tu ne touches pas à l'API du port 80. Aucune migration, aucun `GRANT` (WP09), aucun `.sql` généré. Lignes de 100 caractères, français, sans tiret cadratin.
- **Hors carte inévitable, à faire accepter par l'orchestrateur avant de coder** (voir « Contradictions ») : `package.json` racine (`workspaces`, ajout de `tools/edge-admin`, autorisé par `interfaces.md` § 11), `apps/api/src/processes/tag-keys.module.ts` (import d'`EdgePacksModule`,
  une ligne), et l'import par l'outil du port `EdgeCaPort` d'`apps/api/src/edge/` (WP10). Rien d'autre.
- L'outil n'écrit **aucune clé privée** : les clés de la passerelle naissent dans son port de stockage matériel (WP16, R-19, R-27). Il reçoit des clés **publiques** et une demande de certificat.
- Un écart qui affaiblit la sécurité s'arrête et remonte au porteur (CLAUDE.md, règle 1).

## T066 : L'outil : inscrire, révoquer, tourner, échanger

**But.** `tools/edge-admin/src/main.ts`, commandes (sous-commandes d'un script, `npm run edge-admin -w @cashless/edge-admin -- <commande>`) :
- `register --request <fichier> --operator <uuid> --event <uuid> --serial <texte> --role PRIMARY|STANDBY --lan-url <https://...> --by <étiquette>` ;
- `revoke --gateway <uuid> --reason <texte> --by <étiquette>` ;
- `rotate-cert --gateway <uuid> --request <fichier> --by <étiquette>` ;
- `swap-roles --old <uuid> --new <uuid> --by <étiquette>`.
`set_edge_gateway_role` n'est **pas** exposée seule (`interfaces.md` § 2, A25) : le changement de rôle passe par `swap-roles`.

**Connexion.** `DATABASE_URL_EDGEADMIN` (rôle `cashless_edgeadmin`, `CASHLESS_EDGEADMIN_PASSWORD`), jamais celle d'un processus de service. Un seul pool, ouvert pour la durée de la commande, fermé en `finally`. Aucun `SELECT` direct : fonctions
seulement (le rôle n'a que quatre `EXECUTE`).

**Arbitrages.**
- **Signature exacte de `register_edge_gateway`** : celle de `interfaces.md` § 2 (neuf paramètres : `p_operator, p_event, p_serial, p_role, p_cert_sha256, p_public_key, p_agreement_public_key, p_lan_url, p_registered_by_label`). **Pas** celle de
  R-05, qui en cite dix (avec une clé de snapshot). Si l'inscription de la clé de snapshot de la passerelle (R-05) est nécessaire, c'est une question pour l'orchestrateur : n'ajoute rien.
- `--by` : étiquette d'audit (nom de la personne, depuis `--by` ou `EDGE_ADMIN_LABEL`) ; obligatoire, non vide, 3 à 80 caractères. L'outil ne crée pas d'identité : l'étiquette n'est pas une authentification (limite à consigner, voir Sécurité).
- Sortie : codes `0` réussi, `2` refus de la base (message de la base résumé sans valeur sensible), `1` panne. `register` imprime l'identifiant de la passerelle, la date d'effet des colis (`maintenant + délai`) et **l'avertissement** que l'alerte `EDGE_REGISTERED` a été levée.
- `revoke` : si un handover est ouvert, la base refuse ; l'outil dit « passer par la reprise forcée à deux » sans proposer de contournement.
- `swap-roles` : refusé par la base tant qu'un handover est ouvert ; l'outil rend le message tel quel et rappelle que le délai de 30 minutes repart.

## T067 : Fichier d'enrôlement, certificat par `EDGE_CA`, sans secret en journal

**But.** Le flux : la passerelle (WP16, WP24) génère ses clés dans son port matériel et écrit un **fichier de demande** (CSR PEM de sa clé de transport TLS, clé publique de signature ECDSA P-256 de 65 octets, clé publique d'accord P-256 de 65 octets, numéro de série).
`register` lit ce fichier, fait émettre le certificat par le port `EDGE_CA` (`issue(csrPem, serial)`), calcule `cert_sha256` (SHA-256 du **DER** du certificat), appelle `register_edge_gateway`, puis écrit un **fichier d'enrôlement à usage unique** pour le site :
`gateway_id`, certificat PEM, certificat de l'autorité des passerelles (`caCertPem()`), `lan_url`, rôle, date d'effet des colis. **Aucune clé privée, aucun mot de passe, aucune clé de bracelet.**

**Fichiers.** `enrollment-format.ts` fige le format des deux fichiers (JSON, version, longueurs vérifiées : 65 octets pour les clés P-256 non compressées, 32 pour l'empreinte). Ce format est partagé avec WP16 et WP24 : **n'invente pas de champ qui ne serve qu'ici**
et signale-le à l'orchestrateur pour qu'il le transmette à WP16.

**Arbitrages.**
- Le fichier d'enrôlement est créé avec les droits `0600`, refuse d'écraser un fichier existant, et affiche son chemin, jamais son contenu.
- L'outil lit `EDGE_CA` par une variable d'environnement qui choisit l'adaptateur. Le **faux** est refusé en production (`NODE_ENV=production`) : message clair, code `1`, **et un test le prouve** (règle 2). L'adaptateur réel est la mission 12b : ne l'écris pas.
- Le certificat émis porte un sujet imposé par l'outil (identifiant de la passerelle et du prestataire), pas celui du CSR (même règle que `DeviceSubject`). Si `EdgeCaPort.issue` ne l'impose pas, c'est un défaut de WP10 : signale-le.
- Redaction : `redact.ts` masque tout ce qui ressemble à une URL de connexion (mot de passe), un PEM privé, un nonce, une empreinte complète (garder les 8 premiers octets). Tout log passe par lui.
- Rotation (`rotate-cert`) : même chemin, nouveau CSR, ancienne empreinte refusée aussitôt par la base.

## T068 : Colis déposés par le processus des clés, canari

**But.** Dans `apps/api/src/edge/packs/` : un travailleur du processus `tag-keys` (`cashless_tagkeys`, `KmsModule.forCapabilities(['decrypt'])` déjà présent) qui, pour chaque passerelle éligible, (1) crée une fois la clé de contenu de passerelle et la dépose scellée pour la clé d'accord
(`deposit_edge_pwd_pack_key`), (2) dépose les colis de bracelet chiffrés sous cette clé (`deposit_edge_pwd_pack`). Modèle : `getMediaAuthKey` (un colis par bracelet, rien en clair). **Aucune clé maître ne quitte le central** (C-009).

**Éligibilité (les deux conditions, vérifiées par le travailleur ET par la base).** Passerelle `PRIMARY`, non `REVOKED`, et `role_changed_at` plus ancien que `EDGE_PACK_DELAY_SECONDS` (défaut 1800 ; `0` refusé en production par la configuration, WP10). Une `STANDBY` n'est jamais éligible. Une passerelle
qui devient `PRIMARY` par `swap-roles` redevient non éligible pendant 30 minutes. La base vérifie aussi (WP08, `edge_replication_page`) : deux barrières.

**Point à régler avant de coder.** `interfaces.md` ne nomme aucune fonction de lecture pour qu'un travailleur de `cashless_tagkeys` liste les passerelles éligibles et les bracelets à emballer, et `data-model.md` A.1 n'accorde à `cashless_tagkeys` que `deposit_edge_pwd_pack`.
Lis la liste figée de WP09 : si la lecture est possible, utilise-la sans rien ajouter. **Sinon, arrête-toi sur T068 et signale-le** (n'élargis aucun droit). Le travailleur ne reçoit aucune capacité `mac` ni `dataKey` de plus.

**Cas limites.** Colis déjà déposé et inchangé : pas de réécriture (`pack_sha256` identique). Version du bracelet changée (`media_version`) : nouveau colis. Passerelle révoquée entre le calcul et le dépôt : la base refuse, le travailleur n'insiste pas.
Clé d'accord de la passerelle changée (rotation) : la clé de contenu est recréée et les colis refaits, anciens supprimés par la base.

## Tests attendus

- `tools/edge-admin/test/register.spec.ts` : demande valide : fonction appelée avec les neuf paramètres exacts, fichier d'enrôlement à `0600`, aucun secret ; CSR à clé non P-256 : refus avant la base ; clé de 64 octets : refus ; `--by` vide : refus ; faux `EDGE_CA` en production :
  code `1`, rien d'écrit, la base non appelée.
- `tools/edge-admin/test/commands-other.spec.ts` : `revoke` avec handover ouvert : refus de la base, message « reprise forcée à deux » ; `rotate-cert` : l'ancienne empreinte est refusée par `identify_edge_gateway` ; `swap-roles` ; **le rôle `cashless_edgeadmin` ne peut rien d'autre**
  (un `SELECT` sur `edge_gateway`, un appel à `set_edge_gateway_role` seule ou à `grant_edge_authority` : refusés).
- `tools/edge-admin/test/enrollment-file.spec.ts` : format, longueurs, refus d'écraser, aucune clé privée, version.
- `tools/edge-admin/test/no-secret-in-logs.spec.ts` : canari dans le mot de passe de `DATABASE_URL_EDGEADMIN`, dans le CSR (extension) et dans la sortie : absent de stdout, stderr, du fichier d'enrôlement, sous toutes ses représentations (UTF-8, hexadécimal, base64) ;
  **contrôle positif** : un log volontairement fautif fait échouer le test.
- `apps/api/test/integration/edge/packs/register-alert.spec.ts` : une personne inscrit, l'alerte `EDGE_REGISTERED` existe aussitôt, une ligne d'audit `EDGE_GATEWAY_REGISTERED` porte l'étiquette ; un `swap-roles` lève aussi une alerte.
- `.../pack-delay.spec.ts` : aucun colis à 29 min 59 s, colis à 30 min 1 s (horloge de test) ; `swap-roles` remet le délai à zéro ; `EDGE_PACK_DELAY_SECONDS=0` refusé en production.
- `.../pack-standby.spec.ts` : `STANDBY` inscrite depuis une heure : aucun colis, ni dépôt, ni dans le flux de réplication ; promue, puis 30 minutes : colis.
- `.../pack-canary.spec.ts` : mot de passe de bracelet connu du test : absent en clair du colis, de la base, du flux, des journaux du travailleur, sous toutes ses représentations (UTF-8, hexadécimal minuscule, base64, base64url) ; contrôle positif ; aucune clé maître.

Chaque test doit échouer sur une implémentation fausse : un travailleur qui ignore le délai, qui sert la `STANDBY`, ou un outil qui journalise l'URL de connexion rend sa suite rouge.

## Sécurité

- **Écart accepté (OP-N105, ADR-160)** : inscription par une seule personne. Ne l'aggrave pas : pas de contournement du délai, pas de colis immédiat « pour les tests », pas d'inscription sans alerte. L'étiquette `--by` n'authentifie pas la personne : à consigner dans le rapport comme limite connue.
- Fichiers à faire relire par une personne : `tools/edge-admin/src/commands.ts`, `edge-packs.service.ts`, `pack-sealing.ts` (cryptographie), le rôle `cashless_edgeadmin`.
- Aucun secret en journal. Aucun fichier d'enrôlement réutilisable après usage (WP16 le consomme et le détruit : vérifier la consigne dans l'en-tête du fichier).
- L'outil ne se connecte jamais avec `cashless_app` ni `cashless_edge`, et refuse de démarrer si on lui donne leur URL (le nom d'utilisateur de l'URL est contrôlé).

## Definition of Done

- [ ] Quatre commandes, fonctions de `interfaces.md` § 2, rôle `cashless_edgeadmin` seul, étiquette d'audit obligatoire.
- [ ] Fichiers de demande et d'enrôlement figés, aucune clé privée, `0600`.
- [ ] Faux `EDGE_CA` refusé en production, prouvé.
- [ ] Alerte immédiate et délai de 30 minutes prouvés ; aucun colis à une `STANDBY` non promue.
- [ ] Canari sur colis, base, flux, journaux de l'outil et du travailleur.
- [ ] Hors carte listé (workspaces, `tag-keys.module.ts`, import du port) ; point T068 résolu ou signalé.

## Ce que le relecteur doit casser

- S'inscrire deux fois pour le même événement en `PRIMARY` (une seule doit passer, verrou par événement) ; deux `register` simultanés.
- Faire émettre un certificat par l'autorité des **terminaux** : doit être impossible.
- Chercher le mot de passe de la connexion dans les journaux et le fichier d'enrôlement ; lancer avec `NODE_ENV=production` et le faux.
- Promouvoir la `STANDBY` puis lire le flux à la minute 29.
- Appeler, avec la connexion de l'outil, `set_edge_gateway_role` seule, `register_edge_gateway` avec dix paramètres.

## Contradictions relevées entre les sources (aucune n'est corrigée ici)

- `research.md` R-05 donne à `register_edge_gateway` dix paramètres (clé de snapshot, `actor_label`) ; `interfaces.md` § 2 en donne neuf. **`interfaces.md` fait foi.** Conséquence à trancher : l'inscription de la clé de snapshot de la passerelle (`snapshot_signing_key`, `owner = 'EDGE'`) n'est plus portée par cette fonction.
- `interfaces.md` § 2 déclare `deposit_edge_pwd_pack_key` ; `data-model.md` A.1 n'accorde à `cashless_tagkeys` que `deposit_edge_pwd_pack`. WP09 doit accorder les deux, sinon T068 échoue en exécution.
- `tasks.md` WP15 dépend de WP09 seulement, mais l'outil importe le port `EdgeCaPort` créé par WP10 (`apps/api/src/edge/edge-ca.port.ts`, `edge/ca/**`). La dépendance devrait inclure WP10, ou le port doit être consulté en tant qu'interface fixée par `interfaces.md` § 4.
- `tasks.md` T068 place le dépôt des colis dans `apps/api/src/edge/packs/**` (processus `tag-keys`), mais l'import du module doit se faire dans `processes/tag-keys.module.ts`, absent de `interfaces.md` § 11.
- `tools/` n'a aucun paquet de travail (workspace) à ce jour ; `package.json` racine n'en liste aucun sous `tools/`. L'ajout au tableau `workspaces` est permis par § 11 mais non décrit par `tasks.md`.
- `research.md` R-05 appelle le délai `EDGE_PACK_DELAY` ; `interfaces.md` § 8 : `EDGE_PACK_DELAY_SECONDS`. **`interfaces.md` fait foi.** `edge_replication_page` ne reçoit aucun paramètre de délai (§ 2) : la source du délai côté SQL est à confirmer avec WP08.
