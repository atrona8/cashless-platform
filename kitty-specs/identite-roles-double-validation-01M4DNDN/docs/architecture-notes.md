# Notes d'architecture — mission identite-roles-double-validation-01M4DNDN

> État : **plan finalisé** (2026-10-08). Source : `plan.md`, `research.md`, `data-model.md`, `contracts/`.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **`apps/api/src/identity/`** : vérification des jetons OIDC (`jose`, clés publiques en cache), garde
  d'authentification globale, `Principal`, fournisseur de prestataire de production (remplace le refus
  systématique de la mission 1), `@Roles` et résolution des portées, routes de gestion des personnes et des rôles.
- **`apps/api/src/approval/`** : registre générique des actions à deux, demandes (`202`), décision et exécution
  unique, 4 routes `/approval-requests`, garde du jeton d'approbation sur place.
- **`apps/api/src/audit/`** : écriture des lignes d'audit dans la transaction de l'action.
- **`apps/api/src/idempotency/`** (mission 1) : problème « validé » enregistré dans la transaction ; garde RISK-2.
- **`packages/ledger-sql`** : migrations `0003` (personnes, attributions, `identify_person`), `0004` (journal
  d'audit chaîné, scellements, vérification), `0005` (`approval_request.result`, utilisations de jetons) ;
  `post-roles.sql` rejoué après `roles.sql` ; commande d'amorçage.
- **`packages/contracts/openapi.yaml`** : 7 routes de gestion des personnes et des rôles ; formule de `act_hash`.
- **Serveur d'identité OIDC** (externe) : nouveau système externe, produit à choisir ; faux serveur dans les tests.

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| Jeton OIDC vérifié par `jose` ; rôles et prestataire lus en base (`identify_person`) | Le jeton ne prouve que l'identité ; retrait de rôle immédiat | Rôles dans les claims ; vérification JWT maison |
| Prestataire d'un `PLATFORM_ADMIN` = objet du chemin (`/operators/{operator_id}/…`) | Jamais de paramètre libre ; autres personnes limitées à leur prestataire (`404`) | Paramètre de requête ; en-tête de sélection |
| Approbation : décision + exécution dans une seule transaction, échec dans un point de sauvegarde | Aucune demande `APPROVED` orpheline, aucune écriture partielle | Décision et exécution séparées |
| Journal d'audit chaîné par prestataire, scellé, en ajout seul (choix du porteur) | Altération détectable même par un administrateur de la base | Ajout seul uniquement (spécification initiale) |
| `post-roles.sql` rejoué après `roles.sql` | Retirer les droits trop larges donnés par `roles.sql` sans modifier ce fichier du kit | Modifier `roles.sql` |
| Colonne `approval_request.result` ajoutée par migration | Contradiction contrat / schéma (le contrat renvoie `result`) | Ne pas renvoyer `result` |

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, tables **« Décisions d'architecture notables »** et **« Détail par
mission »** ; `docs/03-context-diagram.md` (serveur d'identité OIDC, déjà présent comme système externe).

## Nécessaire pour cette mission ? Oui — nouveaux modules de l'API, nouvelles tables, nouvelle dépendance externe.
## Complet ? Partiel — décisions du plan ; à confirmer à la review.
## Validé par : agent, par délégation du porteur du projet (08/10/2026)
