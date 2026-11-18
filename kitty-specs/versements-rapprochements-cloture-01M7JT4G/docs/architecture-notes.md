# Notes d'architecture : mission versements-rapprochements-cloture-01M7JT4G

> État : **review terminée le 17/11/2026 (14 lots sur 14 approuvés), acceptée le 17/11/2026 (`15f1a19c`), consolidée sur `feat` (squash `b4b81d8c`), dans `main` par la PR #18 le 18/11/2026**. Recalé sur le code de la lane finale le 17/11/2026. Sources : `plan.md`, `research.md`, `data-model.md`, `contracts/`, code réel. Aucun conteneur
> nouveau : tout vit dans l'API centrale, le processus `maintenance` et la base existants. Seule « intégration » nouvelle : la copie externe des scellements, **simulée** jusqu'à la 12b.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **Modules de l'API centrale** (`apps/api/src/`, NestJS 11, TypeScript) : `closing/` (étapes, calculateurs partagés aperçu et exécution, soldes restants), `payouts/` (droits nets, action `PAYOUT`, export, confirmation), `reconciliation/` (import CSV, rapprochement), `late-claims/` (actions `LATE_CLAIM` et `ADJUSTMENT`), `statements/` (relevés, export comptable, `account_mapping`), `refunds/` (demande du back-office, OP-N124, OP-N126), `sealing/` (port, faux de copie externe, travailleurs de scellement et de vérification), `common/csv.ts` et `common/iban.ts`. Les travailleurs de contrôle vivent dans `processes/controls/` (et non dans un module `controls/`), le branchement dans `processes/maintenance.module.ts` et `processes/ops-alerts.ts`.
- **Base centrale** (PostgreSQL 17) : migrations réelles `0083` à `0088` (la numérotation du plan a changé) : `statement_import`, colonnes de `external_statement_line`, `import_statement_lines`, `match_statement_line`, `account_reconciliation` (`0083`) ; `closing_step` et conditions de statut (`0084`) ; colonnes de `payout`, `create_payout_batch`, `settle_payout`, `CL055` (`0085`) ; garde de `refund_request` et `refund_deposit*` à quatre arguments (`0086`) ; fonctions `ops_*` (`0087`) ; `account_mapping` (`0088`) ; nouvelle section de `post-roles.sql`. Schéma de référence et `.sql` générés intouchés.
- **Processus `maintenance`** : huit travailleurs (le plan disait neuf en n'en listant que huit) : `ledger-seal`, `audit-seal`, `seal-verify`, `ledger-controls`, `payout-overdue`, `statement-unmatched`, `open-anomalies`, `long-transactions`, tous démarrés par `MaintenanceProcessModule`, alertes par `ops_raise_alert` (audit, journal structuré `ALERT`, notification de la base), codes d'alarme 7 à 11.
- **Contrat `openapi.yaml`** : **ajouts seulement** (20 opérations, 3 valeurs de `StatusCondition.code`, code `PAYOUT_EXCEEDS_ENTITLEMENT`), validés par le porteur le 17/11/2026 ; premier lot IC-00. Aucune dépendance nouvelle (ADR-78).

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| Table `closing_step` et verrou par (événement, étape) (R-01) | Un rejeu recalculerait d'autres montants (`CL002`) ; tient 50 exécutions concurrentes | Clé d'en-tête seule |
| Un lot de versements = une demande d'approbation `PAYOUT` ; ligne `payout` créée à la validation (R-06) | Circuit à deux existant, lot immuable | Table `payout_batch` avec état `PREPARED` |
| Borne « montant ≤ droit net » en base : `create_payout_batch`, `CL055` (R-07) | Un contrôle d'API seul affaiblirait la SPEC | Contrôle dans le service |
| Rôle du versement selon le bénéficiaire, SPECIFICATION §3.2 amendée (décision du porteur) | Organisateur pour commerçants et organisateur, exploitant pour prestataire et plateforme | Un seul rôle pour tous |
| Droits réduits de `cashless_app` sur `payout` et `external_statement_line` (SELECT seul, écritures par fonctions) | Ils sont aujourd'hui modifiables en entier (même défaut qu'OP-N130) | Garder les droits |
| Rapprochement automatique par les références des tables sources, jamais par analyse de `idempotency_key` (R-08) ; en plus, même signe et montant égal au net ou au brut (décision 7, ADR-202) | Fiabilité ; frais PSP portés par l'organisateur ou le prestataire | Analyse des clés ; référence seule |
| `refund_request` verrouillée en tête de l'ordre des verrous dans `match_statement_line` et le rapprochement automatique (décision 14, ADR-203) | Ferme la course d'OP-N126 | Second valideur seulement |
| `result` des approbations masqué comme `payload` (OP-N147, ADR-211) | Un numéro de paiement restait lisible | Laisser tel quel |
| Fonctions `ops_*` exécutables par `cashless_maint` seul, sans lecture de table (R-11 à R-13) | Le rôle doit sceller et contrôler tous les prestataires sans `SELECT` | Donner `SELECT` au rôle |
| Transactions longues : fonction dédiée sans texte de requête, pas de `pg_read_all_stats` (C-011) | Le texte d'une requête peut contenir des données | Droit de lecture des statistiques |
| Copie externe des scellements simulée, refusée en production (C-006) ; alertes sans envoi réel (C-010) | Adaptateurs réels en 12b | Attendre la 12b |
| Conditions de statut redéfinies dans leurs deux copies avec test d'égalité (R-05) | `set_event_status` écrit, `event_transition_conditions` affiche | Les fusionner |

## Dette de sécurité et fichiers à faire relire

**Écarts acceptés à consigner** (OP + ADR + test + PRD et PROMPTS) : copie externe simulée (levée 12b), alertes sans envoi (levée 12b). **Renforcements** (faits puis consignés) : borne du droit net, droits réduits, garde de portée des lignes de relevé, `refund_deadline` exigée avant `CLOSED`, caisse ouverte bloquant `RECONCILING`, étapes exigées, transitions de `refund_request` gardées par la base. **Levées** : OP-N123, N124, N126, N128, N130, N147. **Écarts acceptés en plus** : OP-N139 (mobile money vers un autre numéro sans code, ADR-207), OP-N140 à N145 (voir `docs/POINTS_OUVERTS.md`). **À faire relire par une personne** : toutes les migrations, section 12 de `post-roles.sql`, `create_payout_batch`, `settle_payout`, `import_statement_lines`, `match_statement_line`, fonctions `ops_*`, `isValidIban`, écriture CSV.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » et ligne de détail de la mission. La vue C4 n'est pas modifiée (aucun conteneur nouveau ; la copie externe simulée relève du système « stockage S3 » déjà au diagramme).

## Nécessaire pour cette mission ? Oui : décisions de sécurité (droits, borne, verrous, copie simulée, fonctions de maintenance) et sept nouveaux modules, sans nouveau conteneur (réponse proposée par l'Agent le 17/11/2026, à confirmer par le porteur).
## Complet ? Oui : migrations, chemins et travailleurs recalés sur le code livré (proposition de l'Agent, confirmée par le porteur le 17/11/2026).
## Validé par : proposition de l'Agent, confirmée par le porteur le 17/11/2026.
