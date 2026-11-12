# Notes d'architecture : mission passerelle-locale-01M6NM1S

> État : **review terminée le 12/11/2026, 25 lots sur 25 approuvés** ; mission NON acceptée, NON consolidée, NON fusionnée.
> Recalé sur le code de la lane `y` (qui contient toutes les autres lanes). Sources : `plan.md`, `research.md`, `data-model.md`,
> `contracts/`, `docs/passation-8/suivi-lots.md` (journal des lots) et `docs/passation-8/contexte-m8.md` (décisions 1 à 58 du porteur).
> Le code fait foi sur le plan quand ils divergent (voir « Écarts entre le plan et le livré »).

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **Passerelle locale** (`apps/gateway`, NestJS 11.2.7, Node 22, TypeScript) : UN seul processus applicatif. Il porte l'écoute des
  terminaux (TLS, port 8443), un écouteur d'administration local en TLS 1.3 (boucle locale du conteneur, port 8444, ordres à deux
  personnes), et cinq tâches internes : reprise et suivi de l'autorité, boucle de réplication, vidage de la file vers le central,
  production des snapshots signés, déclencheur de purge. Base PostgreSQL 17 locale à schéma réduit, un seul rôle `edge_app`
  (ADR-166), 10 migrations `edge-0001` à `edge-0010` (35 tables environ dans `edge-0001`). Règles partagées avec le central par
  `packages/shared-rules` ; aucune comptabilité ; aucune clé maître de bracelet. Image Docker `apps/gateway/Dockerfile` (base
  `node:22-bookworm-slim` épinglée par condensat, utilisateur non-root, sonde de santé en HTTPS), `docker-compose.site.yml`, procédure
  d'exploitation `docs/procedure-site-passerelle.md`.
- **Processus central `edge`** (`apps/api/src/main.edge.ts`, `processes/edge.module.ts`) : même code que l'API, rôle de base
  `cashless_edge` (aucun droit de table, seulement des fonctions `edge_*`), garde `edgeMtls` sur une autorité de certificats propre
  aux passerelles (`EDGE_CA`), refus de toute route non marquée. Routes `/edge/handovers/current`, `/edge/handovers/{id}/ack`,
  `/edge/handovers/{id}/release`, `/edge/replication-feed`, `/edge/sync-batches`, plus la lecture `edgeMtls` de `getDebitAuthority`.
  Travailleurs de maintenance (rendu bloqué, passerelle muette) sous `cashless_maint`.
- **Module `debit-authority/`** de l'API publique : `GET` et `POST /ledgers/{id}/debit-authority`, lecture `OPERATOR_ADMIN` et
  `ORGANIZER_ADMIN`, changement `OPERATOR_ADMIN` seul, reprise forcée par une approbation à deux (`FORCE_CENTRAL_AUTHORITY`) ;
  refus `409 DEBIT_AUTHORITY_EDGE` sur tous les chemins de débit du central pendant `EDGE`.
- **Base centrale** : migrations `0058` à `0072` (15 migrations ; le plan en prévoyait quatre, `0058` à `0061`). Rôles `cashless_edge`
  et `cashless_edgeadmin`. 8 tables créées : `edge_reference_change` (0058), `edge_sync_batch`, `edge_sync_batch_result` (0060),
  `edge_platform_setting` (0061), `edge_pwd_pack_key`, `edge_pwd_pack`, `edge_staff_token_audit`, `edge_replication_horizon` (0063) ;
  colonnes ajoutées à `edge_gateway` et `debit_authority_handover` ; fonctions `edge_*` (enveloppes, aides internes jamais accordées,
  accès étroits `SECURITY DEFINER` de `0066` et `0067`). `set_debit_authority` n'est jamais appelée.
- **Travailleur de colis de mots de passe** (`apps/api/src/edge/packs`, dans le processus `tag-keys`, rôle `cashless_tagkeys`) : scelle
  les colis sous une clé de contenu dérivée sans état ; prestataires servis désignés par `EDGE_PACK_OPERATORS` (sans liste, rien).
- **Port de stockage matériel** (`key-store/`) : signature des snapshots, signature des jetons d'appareil, clé d'accord ; faux refusé
  au démarrage en production ; clé TLS client en fichier durci jusqu'à la 12b (OP-N113).
- **Outil d'administration** `tools/edge-admin` (rôle `cashless_edgeadmin`) : inscription, révocation, rotation du certificat, échange
  des rôles, hors API publique ; deux titulaires nominatifs distincts pour les clés de site.
- **Contrat** (`packages/contracts/openapi.yaml`) : ajouts facultatifs seulement, 167 chemins et 202 opérations avant et après (analyse
  du YAML). Sous `/edge/*` : champs de `ReplicationPage` (dont `edge_terms` avec `spend_order`), paramètre `after_change_seq`,
  `staff_token_audit` et `local_orders` d'`EdgeSyncBatch`, `operations` admis vide (`minItems` 0) si le lot porte des ordres locaux.
  Hors `/edge/*` : `edge_base_url` et `authority_epoch` facultatifs sur `Problem` (ADR-171). Contrôle de stabilité en CI contre
  `d2a7c538` (`tools/contract-stability`, 29 ajouts admis).
