# Relecture contradictoire du plan, mission 8 (passerelle-locale-01M6NM1S)

Relecteur indépendant. Périmètre lu : `docs/passation-8/contexte-m8.md`, `spec.md`, `plan.md`, `research.md` (R-01 à R-30), `data-model.md`, `contracts/*`, `quickstart.md`, puis vérification dans `packages/ledger-sql/schema_grand_livre_cashless.sql`, `post-roles.sql`, `roles.sql`, les migrations `0036`, `0040`, les tests générés `tests_grand_livre_cashless.sql` et `tests/*.sql`, `packages/contracts/openapi.yaml`, `docs/sync_protocol.md` §8 et §9, `apps/api/src/device-tokens/device-token.service.ts`, `apps/api/src/device-identity/request-signature.ts`, `apps/api/src/processes/bootstrap.ts`, `apps/api/src/config/config.ts`.

Aucun fichier du dépôt n'a été modifié en dehors de ce rapport. Rien n'a été exécuté (ni Jest, ni pgTAP, ni reset-db). Ne figurent ici que des points relus dans le texte ou le code ; quand un point est une déduction, c'est dit.

Légende « Porteur » : oui si le correctif est un écart de sécurité, un changement de contrat ou une décision de politique que `CLAUDE.md` ou la décision 7 réservent au porteur.

---

## Constats BLOQUANTS

### A01. Les terminaux ne peuvent pas s'authentifier sur la passerelle au-delà de 15 minutes : US2 et SC-001 sont inatteignables en l'état

- **Gravité** : BLOQUANT.
- **Preuve** :
  - `research.md:512-522` : le rafraîchissement du jeton d'appareil est « À SOUMETTRE AU PORTEUR » et, par défaut, « rien n'est codé pour `refreshDeviceToken` sur la passerelle ». Le jeton du central tient « jusqu'à son `exp` » (15 minutes, `config.ts` : `deviceTokenTtlSeconds`).
  - `contracts/replication-page-additions.yaml:546-550` écarte `device_token_keys` et `device_token_families` du flux : « Aucun besoin de la famille ni des clés publiques du central ». Or `research.md:501-503` et `619-621` font vérifier les jetons du central sur la passerelle avec des clés « répliquées ». Les deux documents se contredisent ; avec la version du contrat, la passerelle ne peut vérifier aucun jeton émis par le central, donc même les 15 minutes de grâce disparaissent.
  - `research.md:504-507` affirme qu'un « second contrôle `aud` est ajouté » au vérificateur central et, trois lignes plus haut, « sans modifier celui du central ». Le contrôle existe déjà : `apps/api/src/device-tokens/device-token.service.ts:118` (comparaison du `kid` avant toute cryptographie) et `:124` (`audience: DEVICE_TOKEN_AUDIENCE`). Le « test de refus au central » n'a donc rien de nouveau à prouver côté code, mais sa description est fausse.
- **Scénario de panne** : bascule à 18 h, coupure Internet. À 18 h 15 plus aucun terminal n'a de jeton valable sur la passerelle, aucun ne peut en obtenir (opération 1 des 16 suspendue). Le site entier est à l'arrêt alors que la passerelle « détient l'autorité » : c'est exactement la panne que la mission doit éviter, et NFR-005 et SC-001 ne sont pas jouables.
- **Correctif** : obtenir la réponse du porteur sur les options (a), (b), (c) de R-19 avant `tasks`, et trancher dans la même réponse si les clés publiques du central sont répliquées. Si l'option (a) est retenue, préciser le contrôle de substitution (empreinte courante, durée de vie du jeton de la passerelle, rotation locale de la preuve de possession) et son test. Corriger la phrase fausse sur `aud`.
- **Porteur** : oui (affaiblissement possible de la détection de réutilisation du jeton de rafraîchissement, règle 1).

### A02. Deux conceptions incompatibles du flux de réplication coexistent dans les pièces du plan ; la contre-vérification de contrat n'est pas alignée

