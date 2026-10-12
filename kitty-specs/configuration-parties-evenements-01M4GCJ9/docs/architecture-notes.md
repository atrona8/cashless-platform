# Notes d'architecture — mission configuration-parties-evenements-01M4GCJ9

> État : **review terminée** (2026-10-12) — 13/13 WP approuvés ; recalé sur le code livré (lane finale, avant acceptation et fusion).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- Base centrale : migrations `0007` (intégrité et immuabilité de la configuration), `0008` (`open_event_ledger`,
  `open_participation_account`, `event_transition_conditions`), `0009` (portée plateforme de l'idempotence et des
  approbations, `platform_session()`, `decide_approval_request` remplacée) ; `post-roles.sql` : second rôle de base
  `cashless_platform`, droits remis à zéro puis accordés un par un, politiques RLS permissives **et restrictives**
  par table ; politiques restrictives côté `cashless_app` (aucune écriture de niveau `PLATFORM`).
  Suites pgTAP : 10 fichiers, 947 assertions.
- API centrale : second pool et `PlatformTx` ; modules `configuration/` (catalogue des réglages, cascade versionnée,
  bornes, valeurs provisoires, règles de frais, `SqlConfigResolver`), `organization/` (prestataires, organisateurs,
  commerçants, contrats), `events/` (événements, participations, points de vente, statuts) ; huit actions à deux
  (`PLATFORM_CONTRACT_VERSION`, `JURISDICTION_LIMITS_CHANGE`, `CONTRACT_VERSION`, `EVENT_SETTINGS_CHANGE`,
  `EVENT_OPERATOR_SETTINGS_CHANGE`, `PARTICIPATION_CHANGE`, `FEE_RULE_CHANGE`, `EVENT_GO_LIVE`). Le moteur
  d'écritures de la mission 1 porte désormais `fee_rule_id` sur chaque ligne de frais (47 suites Jest, 873 tests).
- Contrat : 48 opérations back-office sur 28 chemins ajoutées à `openapi.yaml` (107 chemins au total), 33 schémas,
  `Problem.violations`, types régénérés ; les 48 opérations sont toutes servies.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Rôle de base distinct `cashless_platform` + second pool pour les écritures de plateforme | Lettre de §2.2, choix du porteur | `SECURITY DEFINER` (précédent de la mission 2), `BYPASSRLS` |
| Politiques RLS nominatives et droits du rôle plateforme posés dans `post-roles.sql` | Une migration ne peut nommer un rôle absent d'une base neuve | Politiques dans les migrations (échec sur base neuve) |
| `operator_id` NULL = plateforme dans l'idempotence et les demandes d'approbation | Clé d'idempotence et double validation aussi au niveau plateforme | Tables parallèles |
| Grand livre et comptes ouverts par fonctions SQL `SECURITY INVOKER` à la création de l'événement / de la participation | Plan de comptes en un seul endroit, atomicité, RLS conservée | Création en TypeScript |
| Catalogue des réglages en TypeScript ; colonnes d'`event` + instantané dans chaque version `EVENT` | Bornes et messages centralisés ; `config_version_id` redonne tous les réglages | Tout en JSON ou tout en colonnes |
| Routes back-office sous `/operators/{operator_id}/…` | Supervision par la plateforme, cohérence avec la mission 2 | Routes plates |
| Implémentation réelle du port `ConfigResolver` (mission 1) | `config_version_id` et `fee_rule_id` réels ; rejeu du scénario sur une configuration construite par l'API | Fixtures seules |
| `platform_session()` compare `session_user` au nom fixe `cashless_platform` ; CHECK d'équivalence « portée plateforme ⇔ `operator_id` NULL » | Aucun réglage de session ne suffit à se dire plateforme (ADR-80) | Variable de session seule |
| Un réglage n'est modifiable que par le rôle que le catalogue désigne ; mélange de rôles dans une même demande refusé (422) | Chaque réglage a un seul responsable (ADR-81) | Hiérarchie de rôles implicite |
| Frais du PSP = règle de frais `EVENT` dont le bénéficiaire est `PSP:<canal>` ; repli sur la plus ancienne version de configuration | Rejeu exact des 48 transactions du scénario sur une configuration construite par l'API (ADR-82) | Table de frais PSP dédiée |
| Pagination par curseur opaque fondé sur un décalage | Suffisant aux volumes du back-office | Curseur par clé |

## Écarts entre le plan et le code livré
- `cashless_platform` garde `EXECUTE` sur les fonctions d'API du schéma via `PUBLIC` : la suite de référence
  l'exige (SPECIFICATION §0.3) ; limite acceptée par le porteur le 12/10/2026 et consignée dans l'ADR-80.
- Politiques restrictives ajoutées en review (WP03, un cycle de rejet) : le rôle applicatif pouvait insérer une
  version de configuration `PLATFORM` ; `party_kind_of` retirée à `cashless_app`.
- Option d'idempotence `platform: 'principal'` pour `/approval-requests` (portée déduite de la personne).
- Le plan supposait que les constructeurs d'écritures posaient déjà `fee_rule_id` : le moteur a été complété (WP12).
- Champs omis d'un profil de législation = valeurs provisoires de §17.2, signalées ; statut dans `updateEvent` → 400 ;
  rien n'est modifiable hors demande à deux une fois l'événement `LIVE`.
- Deux versions concurrentes : la perdante reçoit 409 (`CL001` traduit) ; date d'effet par défaut posée par l'horloge
  de la base, jamais antérieure à la version précédente.
- 48 opérations au lieu des « ~45 » annoncées.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions d'architecture notables ».

## Nécessaire pour cette mission ? Oui — nouveau rôle de base, nouveau pool et trois modules.
## Complet ? Oui — recalé sur le code livré (review terminée).
## Validé par : Agent, par délégation du porteur (12/10/2026, « ok tu peux continuer par toi mm maintenant »)