- **CI** (`.github/workflows/ledger-tests.yml`) : étape de stabilité du contrat bloquante, migrations et tests d'intégration de la
  passerelle dans le job `ledger`, nouveau job `gateway-e2e` (Linux, PostgreSQL natif, deux processus, relais TCP, plancher
  `M8_MIN_DEBIT_RATE` 100, mode long `M8_E2E_LONG`, balayage Trivy de l'image bloquant sur HIGH et CRITICAL corrigeables).
  `.github/CODEOWNERS` : chemins sensibles (clés, droits, purge, rejeu) attribués au porteur ; la protection « revue des propriétaires »
  est activée depuis le 12/11/2026.
- **Dépendances** : aucune nouvelle. Les dépendances de `apps/gateway` (`pg`, `jose`, `@peculiar/x509`, `canonicalize`, `cbor2`,
  `structured-headers`, NestJS, `tsx`) sont déjà celles de l'API, aux mêmes versions exactes (ADR-78).

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| Une seule autorité de débit : bascule demandée par un admin, avec le lien ; aucune prise d'autorité par la passerelle (porteur, 05/11) | Pas de double dépense ; le central cesse de débiter avant l'accusé | Prise d'autorité automatique par la passerelle |
| Rôle `cashless_edge` et processus dédié aux routes `/edge/*` ; `EDGE_SYNC` refusée à `cashless_app` ; écriture directe sur `edge_gateway` retirée à `cashless_app` | Une faille de l'API publique n'atteint pas les routes de la passerelle, et inversement | Routes `/edge/*` dans l'API publique |
| « Mêmes modules » au lieu de « même moteur » : base locale à schéma réduit, règles pures partagées (ADR-164, OP-N109) | Le flux ne porte que des soldes ; pas de schéma central complet sur le site | Schéma central complet répliqué |
| Contrat stable : ajouts facultatifs seulement, inscription hors API publique | Les équipes clientes n'ont rien à changer (SC-006) | Route d'inscription au contrat |
| Clés derrière un port de stockage matériel, faux refusé en production (ADR-155, OP-N100) | Aucun matériel avant la 12b ; aucun faux en production | Clé logicielle chiffrée |
| Jetons d'appareil signés par une clé propre à la passerelle, sans rotation (ADR-156, ADR-157) | Sinon les terminaux sont perdus 15 min après la coupure | Clé du central sur le site |
| Jeton de personne expiré toléré au guichet 12 h, audité et versé au central (ADR-158) | Sinon les guichets s'arrêtent à l'expiration | Refus strict |
| Ventes `EDGE_ONLINE` bornées au rejeu : preuve du bracelet, 50 000 XOF par vente, 500 000 XOF par terminal et par heure, fenêtre en microsecondes (ADR-159, décision 25) | Borne la perte d'une passerelle compromise | Relais de la signature du terminal |
| Inscription par une personne, alerte immédiate, 30 min avant les mots de passe, rien à une `STANDBY` non promue (ADR-160) | Choix du porteur contre la recommandation | Approbation à deux |
| Purge à la clôture et à deux personnes, versée au central AVANT la destruction ; limites WAL et blocs libres (ADR-161, ADR-186, ADR-187) | Un mini-PC récupéré ne livre rien ; le central connaît la purge | Purge locale seule |
| Recharge espèces jamais rejetée au rejeu : deux parts, anomalie `CASH_TOPUP_OVER_LIMIT` ; refus à la saisie au-delà de 500 000 XOF par recharge (ADR-163) | Ne jamais perdre des espèces encaissées | Rejet au rejeu |
| Passerelle perdue : pas de rejeu automatique des activations et cautions, anomalie `EDGE_REPLAY_FAILED` ouverte par la fonction de base (`0068`) (ADR-162) | Le contrat interdit `ACTIVATION` et `DEPOSIT_CASH` dans un lot de terminal | Changer le contrat |
| `STALE` persisté seulement si confirmé ou plausible (au plus +2), levée locale à deux (ADR-165) | Un en-tête forgé ne doit pas arrêter le site | `STALE` sur toute époque supérieure |
| Droits étroits du central pour la réception : `check_balanced` en `SECURITY DEFINER`, six fonctions `cashless_edge` seul (ADR-174, ADR-182, ADR-183) | Aucun droit de table pour `cashless_edge` | Droit de lecture sur `posting` |
| Clé d'origine de la voie passerelle alignée sur `deviceKey` (`<serial>:<seq>` sur 4 chiffres), migration `0070` (décision 52) | Sinon une opération reçue de deux voies n'est pas reconnue comme doublon (NFR-003) | Clé propre à la passerelle |
| Lot sans opération accepté s'il porte des ordres locaux ; refusé en base sinon (décisions 50 et 51, `0069`, `edge-0009`) | Verser l'ordre de purge avant la destruction | Purge forcée après 30 s (ADR-187, levé) |
| Ordre de dépense (`spend_order`) répliqué dans `edge_terms` (décision 45, ADR-185) | Sinon `PROMO_FIRST` en dur diverge au rejeu d'un événement en `PAID_FIRST` | Dette nommée |
| Horloge : recul accepté de l'heure du central limité à 5 min (décision 20) | La borne de 24 h figeait l'horloge | Borne de 24 h |

## Écarts entre le plan et le livré (détectés à la review)

1. **Migrations centrales** : `0058` à `0072` au lieu de `0058` à `0061` (corrections `0064`, `0065`, `0068` à `0072`, accès étroits `0066`, `0067`). Série passerelle : `edge-0001` à `edge-0010` (le plan n'en prévoyait qu'une).
2. **Processus et rôles** : un seul processus passerelle (pas de séparation en plusieurs) ; le travailleur de colis tourne dans le processus `tag-keys` ; rôles ajoutés `cashless_maint` (rendu bloqué, `0065`) et `cashless_tagkeys` (lecture étroite `0067`).
3. **Contrat** : ajouts plus nombreux que les trois du plan (`edge_terms`, `spend_order`, `local_orders`, lot sans opération, `Problem.edge_base_url` et `authority_epoch`), tous facultatifs et rétrocompatibles, décisions 33, 35, 36, 45, 50.
4. **Défauts trouvés par les bancs de bout en bout de WP25 et corrigés** : clé d'origine non complétée sur la voie passerelle (`0070`) ; `#deposit` absent d'`originKeyOf` ; déclencheur de session de caisse utilisable seulement au premier cycle (`edge-0010`) ; page de réplication de 500 au lieu de 200 ; défaut A, colis déposé sans émission dans le flux (`0071`) ; défaut B, opérations hors ligne relayées sans `edge_decision`, toutes refusées au central (`edgeDecisionOf`) ; défaut C, dépôt de colis avant la fin du délai de garde (`0072`, délai inchangé à 1 800 s) ; intervalle `max_snapshot_age` lu en secondes.
5. **Purge** : la purge manuelle verse l'ordre au central avant la destruction (décision 48) ; d'où le lot d'ordres seuls (décisions 50 et 51). Limites WAL, blocs libres et tables d'ajout seul consignées (OP-N118).
6. **Clé TLS client** : la décision 22 (clé non exportable) n'est pas faisable sans dépendance native ; clé en fichier durci, levée en 12b (décision 32, OP-N113).
7. **NFR-001** : 0 violation mais 66 débits/s en local (saturation de PostgreSQL dans la VM Docker), contre 100 exigés ; le plancher de 100 est exigé dans le job CI `gateway-e2e` (décision 54), preuve de référence à obtenir sur un exécuteur Linux. NFR-005 : p95 de 409 ms ramené à 176 ms (verrou de chaîne raccourci). NFR-006 : 10 000 opérations vidées en 6,6 min avec `kill -9`. NFR-007 : accusé en 0,2 à 0,3 s.

## Dettes de sécurité nommées (règle du porteur du 13/10/2026)

OP-N100 à OP-N119 et ADR-155 à ADR-187 (hors ADR-180 et ADR-181, d'un autre chantier), chacune avec test de borne et report en 12b, 13 ou
une mission ultérieure ; OP-N117 et OP-N119 levés par WP25 (11/11/2026). Fichiers à faire relire par une personne : liste par lot dans
`docs/passation-8/suivi-lots.md` (lignes « Relecture humaine ») et `.github/CODEOWNERS` : `0058` en entier, `0061`, `0066`, `0068`, `0070`
à `0072`, `post-roles.sql`, `key-store/`, `authority/site-order.ts`, `purge/`, `drain.service.ts`, `admin-tls.ts`, `Dockerfile`. L'agent
qui a écrit le code ne vaut pas relecture indépendante.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » et ligne de détail de la mission. Vue C4 : la passerelle,
sa base locale et le processus central `/edge/*` y figurent ; libellés recalés à la review.

## Nécessaire pour cette mission ? Oui : nouveau conteneur (passerelle), nouveau processus et nouveaux rôles de base au central, nouvelles décisions de sécurité (réponse proposée par l'Agent le 12/11/2026, en attente de confirmation du porteur).
## Complet ? Oui, recalé à la review sur les migrations réelles, les processus et rôles réels et les défauts de WP25 (réponse proposée par l'Agent le 12/11/2026, en attente de confirmation du porteur). Reste à recaler après l'acceptation : la preuve CI du plancher NFR-001 sur un exécuteur Linux.
## Validé par : réponse proposée par l'Agent le 12/11/2026, en attente de confirmation du porteur.