- **Gravité** : BLOQUANT.
- **Preuve** :
  - `research.md:603-645` (R-24) : champs `edge_seq_applied`, `service_state`, `service_state_version`, `device_seq_acked` ; aucun nouveau paramètre ; `after_change_seq` est « À SOUMETTRE AU PORTEUR (optimisation, non bloquante) ».
  - `contracts/replication-page-additions.yaml:26-41, 76-92` et `contract-stability-check.md:62-66` : bloc `reference`, paramètre `after_change_seq` (déjà inscrit en liste blanche), `pwd_pack_key`, `kyc_verified`, `topup_month_paid`. Aucune trace de `edge_seq_applied`, ni de `device_seq_acked` (grep sur tout `contracts/` : zéro occurrence).
  - `research.md:232-238` et `data-model.md:117-120` : colis scellé par bracelet, déposé par le processus `tag-keys` dans `edge_pwd_pack` ; le yaml (`pwd_pack_key`) prévoit une clé de contenu unique par page. Deux mécanismes de scellement différents.
  - `data-model.md:257-258` et `research.md:640-645` fondent la protection contre le double comptage (solde central + deltas locaux d'`edge_seq > edge_seq_applied`) sur `edge_seq_applied`, qui n'a aucun support dans le contrat décrit par `contracts/`. `gateway-served-operations.md` ligne 4 lit `devices[].seq_status` « (base) », encore autre chose que `device_seq_acked`.
- **Scénario de panne** : un lot écrit selon `research.md` (sans `reference`) et un lot écrit selon `contracts/` (avec `reference`) produisent deux passerelles et deux centraux qui ne se parlent pas. Plus grave : sans `edge_seq_applied`, la passerelle compte deux fois la même vente (delta local + solde central déjà débité par le rejeu) ou, selon l'ordre d'application, ne la compte pas : le solde local peut alors dépasser le solde réel (voir A03 et A09).
- **Correctif** : figer un seul schéma de flux dans `contracts/replication-page-additions.yaml`, y ajouter `edge_seq_applied` (par page, lu dans la même transaction `REPEATABLE READ` que les soldes) et `device_seq_acked`, aligner `contract-stability-check.md` et `contract-baseline.json` sur ce schéma exact, supprimer l'autre version de `research.md`. Faire trancher par le porteur le paramètre `after_change_seq` (le plan le traite à la fois comme « soumis » et comme « admis »).
- **Porteur** : oui pour le paramètre de requête (hors lettre de la décision 7, `research.md:636-639`) ; non pour le reste (cohérence documentaire).

### A04. Les contraintes proposées sur `edge_gateway` cassent les tests générés du kit, qu'il est interdit de modifier, et la reprise forcée

- **Gravité** : BLOQUANT (priorité des sources : tests exécutables au-dessus du reste, `SPECIFICATION.md` §0.3 ; C-010).
- **Preuve** :
  - `data-model.md:35-44` ajoute `ledger_id uuid NOT NULL`, `registered_by_label text NOT NULL`, `UNIQUE (event_id) WHERE role='PRIMARY' AND status<>'REVOKED'`, `CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)`.
  - `packages/ledger-sql/tests_grand_livre_cashless.sql:499-500` (issu de `gen_tests.py:647`) insère `GW-1` PRIMARY et `GW-3` PRIMARY **pour le même événement** `…0e1`, avec les colonnes `(id, operator_id, event_id, serial, role)` seulement : l'index unique partiel et les `NOT NULL` font échouer le fichier. Même insertion sans `ledger_id` dans `tests/tests_definer_search_path.sql:50` et `tests/tests_offline_snapshots.sql:64`.
  - La même suite (`tests_grand_livre_cashless.sql`, scénario de reprise forcée) appelle `force_central_authority`, qui fait `UPDATE edge_gateway SET status = 'REVOKED'` sans toucher `revoked_at` (`schema_grand_livre_cashless.sql`, fonction `force_central_authority`). Avec la nouvelle `CHECK`, la seule sortie de secours de la mission lève une erreur de contrainte. `data-model.md:39` dit que `force_central_authority` écrit `revoked_at`, mais `A.4` (`data-model.md:82-85`) ne la range ni parmi les fonctions modifiées, ni parmi celles qui ne le sont pas, et C-003 interdit de la réécrire.
- **Scénario de panne** : passerelle détruite, deux admins approuvent la reprise forcée, la fonction échoue sur `CHECK`. L'autorité reste `EDGE`, plus personne ne débite sur tout l'événement tant qu'un correctif n'est pas déployé.
- **Correctif** : colonnes nouvelles nullables (ou avec valeur par défaut posée par déclencheur), unicité de la primaire contrôlée dans `register_edge_gateway` et `set_edge_gateway_role` (pas par index), `revoked_at` posé par un déclencheur `BEFORE UPDATE` quand `status` passe à `REVOKED`, ou `CHECK` supprimée. Ajouter au plan un lot de non-régression « les suites générées passent sans modification après 0058-0061 ».
- **Porteur** : non (cohérence), mais les migrations concernées figurent déjà dans la liste « à faire relire par une personne ».

### A05. `operations_count = final_edge_seq` fait échouer tout rendu après le premier, donc force la reprise forcée à la deuxième coupure

- **Gravité** : BLOQUANT.
- **Preuve** : `research.md:198` et `data-model.md:71` : « `ops = final_seq` (numérotation à partir de 1) ». Or le registre et la chaîne sont par passerelle, pas par bascule : `edge_sync_registry PRIMARY KEY (gateway_id, edge_seq)` et `edge_gateway.contiguous_edge_seq` ne repartent jamais de zéro (`schema_grand_livre_cashless.sql`, `record_edge_seq` : `p_edge_seq <> g.contiguous_edge_seq + 1`), et `data-model.md:219` ne remet pas `last_edge_seq` à 0 au rendu. Au deuxième cycle `EDGE`, la passerelle numérote 4212, 4213… : son `operations_count` (nombre d'opérations de ce cycle) ne peut pas valoir `final_edge_seq`.
- **Scénario de panne** : lien instable, ce qui est le cas d'usage de la mission (US1). Deuxième bascule, 40 ventes, rendu : `final_edge_seq = 4251`, `operations_count = 40`. Le central refuse (`CHAIN_BROKEN` d'après `edge-routes.md`), la file est vidée, le rendu ne passe jamais, il ne reste que la reprise forcée à deux, qui révoque la passerelle. Les tests de NFR-001 et NFR-002 (une seule bascule) ne le voient pas.
- **Correctif** : définir `operations_count` comme `final_edge_seq - edge_seq_at_activation` (valeur persistée à l'accusé des deux côtés), ou le contrôler contre le compte de lignes du registre pour ce handover. Ajouter un test à deux cycles consécutifs sur la même passerelle (bascule, ventes, rendu, bascule, ventes, rendu), puis un cycle après changement de rôle.
- **Porteur** : non (le contrat ne définit pas la sémantique du champ ; la règle choisie est à consigner).

---

## Constats ÉLEVÉS

### A03. Les blocages et l'état de service ne sont ni couverts par le filigrane ni livrables par un curseur sur `posting.id`

- **Gravité** : ÉLEVÉ.
- **Preuve** :
  - `openapi.yaml:6968-6977` : le flux porte les « changements de statut des bracelets », avec pour seul curseur `after_posting_id`. Un blocage de bracelet n'écrit aucun `posting`. `research.md:629-635` en convient (« les entités sans `posting.id` n'ont pas de curseur ») mais range `media` parmi les ensembles pagés par `posting.id`.
  - `ack_edge_handover` ne contrôle que `p_replicated_posting_id >= watermark_posting_id` (`schema_grand_livre_cashless.sql`, `ack_edge_handover`). Le filigrane ne dit rien de `service_state` / `reference` (sessions, terminaux, blocages).
- **Scénario de panne** : un bracelet est déclaré perdu et bloqué à 17 h 59 min 55 s, l'admin bascule à 18 h 00. La passerelle rattrape les écritures jusqu'à W, accuse, puis sert un paiement sur le bracelet que le central avait bloqué : le blocage n'est livré que sur le prochain passage de l'état complet. NFR-008 (5 s) est mesuré après l'ouverture, pas à l'accusé.
- **Correctif** : (1) écrire que `media[]` est servi en état complet à chaque passe (ou par un curseur de changement), pas par `posting.id` ; (2) interdire l'accusé tant que la passerelle n'a pas appliqué une lecture complète de l'état de service **commencée après** avoir vu `GRANTED` (le grand livre ne débite plus au central depuis le commit de `GRANTED`, donc cette lecture est exacte) ; (3) test : blocage sans écriture une seconde avant la bascule, vente refusée dès la première requête après l'accusé.
- **Porteur** : non (renforcement), sauf si le choix passe par `after_change_seq` (voir A02).

### A06. Les bornes de décision sont dans le code TypeScript du processus `edge`, pas dans les enveloppes SQL : `cashless_edge` peut écrire n'importe quelle ligne en source `EDGE_SYNC`

- **Gravité** : ÉLEVÉ.
- **Preuve** : `research.md:245-260` : l'enveloppe `edge_post_transaction(p_gateway, p_epoch, p_origin_key, …, p_decision, …)` ne vérifie en SQL que passerelle, handover, époque et présence de `origin_*`. Les bornes 1 à 5 (`research.md:269-283`) sont décrites dans `edge-sync.writer.ts`. `post_transaction` accepte des lignes libres (`p_lines jsonb`) et c'est la seule source qui peut débiter un portefeuille sous `EDGE` (`schema_grand_livre_cashless.sql`, garde CL006). La garde sur `session_user` retire cette puissance à `cashless_app` (`research.md:251-256`) pour la donner à `cashless_edge`, un processus qui lit des corps de requête venus d'un site distant.
- **Scénario de panne** : un défaut d'analyse du corps (ou une compromission du processus `edge`) fait passer des lignes arbitraires : débit de portefeuilles hors de l'événement de la passerelle, crédit d'un compte marchand, type `ADJUSTMENT`. Le grand livre l'accepte, puisque la source `EDGE_SYNC` est autorisée sous `EDGE`. Dernier point : si le contrôle « `charged_to_wallet <=` solde central » est une lecture suivie d'une écriture, une concurrence fait lever `CL007` (solde insuffisant) **après** `record_edge_seq` ; le plan ne dit pas ce qui arrive du numéro et du lot (blocage perpétuel du vidage ou numéro consommé sans effet).
- **Correctif** : mettre les bornes en SQL, dans l'enveloppe, sous verrou de compte : liste blanche de types, comptes de la forme attendue par type (portefeuille de l'événement, compte marchand du point de vente du terminal, caisse de la session), somme nulle déjà garantie, plafond unitaire, et `edge_post_transaction` qui construit lui-même les lignes à partir de `(media, montant, décision)` au lieu de les recevoir. Spécifier le traitement de `CL007` en `EDGE_SYNC` (rogner à la borne sous verrou, jamais lever après `record_edge_seq`) ; `record_edge_seq` et l'écriture dans **une seule transaction** par opération (le texte de `research.md:228-229` ne le dit pas explicitement ; voir A09). Signaler `0058` à la relecture humaine, déjà prévu.
- **Porteur** : non (renforcement), mais la liste des fichiers à faire relire par une personne doit citer l'enveloppe.

