# Cas d'usage : mission durcissements-serveur-01M7QAJD

> État : **plan finalisé le 18/11/2026**, non implémenté (mission 11a « Durcissements serveur hérités »).
> Source : `spec.md`, `plan.md`, `research.md`. Diagramme `/illustre` (police sans empattement, rendu relu) ; source et générateur dans [`diagrams/`](diagrams/) (`generate.py`).

## Cas d'usage propres à cette mission

![Cas d'usage des durcissements](diagrams/usecase-durcissements.png)

Sources : [`usecase-durcissements.excalidraw`](diagrams/usecase-durcissements.excalidraw), [`usecase-durcissements.svg`](diagrams/usecase-durcissements.svg).

| Cas d'usage | Acteur | Règle prévue | Point ouvert |
|---|---|---|---|
| Ouvrir une session de vendeur (PIN) | Terminal (vendeur) | Le PIN n'est vérifié que par le processus `vendor-pin` ; mêmes réponses, même décompte d'essais, même audit | OP-N76 |
| Créer ou modifier un lot de bracelets | Back-office (administrateur) | Par `create_media_batch` / `update_media_batch` seulement ; lot `ORDERED` imposé ; mêmes réponses de route | OP-N60 |
| Créer une demande de remboursement avec IBAN | Back-office (administrateur) | La demande naît à son état initial ; IBAN masqué au journal (chiffrement : décision 1 en attente) | OP-N145, OP-N140 |
| Décider un lot de versements | Back-office (administrateur) | Rôle de classe exigé aussi au refus ; auto-approbation : `409 APPROVAL_INVALID` ; rejeu de confirmation audité ; plafond de la régularisation | OP-N137, OP-N141 |
| Inscrire une passerelle | Administrateur de site | `register_edge_gateway` rend `(gateway_id, ledger_id)` ; l'argument `--ledger` est refusé | OP-N116 |
| Écrire un lot directement (refusé) | API compromise (menace) | `INSERT`/`UPDATE` retirés : refus `42501` | OP-N60 |
| Ouvrir une session sans PIN (refusé) | API compromise (menace) | `cashless_app` n'exécute plus la lecture d'empreinte ni l'ouverture de session ; aucun repli | OP-N76 |
| Insérer une demande payée (refusé) | API compromise (menace) | Déclencheur `BEFORE INSERT` : état initial imposé pour `cashless_app` | OP-N145 |

Hors diagramme (sans cas d'usage utilisateur) : vendeur dans la clé de session (OP-N79), App Attest côté serveur (OP-N64, décision 3 en attente).

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaines « Bracelets NFC : format, clés, lots, cycle de vie » (lots), « Argent réel : PSP, caisses, rapprochements, versements » (demande de remboursement, décision de lot) et « Administration et exploitation » (inscription d'une passerelle, session de vendeur). Aucun domaine « Sécurité du serveur central » n'existe aujourd'hui dans ce fichier : à créer à la mise à jour de la synthèse si le porteur le souhaite, sinon les rattachements ci-dessus suffisent. Pas de renommage ni de fusion de cas d'usage globaux.

## Nécessaire pour cette mission ? Oui : cinq cas d'usage conservés et trois tentatives refusées par la menace « API compromise » sont nouveaux ou changent de garantie (réponse proposée par l'agent le 18/11/2026).
## Complet ? Oui pour le plan : OP-N79 et OP-N64 restent hors diagramme, faute de cas d'usage utilisateur (réponse proposée par l'agent).
## Validé par : en attente de validation humaine (porteur indisponible le 18/11/2026), réponses proposées par l'agent.
