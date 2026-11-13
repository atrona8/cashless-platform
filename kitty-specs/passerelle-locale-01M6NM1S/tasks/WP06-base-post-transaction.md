---
work_package_id: WP06
title: 'Base : enveloppe edge_post_transaction et bornes (migration 0061)'
dependencies: [WP04, WP05]
requirement_refs:
- FR-018
- FR-038
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T024, T025, T026, T027, T028]
phase: Phase 2 - Base du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0061_edge_post_transaction.sql
create_intent: [packages/ledger-sql/migrations/0061_edge_post_transaction.sql, packages/ledger-sql/tests/tests_edge_post_transaction.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0061_edge_post_transaction.sql, packages/ledger-sql/tests/tests_edge_post_transaction.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Base, enveloppe `edge_post_transaction` et bornes (migration 0061)

> **Corrections après analyse** : `contracts/interfaces.md` § 13.4 : `edge_platform_setting` remplace toute clé de configuration ; `tests_edge_post_transaction.sql` prouve le `CHECK value > 0`.


> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour `edge_platform_setting` et `set_edge_setting` (plafonds lus en table, sans paramètre).


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 5, 9, 13 et 14 ;
- `contracts/interfaces.md` § 1 (ligne 0061), § 2 (bloc WP06), § 7 (CL007, CL015 et noms d'alertes), § 8 (plafonds) ;
- `data-model.md` A.4 bis EN ENTIER (onze contrôles, dans cet ordre : il fait foi sur la liste), A.6 invariants 6, 8, 10 ;
- `research.md` R-09 en entier (enveloppe, garde, reprise de `edge_decision`, risque résiduel `EDGE_ONLINE`, perte maximale) ;
- constats `A06`, `A07`, `A08`, `A11` de `docs/passation-8/rapports/plan-adversarial.md` ; ADR-159 et OP-N104 ;
- code : `schema_grand_livre_cashless.sql` l. 510-640 (`post_transaction`, verrous, CL007), l. 1848 (`wallet_topup_headroom`),
  `migrations/0047_offline_anomalies.sql` (`open_offline_anomaly`, `reduce_offline_shortfall`), `migrations/0060_edge_sync_registry.sql`
  (WP05 : `edge_record_seq`, garde `EDGE_SYNC`), `migrations/0059_edge_handover.sql` (WP04), `migrations/0009_platform_scope.sql`
  (modèle de ligne de niveau plateforme) ; côté API, `apps/api/src/offline/**/offline-sale.writer.ts` et
  `ledger-engine.service.ts` (comment le moteur construit les lignes d'une vente), `packages/contracts/openapi.yaml` schéma
  `EdgeSyncOperation` (l. 14416) et `OfflineOperation`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Une passerelle compromise ne doit pouvoir écrire au central que ce que les bornes permettent. `edge_post_transaction` ne reçoit pas
de lignes libres : elle CONSTRUIT les lignes du portefeuille et de l'attente sous verrou de compte, ne prend du moteur que les
lignes de frais et de commission (validées), rogne l'excédent, plafonne les ventes de rejeu, exige la preuve du bracelet, et écrit
l'opération ET `edge_record_seq` dans UNE transaction. Aucun `GRANT`.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP06 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Dans le lot : `0061_edge_post_transaction.sql`, suite pgTAP **sous le propriétaire**. Fonction `SECURITY DEFINER`,
  `search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT`.
- Signature figée (`interfaces.md` § 2) : `edge_post_transaction(p_gateway, p_epoch, p_edge_seq, p_origin_key, p_content, p_op jsonb,
  p_fee_lines jsonb)` → `(outcome, transaction_id, reason, detail, charged_to_wallet, shortfall_amount)`. `research.md` R-09 donne une
  autre liste d'arguments (`p_media`, `p_amount`, `p_type`, `p_decision`...) : elle est périmée. Tout ce que R-09 y passait est ici DANS
  `p_op` (l'opération `EdgeSyncOperation` telle que reçue). Signale l'écart.
- **Plafonds (§ 8)** : `interfaces.md` dit que les plafonds sont « passés depuis une table de réglage de plateforme (WP06) » ET liste
  `EDGE_REPLAY_MAX_PER_SALE` / `EDGE_REPLAY_MAX_PER_TERMINAL_HOUR` comme clés de configuration du central (WP10). Les deux ne peuvent
  pas être la source. Retenu : la TABLE (lue dans la transaction, sans paramètre, inviolable par un appelant). Crée-la (ligne de niveau
  plateforme, `operator_id` NULL, modèle de 0009 : la `tenant_isolation` habituelle s'applique aux lignes de prestataire ; relis
  l'exception « toute table porte `operator_id` » et dis comment tu l'as traitée), valeurs initiales **50 000 XOF par vente et
  500 000 XOF par terminal et par heure** (décision du porteur du 05/11/2026), par devise ; devise sans plafond configuré : l'enveloppe
  REFUSE d'écrire (échec fermé). Aucune fonction d'écriture publique pour cette table dans ce lot. **Signale la double source à
  l'orchestrateur.**
- `CL007` : la borne 4 lit le solde sous verrou ; `CL007` ne doit pas survenir. Le traitement de A06 (une annulation entière, un
  rejeu, puis `REJECTED` / `INSUFFICIENT_FUNDS_RETRY`) est dans ce lot.
- Hors lot : activation, caution, recharge espèces (WP07), réception HTTP (WP13), preuve cryptographique du bracelet (le central
  la fait faire par le processus des clés, WP13 : ici l'enveloppe ne vérifie que les champs de l'objet `tap` déjà vérifiés et passés
  dans `p_op` ; décris précisément quels champs l'API doit fournir, dans l'en-tête de la migration).
- Valeurs d'énumération : AUCUNE ajoutée (A11). Réutilise `MALFORMED_OPERATION`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_FUNDS_RETRY`,
  `REVERSAL_TARGET_NOT_FOUND`. Les détails vont dans `detail`.

## Subtasks

### T024 : Construction des lignes, liste blanche, comptes attendus

Dans l'ordre de A.4 bis (contrôles 1, 2, 3 et 6 ici ; 4, 5 en T025 ; 7 en T026 ; 8 en T027).
- Vérifications d'enveloppe : `p_gateway = app.gateway_id` (`42501`), passerelle non `REVOKED` et `PRIMARY`, handover `TO_EDGE ACTIVE` ou
  `TO_CENTRAL RELEASE_REQUESTED|RELEASING` de CETTE passerelle pour son grand livre, `p_epoch` = époque du handover (`CL015`).
  `origin_key`, `origin_occurred_at`, `origin_mode` présents et bien formés ; écrits dans `journal_transaction.metadata`.
- Liste blanche de types : `PURCHASE`, `REVERSAL`, `DEPOSIT_TAKEN`, `TOPUP_CASH`, `PRELOAD` d'activation ; tout autre (`ADJUSTMENT`...) :
  `REJECTED` / `MALFORMED_OPERATION`. Un type `VOID` ne passe pas par l'écriture : enregistre le numéro (`VOID`) via `edge_record_seq`.
- Comptes de la forme attendue, lus EN BASE, jamais dans la requête : portefeuille = celui du bracelet désigné par `token_hash`
  dans le grand livre du handover ; compte marchand = celui du point de vente du terminal d'origine ; compte de caisse = celui de la
  session `OPEN` du terminal ; attente = `S-ATTENTE`. Somme nulle garantie par `post_transaction`.
- `edge_decision` obligatoire pour tout type qui porte un montant : absente ou incohérente (`charged + shortfall <> amount`,
  montant négatif, `shortfall_reason` absente) : `REJECTED` / `MALFORMED_OPERATION`, anomalie `NON_COMPLIANT_OPERATION`, RIEN d'écrit.
- Les lignes de frais et de commission viennent de `p_fee_lines`, validées par leur fonction (`purpose`) et par leur règle ; une ligne
  sur un autre compte que ceux de frais, de commission et de marchand : `REJECTED`. Les lignes du portefeuille et de l'attente ne sont
  JAMAIS reprises de `p_fee_lines`.
- Écriture par `post_transaction` en source `EDGE_SYNC` avec la clé d'origine du terminal `<serial>:<seq>` comme clé d'idempotence ;
  une clé déjà connue : `DUPLICATE` (avec la transaction existante). Puis, dans la MÊME transaction, `edge_record_seq`.
- Preuve du bracelet (contrôle 6) pour `PURCHASE` et `REVERSAL` de mode `EDGE_ONLINE` : objet `tap` obligatoire avec compteur
  strictement supérieur au dernier compteur du bracelet connu du central, UID égal à celui du bracelet, `token_hash` égal au portefeuille
  débité, et indicateur de signature vérifiée fourni par l'API. Sinon `REJECTED` / `MALFORMED_OPERATION`, anomalie `NON_COMPLIANT_OPERATION`.

### T025 : Verrou de compte, rognage, `S-ATTENTE`, anomalie, `CL007` traitée

- Verrouille les soldes payé et offert du portefeuille (`FOR UPDATE`) AVANT de les lire ; `charged_to_wallet` est rogné à la borne
  sous verrou (solde central disponible selon `spend_order`) ; l'excédent va en `S-ATTENTE`, raison `INSUFFICIENT_FUNDS`, résultat
  `ACCEPTED_WITH_SHORTFALL`, anomalie `OFFLINE_SHORTFALL` (via `open_offline_anomaly`, ne l'insère pas à la main). Une lecture suivie
  d'une écriture sans verrou est interdite. Ordre des verrous C-012 : consultatif d'autorité (celui de `post_transaction`) d'abord,
  puis lignes (grand livre, passerelle, handover), puis soldes.
- `CL007` en `EDGE_SYNC` (A06) : si elle survient quand même, la transaction de l'opération est annulée en entier (numéro non
  consommé), rejouée une fois ; si elle échoue encore, une seconde transaction enregistre le numéro par `edge_record_seq` avec
  `REJECTED` / `INSUFFICIENT_FUNDS_RETRY` (`retryable`) et une anomalie. Le vidage ne se bloque jamais ; un numéro n'est jamais consommé
  sans effet explicite. En plpgsql : sous-bloc `BEGIN ... EXCEPTION` (sous-transaction) pour l'annulation partielle.

### T026 : Plafonds par vente et par terminal et par heure, alerte

- Par vente (contrôle 3) : montant unitaire inférieur ou égal au plafond ; au-delà de ce plafond : part en `S-ATTENTE` (raison
  `INSUFFICIENT_FUNDS`, `detail` = `EDGE_REPLAY_CEILING`), jamais un rejet qui perdrait la trace.
- Par terminal et par heure glissante (contrôle 7) : somme des ventes `EDGE_ONLINE` du terminal, calculée sous verrou du terminal ;
  le dépassement n'est pas rejeté : la part au-delà va en `S-ATTENTE` (`INSUFFICIENT_FUNDS`, `detail = EDGE_REPLAY_CEILING`) avec
  une **alerte** `EDGE_REPLAY_CEILING` (audit + `pg_notify('edge_alert', ...)`, même mécanisme que WP03 : relis-le).
- Risque résiduel accepté (ADR-159, OP-N104) : perte maximale `P_max = min(Σ soldes ; T × H × plafond horaire ; passages réels × plafond
  par vente)`. Le test de bornes le mesure (voir plus bas).

### T027 : `REVERSAL` borné (A08), `DUPLICATE`

- `REVERSAL` : mêmes contrôles que l'annulation en ligne (cible existante dans le même grand livre, même portefeuille, jamais déjà
  annulée). Le crédit rendu au portefeuille est au plus le `charged_to_wallet` de la vente TELLE QU'ÉCRITE au central ; l'excédent annule
  la part restée en `S-ATTENTE` (`reduce_offline_shortfall`, ne l'écris pas à la main). Cible absente ou non écrite :
  `REJECTED` / `REVERSAL_TARGET_NOT_FOUND`. Même `reverses_seq` émis deux fois : `DUPLICATE`.
- Aucune création d'argent : somme des lignes nulle, crédit au portefeuille jamais supérieur au débit d'origine.

## Tests attendus : T028, `tests_edge_post_transaction.sql`

Gabarit `tests/tests_cash_sessions.sql` ; propriétaire seul ; un événement, une passerelle `PRIMARY` avec handover `ACTIVE`, un
portefeuille à solde connu, un terminal avec point de vente, une seconde passerelle d'un autre événement. Mesure les montants au centime.

- Vente complète, vente avec manque (rognage et `S-ATTENTE`, `ACCEPTED_WITH_SHORTFALL`, anomalie), vente de rejeu au-delà du plafond
  par vente et au-delà du plafond horaire (alerte levée, rien de perdu).
- **Tentatives hors périmètre, chacune refusée** : type `ADJUSTMENT` ; compte marchand ou de caisse forcé dans la requête ; lignes libres
  dans `p_fee_lines` sur le portefeuille ; autre grand livre ; autre passerelle ; passerelle `REVOKED`, `STANDBY` ; époque fausse (`CL015`) ;
  `edge_decision` incohérente ; vente sans `tap`, avec compteur non croissant, avec `token_hash` d'un autre portefeuille ; devise sans plafond.
- `CL007` simulée (solde modifié par une seconde session du test, si possible ; sinon par un portefeuille dont le solde est manipulé
  sous le propriétaire) : rejeu puis `INSUFFICIENT_FUNDS_RETRY`, numéro enregistré, jamais consommé sans effet.
- `REVERSAL` : crédit au plus égal à l'origine, cible absente, double annulation (`DUPLICATE`), annulation d'une vente en manque.
- Concurrence A06 : deux ventes sur le même portefeuille traitées l'une après l'autre dans le test ne dépassent jamais le solde central ;
  la preuve de verrouillage est la présence du `FOR UPDATE` (lis le plan ou `pg_locks`), dis ce que le test ne prouve pas.
- Passerelle hostile : 2 000 ventes fictives en boucle plpgsql ; la perte mesurée sur le portefeuille reste inférieure ou égale à
  `P_max` calculé par le test (indépendamment de la fonction). Écris le résultat dans le rapport.
- Somme nulle de toute transaction écrite, `metadata` complète (`origin_key`, `origin_occurred_at`, `origin_mode`), RLS et `search_path`.
- Chaque test doit échouer sur une implémentation fausse (lecture du solde sans verrou, plafond oublié, lignes reprises de la requête).
- Tu ne lances ni pgTAP ni `reset-db`. L'orchestrateur relance les suites du kit et de paiement.

## Sécurité

- **À faire relire par une personne** : tout `0061` (création d'argent, concurrence, bornes de la passerelle compromise).
- Écart accepté et nommé : ventes `EDGE_ONLINE` sans signature du terminal, perte maximale chiffrée (OP-N104, ADR-159). Test de borne
  qui échoue si la limite s'élargit : la perte hostile ci-dessus.
- Aucun rejet silencieux : tout excédent va en `S-ATTENTE` avec anomalie ; aucun numéro consommé sans résultat.
- La requête n'est jamais source d'un compte ni d'un montant de portefeuille : un seul champ repris de la passerelle, la décision, et
  elle est bornée sous verrou.
- Règle 1 : tout écart qui affaiblit la sécurité (borne retirée, plafond par défaut ouvert, lignes libres) est soumis au porteur
  AVANT d'être codé.

## Definition of Done

- [ ] `0061_edge_post_transaction.sql` applicable ; en-tête (ordre des verrous, champs de `tap` fournis par l'API, source des plafonds).
- [ ] `edge_post_transaction` à la signature figée ; `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT` ; aucune valeur d'énumération ajoutée.
- [ ] Onze contrôles de A.4 bis présents (sauf 9 à 11, WP07) et testés ; plafonds en table, échec fermé.
- [ ] `tests_edge_post_transaction.sql` écrit, tentatives hors périmètre et scénario hostile compris.
- [ ] Rapport : signature réelle, contradictions (arguments de R-09, double source des plafonds, tables sans `operator_id`), perte
      hostile mesurée, fichiers à relire, ce qui n'a pas été lancé.
- [ ] Aucun `.sql` généré modifié ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Une vente dont `edge_decision.charged_to_wallet` dépasse le solde central : rognée, l'excédent en `S-ATTENTE`, jamais d'argent créé.
2. Une requête qui nomme le compte marchand ou de caisse : ignoré ou refusé, jamais utilisé.
3. Un `REVERSAL` d'un montant supérieur à la vente d'origine, ou répété : borné ou `DUPLICATE`.
4. Passer `tap` sans compteur croissant, ou avec le `token_hash` d'un autre portefeuille.
5. Dépasser le plafond horaire : alerte levée, aucun rejet, aucune perte.
6. Deux écritures concurrentes sur un même portefeuille (deux connexions) : somme jamais supérieure au solde.
7. Vérifier que l'écriture et `edge_record_seq` sont dans la même transaction (une erreur après l'écriture annule les deux).
8. Rechercher toute valeur d'énumération ajoutée ou un `GRANT` dans la migration.
