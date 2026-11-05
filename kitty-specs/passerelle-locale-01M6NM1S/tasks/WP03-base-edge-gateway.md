---
work_package_id: WP03
title: 'Base : inscription et identité des passerelles (migration 0058)'
dependencies: []
requirement_refs:
- FR-002
- FR-031
- FR-037
- C-009
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-passerelle-locale-01M6NM1S
base_commit: d060f30a0f2e002c2909eac35c2b9a0a2d57ce2c
created_at: '2026-11-05T15:35:51.654910+00:00'
subtasks: [T010, T011, T012, T013]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0058_edge_gateway_admin.sql
create_intent: [packages/ledger-sql/migrations/0058_edge_gateway_admin.sql, packages/ledger-sql/tests/tests_edge_gateway.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0058_edge_gateway_admin.sql, packages/ledger-sql/tests/tests_edge_gateway.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Base, inscription et identité des passerelles (migration 0058)

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour la table `edge_reference_change` créée ici (vide) et `edge_register_snapshot_key`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 5, 6, 16 ;
- `contracts/interfaces.md` § 1 (ligne 0058), § 2 (bloc WP03, signatures figées), § 7 (noms d'audit et d'alertes) ;
- `data-model.md` A.1, A.2 (contraintes A04, une par une), A.4 (lignes `identify`, `touch`, `register`... ) ;
- `research.md` R-05 (inscription), R-06 (points 1 et 3 ; point 1 est pris par WP09, voir plus bas), R-07 (lignes de WP03) ;
- constats `A04`, `A16`, `A25` de `docs/passation-8/rapports/plan-adversarial.md` ; ADR-160 de `docs/DECISIONS_ADR.md`
  et OP-N105 de `docs/POINTS_OUVERTS.md` ;
- code : `schema_grand_livre_cashless.sql` l. 726-745 (`edge_gateway`), l. 488-493 (`forbid_mutation`), l. 1706 (`assert_tenant`),
  l. 2291-2308 (`snapshot_signing_key`), l. 2670-2704 (`force_central_authority`, ne pas toucher) ;
  `tests_grand_livre_cashless.sql` l. 495-545 (insertions de passerelle du kit) ; `migrations/0004_audit_log.sql` ;
  `migrations/0047_offline_anomalies.sql` (modèle d'une migration à fonctions étroites) ; `post-roles.sql` § 2 (création des rôles).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Rendre une passerelle inscriptible par un outil d'administration hors API publique, identifiable par l'empreinte de son
certificat, révocable, sans qu'aucune contrainte nouvelle ne fasse échouer les suites générées du kit. La migration crée
les deux rôles, ajoute des colonnes TOUTES nullables ou à valeur par défaut, un déclencheur qui rend `REVOKED` terminal, et les
sept fonctions de l'identité (`identify`, `touch`, `register`, `revoke`, `rotate`, `swap`, `set_role`). Aucun `GRANT`.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP03 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Dans le lot : `0058_edge_gateway_admin.sql` et la suite pgTAP **sous le propriétaire uniquement** (pas de `SET ROLE` : les
  droits sont en WP09). `REVOKE ALL ... FROM PUBLIC` sur chaque fonction ; `SECURITY DEFINER` ; `SET search_path = public, pg_temp`.
- **Aucun `GRANT`.** Le retrait de l'écriture directe de `cashless_app` sur `edge_gateway` (R-06.1) se fait en WP09 dans
  `roles.sql`/`post-roles.sql` (tâche T038), PAS dans cette migration : `data-model.md` et R-06 le placent en 0058, `tasks.md`
  le place en WP09 ; `interfaces.md` ne le liste pas dans 0058. Retenu : WP09. **Signale cet écart de placement** : entre la
  fusion de WP03 et celle de WP09, `cashless_app` garde l'écriture directe (fenêtre à nommer dans le rapport).
- Création des rôles : `interfaces.md` § 1 met `cashless_edge` et `cashless_edgeadmin` dans 0058. Crée-les ici dans un bloc
  `DO $$ ... IF NOT EXISTS` idempotent, même forme que `post-roles.sql` § 2 (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS NOINHERIT`, sans mot de passe). Les délais de session, les droits et le mot de passe (`migrate.ts`) sont à WP09.
  `migrate.ts` n'appartient à aucun lot : **signale-le** (variables `CASHLESS_EDGE_PASSWORD`, `CASHLESS_EDGEADMIN_PASSWORD`).
- **`register_edge_gateway` : signature figée de `interfaces.md` (9 arguments)**, sans la clé publique de snapshot que R-05
  mentionnait. Conséquence à signaler : l'inscription de `snapshot_signing_key` (`owner = 'EDGE'`) n'a aucun porteur dans la
  carte des lots ; la passerelle signe ses snapshots avec une clé distincte (FR-027). N'invente pas de paramètre ; remonte.
- Les alertes (`EDGE_REGISTERED`, etc.) : `interfaces.md` § 7 donne les noms, pas le mécanisme. Écris une ligne dans `audit_log`
  (action = nom d'audit de § 7, `object_type = 'EDGE_GATEWAY'`) ET `pg_notify('edge_alert', <nom>)`. Si, en lisant 0047, tu vois un
  mécanisme d'alerte déjà établi, suis-le et dis lequel. Dans le doute, arrête et signale : une alerte non levée est un contrôle
  retiré (règle 1).
- Hors lot : handovers (WP04), registre (WP05), colis (WP08), `force_central_authority` (jamais modifiée, C-003).

## Subtasks

### T010 : Rôles, colonnes de `edge_gateway`, déclencheur `REVOKED`

**Colonnes** (toutes `NULL` ou `DEFAULT`, A04) : `registered_at timestamptz DEFAULT now()`, `registered_by_label text`,
`role_changed_at timestamptz`, `revoked_at timestamptz`, `revoke_reason text`, `reference_applied_seq bigint NOT NULL DEFAULT 0`.
`registered_by_label` non nul est imposé par la FONCTION d'inscription, pas par la table.

**Contraintes admises** : `UNIQUE (cert_sha256) WHERE status <> 'REVOKED'` ; déclencheur de refus de suppression
(`forbid_mutation` sur DELETE). **Contraintes INTERDITES** (elles casseraient les suites du kit ou `force_central_authority`) :
index unique « une primaire par événement » (le kit insère deux `PRIMARY` du même événement) ; `CHECK (status <> 'REVOKED' OR
revoked_at IS NOT NULL)` ; toute colonne `ledger_id` (A04, A27).

**Déclencheur** `BEFORE UPDATE OF status` : quand `status` passe à `REVOKED`, `NEW.revoked_at := coalesce(NEW.revoked_at, now())` ;
tout retour hors de `REVOKED` est refusé (terminal). `force_central_authority` fait `UPDATE ... status = 'REVOKED'` sans toucher
`revoked_at` : elle doit rester exécutable telle quelle. Table `edge_gateway` : RLS `tenant_isolation` déjà en place ? Vérifie ;
si absente, signale (n'en ajoute pas en silence, le kit l'insère sans contexte de locataire).

### T011 : `identify_edge_gateway`, `touch_edge_gateway`

- `identify_edge_gateway(p_cert_sha256 bytea)` : ne lit que, renvoie les huit colonnes figées (`gateway_id`, `operator_id`, `event_id`,
  `ledger_id`, `role`, `status`, `lan_url`, `public_key`). Le grand livre se résout par `ledger.scope_type = 'EVENT'` et `scope_id = event_id`
  (aucune colonne `ledger_id`). Empreinte inconnue OU passerelle `REVOKED` : `no_data_found`, **même erreur et même message** dans les
  deux cas (aucun oracle). Longueur autre que 32 octets : même erreur. Pas de `assert_tenant` (le prestataire est ce qu'on cherche) :
  documente cette exception en en-tête, elle ne doit être accordée qu'à `cashless_edge` (WP09).
- `touch_edge_gateway(p_gateway)` : `last_seen_at = now()` ; `ISOLATED` devient `CATCHING_UP` ; ne touche jamais `REVOKED`
  (terminal) ni `ACTIVE`. Passerelle inconnue : sans effet, sans erreur révélatrice. `assert_tenant` si le contexte locataire existe.

### T012 : Administration, verrou par événement, audit, alerte

Cinq fonctions (signatures figées de `interfaces.md` § 2). Toutes prennent d'abord le **verrou consultatif transactionnel de
l'événement** (`pg_advisory_xact_lock` sur une clé dérivée de `event_id`, ordre de verrous C-012 : consultatif d'abord, puis lignes).

- `register_edge_gateway(...)` : événement du prestataire (`assert_tenant`), `p_role` dans `PRIMARY|STANDBY`, empreinte de 32 octets,
  `p_agreement_public_key` de 65 octets, `p_registered_by_label` non vide, `serial` unique, **un seul `PRIMARY` non révoqué par
  événement** (contrôle ICI sous le verrou). `role_changed_at := now()`. Statut `ACTIVE`. Audit `EDGE_GATEWAY_REGISTERED` + alerte
  immédiate `EDGE_REGISTERED` (décision 16 : inscription par UNE personne, compensée par l'alerte et par le délai des colis, WP08).
- `revoke_edge_gateway(p_gateway, p_reason, p_label)` : refusée si un handover est ouvert pour l'événement (on passe par la reprise
  forcée) ; pose `status = 'REVOKED'` et `revoke_reason` ; audit `EDGE_GATEWAY_REVOKED`. Idempotente sur une passerelle déjà révoquée.
- `rotate_edge_gateway_cert(p_gateway, p_cert_sha256, p_label)` : l'ancienne empreinte est refusée AUSSITÔT (la colonne est remplacée) ;
  refusée sur `REVOKED` ; audit `EDGE_CERT_ROTATED`.
- `swap_edge_gateway_roles(p_old_primary, p_new_primary, p_label)` : échange `PRIMARY` et `STANDBY` en UNE instruction atomique sous le
  verrou de l'événement (A25), même événement exigé, ancien `PRIMARY` et nouveau `STANDBY` non révoqués, refusée tant qu'un handover est
  ouvert, `role_changed_at := now()` sur les deux (le délai des colis repart), audit `EDGE_GATEWAY_ROLE_CHANGED`, alerte immédiate.
- `set_edge_gateway_role(p_gateway, p_role, p_label)` : refusée tant qu'un handover est ouvert pour l'événement ; refuse de créer un
  second `PRIMARY` ; **non accordée seule** (WP09 ne la donne à aucun rôle). Audit `EDGE_GATEWAY_ROLE_CHANGED`.
- Tous les `p_label` sont obligatoires et écrits dans l'audit (qui a fait quoi). Le secret ne passe jamais dans l'audit (aucun
  contenu de clé, seulement l'empreinte tronquée ou rien).

### T013 : `tests_edge_gateway.sql`

Gabarit `tests/tests_cash_sessions.sql` : `no_plan()`, `ROLLBACK`, deux prestataires A et B, données propres. Cas :

- les insertions du kit passent encore (`(id, operator_id, event_id, serial, role)` seules, deux `PRIMARY` du même événement) ;
- `force_central_authority` met la passerelle en `REVOKED` : `revoked_at` posé par le déclencheur, retour hors de `REVOKED` refusé ;
- DELETE refusé ; `UNIQUE (cert_sha256)` hors `REVOKED` ; une empreinte libérée par révocation peut être réinscrite ;
- `register` : second `PRIMARY` refusé ; mauvaises longueurs ; événement d'un autre prestataire (`no_data_found`) ; libellé vide ;
  audit et alerte présents ; `role_changed_at` posé. **Deux inscriptions « simultanées »** : une session pgTAP ne prouve pas la
  concurrence ; prouve (a) le refus séquentiel et (b) la prise du verrou (`pg_locks` du type `advisory` dans la transaction).
  La concurrence réelle (deux connexions) est demandée à l'orchestrateur et à WP25 : écris-le dans le rapport.
- `identify` : même erreur pour inconnue et `REVOKED` ; `touch` : `ISOLATED -> CATCHING_UP`, `REVOKED` inchangé ;
- `revoke` avec handover ouvert refusé ; `rotate` : ancienne empreinte refusée par `identify` ; `swap` atomique (jamais deux
  `PRIMARY`, jamais zéro) et refusé avec handover ouvert ; `set_role` refuse un second `PRIMARY` ;
- toutes les fonctions : `prosecdef`, `proconfig` avec `search_path`, aucune exécutable par `PUBLIC` (`has_function_privilege`).

## Tests attendus

- `packages/ledger-sql/tests/tests_edge_gateway.sql`, cas ci-dessus ; chaque test échoue sur une implémentation fausse (un
  `CHECK` sur `revoked_at`, un index unique de primaire, une erreur différente pour `REVOKED`).
- Tu ne lances pas pgTAP ni `reset-db` : l'orchestrateur les lance en série. Relis la syntaxe avec soin ; ne déclare pas « vert ».
- L'orchestrateur relancera `tests_grand_livre_cashless.sql`, `tests_definer_search_path.sql` et `tests_offline_snapshots.sql`
  SANS modification (A04) : c'est le critère d'acceptation principal du lot.

## Sécurité

- **À faire relire par une personne** : `0058` entier (règle 4 de `CLAUDE.md`) ; surtout `identify_edge_gateway` (porte d'entrée
  mTLS), `register_edge_gateway`, `swap_edge_gateway_roles`.
- Écart accepté et nommé : inscription par une seule personne (OP-N105, ADR-160). Test de borne de ce lot : alerte levée à
  l'inscription et au changement de rôle ; l'absence de colis avant 30 min est testée en WP08/WP15.
- `identify` ne doit révéler ni l'existence ni l'état d'une passerelle à un appelant sans certificat valide.
- Aucun secret en clair dans `audit_log`, messages d'erreur ou notifications.
- Règle 1 : tout écart qui affaiblit la sécurité (contrainte retirée, alerte omise, fonction ouverte plus largement) est soumis
  au porteur AVANT d'être codé.

## Definition of Done

- [ ] `0058_edge_gateway_admin.sql` applicable sur base propre ; en-tête (contraintes écartées et pourquoi, ordre des verrous).
- [ ] Toutes les fonctions : `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT`.
- [ ] Colonnes ajoutées nullables ou à défaut ; aucune contrainte interdite.
- [ ] `tests_edge_gateway.sql` écrit, couvrant chaque cas ; suites du kit non modifiées.
- [ ] Rapport : signatures réelles, contradictions (placement du retrait de l'écriture directe, rôles et `migrate.ts`,
      clé de snapshot, mécanisme d'alerte), fichiers à relire, ce qui n'a pas été lancé.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Insérer une passerelle comme le kit (cinq colonnes) : doit passer. Insérer deux `PRIMARY` du même événement directement : passe.
2. Appeler `register` deux fois pour le même événement en `PRIMARY` : le second échoue.
3. `identify` d'une empreinte `REVOKED` et d'une inconnue : messages et codes identiques.
4. Remettre une passerelle `REVOKED` en `ACTIVE` par `UPDATE` : refusé ; `DELETE` : refusé.
5. `rotate` : l'ancienne empreinte doit cesser d'identifier à la seconde même.
6. `swap` avec un handover ouvert, ou avec deux passerelles d'événements différents : refusé.
7. `register` avec un événement d'un autre prestataire ; avec un libellé vide ; avec une empreinte de 31 octets.
8. Lister les fonctions sans `search_path` ou exécutables par `PUBLIC`.
