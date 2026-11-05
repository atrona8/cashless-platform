# Fiche de contexte, mission 8 (passerelle-locale-01M6NM1S)

Branche `feat/passerelle-locale`. Spec : `kitty-specs/passerelle-locale-01M6NM1S/spec.md` (FR-001 à FR-034, NFR-001 à NFR-012,
C-001 à C-013). Sources normatives : `docs/SPECIFICATION.md` §9.7, §12.1, §13.1, §14.1 S12 S13 ; `docs/sync_protocol.md` §9, §13 ;
`docs/DECISIONS_ADR.md` ADR-52 ; `packages/contracts/openapi.yaml` (tag Passerelle, `x-edge-available`) ; pile : `docs/08-pile-logicielle.md`.

Décisions du porteur (05/11/2026) : bascule par un admin avec le lien ; recharges espèces sur sessions ouvertes au central avant
la bascule ; port de stockage matériel, faux refusé en production, réel en 12b ; `STANDBY` promue par handover normal ; contrat
stable, ajouts facultatifs sous `/edge/*` seulement ; inscription d'une passerelle par outil d'administration hors API publique.

Règles : ne jamais modifier les `.sql` générés de `packages/ledger-sql/`. Écart de sécurité : jamais en silence (CLAUDE.md).
Commandes spec-kitty avec `LC_ALL=C LANG=C`. Base de test partagée : les agents ne lancent ni Jest, ni pgTAP, ni reset-db, et ne
commitent pas. Une API tourne sur le port 80 : ne pas y toucher.

## Décisions du plan (porteur, 05/11/2026, confirmées) : font foi sur les rapports `docs/passation-8/rapports/R-*.md`

1. Base de la passerelle : PostgreSQL local, schéma réduit (série de migrations propre), règles partagées en TypeScript, mêmes scénarios de référence ; le central seul tient la comptabilité. Écart de texte à acter : « même moteur » (SPEC §9) devient « mêmes modules ».
2. Jetons d'appareil pendant EDGE : clé propre à la passerelle dans le port de stockage matériel, jetons valables sur elle seule, refusés au central (test). Écart accepté, dette nommée.
3. Jeton de personne expiré au guichet : toléré sur la passerelle seulement, bien signé, personne qui a ouvert la session, même terminal, session ouverte, 12 h au plus après la bascule, chaque usage audité. Écart accepté, dette nommée. Risque : compte révoqué pendant la coupure.
4. Passerelle perdue avant rejeu : pas de changement de contrat. Un terminal n'envoie que `ONLINE_REF` pour activation et caution (`OfflineOperationType`) ; le central reconnaît une référence à une opération inconnue et ouvre `EDGE_REPLAY_FAILED` ; un `TOPUP_CASH` suit le refus existant, anomalie portant le montant. Aucune perte silencieuse, rétablissement manuel, résolution à deux.
5. Rôle `cashless_edge` et enveloppe pour écrire en `EDGE_SYNC` (vérifie passerelle, handover, époque, `origin_*`) ; `post_transaction` en `EDGE_SYNC` refusée à `cashless_app`. Migrations à partir de `0058`.
6. Renforcements à faire puis consigner : retirer l'écriture directe de `cashless_app` sur `edge_gateway` ; `record_edge_seq` refuse une passerelle `REVOKED` ou sans handover de cette passerelle ; lier passerelle et handover ; `begin_cash_close` refusé (`409 CONFLICT_STATE`) tant que l'autorité est à la passerelle ou que la file n'est pas vide.
7. Contrat : seuls des champs facultatifs sur `ReplicationPage`, sous `/edge/*`. Aucune autre route ne change. Compléter un 409 du central (`edge_base_url`, époque) n'est permis que si le contrat le déclare déjà.
8. Écarts acceptés, chacun avec OP, ADR, test de borne et report : clés de passerelle simulées jusqu'à 12b ; décision 2 ; décision 3.
9. À régler au plan, signaler si sécurité : contenu haché de la chaîne de la passerelle et vecteurs ; horloge de la passerelle ; écriture de `ISOLATED`/`CATCHING_UP` ; réveil immédiat de l'attente longue (NFR-007) ; NFR-005 sur 1 000 paiements.
10. Preuves : deux processus, deux bases, relais TCP coupable, points d'arrêt actifs hors production seulement, étape CI dédiée.

## Décisions après la passe contradictoire (porteur, 05/11/2026)

11. A01, renouvellement du jeton d'appareil : sans rotation sur la passerelle ; empreinte répliquée du jeton de rafraîchissement et certificat du terminal, jeton court valable sur elle seule, rotation forcée au retour. Écart accepté, dette nommée.
12. A02 : `after_change_seq` facultatif accepté sur `/edge/replication-feed`.
13. A07 : au rejeu, preuve du bracelet (compteur croissant, signature, bon portefeuille), plafond par vente et par terminal et par heure, alerte, sans changement de contrat. Risque résiduel accepté par ADR, perte maximale chiffrée.
14. A09 : recharge espèces jamais rejetée pour un plafond au rejeu, deux parts (protocole §8), anomalie résolue à deux ; signaler au juriste le dépassement temporaire d'un plafond réglementaire.
15. A12 : `STALE` persisté seulement si confirmé par le central ou plausible (au plus époque détenue + 2) ; sinon refus sans arrêt, alerte ; levée locale à deux personnes si le lien est coupé.
16. A16 : inscription par UNE personne (choix du porteur contre la recommandation), alerte immédiate et délai avant l'envoi des mots de passe ; rien pour une `STANDBY` non promue. Écart accepté, dette nommée, test.
17. A21 : purge automatique à la clôture de l'événement et manuelle à deux personnes (clé d'accord, données répliquées), test ; limite consignée : mini-PC volé avant la purge.
18. Audit de la tolérance des jetons de personne versé au central par un champ facultatif sous `/edge/*`.
