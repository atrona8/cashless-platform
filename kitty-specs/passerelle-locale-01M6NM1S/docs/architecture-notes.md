# Notes d'architecture : mission passerelle-locale-01M6NM1S

> État : **plan finalisé le 05/11/2026** (planifiée, rien n'est encore codé). Source : `plan.md`, `research.md` (R-01 à R-30),
> `research-adversarial.md` (29 constats), `data-model.md`, `contracts/`. Décisions du porteur du 05/11/2026 : `decisions/`
> et `docs/passation-8/contexte-m8.md`. Les noms de migrations, de dossiers et de variables sont ceux du plan, à confirmer à la review.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **Passerelle locale** (`apps/gateway`, NestJS 11, Node 22, image Docker, mini-PC sur site) : seule autorité de débit d'un
  événement pendant la coupure ; base PostgreSQL 17 locale à schéma réduit (série `edge-NNNN`), règles partagées avec le central
  par le paquet `packages/shared-rules` ; ne tient aucune comptabilité ; aucune clé maître de bracelet.
- **Processus central `/edge/*`** (`apps/api/src/processes/`, même code, rôle de base `cashless_edge`) : routes de contrôle, flux de
  réplication, réception `EDGE_SYNC`, rendu ; garde `edgeMtls` sur une autorité de certificats distincte de celle des terminaux ;
  révocation relue en base à chaque requête.
- **Module `debit-authority/`** de l'API publique : `GET` et `POST /ledgers/{id}/debit-authority`, reprise forcée à deux ; refus
  `409 DEBIT_AUTHORITY_EDGE` sur tous les chemins de débit du central pendant `EDGE`.
- **Base centrale** : migrations `0058` à `0061` (droits et fonctions S12 et S13 exposées au rôle `cashless_edge`, colonnes de
  `edge_gateway`, tables `edge_sync_batch`, `edge_sync_batch_result`, `edge_pwd_pack_key`, `edge_pwd_pack`,
  `edge_reference_change`, `edge_staff_token_audit`, vue `edge_device_seq_acked`) ; `set_debit_authority` jamais appelée.
- **Port de stockage matériel** (`key-store/`) : signature des snapshots, signature des jetons d'appareil, clé d'accord ; faux
  refusé au démarrage en production (adaptateur réel en 12b).
- **Outil d'administration** `tools/edge-admin` : inscription, révocation, purge, hors API publique.
- **Contrat** (`packages/contracts/openapi.yaml`) : ajouts facultatifs sous `/edge/*` seulement (champs de `ReplicationPage`,
  paramètre `after_change_seq`, propriété `staff_token_audit` d'`EdgeSyncBatch`), contrôle de stabilité en CI contre `d2a7c538`.

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| Une seule autorité de débit : bascule demandée par un admin, avec le lien ; aucune prise d'autorité par la passerelle (porteur, 05/11) | Pas de double dépense ; le central cesse de débiter avant l'accusé | Prise d'autorité automatique par la passerelle |
| Rôle de base `cashless_edge` et processus dédié aux routes `/edge/*` ; `EDGE_SYNC` refusée à `cashless_app` ; écriture directe sur `edge_gateway` retirée à `cashless_app` | Une faille de l'API publique n'atteint pas les routes de la passerelle, et inversement | Les routes `/edge/*` dans l'API publique |
| « Mêmes modules » au lieu de « même moteur » : base locale à schéma réduit, règles pures partagées en TypeScript (ADR-164, OP-N109) | Le flux du contrat ne porte que des soldes ; pas de schéma central complet sur le site | Schéma central complet répliqué |
| Contrat stable : champs facultatifs sous `/edge/*` seulement, inscription hors API publique (porteur, 05/11) | Les équipes clientes n'ont rien à changer (SC-006) | Route d'inscription au contrat |
| Clés de la passerelle derrière un port de stockage matériel, faux refusé en production, réel en 12b (ADR-155, OP-N100) | Aucun matériel avant la 12b ; aucun faux en production | Clé logicielle chiffrée |
| Jetons d'appareil signés par une clé propre à la passerelle, valables sur elle seule, renouvelés sans rotation (ADR-156, ADR-157) | Sinon les terminaux sont perdus 15 min après la coupure | Clé du central sur le site |
| Jeton de personne expiré toléré au guichet : même personne, même terminal, session ouverte, 12 h, audité et versé au central (ADR-158) | Sinon les guichets s'arrêtent à l'expiration | Refus strict |
| Ventes `EDGE_ONLINE` bornées au rejeu : preuve du bracelet, plafonds 50 000 XOF par vente et 500 000 XOF par terminal et par heure (porteur, 05/11, réglables côté plateforme), rognage au solde central (ADR-159, OP-N104) | Borne la perte d'une passerelle compromise | Relais de la signature du terminal (changement de contrat) |
| Inscription par une personne, alerte immédiate, 30 min avant l'envoi des mots de passe, rien à une `STANDBY` non promue (ADR-160) | Choix du porteur contre la recommandation à deux | Approbation à deux |
| Purge des secrets du site à la clôture et à deux personnes ; limite : mini-PC volé avant la purge (ADR-161) | Un mini-PC récupéré ne livre rien | Aucune (limite physique) |
| Recharge espèces jamais rejetée pour un plafond au rejeu : deux parts, anomalie `CASH_TOPUP_OVER_LIMIT` ; à signaler au juriste (ADR-163) | Ne jamais perdre des espèces encaissées | Rejet au rejeu |
| Passerelle perdue : pas de rejeu automatique des activations et cautions, anomalie `EDGE_REPLAY_FAILED`, résolution à deux (ADR-162) | Le contrat interdit `ACTIVATION` et `DEPOSIT_CASH` dans un lot de terminal | Changer le contrat |
| `STALE` persisté seulement si l'époque est confirmée ou plausible (au plus +2), levée locale à deux (ADR-165) | Un en-tête forgé ne doit pas arrêter le site | `STALE` sur toute époque supérieure |

## Dettes de sécurité nommées (règle du porteur du 13/10/2026)

OP-N100 à OP-N110 et ADR-155 à ADR-165, chacune avec test de borne et report en 12b ou 13 (voir `docs/POINTS_OUVERTS.md`). Fichiers à
faire relire par une personne : droits de la base et enveloppes `edge_*`, persistance de `STALE`, horloge, jetons d'appareil et de
personne, port de clés, purge. Aucun écart n'est codé sans décision du porteur.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » et ligne de détail de la mission. Vue C4 : la passerelle
et sa base locale y figurent déjà (cible) ; le processus central `/edge/*` n'y est pas encore, à ajouter à la review si le code le confirme.

## Nécessaire pour cette mission ? Oui : nouveau conteneur (passerelle), nouveau processus et nouveau rôle de base au central, nouvelles décisions de sécurité.
## Complet ? Oui pour le plan (réponse proposée par l'Agent). À recaler à la review : numérotation réelle des migrations, forme finale du processus `/edge/*`, valeurs des seuils mesurées.
## Validé par : réponse proposée par l'Agent le 05/11/2026, en attente de confirmation du porteur.
