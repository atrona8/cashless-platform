# Cas d'usage : mission adaptateurs-fournisseurs-choisis-01M8BXJA

> État : **plan finalisé le 26/11/2026 (plan commité `64a7f01c`, artefacts `944b47ff`) : PLANIFIÉ, rien n'est codé**. Décisions D1 à D9 du porteur du 26/11/2026.
> Diagramme `/illustre` (police sans empattement, rendu relu), source et générateur dans [`diagrams/`](diagrams/) (`generate.py`).

## Cas d'usage propres à cette mission

![Cas d'usage des adaptateurs des fournisseurs choisis](diagrams/usecase-adaptateurs-fournisseurs.png)

Sources : [`usecase-adaptateurs-fournisseurs.excalidraw`](diagrams/usecase-adaptateurs-fournisseurs.excalidraw), [`usecase-adaptateurs-fournisseurs.svg`](diagrams/usecase-adaptateurs-fournisseurs.svg).

| Cas d'usage | Acteur | Règle prévue | Opération concernée |
|---|---|---|---|
| Recharger par Wave | Festivalier | Session Wave au montant exact en XOF, référence de la recharge, adresses de retour ; notification `Wave-Signature` acceptée si une signature est valide (plusieurs pendant une rotation), dans les 5 minutes ; crédit unique | `POST /topups/psp` (`initiatePspTopup`, existante), `receivePspWebhook` (`wave`) |
| Recharger par PayDunya | Festivalier | Facture PayDunya ; la notification n'est qu'un **signal** (D2) : preuve d'origine vérifiée, rien n'est crédité avant la relecture authentifiée de la facture, au montant et à la devise confirmés ; carte sans preuve 3-D Secure : reçue, non créditée (D7) | `receivePspWebhook` (`paydunya`, corps en formulaire, D9) |
| Recharger par carte avec Stripe | Festivalier | Session Stripe hébergée, 3-D Secure exigé, notification `Stripe-Signature` à relire (la carte n'est pas dans l'événement) ; éligibilité Sénégal à vérifier par le porteur (D4) | `receivePspWebhook` (`stripe`) |
| Rapprocher les paiements | Prestataire | Relevé Wave par jour, mouvements de solde Stripe par période ; PayDunya : aucun relevé documenté, rapprochement manuel | lecture du relevé (existante) |
| Ranger les identifiants des PSP dans le coffre | Porteur | Un secret JSON par configuration, sous `psp/<holder_party_id>/<nom>`, valeur courante et précédente à échéance ; un détenteur ne lit jamais les secrets d'un autre | coffre AWS Secrets Manager |
| Faire tourner clés des bracelets, signature des snapshots et copie des scellements sur AWS | Porteur | Cinq ports KMS (MAC, clé de données, déchiffrement, signature, administration) ; copie S3 Object Lock en mode conformité, 10 ans (D8) ; droits par processus inchangés | KMS, S3 |
| Essayer un service puis le passer en production | Porteur | Commande d'essai contre le vrai service, compte rendu sans secret ; garde de production : tout adaptateur réel non essayé refuse le démarrage, levée service par service par une PR relue (D3, D6) | `npm run essai -w @cashless/api -- <service>` |

Hors périmètre : Orange Money (D1, documentation derrière un compte Sonatel), remboursement d'un paiement non crédité (D5, OP-N82, hors plateforme), fournisseurs non décidés (SMS, WhatsApp, OIDC, matériel de la passerelle, banque).

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaine « Argent réel : PSP, caisses, rapprochements, versements » (recharges Wave, PayDunya, Stripe, rapprochement) ; aucun domaine nouveau, aucun renommage ni fusion de cas d'usage globaux. Les cas « ranger les identifiants » et « essayer puis passer en production » sont des actions du porteur, décrites dans `docs/SERVICES-EXTERNES.md`.

## Nécessaire pour cette mission ? Oui : sept cas d'usage de recharge, de coffre et de mise en production, dont un parcours (le signal) qui diffère des autres PSP (proposition de l'Agent, en attente de confirmation du porteur).
## Complet ? Oui pour le plan (26/11/2026) : sept cas d'usage, acteurs festivalier, prestataire et porteur, hors périmètre listé ; diagramme `/illustre` généré et relu (proposition de l'Agent, en attente de confirmation du porteur).
## Validé par : proposition de l'Agent le 26/11/2026, confirmée par le porteur le 26/11/2026.
