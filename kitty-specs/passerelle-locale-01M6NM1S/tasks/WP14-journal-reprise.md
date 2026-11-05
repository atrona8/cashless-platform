---
work_package_id: WP14
title: Reprise forcée et journal des terminaux
dependencies: [WP11, WP13]
requirement_refs:
- FR-028
- FR-029
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T063, T064, T065]
phase: Phase 3 - API du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/processing/online-ref-resolver.ts
create_intent: [apps/api/src/offline/processing/online-ref-resolver.ts, apps/api/src/edge/journal/forced-takeover.reader.ts, apps/api/src/edge/journal/edge-replay-anomaly.ts, apps/api/src/edge/journal/edge-journal.module.ts, apps/api/test/integration/edge/journal/online-ref-unknown.spec.ts, apps/api/test/integration/edge/journal/forced-takeover-journal.spec.ts, apps/api/test/integration/edge/journal/no-silent-loss.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/edge/journal/**, apps/api/src/offline/processing/online-ref-resolver.ts, apps/api/test/integration/edge/journal/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 : Reprise forcée et journal des terminaux

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte (`docs/passation-8/contexte-m8.md`, **décision 4**), ce prompt, puis seulement :

- `contracts/interfaces.md` § 2 (WP04 : `force_central_authority_approved` ; WP07 : `edge_activate_media`, `edge_take_deposit`, `edge_topup_cash`), § 7 (noms d'audit et d'alertes), § 11 ;
- `research.md` **R-23** (en entier : c'est la spécification de ce lot), R-10 (clé d'origine, rejeu impossible, A10), R-30 ; `data-model.md` A.4 bis (points 9 à 11), A.6 (invariant 3) ;
- constats `A09`, `A10`, `A24` de `docs/passation-8/rapports/plan-adversarial.md` ;
- `docs/sync_protocol.md` §9 (cas passerelle perdue) et §8 (anomalies, tableau des plafonds) ;
- code existant de la mission 7, à **étendre sans changer son contrat** : `apps/api/src/offline/processing/offline-operation.processor.ts` (lignes 148-149 et 235 : `ONLINE_REF` donne `VOID` /
  `ONLINE_NOT_EXECUTED` ; ligne 142 : `TOPUP_CASH` donne `OFFLINE_NOT_ALLOWED`), `processing/compliance-input.reader.ts`, `offline/journal/journal-import.service.ts`, `journal-import.worker.ts`,
  `offline/anomalies/` (types d'anomalies et leur ouverture), `apps/api/test/integration/offline/journal-world.ts` et `journal-import.spec.ts` (décor de test à réutiliser).

## Objectif

Après une **reprise forcée** (passerelle perdue avant le rejeu de sa file), les terminaux renvoient tout leur journal non acquitté. Le central doit y reconnaître ce qui a déjà été rejoué (aucun bruit) et **ouvrir une anomalie pour tout ce qui ne l'a pas été**,
avec le montant, le terminal et la clé d'origine : **aucune perte silencieuse**. Pas de changement de contrat. Rétablissement manuel, résolution à deux.

## Branch Strategy

- Branche de planification : `feat/passerelle-locale`. Branche de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane selon `kitty-specs/passerelle-locale-01M6NM1S/lanes.json`.

## Commande d'implémentation

```bash
LC_ALL=C LANG=C spec-kitty agent action implement WP14 --agent claude --mission passerelle-locale-01M6NM1S
```

## Règles du lot

- Tu ne lances ni Jest, ni pgTAP, ni `reset-db`. Tu ne commites pas. Tu ne touches pas à l'API du port 80. Aucune migration, aucun `GRANT`, aucun `.sql` généré. Lignes de 100 caractères, français, sans tiret cadratin.
- Aucun nouveau code d'erreur, aucune valeur d'énumération de contrat ajoutée. Types d'anomalie : `EDGE_REPLAY_FAILED` et `NON_COMPLIANT_OPERATION` existent déjà (schéma, `0038`) ; si un type manque, **arrête-toi** (une migration serait
  hors de ce lot et touche l'énumération).
- **Fichier hors carte inévitable** : `offline-operation.processor.ts` (code de la mission 7) doit appeler le résolveur aux lignes 148-149 et 235, et à la ligne 142 pour `TOPUP_CASH`. Ce fichier n'est dans aucune carte de lot et n'est pas dans
  `interfaces.md` § 11. **Demande l'accord de l'orchestrateur, puis limite la retouche à ces trois appels** (trois lignes ajoutées, aucune règle déplacée). Sans accord, livre le résolveur et ses tests contre un point d'appel simulé et signale-le.
- Un écart qui affaiblit la sécurité s'arrête et remonte au porteur (CLAUDE.md, règle 1).

## T063 : Références inconnues : `ONLINE_REF` à une opération que le central ne connaît pas

**But.** `online-ref-resolver.ts` : une fonction pure autour d'une lecture, `resolveOnlineRef(client, ctx, op)`, qui décide pour une entrée `ONLINE_REF` (activation `ACTIVATION` ou caution `DEPOSIT`, valeurs à relire dans le schéma `OfflineOperation`)
si elle est **inconnue du central dans un contexte de reprise forcée**.

**Critère exact (R-23).** Il faut les trois à la fois : (1) la clé d'origine `<serial>:<seq>` (R-10, A10) n'existe pas au central, ni dans le registre des écritures `EDGE_SYNC` (`UNIQUE (ledger_id, idempotency_key)`), ni dans le registre d'idempotence de la route en ligne ;
(2) le terminal appartient à un événement dont la passerelle est `REVOKED` et dont le dernier handover `TO_EDGE` est `FORCED` ; (3) l'opération date d'un moment où l'autorité était `EDGE` (borne : `occurred_at` ≥ l'accord du handover). Sans les trois, le
comportement actuel est conservé à l'identique (`VOID` / `ONLINE_NOT_EXECUTED`, sans anomalie).

**Résultat.** Pour un critère rempli : résultat `VOID` / `ONLINE_NOT_EXECUTED` **comme aujourd'hui** (pas de changement de contrat) **et** une anomalie `EDGE_REPLAY_FAILED` portant : bracelet, terminal, clé d'origine, et `amount` = la caution connue du terminal si présente. Ouverture
par le mécanisme existant d'anomalies (`openAnomaly` ou son équivalent dans `offline/anomalies/`), jamais par `INSERT` direct.

**Arbitrages.**
- Une activation **déjà rejouée** avant la perte de la passerelle est retrouvée par sa clé `<serial>:<seq>` (A10) : **aucune anomalie**, pas même un résultat différent d'aujourd'hui (`DUPLICATE` ou référence reconnue). C'est le piège principal : tester le journal complet, pas l'entrée isolée.
- La caution d'une activation porte `<serial>:<seq>#deposit`. Le résolveur cherche les deux clés (l'une ne doit pas faire croire que l'autre manque).
- Le résolveur ne lit que par `cashless_app` : ses lectures passent par les tables visibles sous RLS (`edge_gateway`, `debit_authority_handover`) ; il n'ajoute ni droit ni fonction. Si une lecture exige un droit absent de la liste figée de WP09, **signale-le, ne l'élargis pas**.
- Idempotence : le même journal importé deux fois n'ouvre pas deux anomalies pour la même clé d'origine (clé d'anomalie dérivée de la clé d'origine ; contrôle par l'unicité existante ou par une lecture sous verrou).

## T064 : Journal après reprise forcée : `DUPLICATE`, `TOPUP_CASH`, anomalie avec montant

**But.** Le traitement du journal importé (`journal-import.service.ts`) et du lot hors ligne appelle le résolveur ; couvre aussi `TOPUP_CASH`.
- `DUPLICATE` : une opération du journal dont la clé a déjà été rejouée par la passerelle donne `DUPLICATE`, sans anomalie. Rien à changer, mais à **prouver** sur un journal mêlant rejouées et non rejouées.
- `TOPUP_CASH` du journal d'un terminal d'une passerelle perdue : suit le refus existant, `REJECTED` / `OFFLINE_NOT_ALLOWED` (C-006), **avec** une anomalie `NON_COMPLIANT_OPERATION` portant le montant, le terminal et la clé d'origine. L'argent encaissé
  est dans la caisse physique : l'anomalie est ce qui le rend visible ; elle se résout à deux personnes (`ANOMALY_RESOLUTION`, déjà en place). Aucune écriture comptable automatique.
- Critère de reconnaissance : même qu'en T063 (passerelle `REVOKED` et `FORCED` pour ce terminal). Un `TOPUP_CASH` d'un terminal ordinaire, hors reprise forcée, garde exactement le comportement actuel (rejet sans anomalie nouvelle).

**Cas limites.**
- Montant d'une caution inconnu du terminal : l'anomalie porte `amount` nul **et** le détail « montant inconnu », jamais un montant deviné.
- Terminal révoqué entre-temps : le journal est refusé comme aujourd'hui (aucun changement), sans anomalie.
- Plusieurs terminaux de la même passerelle : une anomalie par opération non rejouée, regroupées par un identifiant de lot de reprise pour la résolution (utilise le champ de contexte existant des anomalies, n'en crée pas).
- Reprise forcée **avant** tout accusé de bascule (`GRANTED` forcé) : aucune opération de passerelle n'a pu exister ; aucun `EDGE_REPLAY_FAILED` ne doit s'ouvrir (borne 3 du critère).

## T065 : Aucune double écriture, aucune perte silencieuse

**But.** Une suite de bout en bout qui compte : après reprise forcée et import des journaux, pour chaque opération du monde de test (rejouée, non rejouée, recharge, activation, caution, vente), **exactement un** des états suivants existe : une écriture au grand livre, un `DUPLICATE`,
une anomalie ouverte portant le montant. Jamais zéro, jamais deux. `edge-replay-anomaly.ts` factorise la fabrication de l'anomalie (champs communs de T063 et T064).

## Tests attendus

Dans `apps/api/test/integration/edge/journal/` (décor : `JournalWorld`, `ProcessingWorld` de la mission 7 ; l'orchestrateur lance) :

- `online-ref-unknown.spec.ts` : `ONLINE_REF` d'une activation inconnue, passerelle `FORCED` : `VOID` / `ONLINE_NOT_EXECUTED` + anomalie `EDGE_REPLAY_FAILED` avec bracelet, terminal, clé, montant ; même entrée sans reprise forcée : `VOID` sans anomalie (comportement d'avant
  **strictement inchangé**) ; activation déjà rejouée par la passerelle : aucune anomalie ; caution `#deposit` rejouée mais activation non rejouée : une anomalie, pas deux ; deuxième import du même journal : pas de seconde anomalie.
- `forced-takeover-journal.spec.ts` : journal mêlant dix opérations rejouées et trois non rejouées (une activation, une caution, une recharge) : trois anomalies, zéro bruit sur les dix ; `TOPUP_CASH` : `REJECTED` / `OFFLINE_NOT_ALLOWED` + `NON_COMPLIANT_OPERATION` avec montant ;
  même `TOPUP_CASH` hors reprise : sans anomalie ; passerelle simplement `REVOKED` (inscription retirée) sans handover forcé : comportement d'avant ; résolution à deux : un seul résolveur refusé.
- `no-silent-loss.spec.ts` : bilan par opération (une écriture ou `DUPLICATE` ou anomalie, jamais zéro ni deux) sur un monde complet avec lots hors ligne **et** journal importé ; rejouer l'ensemble deux fois ne change pas le bilan.

Chaque test doit échouer sur une implémentation fausse : un résolveur qui ouvre une anomalie pour toute `ONLINE_REF` inconnue rend rouge le cas « activation déjà rejouée » et le cas « sans reprise forcée » ; un résolveur qui ne cherche pas la clé `#deposit` rend rouge le cas caution.

## Sécurité

- Pas de perte silencieuse : c'est la propriété de sécurité de ce lot (argent et espèces). Ne remplace jamais une anomalie par un journal d'application.
- L'anomalie porte des identifiants et des montants, **pas** de contenu d'opération complet ni de secret de bracelet.
- Le critère de reprise forcée n'élargit aucun droit de lecture et ne dépend pas d'une valeur fournie par le terminal : état de la passerelle et du handover lus en base.
- Fichiers à faire relire par une personne : `online-ref-resolver.ts` (critère de reconnaissance) et la retouche du processeur.

## Definition of Done

- [ ] Résolveur livré, critère à trois conditions, comportement d'avant strictement inchangé hors reprise forcée.
- [ ] Journal après reprise forcée : rejouées sans bruit, non rejouées en anomalie avec montant, `TOPUP_CASH` en `NON_COMPLIANT_OPERATION` avec montant.
- [ ] Bilan sans double écriture ni perte, rejouable deux fois.
- [ ] Retouche du processeur limitée aux trois appels, accord de l'orchestrateur noté ; sinon point signalé.
- [ ] Suites de la mission 7 inchangées (non-régression, lancée par l'orchestrateur).

## Ce que le relecteur doit casser

- Importer le même journal trois fois ; l'importer par deux terminaux en parallèle.
- Faire reconnaître comme « inconnue » une activation qui a réussi au central en ligne (clé dans le registre d'idempotence de la route).
- Forcer la reprise juste après `GRANTED`, avant l'accusé, puis importer un journal : aucune anomalie ne doit s'ouvrir.
- Un `TOPUP_CASH` d'un terminal ordinaire : aucun changement de comportement.
- Chercher un `INSERT` direct dans les anomalies et une valeur de contrat nouvelle.

## Contradictions relevées entre les sources (aucune n'est corrigée ici)

- `tasks.md` donne à WP14 `online-ref-resolver.ts` mais ni le processeur de la mission 7 ni `journal-import.service.ts` qui doivent l'appeler ; `interfaces.md` § 11 ne les liste pas. Accord de l'orchestrateur requis (voir « Règles »).
- `research.md` R-23 parle de « passerelle `REVOKED`/`FORCED` pour ce terminal » : un terminal n'est lié qu'à un événement, pas à une passerelle. Le critère ci-dessus le lit au niveau de l'événement. À confirmer.
- `tasks.md` WP14 dépend de WP11 et WP13 mais le lot suppose aussi les enveloppes de WP07 (clé d'origine, rejeu impossible) : acquises par WP09, donc sans effet sur l'ordre, signalé par prudence.
- `research.md` R-23 cite `journal-import.service.ts` « FR-029 » ; le critère de reconnaissance (3) est une précision de ce prompt, absente de R-23.
