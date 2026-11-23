# Cas d'usage : mission serveur-app-festivalier-01M7WB69

> État : **relue le 23/11/2026 (11 lots sur 11 approuvés), non acceptée, non fusionnée** (mission 10a « Serveur de
> l'app festivalier »). Recalé le 23/11/2026 sur la lane `k` (code réel). Source : `spec.md`, `plan.md`,
> `data-model.md`, `contracts/`, `docs/passation-10a/preuves.md`. Diagramme `/illustre` (police sans
> empattement, rendu relu le 23/11/2026) ; source et générateur dans [`diagrams/`](diagrams/)
> (`generate.py`).

## Cas d'usage propres à cette mission

![Cas d'usage du serveur de l'app festivalier](diagrams/usecase-festivalier-serveur.png)

Sources : [`usecase-festivalier-serveur.excalidraw`](diagrams/usecase-festivalier-serveur.excalidraw),
[`usecase-festivalier-serveur.svg`](diagrams/usecase-festivalier-serveur.svg).

| Cas d'usage | Acteur | Règle réalisée | Point ouvert |
|---|---|---|---|
| Identifier un festivalier | Caissier, `ORGANIZER_ADMIN` | Compte au numéro vérifié exigé ; pièce (type, pays, 4 derniers caractères, expiration) ; écriture par `create_kyc_verification` seule (`201`) ; pièce déjà expirée refusée (`422`) ; niveau calculé à l'usage ; `403` aussi pour un client sans portefeuille d'événement | OP-N163 (agent titulaire), OP-N165 |
| Identifier son propre compte (refusé) | Caissier titulaire | Numéro vérifié du compte égal au téléphone de l'agent : `403` | C-005 |
| Demander une révocation | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Motif d'au moins 10 caractères (`422` sinon, réponse déclarée au contrat, ADR-225) ; demande `KYC_REVOCATION` `202` ; une identification déjà révoquée n'est pas refusée à la demande : l'exécution échoue (`409`, demande `FAILED`) | OP-N164 levé le 23/11/2026 (§6.3 point 5 amendé) ; OP-N165 |
| Approuver une révocation | Autre personne habilitée | Auteur et valideur distincts ; identification `REVOKED` ; `revoked_by` = auteur de la demande, valideur dans l'audit | OP-N165 |
| Faire tourner le secret | Exploitant | Version du secret sur chaque empreinte ; ancien code refusé comme inconnu | OP-N47 levé |
| Réémettre les codes | Exploitant | Commande `reissue-claim-codes`, rôle `cashless_claimadmin` ; fichier `rank,code,url,uid,printed_number` (0600, jamais écrasé, écrit avant la base) qui nomme le bracelet de chaque code : plus d'import après réémission | OP-N47 levé, OP-N167 |
| Recevoir son code | Festivalier | WhatsApp, SMS principal (10 s), SMS de repli (20 s, délais réglables) ; code en mémoire, 35 s au plus ; au plafond la chaîne s'arrête sans repli | OP-N120 (faux jusqu'à la 12b), OP-N166 |
| Voir bracelet et solde | Festivalier | `printed_number` (colonne facultative du fichier de l'imprimeur) et `pending_offline_notice` (par terminal et grand livre du portefeuille) | OP-N168 |

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaines « Argent réel : PSP, caisses, rapprochements,
versements » (identification et plafonds), « Bracelets NFC : format, clés, lots, cycle de vie »
(rotation, réémission, numéro imprimé) et « App festivalier » (code d'envoi, lectures `/me`). Pas de
renommage ni de fusion de cas d'usage globaux. Références par nom de domaine, jamais par numéro (vérifié le 23/11/2026).

## Nécessaire pour cette mission ? Oui : sept cas d'usage nouveaux ou servis pour la première fois et un refus (agent titulaire) ; réponse proposée par l'Agent, en attente du porteur (reconduite le 23/11/2026).
## Complet ? Oui, recalé à la review : acteurs réels, codes d'erreur (`422`, `403`, `409`), fichier de réémission à cinq colonnes. Réponse proposée par l'Agent, en attente du porteur.
## Validé par : en attente du porteur.
