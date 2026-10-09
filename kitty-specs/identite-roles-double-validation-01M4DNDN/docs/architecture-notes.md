# Notes d'architecture — mission identite-roles-double-validation-01M4DNDN

> État : **review terminée** (2026-10-09, 10/10 WP approuvés), recalé sur le code livré. Sources : `plan.md`,
> `research.md` (dont « Contradictions constatées à l'implémentation »), code des lanes.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **`apps/api/src/identity/`** : vérification des jetons OIDC (`jose` 6.2.12, clés publiques en cache), garde
  d'authentification globale, `Principal`, `IdentityTenantContext` (remplace le refus systématique de la mission 1),
  `@Roles` + `RolesGuard` et résolution des portées (`scope-resolver`), `users/` : 7 routes de gestion des personnes
  et des rôles (règles « qui peut donner quoi » dans `role-rules.ts`). `IdentityModule` est global.
- **`apps/api/src/approval/`** : registre générique des actions à deux (`registerApprovalActions(...)`, module
  dynamique par mission), demandes (`202`), décision et exécution unique, 4 routes `/approval-requests` ;
  `onsite/` : `@RequiresOnsiteApproval`, `act_hash`, consommation du jeton dans la transaction métier.
- **`apps/api/src/audit/`** : écriture des lignes d'audit dans la transaction de l'action.
- **`apps/api/src/idempotency/`** (mission 1) : `CommittedProblem` (problème validé avec le travail) ; garde
  `@Idempotent({ writes })` et test d'architecture RISK-2 ; conservation des clés portée à 30 jours (ADR-79).
- **`apps/api/src/db/tenant-tx.ts`** (mission 1) : deux exceptions documentées à « tout passe par `run` » :
  `identify` (lecture seule par `identify_person`) et `withoutTenant` (seulement `create_platform_admin`).
- **`packages/ledger-sql`** : migrations `0003` (personnes, attributions, `identify_person`), `0004` (journal
  d'audit chaîné, scellements, vérification), `0005` (`approval_request.result`, utilisations de jetons) ;
  `0006` (`create_platform_admin`, SECURITY DEFINER) ; `post-roles.sql` rejoué après `roles.sql` ; commande
  d'amorçage `bootstrap-admin`.
- **`packages/contracts/openapi.yaml`** : 7 routes de gestion des personnes et des rôles (tag `Personnes`) ;
  formule de `act_hash` ; conventions corrigées (exception `/operators/{operator_id}/…`, rôles jamais tirés du
  jeton).
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
| *(implémentation)* Administrateur de la plateforme créé par `create_platform_admin` (SECURITY DEFINER, droit lu en base), `POST /platform-admins` sans `Idempotency-Key` | Une personne de plateforme est invisible et non insérable sous RLS ; `api_idempotency` exige un prestataire | Rôle propriétaire dans l'API ; clé d'idempotence sans prestataire |
| *(implémentation)* Actions à deux enregistrées par module dynamique `registerApprovalActions(...)` | Nest n'a pas de multi-fournisseur ; doublon = démarrage refusé | Jeton `APPROVAL_ACTIONS` multi-fournisseur (inexistant) |
| *(implémentation)* `IdentityModule`, `AuditModule`, `ApprovalModule` globaux | Tout module métier injecte `TENANT_CONTEXT`, l'audit et la double validation | Import explicite dans chaque module |

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, tables **« Décisions d'architecture notables »** et **« Détail par
mission »** ; `docs/03-context-diagram.md` (serveur d'identité OIDC, déjà présent comme système externe).

## Nécessaire pour cette mission ? Oui — nouveaux modules de l'API, nouvelles tables, nouvelle dépendance externe.
## Complet ? Oui — recalé sur l'implémentation (écarts : migration `0006`, exceptions `TenantTx`, enregistrement
## des actions, modules globaux ; voir `research.md`, contradictions C-01 à C-15).
## Validé par : agent, par délégation du porteur du projet (09/10/2026)
