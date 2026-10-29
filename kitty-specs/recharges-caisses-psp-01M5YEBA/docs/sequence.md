# Séquences — mission recharges-caisses-psp-01M5YEBA

> État : **relue le 29/10/2026, 14 lots approuvés** ; flux confrontés au code livré (`research.md` R-02, R-03, R-10, R-11,
> R-12, R-14 et R-20). Les six diagrammes du plan restent justes dans leurs grandes lignes ; les détails livrés après eux
> sont listés ci-dessous (diagrammes à revoir si le porteur le demande).

## Flux internes propres à cette mission

### Session de caisse et fermeture

![Session de caisse](diagrams/sequence-session-caisse.png)

Sources : [`sequence-session-caisse.excalidraw`](diagrams/sequence-session-caisse.excalidraw), [`sequence-session-caisse.svg`](diagrams/sequence-session-caisse.svg).

### Recharge en espèces et caution due

![Recharge espèces](diagrams/sequence-recharge-especes.png)

Sources : [`sequence-recharge-especes.excalidraw`](diagrams/sequence-recharge-especes.excalidraw), [`sequence-recharge-especes.svg`](diagrams/sequence-recharge-especes.svg).

### Recharge PSP : demande, notification conservée, traitement

![Recharge PSP](diagrams/sequence-recharge-psp.png)

Sources : [`sequence-recharge-psp.excalidraw`](diagrams/sequence-recharge-psp.excalidraw), [`sequence-recharge-psp.svg`](diagrams/sequence-recharge-psp.svg).

### Interrogation planifiée et expiration

![Interrogation planifiée](diagrams/sequence-interrogation.png)

Sources : [`sequence-interrogation.excalidraw`](diagrams/sequence-interrogation.excalidraw), [`sequence-interrogation.svg`](diagrams/sequence-interrogation.svg).

### Notification refusée

![Notification refusée](diagrams/sequence-notification-refusee.png)

Sources : [`sequence-notification-refusee.excalidraw`](diagrams/sequence-notification-refusee.excalidraw), [`sequence-notification-refusee.svg`](diagrams/sequence-notification-refusee.svg).

### Contestation carte

![Contestation carte](diagrams/sequence-contestation-carte.png)

Sources : [`sequence-contestation-carte.excalidraw`](diagrams/sequence-contestation-carte.excalidraw), [`sequence-contestation-carte.svg`](diagrams/sequence-contestation-carte.svg).

### Détails livrés non dessinés
- Fermeture : verrous terminal, session puis solde (`0040`) ; la vue `CASHIER` d'une session masque l'anomalie d'écart.
- Recharge PSP : demande en trois temps, la dernière transaction étant l'`IdempotentTx` de la route (idem annulation) ;
  traitement sous verrou consultatif `psp-topup:<id>` ; succès tardif après annulation crédité si recevable.
- Interrogation : trois travailleurs (interrogation et expiration, reprise `UNMATCHED`/`RETRY`, purge des corps de plus de 400 jours).
- Contestation : un blocage ne s'attribue jamais une autre cause (`wallet.other_block`) ; contestation introuvable après
  24 h : `PSP_MISMATCH` ; contestation tardive et déblocage : demandes `LATE_CHARGEBACK` et `WALLET_UNBLOCK` à deux.

Régénération : `python3.14 diagrams/generate.py diagrams ~/.claude/skills/illustre/references/render_excalidraw.py`
(police sans-serif imposée, rendus relus le 27/10/2026, non refaits à la review).

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)
Voir `docs/05-sequence-diagrams.md`, flux : « Recharge mobile money » (complété par les flux de cette mission),
« Double validation au back-office » (activation d'une configuration, choix pendant `LIVE`, dépôt, déblocage,
contestation tardive) et « Paiement en ligne par bracelet » (caution due après un crédit).

## Nécessaire pour cette mission ? Oui — six flux entre terminal, back-office, API, moteur, PSP, travailleur et base.
## Complet ? Oui pour l'essentiel : six diagrammes relus au plan, détails livrés ci-dessus en texte seulement (à confirmer par le porteur).
## Validé par : en attente du porteur (proposition de l'Agent, 29/10/2026)