### A07. Une décision `EDGE_ONLINE` n'est vérifiable sur aucune preuve du terminal : une passerelle compromise invente des ventes sur tout bracelet de l'événement, jusqu'à son solde

- **Gravité** : ÉLEVÉ.
- **Preuve** : `openapi.yaml:14416-14485` : pour `EDGE_ONLINE`, aucune signature du terminal n'est relayée (la signature d'origine n'existe que pour `DEVICE_OFFLINE`, `device_batches`). `research.md:269-283` borne le montant par le solde central et le périmètre par l'appartenance, `research.md:284-286` reconnaît le risque, sans le réduire. Aucune borne par vente (`max_per_sale`), par terminal, par durée, ni vérification de la preuve du bracelet (compteur, UID, signature de passage) que le central sait faire pour les lots hors ligne (mission 7).
- **Scénario de panne** : une passerelle volée ou infectée émet 2 000 `PURCHASE` fictifs vers un compte marchand complice, chacun sous le solde du portefeuille visé ; le rendu les rejoue tous. Le plafond est la somme des soldes de l'événement, soit tout l'argent des festivaliers.
- **Correctif** (du moins coûteux au plus fort) : (1) au rejeu, exiger l'objet `tap` (compteur strictement croissant, UID, signature de bracelet vérifiée) et que `token_hash` désigne le portefeuille débité ; (2) appliquer `max_per_sale` et un plafond par terminal et par heure dérivés de la politique hors ligne, avec alerte ; (3) relayer l'en-tête de signature RFC 9421 du terminal avec un hachage de corps dans `edge_guichet`-like (ajout de contrat sous `/edge/*`, à faire décider). Si le porteur accepte le risque tel quel, l'écrire dans un ADR avec l'ordre de grandeur de la perte maximale.
- **Porteur** : oui pour (3) (contrat) et pour l'acceptation du risque résiduel ; (1) et (2) sont des renforcements.

### A08. Le rejeu d'un `REVERSAL` peut créer de l'argent

- **Gravité** : ÉLEVÉ.
- **Preuve** : la liste des bornes `research.md:269-283` ne traite aucun `REVERSAL` : ni cible dans le même grand livre, ni même portefeuille, ni « pas déjà annulée », ni montant plafonné à ce qui a réellement été débité au central. `data-model.md:234` autorise le type. Or la borne 2 (`charged_to_wallet <= solde central`) peut **rogner** la vente d'origine (`EDGE_BALANCE_EXCEEDED`) tandis que l'annulation de la passerelle recrédite le montant local complet.
- **Scénario de panne** : vente de 3 000 locale, rognée à 1 000 au rejeu (le reste en `S-ATTENTE`), puis annulation locale de 3 000 : le portefeuille reçoit 3 000 au central pour 1 000 débités, +2 000 créés, et l'attente n'est pas apurée. Même chose avec une annulation émise deux fois sur le même `reverses_seq` si la passerelle est défaillante.
- **Correctif** : l'écrivain `REVERSAL` reprend les contrôles de l'annulation en ligne (cible existante, même grand livre, même portefeuille, jamais annulée) et crédite au plus `charged_to_wallet` de la vente **telle qu'écrite au central** ; l'excédent suit la vente d'origine en `S-ATTENTE`. Test : annulation d'une vente rognée.
- **Porteur** : non (renforcement).

### A09. Une recharge espèces décidée par la passerelle puis refusée au rejeu perd l'argent, et l'invariant « solde local jamais au-dessus du réel » est faux pour les crédits locaux

- **Gravité** : ÉLEVÉ.
- **Preuve** :
  - `research.md:307-310` : `edge_topup_cash` applique `check_wallet_limits` « à l'identique d'une recharge en ligne », donc **rejette** `MONTHLY_TOPUP_LIMIT_EXCEEDED` ou `WALLET_LIMIT_EXCEEDED`. Le protocole prévoit l'inverse pour une recharge espèces rejouée : écriture en deux parts, anomalie `CASH_TOPUP_OVER_LIMIT`, jamais de rejet (`docs/sync_protocol.md` §8, dernière ligne du tableau des plafonds). Autres causes de rejet au rejeu non traitées : session de caisse fermée côté central par un chemin non couvert (`research.md:346-348`), bracelet entre-temps retiré.
  - `spec.md` FR-020 et `research.md:311-317` ne prévoient le « rejeu impossible » que pour `ACTIVATION` et `DEPOSIT_CASH`. `TOPUP_CASH` n'est traité que pour le cas « passerelle perdue » (R-23).
  - `data-model.md:311-312` (invariant B.7.5) crédite le solde local d'une recharge avant le rejeu, ce qui contredit US5 (« le solde vu y reste inférieur ou égal au solde central », `spec.md`) et `plan.md` IC-09 (« soldes locaux jamais au-dessus du central »).
