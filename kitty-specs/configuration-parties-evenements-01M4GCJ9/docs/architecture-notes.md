# Notes d'architecture — mission configuration-parties-evenements-01M4GCJ9

> État : **plan finalisé** (2026-10-09).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- Base centrale : migrations `0007` (intégrité et immuabilité de la configuration), `0008` (`open_event_ledger`,
  `open_participation_account`, `event_transition_conditions`), `0009` (portée plateforme de l'idempotence et des
  approbations) ; `post-roles.sql` : second rôle de base `cashless_platform` et ses politiques RLS nominatives.
- API centrale : second pool et `PlatformTx` ; modules `configuration/` (catalogue des réglages, cascade versionnée,
  bornes, valeurs provisoires, règles de frais, `SqlConfigResolver`), `organization/` (prestataires, organisateurs,
  commerçants, contrats), `events/` (événements, participations, points de vente, statuts) ; huit actions à deux.
- Contrat : ~45 opérations back-office ajoutées à `openapi.yaml`, types régénérés.

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

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions d'architecture notables ».

## Nécessaire pour cette mission ? Oui — nouveau rôle de base, nouveau pool et trois modules.
## Complet ? Oui au stade du plan.
## Validé par : Agent, par délégation du porteur (09/10/2026)
