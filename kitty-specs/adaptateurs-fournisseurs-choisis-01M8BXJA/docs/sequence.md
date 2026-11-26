# Séquences : mission adaptateurs-fournisseurs-choisis-01M8BXJA

> État : **plan finalisé le 26/11/2026 : PLANIFIÉ, rien n'est codé**. Diagramme `/illustre` (police sans empattement, rendu relu), source et générateur dans [`diagrams/`](diagrams/) (`generate.py`).

## Flux internes propres à cette mission

### Signal, relecture, puis crédit (PayDunya ; Stripe carte pour la relecture)

![Signal, relecture, puis crédit](diagrams/sequence-signal-relecture-credit.png)

Sources : [`sequence-signal-relecture-credit.excalidraw`](diagrams/sequence-signal-relecture-credit.excalidraw), [`sequence-signal-relecture-credit.svg`](diagrams/sequence-signal-relecture-credit.svg).
PayDunya envoie sa notification en formulaire ; l'API ne lit que `data[hash]` avant de le comparer, à temps constant, au `sha512` de la clé maître (faux : refus, rien conservé). Un signal valide est conservé dans `psp_event`, sans effet, et l'API répond `200` sans appel sortant. Le travailleur d'interrogation prend d'abord les recharges ayant reçu un signal (délai 0 au lieu de 2 minutes), lit la facture par `checkout-invoice/confirm/{token}` avec les clés, puis le processeur existant crédite une seule fois, au montant et à la devise confirmés ; non payée ou montant différent : rien n'est crédité, anomalie. Au plus une relecture par recharge et par minute (borne d'un signal forgé). Stripe : la notification `checkout.session.completed` est « à relire » (ni 3-D Secure ni empreinte dans l'événement) ; même relecture, par `getStatus`.

Restent en texte : Wave (notification signée dont le contenu suffit, crédit par le chemin existant ; création jamais rejouée telle quelle, recherche par `client_reference` d'abord) ; lecture d'un secret (coffre, cache de 60 s) ; garde de production et commande d'essai (refus de démarrer en nommant le service) ; écriture S3 verrouillée (412 : relecture et comparaison de l'empreinte).

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)

Voir `docs/05-sequence-diagrams.md`, flux : « Recharge mobile money » (le flux global reste juste pour Wave ; le parcours du signal PayDunya est ajouté en complément, planifié).

## Nécessaire pour cette mission ? Oui : une interaction inter-composants nouvelle et sensible (signal puis relecture avant tout crédit) (proposition de l'Agent, en attente de confirmation du porteur).
## Complet ? Oui pour le plan (26/11/2026) : le flux PayDunya est dessiné ; Wave, coffre, essai et S3 en texte ; à recaler à la review (proposition de l'Agent, en attente de confirmation du porteur).
## Validé par : proposition de l'Agent le 26/11/2026, confirmée par le porteur le 26/11/2026.
