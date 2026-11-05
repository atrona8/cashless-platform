# Séquences — mission hors-ligne-snapshots-lots-01M645RN

> État : **implémentée, relue et approuvée le 04/11/2026** ; en attente d'acceptation et de fusion. Flux recalés sur le
> code de la lane `u` (`research.md` R-05, R-08, R-10, R-11, R-16, R-18, R-30.8, R-30.11 pour le plan).

## Flux internes propres à cette mission

### Production et lecture d'un snapshot

![Production et lecture d'un snapshot](diagrams/sequence-snapshot.png)

Sources : [`sequence-snapshot.excalidraw`](diagrams/sequence-snapshot.excalidraw), [`sequence-snapshot.svg`](diagrams/sequence-snapshot.svg).

### Envoi d'un lot, opération par opération

![Envoi d'un lot](diagrams/sequence-lot.png)

Sources : [`sequence-lot.excalidraw`](diagrams/sequence-lot.excalidraw), [`sequence-lot.svg`](diagrams/sequence-lot.svg).

### Vente partiellement couverte (transaction 22)

![Vente partiellement couverte](diagrams/sequence-vente-partielle.png)

Sources : [`sequence-vente-partielle.excalidraw`](diagrams/sequence-vente-partielle.excalidraw), [`sequence-vente-partielle.svg`](diagrams/sequence-vente-partielle.svg).

### Levée d'un trou à deux

![Levée d'un trou](diagrams/sequence-trou.png)

Sources : [`sequence-trou.excalidraw`](diagrams/sequence-trou.excalidraw), [`sequence-trou.svg`](diagrams/sequence-trou.svg).

### Points à retenir
- Snapshot : `snapshot-content` n'a aucun droit de publication ; `snapshot-signer` ne détient que le port de signature ;
  la version est calculée par la base à la publication. L'API publique ne lit que l'enveloppe du terminal appelant.
  **Recalé à la review** : le signataire vérifie sa signature contre la clé publique avant de publier (étapes 10 et 11 du
  diagramme) ; il traite un grand livre à la fois, dans l'ordre, et les grands livres en parallèle ; un brouillon qui ne
  se vérifie pas est jeté, jamais signé.
- Lot : une transaction par opération, dans l'ordre. Au quatrième échec de solde (`CL007`), rejet réessayable avec trace
  `offline_batch_retry`. Renvoi d'un lot en cours : reprise sous verrou, ou `409 BATCH_IN_PROGRESS`.
- Vente partielle : le commerçant d'un terminal conforme est crédité du total ; la commission porte sur 9 000.
- Trou : la demande et l'approbation viennent de deux `SUPERVISOR` différents ; les contrôles sont rejoués à l'approbation.
- Lot, recalé à la review : l'identité du terminal est vérifiée avant la lecture du corps (`body-gate`) ; l'état du lot
  est relu dans la transaction de chaque opération, après le verrou du terminal : un lot abandonné ou rejeté en cours de
  route n'écrit plus rien au-delà (garde prouvée au cycle 2 de WP21). Le flux dessiné reste exact, la précision est en
  texte.
- Trou : sans le rôle voulu, ou pour un autre prestataire, la réponse est `404` neutre (ADR-149), pas `403`.
- Non dessinés : import du journal d'un terminal révoqué (même schéma que la levée de trou, avec un travailleur
  `journal-import` ; une demande rejetée ou expirée est annulée par `cancel_device_journal_import`, migration 0050),
  alerte d'un trou de plus de 24 h (travailleur `seq-gap-age`), lecture de `GET /device/seq-status` et de
  `GET /events/{event_id}/device-sync-status` (un seul échange chacune : lecture seule par la base).

## Flux transverses auxquels cette mission participe (référence, pas dupliqué)
Voir `docs/05-sequence-diagrams.md`, flux : « Vente hors ligne puis synchronisation » (§9.3 à §9.6). La mission prévoit
la partie serveur de ce flux : snapshot, lot, réconciliation, livrée. Aucune recharge espèces hors ligne dans ce flux
(décision du 30/10/2026, reportée en texte dans le flux global).

## Nécessaire pour cette mission ? Oui — la mission introduit des échanges entre processus (contenu, signature), KMS simulé, API, moteur d'écritures, base et terminal.
## Complet ? Oui, recalé à la review (05/11/2026) : le diagramme du snapshot est régénéré avec `/illustre` et relu (vérification de la signature, signataire par grand livre) ; les trois autres diagrammes (lot, vente partielle, trou) restent exacts, leurs précisions sont en texte. Import du journal et alerte des trous restent en texte, à dessiner si le porteur le demande.
## Validé par : proposition de l'Agent, à confirmer par le porteur, le 05/11/2026
