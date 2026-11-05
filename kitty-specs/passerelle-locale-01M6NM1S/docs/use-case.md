# Cas d'usage : mission passerelle-locale-01M6NM1S

> État : **plan finalisé le 05/11/2026**, aucun code encore écrit (planifiée). Source : `spec.md` (9 user stories, 39 FR,
> 13 NFR, 13 contraintes), `plan.md`, `contracts/`. En cas d'écart ultérieur, le code fait foi et ce fichier est recalé
> à la review. Diagrammes `/illustre` (préférence du porteur du 13/10/2026), police sans empattement, rendus relus.

## Cas d'usage propres à cette mission

### Personnes : inscrire, basculer, rendre, reprendre la main

![Cas d'usage du pilotage](diagrams/usecase-admin.png)

Sources : [`usecase-admin.excalidraw`](diagrams/usecase-admin.excalidraw), [`usecase-admin.svg`](diagrams/usecase-admin.svg).

### Site : le terminal et le guichet pendant la coupure

![Cas d'usage du site](diagrams/usecase-site.png)

Sources : [`usecase-site.excalidraw`](diagrams/usecase-site.excalidraw), [`usecase-site.svg`](diagrams/usecase-site.svg).

| Cas d'usage | Acteur | Règle principale (prévue) | Route ou outil |
|---|---|---|---|
| Inscrire une passerelle | Opérateur, par l'outil d'administration | Numéro, rôle `PRIMARY` ou `STANDBY`, certificat, clé d'accord, adresse du site ; une personne ; alerte immédiate, aucun mot de passe de bracelet avant 30 min, rien pour une `STANDBY` non promue | `tools/edge-admin` (hors API publique, aucune route ajoutée) |
| Demander la bascule | `OPERATOR_ADMIN` | `grant_edge_authority` : le central cesse de débiter, `202`, époque +1 ; refusée si la passerelle est `STANDBY`, révoquée ou d'un autre événement | `POST /ledgers/{ledger_id}/debit-authority` (`target = EDGE`) |
| Abandonner une bascule | `OPERATOR_ADMIN` | `fail_edge_grant` sur un handover `GRANTED` : l'autorité revient au central | même route (`target = CENTRAL`) |
| Voir l'autorité et l'époque | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` (lecture, à confirmer) ; passerelle | Autorité, époque, passerelle désignée, handover ouvert | `GET /ledgers/{ledger_id}/debit-authority` |
| Demander le rendu | `OPERATOR_ADMIN` | `RELEASE_REQUESTED` ; la passerelle persiste `RELEASING` et cesse de débiter | même route (`target = CENTRAL`, `force = false`) |
| Reprise forcée à deux | `OPERATOR_ADMIN` + seconde personne | Constat physique déclaré, `FORCE_CENTRAL_AUTHORITY`, certificat révoqué, handover `FORCED` | même route (`force = true`), approbation |
| Purger les secrets du site | Deux personnes ; automatique à la clôture | Clés et mots de passe de la passerelle détruits (FR-035) | ordre à deux, outil du site |
| Recevoir les alertes | Responsable | Inscription, changement de rôle, chaîne rompue, rendu bloqué, passerelle muette, époque forgée | audit et alertes (FR-034) |
| Vendre, annuler, lire un solde | Terminal, vendeur | Les 16 opérations `x-edge-available` avec les mêmes formats et erreurs ; époque exigée ; solde effectif = solde central + deltas locaux | `createPayment`, `reversePayment`, `getPayment`, `createTap` et les lectures (16 opérations, voir `contracts/gateway-served-operations.md`) |
| Recharger en espèces | Caissier | Seulement sur une session de caisse ouverte au central et répliquée avant la bascule ; aucune ouverture, relève ni fermeture sur la passerelle | `POST /topups/cash` (`createCashTopup`) sur la passerelle |
| Activer, prendre une caution | Caissier | Activation sans frais sur solde et caution en espèces, transmises au central dans la même file | `POST /media/activations`, `POST /media/{media_id}/deposit` sur la passerelle |
| Renouveler son jeton | Terminal | Jeton court signé par la clé propre de la passerelle, valable sur elle seule, sans rotation du jeton de rafraîchissement | `POST /device-tokens/refresh` sur la passerelle |
| Lire l'accusé du central | Terminal | Accusé contigu du central, jamais l'accusé provisoire de la passerelle | `GET /device/seq-status` |
| Envoyer un lot hors ligne | Terminal isolé | Règles de la mission 7 avec les soldes de la passerelle ; relais avec la signature d'origine ; `TOPUP_CASH` d'un lot toujours rejeté | `POST /offline-batches` sur la passerelle (`submitOfflineBatch`) |
| Refus : opération non servie, `STANDBY` | Terminal | Caution sur solde, remboursement, restitution, QR : `409 DEBIT_AUTHORITY_EDGE` ; `STANDBY` refuse tout débit | passerelle |

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, section « Hors ligne et passerelle locale » (domaine existant, la mission 8
livre sa moitié « passerelle locale »). Pas de renommage ni de fusion de cas d'usage globaux.

## Nécessaire pour cette mission ? Oui : la mission introduit six acteurs et quinze cas d'usage nouveaux (pilotage, site, guichet), donc la règle de génération des diagrammes s'applique.
## Complet ? Oui pour le plan (réponse proposée par l'Agent). Restent à confirmer à la review : le rôle de lecture de `getDebitAuthority` (le contrat ne le dit pas, plan : `OPERATOR_ADMIN` et `ORGANIZER_ADMIN`), et le comportement de la passerelle sur `activateMedia` et `takeDeposit` (le contrat ne déclare pas l'en-tête d'époque pour elles, note 1 de `gateway-served-operations.md`).
## Validé par : réponse proposée par l'Agent le 05/11/2026, en attente de confirmation du porteur.