- **Scénario de panne** : un caissier encaisse 20 000 espèces, le bracelet est crédité localement, le festivalier dépense 18 000 sur la passerelle. Au rejeu, la recharge est rejetée (plafond mensuel dépassé selon le central) : les 18 000 de ventes sont rognés à un solde central de 0 et partent en compte d'attente, les 20 000 espèces sont dans la caisse physique sans écriture. Perte pour le prestataire et écart de caisse sans anomalie dédiée.
- **Correctif** : au rejeu, la recharge espèces d'une passerelle n'est jamais rejetée pour un plafond : partage en deux parts selon `wallet_topup_headroom` et anomalie, comme le protocole. Toute cause de rejet résiduelle crée une anomalie portant le montant et le terminal, et les ventes qui en dépendent sont traitées comme manque (déjà prévu). Corriger l'invariant B.7.5 et IC-09 : le solde local peut dépasser le central de la somme des recharges non rejouées ; c'est la borne 2 qui protège le central, pas la monotonie.
- **Porteur** : oui (traitement comptable d'une perte possible, hors ce que décrit le protocole).

### A10. Les clés d'origine des opérations de guichet ne correspondent ni à l'idempotence du terminal, ni à ce que le journal du terminal renverra après une reprise forcée

- **Gravité** : ÉLEVÉ.
- **Preuve** :
  - `research.md:318-321` : `activateMedia` et `takeDeposit` « ne portent pas de numéro de terminal », donc `origin_key = <device_serial>:edge:<edge_seq>`. Or `contracts/gateway-served-operations.md` (lignes 7 et 8 du tableau) indique `Idempotency-Key` `<serial>:<seq>` pour ces deux opérations. Contradiction interne au plan, à lever sur `openapi.yaml`.
  - `research.md:374-375` (R-12) l'admet : l'objet `ONLINE_REF` que le terminal enverra plus tard n'est « pas le même ». `research.md:591-598` (R-23) détecte l'« opération inconnue du central » par la clé ; une activation déjà rejouée sous `…:edge:N` n'est pas retrouvée sous `…:<seq>`.
- **Scénario de panne** : (a) reprise forcée : le journal renvoie 40 activations déjà reversées par la passerelle avant sa perte ; le central les juge « inconnues » et ouvre 40 anomalies `EDGE_REPLAY_FAILED` pour des opérations réussies, noyant les vraies. (b) La requête d'activation est d'abord envoyée au central juste avant la bascule (réponse perdue), puis rejouée sur la passerelle : deux clés différentes, donc pas de `DUPLICATE` ; la caution est prise deux fois ou l'activation échoue en `EDGE_REPLAY_FAILED` à tort. NFR-003 (« par tous les chemins ») n'est pas tenue pour le guichet.
- **Correctif** : utiliser l'`Idempotency-Key` du terminal (`<serial>:<seq>`) comme clé d'origine de toutes les opérations de guichet, `edge_seq` ne servant qu'à l'ordre ; si `ACTIVATION` et `DEPOSIT_CASH` partent d'une même requête, dériver un suffixe stable (`#deposit`). Écrire le test : même requête envoyée au central puis à la passerelle, puis journal après reprise forcée.
- **Porteur** : non.

### A11. Les ajouts d'énumération prévus modifient des schémas partagés avec des routes de terminal : changement de contrat hors `/edge/*`

- **Gravité** : ÉLEVÉ.
- **Preuve** : `research.md:743-745` ajoute `EDGE_BALANCE_EXCEEDED` (à `ShortfallReason`) et `EDGE_DECISION_INVALID` (à `OfflineRejectReason`) « s'ils n'y existent pas déjà ». Ils n'y existent pas (`openapi.yaml:14290-14331`) et les deux énumérations sont référencées par `OfflineOperationResult` (`openapi.yaml:14363, 14371`), schéma de résultat de `submitOfflineBatch` et `getOfflineBatchResult`, routes de terminal. `contract-stability-check.md:55-58` refuse précisément ces modifications (règle 5) : la CI du plan échoue sur le plan lui-même. `research.md:802-803` (écart 8) ne tranche pas.
- **Scénario de panne** : un client Dart généré strictement sur l'énumération rejette un résultat portant une valeur inconnue : le terminal se bloque au retour du lot de la passerelle.
- **Correctif** : ne rien ajouter. Réutiliser `MALFORMED_OPERATION` pour une décision incohérente et `INSUFFICIENT_FUNDS` pour un excédent de solde, avec le détail dans `detail` (champ libre). Si le porteur tient aux nouvelles valeurs, c'est une décision de contrat, à soumettre avant le codage.
- **Porteur** : non si valeurs existantes réutilisées ; oui sinon.

### A12. Une requête portant une époque forgée met la passerelle en `STALE` définitivement

- **Gravité** : ÉLEVÉ.
- **Preuve** : `research.md:453-455` et `data-model.md:206, 350` : toute requête portant une époque supérieure fait persister `STALE` et `highest_epoch_seen` avant de répondre, et on n'en sort que par un nouvel accord « sur une époque supérieure à celle vue ». La passerelle ne peut pas vérifier l'en-tête `X-Authority-Epoch` hors du central.
- **Scénario de panne** : un terminal défectueux ou volé (il a un certificat, un jeton, une signature valides) envoie `X-Authority-Epoch: 9999`. Plus aucun débit sur le site jusqu'à ce que le central ait incrémenté son époque 9990 fois : la passerelle est inutilisable jusqu'à une intervention manuelle non prévue par le plan.
- **Correctif** : une époque vue dans une requête de terminal ne persiste `STALE` que si elle est corroborée par le canal de contrôle du central (long-polling) ou plausible (`<= epoch détenue + 2`, comme le protocole `e+2` au rendu) ; sinon la requête reçoit `409 STALE_AUTHORITY_EPOCH`, sans persister, avec alerte. Prévoir une levée locale à deux personnes si le canal central est coupé. Test : en-tête forgé.
- **Porteur** : oui (la règle de persistance de FR-012 est une règle d'exclusion ; la relâcher partiellement doit être décidé, même si c'est pour la disponibilité).

### A13. Le plan ne dit pas comment la passerelle lit l'échec d'un rendu, ni quel handover rend `getCurrentEdgeHandover` quand deux sont ouverts

- **Gravité** : ÉLEVÉ.
- **Preuve** : `schema_grand_livre_cashless.sql` : `handover_one_open` est unique par `(ledger_id, direction)` ; un `TO_EDGE ACTIVE` et un `TO_CENTRAL RELEASE_REQUESTED` sont ouverts **en même temps** pendant le rendu. `research.md:195` définit `get_current_edge_handover` comme « le handover ouvert (GRANTED, ACTIVE, RELEASE_REQUESTED, RELEASING) » au singulier, et `DebitAuthorityState.handover` est un objet unique ou nul (`openapi.yaml:14685-14690`). Pour FR-023, la passerelle doit reconnaître « `FAILED` pour la même époque » (`research.md:451-452` : « elle lit `get_current_edge_handover` et compare l'identifiant »), mais une ligne `FAILED` n'est plus « ouverte » et ne serait jamais rendue.
- **Scénario de panne** : (1) la fonction rend le `TO_EDGE ACTIVE` et la passerelle redémarrée en `RELEASING` y lit « ACTIVE, même époque » : elle reprend les débits alors que le rendu est en cours (deux autorités au moment de la vérification de continuité). (2) À l'inverse, après un vrai `fail_edge_release`, rien ne rend la passerelle à `ACTIVE` et le site reste muet.
- **Correctif** : fixer par écrit la priorité (le `TO_CENTRAL` ouvert l'emporte), faire rendre l'état du `TO_CENTRAL` le plus récent y compris `FAILED` pendant une fenêtre bornée à l'époque détenue, et ajouter au test de FR-023 les quatre cas : restart pendant `RELEASING`, avec `RELEASE_REQUESTED` toujours ouvert, avec `FAILED`, avec `COMPLETED`.
- **Porteur** : non (précision de comportement dans la lettre du contrat actuel), à moins que la sémantique demande un champ ajouté.

### A14. L'horloge de la passerelle est falsifiable et repart de zéro au redémarrage ; les durées de 12 h et de session en dépendent

- **Gravité** : ÉLEVÉ.
- **Preuve** : `research.md:406-414` : l'heure servie est `heure_système + central_offset` tant que l'écart reste sous 120 s, sinon `dernière_heure_centrale + (monotone_maintenant - monotone_à_la_mesure)`. `data-model.md:213` persiste `measured_at_monotonic_ms`. Une horloge monotone n'a de sens que dans un seul démarrage du système : après un redémarrage de la machine (onduleur vidé, coupure de courant, fréquente sur site) la valeur persistée est incomparable. Rien n'empêche non plus de reculer l'horloge système sous 120 s répétés. Cette heure borne `token_tolerance_until` (`data-model.md:204`, `research.md:533-535`), les sessions vendeur de 12 h, la fenêtre de nonces et la tolérance de signature.
- **Scénario de panne** : après redémarrage hors lien, l'horloge matérielle de la machine est à la date par défaut du BIOS ou reculée par un technicien. La fenêtre « 12 h après la bascule » devient indéfinie ; une session vendeur expirée redevient valide.
- **Correctif** : persister un **plafond d'heure** (le maximum jamais observé, central ou système) et ne jamais servir une heure inférieure à ce plafond ; au redémarrage, `maintenant = max(heure système, plafond)`, et refuser l'accusé si l'écart dépasse la tolérance. Test : redémarrage avec horloge reculée de 2 h puis de 13 h, jeton à 12 h + 1 s refusé.
- **Porteur** : non (renforcement).

### A15. La tolérance du jeton de personne expiré n'est pas bornée par l'ancienneté de l'expiration

- **Gravité** : ÉLEVÉ.
- **Preuve** : `research.md:526-540` (R-20) : conditions 1 à 7. La condition 5 vérifie `iat <= activated_at` et `maintenant <= activated_at + 12 h`, mais pas que le jeton était encore valable (`exp`) à l'instant de la bascule. Les sessions de caisse peuvent rester ouvertes plusieurs jours (`cash_session` : états `OPEN`/`CLOSING`/`CLOSED`, aucune durée maximale dans `0036`).
- **Scénario de panne** : un caissier ouvre sa session le vendredi et la laisse ouverte, avec un jeton de personne expiré depuis le vendredi soir. À la bascule du dimanche, ce jeton (volé d'un journal, d'un téléphone) est accepté 12 h de plus sur le terminal de la session. La décision 3 du porteur parle d'un jeton expiré **pendant** la coupure.
- **Correctif** : ajouter la condition `exp >= activated_at` (le jeton était valable à la bascule), de sorte que seul un jeton dont l'expiration tombe dans la fenêtre de coupure soit toléré. C'est un renforcement : le faire, puis le consigner (règle 1).
- **Porteur** : non (renforcement) ; le consigner dans l'ADR de la décision 3.

---

## Constats MOYENS

### A16. L'inscription d'une passerelle n'exige pas deux personnes, et une passerelle `STANDBY` reçoit déjà les mots de passe des bracelets

- **Gravité** : MOYEN.
- **Preuve** : `research.md:133-155` : `register_edge_gateway(…, agreement_public_key, …, actor_label)` accessible au rôle `cashless_edgeadmin`, aucune approbation. `research.md:236-238, 461` : le flux sert les colis à toute passerelle non `REVOKED`, `STANDBY` incluse. L'unicité de la primaire est contrôlée par la fonction de rôle (`set_edge_gateway_role`, refusée si un handover est ouvert).
- **Scénario de panne** : une personne disposant du rôle de l'outil inscrit une passerelle `STANDBY` avec sa propre clé d'accord : le flux lui remet les mots de passe de tous les bracelets de l'événement. Aucune alerte n'est prévue à l'inscription.
- **Correctif** : inscription et changement de rôle soumis à une demande d'approbation `ADMIN` (deux personnes, comme la reprise forcée), ou au minimum une alerte immédiate et un délai avant le premier colis ; colis servis seulement après `ACTIVE`/primaire inscrit depuis plus de N minutes. Documenter dans la procédure de site.
- **Porteur** : oui (droit nouveau, règle 1).

### A17. L'accusé de bascule n'est pas idempotent côté SQL alors que `edge-routes.md` le promet

- **Gravité** : MOYEN.
- **Preuve** : `schema_grand_livre_cashless.sql`, `ack_edge_handover` : `IF h.status <> 'GRANTED' THEN RAISE … 'CL013'`. `contracts/edge-routes.md` (section `ackEdgeHandover`/idempotence) : « `ack` et `release` sont idempotents par construction ». `data-model.md:344` ne traite que le redémarrage, pas la répétition d'un `POST` dans le même processus après un délai dépassé.
- **Scénario de panne** : le `200` est perdu dans le lien, le central est déjà `ACTIVE`. La passerelle renvoie l'accusé, reçoit `409 HANDOVER_INVALID_STATE`, la traite comme un échec, repasse `ARMED`. Le central pense la passerelle active, personne ne débite jusqu'au rendu.
- **Correctif** : l'enveloppe `edge_ack_handover` renvoie l'état courant (`200`) quand le handover est déjà `ACTIVE` pour la même passerelle et la même époque ; test avec réponse perdue (relais coupable).
- **Porteur** : non.

### A18. Le curseur `posting.id` peut sauter une écriture qui valide hors d'ordre

- **Gravité** : MOYEN.
- **Preuve** : `research.md:629-631` : page suivante à partir de `to_posting_id`. Les écritures prennent leur `id` avant leur validation ; le verrou partagé de `post_transaction` n'ordonne pas les commits. Une écriture d'`id` 100 validée après la lecture d'une page qui contient l'`id` 101 est sautée, jusqu'à la prochaine écriture sur le même portefeuille. L'accusé est protégé (le verrou exclusif de la bascule attend les écritures en vol), pas le régime courant.
- **Scénario de panne** : une recharge PSP validée tardivement n'arrive jamais sur la passerelle ; le festivalier, qui a payé, est refusé au bar.
- **Correctif** : relire une fenêtre de recouvrement (par exemple les 30 dernières secondes) à chaque passe, ou borner `to_posting_id` à `min(xmin non validés)`. Le doublon est inoffensif (état absolu). Test à deux sessions concurrentes.
- **Porteur** : non.

### A19. La liste des faux refusés en production est incomplète et la condition de production du plan est ouverte

- **Gravité** : MOYEN.
- **Preuve** :
  - `research.md:735` (NFR-009) liste cinq ports ; le plan et le contrat ne parlent jamais de `CORS_ALLOW_ALL`, ni du démarrage en clair sans TLS (`bootstrap.ts` accepte l'écoute en clair hors production), ni des `DEVICE_REQUEST_AUTHORITIES` à joker (`config.ts:125`, `:373`), ni des secrets de test (`config.ts:226-260`). La passerelle est un nouveau binaire : tout ce que `loadConfig` refuse en production doit être refait ou réutilisé.
  - `research.md:676-677` : points d'arrêt « actifs seulement si `NODE_ENV !== 'production'` ». Ouvert si `NODE_ENV` est absent ou mal orthographié. L'API refuse toute valeur hors `production | development | test` (`config.ts:335-341`) ; le plan n'impose pas la même énumération à la passerelle.
  - Noms divergents : `quickstart.md` (`EDGE_TEST_BREAKPOINTS`, `GATEWAY_KEY_STORE`, points `before-write`) contre `research.md` (`EDGE_FAILPOINT`, `EDGE_ALLOW_FAILPOINTS`, `HARDWARE_KEYSTORE`, `before-local-write`). Un test écrit sur l'un ne garde pas l'autre.
- **Scénario de panne** : passerelle lancée avec `NODE_ENV=prod` ou sans la variable : points d'arrêt actifs (`SIGKILL` sur demande) et faux clés acceptés.
- **Correctif** : réutiliser `nodeEnv()` / l'énumération stricte de l'API dans la passerelle (échec fermé), dresser la liste exhaustive des variables « de développement » et un test de démarrage réel (`NestFactory`) par variable, y compris `CORS_ALLOW_ALL=1` en production et `NODE_ENV=staging`. Rapprocher les noms de `quickstart.md` de `research.md`.
- **Porteur** : non (règle 2 de `CLAUDE.md`).

### A20. La séparation par `@authority` entre central et passerelle est contredite par le quickstart et par R-21

- **Gravité** : MOYEN.
- **Preuve** : `request-signature.ts:133-137` : une `@authority` est acceptée si elle figure dans la liste de l'API (égalité ou `host:*`). `quickstart.md` (tableau des variables) place « l'adresse de la passerelle » dans `DEVICE_REQUEST_AUTHORITIES` **du central** ; le défaut de test est `localhost:*,127.0.0.1:*` (`config.ts:373`), qui accepte toute autre adresse locale. À l'inverse `research.md:559-564` (R-21) décrit un rejeu de requête capturée « une fois » vers l'autre côté, que `gateway-served-operations.md` dit pourtant empêché par `@authority`. Deux textes opposés.
- **Scénario de panne** : une requête de paiement signée pour la passerelle est rejouée au central (ou l'inverse) avec un nonce non vu de l'autre registre. Si les listes se recouvrent, elle passe ; elle n'écrit rien de plus qu'une opération idempotente, mais l'argument de sécurité du plan est faux tel qu'écrit.
- **Correctif** : listes disjointes, sans joker, en production et dans le test d'intégration ; test : requête signée pour A refusée par B, dans les deux sens. Retirer le risque 6 des écarts s'il disparaît, ou le garder avec les bonnes conditions.
- **Porteur** : non.

### A21. Rien n'organise la destruction des secrets sur le site après l'événement ou après une révocation

- **Gravité** : MOYEN.
- **Preuve** : `research.md:694-721` (R-27) : « aucun secret dans l'image » mais le disque garde `edge_media.pwd_pack_sealed`, `edge_snapshot_entry.pwd_pack_enc`, la clé d'accord et la clé de jetons (fausse en fichier jusqu'à la 12b, `research.md:714`), les empreintes éventuelles de jetons de rafraîchissement (`data-model.md:276`), l'audit local de tolérance. FR-033 prévoit disque chiffré, onduleur, Wi-Fi, « révocation à distance » ; une passerelle révoquée mais débranchée du lien ne reçoit pas la révocation. Aucun FR ni lot ne prévoit une purge à la clôture de l'événement.
- **Scénario de panne** : la machine revient du festival avec les mots de passe de tous les bracelets de l'événement et une clé d'accord utilisable ; une réutilisation de bracelets pour un autre événement (lots rattachés au prestataire) les rend rejouables.
- **Correctif** : ajouter une exigence de purge cryptographique (suppression de la clé d'accord et des colis, zéroïsation des tables répliquées) déclenchée par la clôture de l'événement et par un ordre local à deux personnes ; consigner la limite de la « révocation à distance ». Test : après purge, aucune occurrence du canari ni de la clé.
- **Porteur** : oui si la procédure ajoute une exigence nouvelle de périmètre (FR-033).

### A22. Le test à canari prévu laisse passer une implémentation qui stocke ou journalise le secret sous une autre forme

- **Gravité** : MOYEN.
- **Preuve** : `research.md:717-718`, `contracts/replication-page-additions.yaml:541-543` : « le flux, la base et les journaux n'en contiennent aucune occurrence », « `docker save` grep ». Un `grep` du canari en clair ne voit ni sa forme hexadécimale, `base64`, `base64url`, échappée JSON, ni une copie dans `pg_stat_statements`, dans une trace d'erreur ou dans le tas d'un processus.
- **Scénario de panne** : une journalisation de requête avec le PWD en base64 passe le test.
- **Correctif** : rechercher le canari sous toutes les représentations, inclure un contrôle positif (une version volontairement fautive du code doit faire échouer le test), et couvrir aussi les journaux de PostgreSQL local (`log_statement`), le dump et la sortie standard des processus enfants.
- **Porteur** : non.

### A23. Le « témoin positif » de CI peut passer sur une panne du script ; la référence est épinglée sans garde-fou de propriété

- **Gravité** : MOYEN.
- **Preuve** : `contracts/contract-stability-check.md` (« Preuve en CI sur le dépôt réel ») : `! node scripts/check-stability.mjs --candidate "$RUNNER_TEMP/mutated.yaml"`. Le `!` réussit pour tout code de sortie non nul : chemin de fichier erroné, erreur de syntaxe du script, `yaml` absent. Le test ne prouve alors rien (la mutation par `sed` peut aussi ne rien muter si le motif a changé). `contract-baseline.json` est modifiable par n'importe quel lot sans propriétaire de relecture imposé (« décision du porteur » en prose seulement).
- **Correctif** : exiger un code de sortie précis (par exemple `2` pour « différence refusée » et `1` pour erreur d'usage) et le message nommant le pointeur mué ; vérifier que la mutation a eu lieu (`cmp`). Placer `contract-baseline.json` sous `CODEOWNERS` ou un contrôle qui échoue si le fichier change sans la mention d'une décision.
- **Porteur** : non.

### A24. L'`ACTIVATION` reçoit `wallet_id` de la passerelle sans contrôle de nouveauté

- **Gravité** : MOYEN.
- **Preuve** : `openapi.yaml:14447-14452` : `wallet_id` « créé par la passerelle s'il est anonyme ». `research.md:300-303` : `edge_activate_media(gateway, origin_key, media, wallet, event, channel, occurred_at)` : mêmes contrôles que `activate_media` (mode d'activation, bracelet libre), rien sur la nouveauté du portefeuille. La caution espèces porte aussi `cash_desk_account_id` fourni par la passerelle (`openapi.yaml:14459`) ; `take_deposit(p_media, p_money_account)` l'accepte tel quel (`schema_grand_livre_cashless.sql`, `take_deposit`).
- **Scénario de panne** : une passerelle défaillante ou hostile attache un bracelet libre au portefeuille d'un autre festivalier (identifiant connu par la réplication) : le porteur du bracelet dépense le solde de la victime. De même une caution encaissée sur la caisse d'un autre terminal.
- **Correctif** : à l'activation anonyme, exiger un portefeuille inexistant (créé par l'enveloppe, jamais rattaché à un portefeuille existant) ; `cash_desk_account_id` doit égaler le compte de caisse du terminal d'origine, tiré de la session et de `device`, pas de la requête.
- **Porteur** : non (renforcement).

### A25. La promotion de la `STANDBY` n'a ni canal pour apprendre son rôle, ni opération atomique d'échange de rôles

- **Gravité** : MOYEN.
- **Preuve** : `data-model.md:326` « `STANDBY --> ARMED : promotion (rôle changé hors ligne de débit)` » sans dire qui informe la passerelle ; `DebitAuthorityState` ne porte pas le rôle. Côté central, `UNIQUE (event_id) WHERE role='PRIMARY' AND status<>'REVOKED'` (`data-model.md:43`) interdit deux primaires pendant l'échange ; `set_edge_gateway_role` (`research.md:461`) agit sur une passerelle à la fois.
- **Scénario de panne** : la secondaire reste `STANDBY` localement après la promotion, le central lui accorde l'autorité, elle ne la prend pas ; ou l'échange en deux instructions échoue entre les deux et l'événement n'a plus de primaire pendant une coupure.
- **Correctif** : une fonction `swap_edge_gateway_roles(old, new)` atomique, et le rôle porté par une réponse du central déjà existante (par exemple dans la configuration d'enrôlement relue à chaque long-polling). Sûreté : la passerelle ne débite jamais sans l'accusé `200`, ce qui limite le risque à la disponibilité.
- **Porteur** : non.

### A26. Le sort des deltas locaux après `DUPLICATE` ou `REJECTED` n'est pas défini, et l'affirmation « se corrige d'elle-même par la réplication » est fausse pour ces cas

- **Gravité** : MOYEN.
- **Preuve** : `spec.md` US4-5 et `research.md:644-645` : un `DUPLICATE` « se corrige d'elle-même par la réplication ». Un `DUPLICATE` n'écrit aucune ligne nouvelle : le portefeuille n'apparaît donc dans aucune page du flux (le flux se pagine sur `posting.id`), `applied_edge_seq` du portefeuille ne bouge pas et le delta reste compté. `data-model.md:242` ne dit que « purgée après `acked_edge_seq` et passage du curseur au-delà », sans le lien entre la ligne d'`edge_op` et un `posting.id`.
- **Scénario de panne** : une vente d'un bracelet réessayée juste avant la bascule (réponse perdue) est débitée deux fois localement ; le festivalier voit le solde réduit de la vente en trop jusqu'au prochain mouvement de son portefeuille. Sens sans danger pour l'argent, mais le contraire (delta supprimé trop tôt) fait dépasser le solde réel.
- **Correctif** : définir explicitement la règle de purge par issue (`ACCEPTED` : après réplication d'un solde dont `edge_seq_applied >= edge_seq` ; `DUPLICATE`, `REJECTED`, `VOID` : dès le résultat, delta annulé) et la prouver avec les deux sens.
- **Porteur** : non.

---

## Constats FAIBLES

### A27. Incohérences documentaires à corriger avant `tasks`

- **Gravité** : FAIBLE.
- **Preuve et correctif** :
  1. NFR-005 : `spec.md` (200 paiements) contre `plan.md` et `research.md:731` (1 000 paiements). Mettre `spec.md` à jour.
  2. `research.md:129-131` parle de « 6 routes `/edge/*` » ; le contrat en a cinq (`edge-routes.md`, tableau d'ensemble : 7 opérations dont 2 sur `/ledgers/…`).
  3. `plan.md` (arborescence de documentation) cite `research-adversarial.md` qui n'existe pas ; le retirer ou le produire.
  4. `data-model.md:51` écrit `ledger.authority_gateway_id` ; la colonne est `ledger.edge_gateway_id` (`schema_grand_livre_cashless.sql`, `set_debit_authority`).
  5. `plan.md` IC-02 : « époque vérifiée là où elle manque (activation, caution, recharge) » contredit `research.md:751-753` (non fait).
  6. `gateway-served-operations.md` : la restitution (`releaseMedia`) répond « 409 » dans le tableau des refus et « route absente, 404 » dans « Aucune route ajoutée ». Choisir un seul comportement.
  7. `gateway-served-operations.md` (états sans débit) : `ARMED` et `STANDBY` rendent `409 DEBIT_AUTHORITY_MOVING` ; `research.md` n'en parle pas, et `retryable: true` est annoncé comme « à confirmer ». Une `STANDBY` qui répond « bascule en cours » à un terminal qui devrait aller au central est trompeuse.
  8. `quickstart.md` : relais dans `tools/edge-link-relay/relay.mjs` ; `research.md:671` dans `apps/gateway/test/support/tcp-relay.ts`.
  9. `research.md:719-721` rappelle la contradiction n° 12 (« Docker absent ») mais le quickstart suppose déjà Docker : arrêter une version.
- **Porteur** : non.

### A28. NFR-004 prouve la reprise après arrêt du processus, pas après arrêt de PostgreSQL ou coupure de courant

- **Gravité** : FAIBLE.
- **Preuve** : `research.md:679-680` : action des points d'arrêt = `SIGKILL` du processus lui-même ; `research.md:446` suppose `synchronous_commit = on` et `fsync` par défaut. Un `SIGKILL` de Node ne teste ni la durabilité de la base locale, ni la perte du conteneur.
- **Correctif** : ajouter un point d'arrêt qui tue le conteneur PostgreSQL local (`docker kill`) et vérifier `fsync`/`full_page_writes` actifs dans le profil de déploiement ; noter que la coupure de courant sans onduleur relève de la procédure de site.
- **Porteur** : non.

### A29. Reprise d'un lot `ABANDONED` non spécifiée

- **Gravité** : FAIBLE.
- **Preuve** : `research.md:219-227` : `edge_sync_batch.status` peut valoir `ABANDONED` après 15 minutes, et un même `batch_id` avec la même empreinte « renvoie les résultats mémorisés ». Pour un lot abandonné, ces résultats sont partiels (`openapi.yaml:14409-14412` : `abandoned: true`, renvoyer le reste « dans un nouveau lot »).
- **Scénario de panne** : la passerelle renvoie le lot abandonné avec le même `batch_id` : elle reçoit les résultats partiels en boucle au lieu de construire un nouveau lot.
- **Correctif** : préciser que le reste part avec un nouveau `batch_id`, `edge_seq_from` = premier numéro non enregistré, et le tester.
- **Porteur** : non.

---

## Points vérifiés qui tiennent (pour ne pas les relancer)

- `edge_gateway` n'est dans aucune liste de `post-roles.sql` et `cashless_app` y garde INSERT et UPDATE (`roles.sql:14-15` : `GRANT INSERT, UPDATE ON ALL TABLES`) : le retrait de R-06.1 est justifié.
- `post_transaction` est `SECURITY DEFINER` (`schema_grand_livre_cashless.sql:516`), donc le test sur `session_user` plutôt que `current_user` est correct ; seul `cashless_app` reçoit `EXECUTE` aujourd'hui (`post-roles.sql:421`).
- La garde CL006 de `post_transaction` couvre déjà tout débit de portefeuille hors source `EDGE_SYNC` sous `EDGE` (`schema_grand_livre_cashless.sql:573-578`) : FR-013 est tenu au niveau SQL pour tous les chemins qui passent par cette fonction. Le travail est de traduire CL006 en `409` avec `edge_base_url` et époque partout (le corps actuel est nu, `batch-intake.ts:192-195`).
- L'époque s'incrémente de 1 à chaque `set_debit_authority` : accord `e+1`, échec d'accord ou rendu `e+2`, reprise forcée `e+2` (cohérent avec `data-model.md:60`).
- `posting_cash_desk_guard` (`0036_cash_sessions.sql:500-529`) refuse tout mouvement de caisse sans session `OPEN` de ce terminal : l'absence d'exemption (C-005) est bien la règle.
- Le vérificateur de jetons du central compare `kid` avant la cryptographie et contrôle `aud` (`device-token.service.ts:118, 124`) : un jeton de passerelle est déjà refusé au central.
- Les 16 opérations marquées `x-edge-available` : le compte est cohérent avec les lignes citées.
- Tous les FR (001 à 034) ont au moins un concern dans `plan.md` ; aucun FR n'est sans porteur.

---

## Tableau récapitulatif

| N° | Gravité | Sujet | Décision du porteur |
|---|---|---|---|
| A01 | BLOQUANT | Terminaux sans jeton valable sur la passerelle après 15 min (refresh suspendu, clés du central non répliquées) | Oui |
| A02 | BLOQUANT | Deux conceptions du flux de réplication ; `edge_seq_applied` sans support ; contrôle de stabilité non aligné | Oui (paramètre `after_change_seq`) |
| A04 | BLOQUANT | Contraintes de `edge_gateway` incompatibles avec les tests générés du kit et avec `force_central_authority` | Non |
| A05 | BLOQUANT | `operations_count = final_edge_seq` fait échouer tout rendu après le premier cycle | Non |
| A03 | ÉLEVÉ | Blocages et état de service hors filigrane et hors curseur de postings | Non |
| A06 | ÉLEVÉ | Bornes de décision en TypeScript, enveloppe SQL trop large, `CL007` non traité | Non |
| A07 | ÉLEVÉ | Décision `EDGE_ONLINE` invérifiable (aucune preuve de terminal, pas de borne par vente) | Oui (contrat ou acceptation) |
| A08 | ÉLEVÉ | Rejeu d'un `REVERSAL` après vente rognée : création d'argent | Non |
| A09 | ÉLEVÉ | Recharge espèces rejetée au rejeu après dépense locale ; invariant « solde local ≤ réel » faux | Oui |
| A10 | ÉLEVÉ | Clés d'origine de guichet incompatibles avec l'idempotence du terminal et avec `ONLINE_REF` | Non |
| A11 | ÉLEVÉ | Ajouts d'énumération dans des schémas partagés : changement de contrat hors `/edge/*` | Non (si réutilisation) |
| A12 | ÉLEVÉ | Époque forgée par un terminal : `STALE` permanent | Oui |
| A13 | ÉLEVÉ | Lecture du `FAILED` et handover courant ambigus (deux handovers ouverts) | Non |
| A14 | ÉLEVÉ | Horloge de la passerelle falsifiable, monotone non persistable | Non |
| A15 | ÉLEVÉ | Tolérance du jeton expiré sans borne sur l'ancienneté de l'expiration | Non (renforcement) |
| A16 | MOYEN | Inscription d'une passerelle sans deux personnes ; `STANDBY` reçoit les mots de passe | Oui |
| A17 | MOYEN | Accusé non idempotent, `409` mal interprété | Non |
| A18 | MOYEN | Curseur `posting.id` saute une écriture validée hors d'ordre | Non |
| A19 | MOYEN | Liste des faux incomplète, `NODE_ENV` ouvert, noms de variables divergents | Non |
| A20 | MOYEN | Séparation `@authority` contredite par le quickstart et par R-21 | Non |
| A21 | MOYEN | Aucune purge des secrets sur le site après l'événement | Oui |
| A22 | MOYEN | Test à canari insuffisant (une seule représentation, pas de contrôle positif) | Non |
| A23 | MOYEN | Témoin positif de CI qui passe sur toute panne du script ; référence non protégée | Non |
| A24 | MOYEN | `wallet_id` et `cash_desk_account_id` fournis par la passerelle sans contrôle | Non |
| A25 | MOYEN | Promotion de la `STANDBY` : pas de canal de rôle, pas d'échange atomique | Non |
| A26 | MOYEN | Règle de purge des deltas locaux non définie pour `DUPLICATE`/`REJECTED` | Non |
| A27 | FAIBLE | Incohérences documentaires (200/1 000 paiements, colonne, relais, 404/409, etc.) | Non |
| A28 | FAIBLE | NFR-004 ne prouve pas la durabilité de la base locale | Non |
| A29 | FAIBLE | Reprise d'un lot `ABANDONED` non spécifiée | Non |

Décompte : 4 BLOQUANT, 11 ÉLEVÉ, 11 MOYEN, 3 FAIBLE (29 constats).

Fichiers à faire relire par une personne en plus de la liste de `research.md:824-828` : l'enveloppe `edge_post_transaction` et ses bornes (A06), `edge_activate_media` et `edge_take_deposit` (A24), la persistance de `STALE` (A12), la lecture du handover courant (A13), la gestion d'horloge de la passerelle (A14).
