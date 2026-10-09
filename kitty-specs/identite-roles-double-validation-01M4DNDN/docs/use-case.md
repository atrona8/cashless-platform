# Cas d'usage — mission identite-roles-double-validation-01M4DNDN

> État : **mergée** (2026-10-09, squash `c2f3934`) ; review terminée (2026-10-09, 10/10 WP approuvés), recalé sur le code livré.

## Cas d'usage propres à cette mission

```mermaid
flowchart LR
    Personne([Personne du personnel])
    Admin([Administrateur])
    Auteur([Auteur])
    Valideur([Valideur])
    Exploit([Exploitant])
    Controleur([Contrôleur])

    UC1((Se connecter<br/>et agir))
    UC2((Gérer personnes<br/>et rôles))
    UC3((Demander une<br/>action à deux))
    UC4((Approuver ou<br/>refuser))
    UC5((Valider sur place<br/>au guichet))
    UC6((Amorcer le premier<br/>administrateur))
    UC7((Vérifier le journal<br/>d'audit))

    Personne --> UC1
    Admin --> UC2
    Auteur --> UC3
    Valideur --> UC4
    Valideur --> UC5
    Exploit --> UC6
    Controleur --> UC7
    UC3 -.include.-> UC4
```

| Cas d'usage | Ce qui le prouve |
|---|---|
| Se connecter et agir | Jeton d'accès vérifié ; prestataire et rôles tirés de la base ; refus `401` de chaque défaut ; isolation à deux prestataires |
| Gérer personnes et rôles | 7 routes du contrat (`/operators/{operator_id}/users…`, `/platform-admins`) ; table de vérité « qui peut donner quoi » ; une ligne d'audit par action réussie, aucune sur refus. Limite : aucune route ne retire ni ne désactive un `PLATFORM_ADMIN` (C-10) |
| Demander une action à deux | `202 Accepted`, demande `PENDING` figée (action de démonstration en test) |
| Approuver ou refuser | Rôle sur la même portée ; auteur refusé `409` ; exécution unique ; `EXECUTED` / `FAILED` / `REJECTED` |
| Valider sur place au guichet | `X-Approval-Token` : `APPROVAL_REQUIRED` / `APPROVAL_INVALID`, usage unique, lié à la requête |
| Amorcer le premier administrateur | `npm run bootstrap-admin` idempotent et journalisé ; les suivants par `POST /platform-admins` |
| Vérifier le journal d'audit | `verify_audit_chain`, `seal_audit` (rôle propriétaire) : parcours de bout en bout vérifié et scellé sans anomalie ; altérations simulées détectées (copie externe : mission 9) |

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, vue **« administration (back-office) »** (gestion des personnes et des
rôles, double validation) ; ligne ajoutée au tableau « Détail par mission ».

## Nécessaire pour cette mission ? Oui — la mission introduit des cas d'usage du personnel et de l'administration.
## Complet ? Oui — confronté à l'implémentation ; parcours prouvé par `identity-journey.spec.ts`.
## Validé par : agent, par délégation du porteur du projet (09/10/2026)
