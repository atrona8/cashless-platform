# Mission Specification: Hors ligne : snapshots et lots

**Mission Branch**: `feat/hors-ligne-snapshots-lots`
**Created**: 2026-10-29
**Status**: Draft
**Input**: User description: "Fonctionnement hors ligne côté serveur (SPECIFICATION §9.1 à §9.6, `docs/sync_protocol.md` normatif, §14.1 S4 à S11). Politique hors ligne par organisateur, événement et terminal, plafonds du prestataire, politique effective, affichage du risque maximal. Snapshots signés de l'état des bracelets (`FULL`/`DELTA`, version croissante, nouvelle version en 60 s après un changement et en 5 s après un blocage, mots de passe chiffrés pour le seul terminal, rien pour un terminal révoqué). Lots d'opérations (`POST /offline-batches` : numéros continus, 500 opérations et 1 Mio au plus, un lot en vol, signé et chaîné, traitement opération par opération dans l'ordre des numéros, `ACCEPTED`, `DUPLICATE`, `ACCEPTED_WITH_SHORTFALL`, `REJECTED`), registre des numéros, trous `SEQ_GAP` levés à deux (`waiveSeqGap`), borne `CL021`, lot abandonné après 15 min. Conflits (part non couverte en `S-ATTENTE`, `OFFLINE_SHORTFALL`, `NON_COMPLIANT_OPERATION`, `CLOCK_SKEW`, `SIGNATURE_MISMATCH`), conformité sur la configuration détenue (`policy_in_force`), synchronisations tardives (`SYNC_DEADLINE_PASSED`, `LATE_OFFLINE_SYNC`). Import du journal d'un terminal révoqué (à deux). Services externes simulés (décision du 29/10/2026). Dettes de droits héritées levées : OP-N57, OP-N58, OP-N68, OP-N69, OP-N75. Héritages des missions 5b et 6 (forme de `content_sha256`, `seq` au-delà de 2^53, trou d'un corps en ligne invalide, sonde de numéro falsifié, recharge espèces hors ligne et session de caisse)."

**Sources normatives** : `docs/sync_protocol.md` (§1, §3 à §8, §10 à §13), `docs/SPECIFICATION.md` (§3.2, §5.3, §5.7, §7.6, §8.5, §9.1 à §9.6, §12.1, §13.1, §14.1 S4 à S11), `docs/DECISIONS_ADR.md` (ADR-47, ADR-49, ADR-50, ADR-58, ADR-59, ADR-61, ADR-63, ADR-69, ADR-73, ADR-74, ADR-94, ADR-111, ADR-112, ADR-114, ADR-128, ADR-132), `docs/POINTS_OUVERTS.md` (OP-N13, OP-N41, OP-N57, OP-N58, OP-N68, OP-N69, OP-N73, OP-N75), `packages/ledger-sql/schema_grand_livre_cashless.sql` (`open_offline_batch`, `complete_offline_batch`, `check_offline_snapshot`, `effective_offline_policy`, `policy_in_force`, `record_device_seq`, `device_missing_seqs`, `waive_seq_gap`, `max_seq_jump`, `event_sync_deadline`, `log_offline_policy`, `bump_offline_policy_version`, `register_tap`, `consume_tap`, `post_transaction`, `wallet_topup_headroom`), `packages/contracts/openapi.yaml` (`getOfflineSnapshot`, `ackOfflineSnapshot`, `submitOfflineBatch`, `getOfflineBatchResult`, `waiveSeqGap`, `importDeviceJournal`, schémas `OfflinePolicy`, `OfflineSnapshot`, `OfflineBatch`, `OfflineBatchResult`). En cas de contradiction, la règle de priorité de SPECIFICATION §0.3 s'applique et la contradiction est signalée (section « Contradictions de sources »).

**Dépend de** : missions `fondations-grand-livre-01M4AY8M` (moteur d'écritures, `OFFLINE_SYNC`, anomalies), `identite-roles-double-validation-01M4DNDN` (rôles, demandes d'approbation), `configuration-parties-evenements-01M4GCJ9` (événements, contrats, statuts d'événement), `bracelets-nfc-01M4TD3W` (bracelets, lots, mots de passe chiffrés), `identite-enrolement-terminaux-01M52R6H` (terminaux, clés, révocation, numérotation), `terminaux-paiement-en-ligne-01M52QB9` (registre des numéros alimenté en ligne, session de vendeur, ADR-128) et `recharges-caisses-psp-01M5YEBA` (sessions de caisse, garde de caisse ADR-132, recharge espèces).

## Contexte

Les festivals perdent souvent le réseau. Jusqu'ici, un terminal coupé ne peut plus vendre. Cette mission donne au serveur ce qu'il faut pour que les terminaux continuent d'encaisser sans réseau, puis pour réconcilier leurs opérations au retour, sans double écriture et sans perte silencieuse. Elle lève aussi cinq dettes de droits de la base héritées des missions 4 et 5a, qui bloquent la mise en production.

Le principe est celui de `sync_protocol.md` : hors ligne, le terminal autorise seul, sur un snapshot signé reçu avant la coupure et dans des plafonds qui bornent la perte possible. À la synchronisation, le serveur rejoue chaque opération dans l'ordre des numéros. Le commerçant est garanti pour toute vente d'un terminal conforme. Le festivalier n'est jamais débité au-delà de son solde : la part non couverte va au compte d'attente, avec une anomalie.

Quatre exigences structurent la mission :
- **une opération, une écriture au plus** : quel que soit le chemin (en ligne, lot, rejeu), une clé `<série>:<numéro>` n'écrit qu'une fois ;
- **aucun numéro perdu en silence** : chaque numéro consommé aboutit à un résultat final ou à un trou levé par deux personnes ;
- **aucun faux en production** : les services externes (clés de signature) sont simulés derrière des ports ; leurs faux font refuser le démarrage en configuration de production ;
- **aucune écriture sans garde** : la recharge espèces hors ligne ne contourne jamais la garde de caisse.

Les adaptateurs AWS KMS (signature des snapshots, OP-N41, OP-N73) partent en mission 12b (feuille de route révisée du 29/10/2026). La passerelle locale relève de la mission 8, l'application du terminal (déléguée) d'une autre équipe, les rapprochements de la mission 9.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Snapshot | Photo signée de l'état des bracelets d'un événement (soldes, blocages, mots de passe chiffrés), à une version donnée | « cache », « export » |
| Version | Numéro strictement croissant d'un snapshot, par grand livre | « révision » |
| `FULL` / `DELTA` | Snapshot complet / changements depuis une version de base connue | |
| Politique hors ligne | Réglage `offline_policy` par organisateur, événement ou terminal : hors ligne permis, plafonds, âge maximal du snapshot, recharge espèces permise | « mode secours » |
| Plafonds du prestataire | Valeurs maximales que la politique d'un organisateur ne peut pas dépasser | |
| Politique effective | Politique calculée pour un terminal (héritage, plafonds du prestataire) ; `capped` si un plafond l'a réduite | |
| Politique en vigueur | Politique de la configuration réellement détenue par le terminal à l'instant de l'opération (`policy_in_force`) | « politique courante » |
| Risque maximal | Somme des plafonds `max_total_per_device` des terminaux de l'événement | « exposition » (réservé au calcul du terminal) |
| Numéro (`seq`) | Compteur propre au terminal, de 1 en 1, consommé pour toute opération | « id d'opération » |
| Clé d'opération | `<série>:<numéro>`, numéro complété à gauche par des zéros jusqu'à 4 chiffres, jamais tronqué | |
| Registre des numéros | Table serveur : un résultat final par numéro de terminal | « journal » (réservé au journal local du terminal) |
| Lot | Suite d'opérations de numéros continus envoyée par un terminal (500 au plus, 1 Mio au plus) | « batch » dans les textes |
| Trou | Numéro consommé, jamais reçu ; anomalie `SEQ_GAP` | « manque » (réservé au solde) |
| Part non couverte (manque) | Part d'une vente que le solde ne couvre pas ; portée par le compte d'attente `S-ATTENTE` | « découvert » |
| Terminal conforme | Terminal dont l'opération respecte la politique en vigueur et le protocole ; le commerçant est alors garanti | |
| Synchronisation tardive | Opération reçue après la date limite de synchronisation (événement en `SETTLING` ou au-delà) | |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - L'organisateur fixe la politique hors ligne et voit son risque maximal (Priority: P1)

Un `ORGANIZER_ADMIN` règle la politique hors ligne de son organisation, d'un événement ou d'un terminal : hors ligne permis ou non, montant maximal par vente, par bracelet et par terminal, âge maximal du snapshot, recharge espèces hors ligne permise. Un champ vide hérite du niveau au-dessus. Le prestataire fixe des plafonds que l'organisateur ne peut pas dépasser. L'organisateur voit le risque maximal de son événement quand il règle ses plafonds.

**Why this priority**: sans politique, aucun terminal n'a le droit de vendre hors ligne ; le risque maximal est ce que l'organisateur accepte de perdre.

**Independent Test**: régler une politique d'événement au-dessus du plafond du prestataire ; lire la politique effective d'un terminal (valeur réduite, `capped`) ; lire le risque maximal ; changer un plafond et vérifier l'historique.

**Acceptance Scenarios**:

1. **Given** aucune politique réglée, **When** la politique effective d'un terminal est lue, **Then** le hors ligne est interdit (`offline_enabled` faux, plafonds à 0, âge maximal du snapshot 900 s).
2. **Given** une politique d'événement et une politique de terminal qui ne règle que `max_per_sale`, **When** la politique effective est lue, **Then** les autres champs viennent de l'événement, puis de l'organisation.
3. **Given** un plafond du prestataire inférieur à la valeur de l'organisateur, **When** la politique effective est lue, **Then** la valeur est réduite au plafond et `capped` est vrai.
4. **Given** 12 terminaux dont les plafonds par terminal totalisent 3 600 000 XOF, **When** l'organisateur règle ses plafonds, **Then** le risque maximal de l'événement affiché est 3 600 000 XOF.
5. **Given** une politique modifiée, **When** la modification est faite, **Then** la version de la politique augmente et une ligne d'historique est écrite par la base, sans que l'application puisse l'écrire elle-même.
6. **Given** un organisateur A, **When** une personne de l'organisateur B lit ou modifie ses politiques, **Then** elle ne les voit pas.
7. **Given** une modification faite pendant qu'un terminal est coupé, **When** le terminal revient, **Then** elle ne vaut qu'à partir de la configuration suivante qu'il reçoit ; les opérations faites avant restent jugées sur la configuration qu'il détenait.

---

### User Story 2 - Le terminal reçoit un snapshot signé de l'état des bracelets (Priority: P1)

Un terminal enrôlé dont la politique permet le hors ligne demande son snapshot. Il reçoit l'état des bracelets de son événement (statut, lot, portefeuille, solde dépensable, dernier compteur, empreinte de la signature d'originalité) et les mots de passe chiffrés pour lui seul. Le snapshot est signé. Une nouvelle version est publiée en 60 s au plus après un changement, et en 5 s au plus après un blocage. Il demande ensuite un `DELTA` à partir de sa version.

**Why this priority**: sans snapshot frais et authentique, un terminal ne peut pas vendre hors ligne en sécurité.

**Independent Test**: demander un `FULL`, bloquer un bracelet, mesurer l'apparition de la nouvelle version, demander le `DELTA`, vérifier la signature avec la clé publique du jeu d'essai, puis révoquer le terminal et constater qu'il ne reçoit plus rien.

**Acceptance Scenarios**:

1. **Given** un terminal actif dont la politique permet le hors ligne, **When** il demande son snapshot sans version, **Then** il reçoit un `FULL` signé dont l'en-tête porte l'opérateur, le grand livre, l'événement, la devise, la version, l'époque d'autorité et la clé de signature.
2. **Given** un `FULL` de version 1532, **When** il demande avec `since_version=1532` et que la version 1534 existe, **Then** il reçoit un `DELTA` de base 1532 (entrées modifiées et retirées) ; sans version de base connue, il reçoit un `FULL`.
3. **Given** un changement quelconque d'un solde ou d'un statut, **When** 60 s se sont écoulées, **Then** une nouvelle version existe.
4. **Given** un bracelet passé `SUSPENDED`, `BLACKLISTED`, `REPLACED` ou `RETIRED`, un lot qui n'est plus `ACTIVE`, ou un portefeuille `BLOCKED`, **When** le changement est fait, **Then** une nouvelle version est publiée en 5 s au plus.
5. **Given** un snapshot, **When** il est lu, **Then** aucun mot de passe de bracelet n'apparaît en clair ; chaque mot de passe est chiffré avec une clé propre à la version, et cette clé n'est remise qu'enveloppée pour la clé d'accord du terminal.
6. **Given** un terminal `REVOKED` ou dont la politique interdit le hors ligne, **When** il demande un snapshot, **Then** il ne reçoit aucun snapshot ni aucune clé de contenu (`403`, `OFFLINE_NOT_ALLOWED` pour le second cas).
7. **Given** un terminal qui accuse réception d'une version, **When** l'accusé est reçu, **Then** sa dernière version appliquée est mise à jour par une fonction de la base.
8. **Given** une version choisie par l'appelant, **When** le snapshot est inscrit, **Then** la base la refuse : la version est toujours calculée par la base (dernière + 1) ; une version plantée en avance ne bloque pas les suivantes.

---

### User Story 3 - Le terminal envoie ses lots au retour du réseau (Priority: P1)

Au retour du réseau, le terminal envoie ses opérations non acquittées en un lot signé et chaîné : numéros continus, 500 opérations et 1 Mio au plus, un seul lot en vol. Le serveur traite chaque opération dans l'ordre des numéros, chacune dans sa propre transaction, sans double écriture, et rend un résultat par opération.

**Why this priority**: c'est la raison d'être de la mission ; sans lots, un hors ligne ne se réconcilie jamais.

**Independent Test**: envoyer un lot de trois opérations (vente couverte, vente partiellement couverte, annulation), perdre la réponse, relire le résultat par `batch_id`, renvoyer le même lot cent fois, couper le serveur au milieu d'un lot de 500.

**Acceptance Scenarios**:

1. **Given** un lot valide de numéros continus, **When** il est envoyé, **Then** chaque opération est traitée dans l'ordre des numéros, chacune dans sa transaction, et la réponse donne un résultat par opération et le plus grand numéro continu acquitté.
2. **Given** une vente couverte, **When** elle est traitée, **Then** `PURCHASE` est écrite en source `OFFLINE_SYNC` avec la clé `<série>:<numéro>`, le résultat est `ACCEPTED`, et le passage lu est consommé.
3. **Given** le même lot renvoyé (même `batch_id`), **When** il arrive une seconde fois, **Then** les résultats mémorisés sont rendus et rien n'est écrit deux fois.
4. **Given** une vente déjà écrite en ligne puis renvoyée dans le lot, **When** elle est traitée, **Then** le résultat est `DUPLICATE` avec la transaction d'origine.
5. **Given** un lot dont les numéros ne sont pas continus, **When** il est reçu, **Then** il est refusé en entier avant tout traitement (`400 SEQ_OUT_OF_ORDER`).
6. **Given** un lot de plus de 500 opérations ou de plus de 1 Mio, **When** il est reçu, **Then** il est refusé avant tout traitement (`413` pour la taille).
7. **Given** un lot en cours de traitement pour ce terminal, **When** un second lot arrive, **Then** il est refusé (`409 BATCH_IN_PROGRESS`).
8. **Given** un dernier numéro au-delà du plus grand numéro continu acquitté plus 10 000, **When** le lot est reçu, **Then** il est refusé en entier (`409 SEQ_OUT_OF_RANGE`, `CL021`), rien n'est traité et aucune anomalie `SEQ_GAP` n'est ouverte.
9. **Given** une signature de lot invalide, **When** le lot est reçu, **Then** il est refusé (`400 BATCH_SIGNATURE_INVALID`), rien n'est traité et le refus est signalé.
10. **Given** un lot dont le `prev_chain_hash` ne raccorde pas au dernier accepté, **When** il est reçu, **Then** il est refusé (`409 CHAIN_BROKEN`) et une anomalie `CHAIN_BROKEN` est ouverte pour examen manuel.
11. **Given** un lot resté `PROCESSING` plus de 15 min, **When** le lot suivant du même terminal est ouvert, **Then** l'ancien passe `REJECTED` (`ABANDONED`), ses opérations déjà traitées restent au registre, et la lecture de son résultat répond `200` avec `abandoned` vrai.
12. **Given** un lot dont la réponse s'est perdue, **When** le terminal relit le résultat par `batch_id`, **Then** il reçoit les résultats mémorisés (`200`), ou `202` avec `Retry-After` si le traitement dure, ou `404` si le lot est inconnu.

---

### User Story 4 - Les conflits à la synchronisation protègent le festivalier et le commerçant (Priority: P1)

À la synchronisation, le solde peut ne plus suffire (dépenses sur d'autres terminaux), un bracelet peut avoir été bloqué, ou un terminal peut avoir vendu hors des règles. Le serveur applique les règles de conflit : le commerçant d'un terminal conforme est toujours crédité du total ; la part non couverte va en `S-ATTENTE` avec une anomalie ; une opération non conforme est rejetée avec une anomalie et sans garantie.

**Why this priority**: c'est ce qui rend le hors ligne acceptable pour les trois parties (festivalier, commerçant, plateforme).

**Independent Test**: rejouer la transaction 22 du scénario de référence (vente de 9 000, solde de 6 000) ; rejouer les situations de la table de §7.3 ; dépasser un plafond de la configuration détenue.

**Acceptance Scenarios**:

1. **Given** une vente de 9 000 XOF et un solde de 6 000, **When** elle est traitée, **Then** le portefeuille est débité de 6 000, `S-ATTENTE` de 3 000, le commerçant crédité de 9 000, la commission calculée sur 9 000, le résultat est `ACCEPTED_WITH_SHORTFALL` (`INSUFFICIENT_FUNDS`) et une anomalie `OFFLINE_SHORTFALL` de 3 000 est ouverte ; les écritures sont celles de `scenario_reference.json`.
2. **Given** un bracelet bloqué après la vente (à la tolérance d'horloge près), **When** la vente est traitée, **Then** le portefeuille est débité du minimum entre solde et montant, le reste va en attente.
3. **Given** un bracelet bloqué avant la vente alors que le snapshot utilisé lui est antérieur, **When** la vente est traitée, **Then** le portefeuille n'est pas débité, tout le montant va en attente (`MEDIA_BLOCKED_AFTER_SNAPSHOT`), le commerçant est crédité.
4. **Given** une copie suspectée, un UID différent, une signature d'originalité différente ou un portefeuille bloqué ou clos, **When** la vente est traitée, **Then** le portefeuille n'est pas débité, tout le montant va en attente avec la raison correspondante (`MEDIA_CLONE_SUSPECTED`, `MEDIA_UID_MISMATCH`, `MEDIA_SIGNATURE_MISMATCH`, `WALLET_BLOCKED`).
5. **Given** un bracelet inconnu, non activé ou d'un autre événement, **When** la vente est traitée, **Then** elle est `REJECTED` (`MEDIA_NOT_IN_SNAPSHOT` ou `MEDIA_WRONG_EVENT`), rien n'est écrit.
6. **Given** un montant au-dessus de `max_per_sale`, ou un cumul par bracelet ou par terminal au-dessus des plafonds de la configuration détenue par le terminal, **When** l'opération est traitée, **Then** elle est `REJECTED` (`POLICY_LIMIT_EXCEEDED`), rien n'est écrit, une anomalie `NON_COMPLIANT_OPERATION` est ouverte.
7. **Given** un snapshot trop vieux, un snapshot inconnu, un bracelet déjà bloqué dans le snapshot utilisé, un `PACK` non vérifié, une devise différente ou un hors ligne interdit à `occurred_at`, **When** l'opération est traitée, **Then** elle est `REJECTED` avec la raison correspondante, sans écriture, avec l'anomalie `NON_COMPLIANT_OPERATION`.
8. **Given** une anomalie `NON_COMPLIANT_OPERATION`, **When** elle est lue, **Then** elle indique la partie qui porte la perte selon `provided_by` du terminal (prestataire pour la plateforme ou le prestataire, organisateur pour l'organisateur, commerçant pour le commerçant sauf défaut du logiciel).
9. **Given** une opération confirmée en ligne (`online_status = CONFIRMED`) mais introuvable, **When** elle est traitée, **Then** une anomalie `ONLINE_CONFIRMED_MISSING` est ouverte et l'opération continue comme une opération hors ligne, sans les contrôles de conformité.
10. **Given** un plafond abaissé pendant l'isolement du terminal, **When** les opérations faites avant que le terminal reçoive la baisse sont traitées, **Then** elles sont acceptées (jugées sur la configuration détenue).
11. **Given** un débit concurrent qui rend le solde insuffisant au moment d'écrire (`CL007`), **When** l'écriture échoue, **Then** l'opération est recalculée au plus trois fois ; au quatrième échec, elle est `REJECTED` (`INSUFFICIENT_FUNDS_RETRY`, `retryable` vrai) sans rien écrire au registre.
12. **Given** une annulation d'une vente de ce terminal, **When** elle est traitée, **Then** elle écrit les lignes exactement opposées (part en attente comprise) et réduit d'autant l'anomalie `OFFLINE_SHORTFALL` liée ; une annulation d'une vente d'un autre terminal ou déjà annulée est `REJECTED`.

---

### User Story 5 - Aucun numéro n'est perdu en silence (Priority: P1)

Chaque numéro consommé par un terminal aboutit à un résultat final. Si des numéros manquent, le lot est quand même traité (le commerçant reste garanti), les numéros manquants sont signalés et une anomalie `SEQ_GAP` est ouverte pour chacun. Un numéro définitivement perdu est levé par deux personnes du back-office.

**Why this priority**: c'est l'invariant I2 ; sans lui, une opération peut disparaître sans trace.

**Independent Test**: envoyer un lot qui commence après un trou ; renvoyer le numéro manquant ; lever un autre trou avec `waiveSeqGap` ; lever un numéro couvert par un lot en cours.

**Acceptance Scenarios**:

1. **Given** un lot dont `seq_from` dépasse le plus grand numéro continu acquitté plus 1, **When** il est reçu, **Then** il est traité, les numéros manquants sont rendus dans `missing_seqs` et une anomalie `SEQ_GAP` (montant 0) est ouverte par numéro manquant.
2. **Given** un numéro manquant renvoyé ensuite, **When** il est reçu, **Then** son anomalie `SEQ_GAP` est close et le plus grand numéro continu avance.
3. **Given** un `SUPERVISOR` qui demande la levée d'un trou, **When** il envoie `waiveSeqGap` avec un motif d'au moins 10 caractères, **Then** une demande d'approbation `WAIVE_SEQ_GAP` est créée (`202`), rien n'est exécuté ; une seconde personne `SUPERVISOR` l'approuve ; l'anomalie passe `RESOLVED`, le plus grand numéro continu avance, aucune écriture comptable n'est produite.
4. **Given** un numéro qui n'est pas un trou connu, **When** la levée est demandée, **Then** elle est refusée (`409 SEQ_GAP_NOT_FOUND`, `CL012`) ; un numéro couvert par un lot en cours est refusé (`409 BATCH_IN_PROGRESS`, `CL010`), à la demande puis à l'exécution.
5. **Given** un même auteur et un même approbateur, **When** l'approbation est tentée, **Then** elle est refusée.
6. **Given** un trou ouvert depuis plus de 24 h, **When** le contrôle périodique passe, **Then** l'exploitation est alertée une seule fois par trou.
7. **Given** un corps de paiement en ligne qui n'était pas un objet JSON (refus `400` sans ligne au registre, mission 5b), **When** le numéro correspondant manque dans le lot suivant, **Then** il est traité comme un trou et se lève par la procédure des trous.
8. **Given** un numéro supérieur à 2^53, **When** il est reçu, **Then** il est lu et enregistré sans perte de précision, ou refusé explicitement ; il n'est jamais arrondi.

---

### User Story 6 - Les cas de temps et de période sont tranchés sans perdre l'argent (Priority: P2)

Les horloges des terminaux se trompent, et certaines opérations arrivent trop tard. Le serveur corrige les dates fautives en gardant l'original et signale l'écart. Les ventes arrivées après la date limite de synchronisation sont rejetées mais gardent le commerçant garanti par le back-office. Les recharges espèces tardives sont écrites avec une anomalie, jamais refusées pour ce motif.

**Why this priority**: évite les écritures à une mauvaise date et les ventes perdues à la clôture, sans bloquer le cœur de la mission.

**Independent Test**: envoyer des opérations datées dans le futur, avant le snapshot, dans une période close, après `SETTLING`.

**Acceptance Scenarios**:

1. **Given** une opération datée après l'heure du serveur plus la tolérance, **When** elle est traitée, **Then** sa date est ramenée à l'heure du serveur, l'anomalie `CLOCK_SKEW` est ouverte et la date d'origine est gardée.
2. **Given** une opération datée avant la génération du snapshot qu'elle cite (moins la tolérance), **When** elle est traitée, **Then** sa date est ramenée à celle du snapshot, avec `CLOCK_SKEW`.
3. **Given** des dates qui ne croissent pas avec les numéros (au-delà de la tolérance), **When** le lot est traité, **Then** `CLOCK_SKEW` est ouverte sans changer le résultat.
4. **Given** un terminal à +2 h puis à -2 h, **When** ses lots sont traités, **Then** les corrections et anomalies sont celles du protocole (test minimal §13, point 6).
5. **Given** une opération datée dans une période close, **When** elle est traitée, **Then** elle est `REJECTED` (`PERIOD_CLOSED`), rien n'est écrit, anomalie `PERIOD_CLOSED_OPERATION`, traitement manuel ; grand livre `LOCKED` : `REJECTED` (`LEDGER_LOCKED`).
6. **Given** une vente ou son annulation reçue événement en `SETTLING` ou au-delà, **When** elle est traitée, **Then** elle est `REJECTED` (`SYNC_DEADLINE_PASSED`) avec l'anomalie `LATE_OFFLINE_SYNC` (et non `PERIOD_CLOSED_OPERATION`) ; le commerçant reste garanti par une écriture du back-office.
7. **Given** une recharge en espèces reçue événement en `SETTLING` ou `REFUND_WINDOW`, **When** elle est traitée, **Then** elle est écrite normalement (`ACCEPTED`) avec l'anomalie `LATE_OFFLINE_SYNC`.
8. **Given** une opération confirmée en ligne, **When** elle est jugée sur la période, **Then** les contrôles de période s'appliquent, mais pas les contrôles de conformité du terminal.
9. **Given** une signature d'originalité absente alors que la puce en a une, **When** la vente est traitée, **Then** elle est gardée avec son résultat habituel et une anomalie `SIGNATURE_MISMATCH` s'ajoute.

---

### User Story 7 - La recharge espèces faite hors ligne passe par la garde de caisse (Priority: P2)

Si la politique le permet, un terminal `TOPUP_DESK` recharge un bracelet en espèces hors ligne. À la synchronisation, la recharge est écrite et rattachée à la session de caisse du même terminal qui couvre son heure, si cette session est encore ouverte. Au-delà d'un plafond réglementaire, elle est écrite en deux parts (portefeuille jusqu'à la marge, reste en `L-ESP-A-RENDRE`) avec une anomalie `CASH_TOPUP_OVER_LIMIT`. Si la session couvrante est déjà fermée, ou s'il n'y en a aucune, la recharge est refusée (`REJECTED`) : rien n'est écrit, ni au portefeuille ni en caisse, et une anomalie porte le montant pour régularisation au back-office.

**Why this priority**: l'argent a changé de main ; l'écriture doit exister, sans jamais ouvrir d'exemption silencieuse à la garde de caisse.

**Independent Test**: synchroniser une recharge avec une session ouverte, avec une session fermée couvrant l'heure, sans session, et au-delà d'un plafond.

**Acceptance Scenarios**:

1. **Given** une recharge espèces hors ligne et une session ouverte du même terminal couvrant son heure, **When** elle est synchronisée, **Then** `TOPUP_CASH` est écrite, rattachée à cette session.
2. **Given** une session du même terminal déjà fermée mais qui couvrait l'heure de la recharge, **When** la recharge est synchronisée, **Then** elle est `REJECTED` : rien n'est écrit (ni portefeuille ni caisse), la fermeture n'est pas touchée et une anomalie porte le bracelet, le terminal et le montant.
3. **Given** aucune session du terminal ne couvre l'heure de la recharge, **When** elle est synchronisée, **Then** elle est `REJECTED` : rien n'est écrit, une anomalie porte le montant ; il n'existe aucune exemption à la garde de caisse.
4. **Given** une recharge au-delà d'un plafond réglementaire, **When** elle est écrite, **Then** le portefeuille reçoit la marge (`wallet_topup_headroom`), le reste est crédité sur `L-ESP-A-RENDRE`, le résultat est `ACCEPTED` et l'anomalie `CASH_TOPUP_OVER_LIMIT` porte le bracelet et le montant.
5. **Given** une recharge dont le montant dépasse `max_per_sale` ou une politique sans `cash_topup_offline`, **When** elle est traitée, **Then** elle est `REJECTED` comme non conforme.
6. **Given** une recharge espèces hors ligne synchronisée, **When** le solde est lu, **Then** il n'est dépensable ailleurs qu'après la nouvelle version de snapshot qui le reflète.

---

### User Story 8 - Deux personnes importent le journal d'un terminal révoqué (Priority: P2)

Un terminal révoqué ne peut plus envoyer de lots, mais ses opérations non acquittées restent dues au commerçant. Un superviseur exporte le journal depuis l'application du terminal (signé par sa clé), et une personne du back-office l'importe, validée par une seconde.

**Why this priority**: évite de perdre les ventes d'un terminal perdu ou compromis ; hors flux nominal.

**Independent Test**: révoquer un terminal avec des opérations non acquittées, créer la demande d'import, la faire approuver, constater les écritures ; tenter l'import d'un terminal actif.

**Acceptance Scenarios**:

1. **Given** un terminal `REVOKED` et un export valide, **When** un `SUPERVISOR` crée la demande d'import, **Then** les signatures et la chaîne sont vérifiées immédiatement (refus si faux) et la demande `DEVICE_JOURNAL_IMPORT` est `PENDING` (`202`), sans écriture.
2. **Given** la demande, **When** une seconde personne `SUPERVISOR` l'approuve, **Then** chaque lot est traité opération par opération selon l'algorithme des lots (`OFFLINE_SYNC`), une seule fois, avec la seconde personne comme valideur, et le résultat est rendu.
3. **Given** une opération datée après la révocation, **When** elle est traitée, **Then** elle est `REJECTED` (`OFFLINE_NOT_ALLOWED`) avec l'anomalie `NON_COMPLIANT_OPERATION`.
4. **Given** un terminal non `REVOKED`, **When** l'import est demandé, **Then** il est refusé (`409 CONFLICT_STATE`).
5. **Given** un terminal `SUSPENDED`, **When** il envoie un lot, **Then** le lot est traité ; **When** il tente d'autoriser une nouvelle opération hors ligne, **Then** les opérations datées après la suspension sont `REJECTED`.
6. **Given** un terminal `REVOKED`, **When** il envoie un lot lui-même, **Then** il est refusé.
7. **Given** un export perdu ou détruit, **When** les numéros restent non reçus, **Then** ils se lèvent par `waiveSeqGap`.

---

### User Story 9 - Le vendeur reste connecté hors ligne, sans secret sur le terminal (Priority: P2)

Un vendeur connecté en ligne garde sa session de vendeur hors ligne jusqu'à son expiration (12 h). Il n'y a aucune nouvelle connexion hors ligne. Aucun secret, aucune empreinte de PIN n'est envoyé au terminal.

**Why this priority**: tranche la question héritée de la mission 5b sans affaiblir la sécurité du PIN.

**Independent Test**: ouvrir une session en ligne, couper le réseau, vérifier ce que reçoit le terminal ; traiter un lot dont les ventes portent cette session.

**Acceptance Scenarios**:

1. **Given** un snapshot ou une configuration servis à un terminal, **When** leur contenu est balayé, **Then** il ne contient ni PIN, ni empreinte de PIN, ni secret de vérification.
2. **Given** une vente hors ligne rattachée à une session de vendeur ouverte en ligne et non expirée à l'heure de l'opération, **When** elle est traitée, **Then** elle est attribuée à ce vendeur.
3. **Given** une vente hors ligne datée après l'expiration de la session de vendeur (12 h), **When** elle est traitée, **Then** elle est rejetée comme non conforme.
4. **Given** un vendeur sans session ouverte sur un terminal coupé, **When** il cherche à se connecter, **Then** aucune connexion hors ligne n'existe : le terminal ne peut pas vendre pour lui.

---

### User Story 10 - Les dettes de droits de la base héritées sont levées (Priority: P1)

Cinq limites de droits héritées des missions 4 et 5a sont levées, chacune avec son test et la levée du point ouvert : OP-N57 (version de snapshot choisie par l'application), OP-N58 (historique des politiques falsifiable), OP-N68 (fonction créée à la main exécutable par tous), OP-N69 (écritures directes de l'application sur le terminal), OP-N75 (purges faites par l'application).

**Why this priority**: OP-N57 et OP-N58 sont classés « Oui » (bloquent la production) ; les trois autres sont décidées par le porteur le 29/10/2026 dans cette mission.

**Independent Test**: pour chaque point, tenter depuis le rôle de l'application l'écriture ou l'exécution qui doit être refusée, puis vérifier que le chemin normal marche toujours.

**Acceptance Scenarios**:

1. **Given** le rôle de l'application, **When** il inscrit un snapshot avec une version de son choix, **Then** la base refuse ; l'inscription par la fonction dédiée donne toujours dernière + 1 (OP-N57).
2. **Given** le rôle de l'application, **When** il insère directement une ligne d'historique des politiques, **Then** la base refuse ; une modification de politique écrit toujours l'historique, par un déclencheur de la base (OP-N58).
3. **Given** une fonction créée à la main hors des migrations, **When** un rôle ordinaire tente de l'exécuter, **Then** l'exécution est refusée tant qu'aucun droit explicite n'est donné ; le droit par défaut global retire l'exécution à `PUBLIC` sur les fonctions futures (OP-N68).
4. **Given** le rôle de l'application, **When** il modifie directement le plancher de numérotation, la dernière présence, le nom de station, la version de snapshot, le téléphone personnel ou le mode d'application d'un terminal, **Then** la base refuse ; chaque écriture légitime passe par une fonction qui garde ses règles (plancher qui ne descend jamais, présence à l'heure de la base) (OP-N69).
5. **Given** le rôle de l'application, **When** il exécute la purge des nonces ou des essais d'enrôlement, **Then** il n'en a pas le droit ; un rôle et une connexion de maintenance dédiés les exécutent (OP-N75).
6. **Given** la fin de la mission, **When** `docs/POINTS_OUVERTS.md` est lu, **Then** OP-N57, OP-N58, OP-N68, OP-N69 et OP-N75 sont marqués levés avec la référence de leur test.

---

### User Story 11 - Le registre des numéros résiste aux numéros falsifiés (Priority: P2)

La mission alimente le registre des numéros par les lots avec la même forme d'empreinte que le chemin en ligne. Une sonde prouve qu'un numéro posé hors idempotence puis présenté avec un paiement falsifié est détecté et consigné en anomalie.

**Why this priority**: sécurité du registre déjà alimenté en ligne ; héritage de la relecture de la mission 5b.

**Independent Test**: poser un numéro sans clé d'idempotence valide, présenter un paiement différent avec ce numéro dans un lot ; relire les vecteurs d'empreinte de la mission 5b.

**Acceptance Scenarios**:

1. **Given** les vecteurs fixes de la mission 5b, **When** l'empreinte du contenu d'une opération de lot est calculée, **Then** elle est identique à celle du chemin en ligne, champs absents omis, sans jamais inclure `tap_id`, `customer_qr_token`, `vendor_session_id` ni un champ d'état.
2. **Given** un numéro déjà au registre avec une autre empreinte, **When** une opération du lot le réutilise, **Then** elle est `REJECTED` (`IDEMPOTENCY_KEY_REUSED`), la première écriture fait foi et une anomalie `IDEMPOTENCY_CONFLICT` est ouverte.
3. **Given** un numéro posé hors idempotence puis un paiement falsifié sur ce numéro, **When** le lot est traité, **Then** une anomalie est ouverte et aucun second débit n'est écrit.
4. **Given** une vente `UNKNOWN_ONLINE` abandonnée par l'opérateur et envoyée en `VOID` alors que la clé existe, **When** elle est traitée, **Then** le résultat est `DUPLICATE` avec l'anomalie `VOID_CONFLICT`.
5. **Given** une opération `ONLINE_REF` dont l'opération en ligne n'a pas été exécutée, **When** elle est traitée, **Then** le résultat est `ACCEPTED` sans effet (`ONLINE_NOT_EXECUTED`).

### Edge Cases

- Lot reçu par le central alors que l'autorité de débit est `EDGE` : le lot entier est refusé (`409 DEBIT_AUTHORITY_EDGE`) ; il est renvoyé inchangé à la passerelle (mission 8).
- Réponse de lot perdue pendant un traitement de 500 opérations : lecture du résultat par `batch_id` ; opérations déjà traitées rendues depuis le registre.
- Panne du serveur au milieu d'un lot : le rejeu reprend à la première opération non traitée, sans double écriture.
- Terminal ré-enrôlé après perte de son stockage : `next_seq = max_seen_seq + 1`, les numéros perdus sont des trous.
- Deux terminaux cités avec la même série : refus d'enrôlement, hors périmètre de cette mission (mission 5a).
- Snapshot demandé pour un terminal sans événement : politique effective « hors ligne interdit » (testé au schéma), pas de snapshot.
- Delta demandé sur une version de base inconnue ou plus ancienne que la conservation : `FULL`.
- Vente hors ligne dont le portefeuille est dans une autre devise que celle de l'événement : `REJECTED` (`CURRENCY_MISMATCH`).
- Clé de signature des snapshots retirée ou inactive : aucun snapshot n'est produit ; l'exploitation est alertée ; aucun snapshot n'est signé avec une clé inactive.
- Deux clés actives seulement par signataire pendant une rotation : le terminal reçoit les deux clés publiques et accepte l'une ou l'autre.
- Terminal `SUSPENDED` puis `REVOKED` avec des lots en cours : le lot en cours est traité jusqu'au bout ; les suivants sont refusés.
- Recharge espèces hors ligne d'un terminal dont la session de caisse a été fermée avec un compté déjà constaté : écart a posteriori signalé, la fermeture n'est jamais réécrite.
- Événement en `LOCKED` : tout lot est `REJECTED` (`LEDGER_LOCKED`) ; en `CLOSING` ou `RECONCILING` : ventes acceptées.
- Même lecture citée par un lot sans `online_tap_id` : lecture réutilisée si même terminal, même compteur, même UID et jamais utilisée ; un passage ne sert qu'à une seule écriture.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Politique hors ligne à trois portées | En tant qu'`ORGANIZER_ADMIN`, je veux régler la politique hors ligne par organisation, par événement et par terminal ; un champ vide hérite du niveau au-dessus ; sans réglage, hors ligne interdit, plafonds à 0, âge maximal 900 s, recharge espèces interdite. | High | Open | [build] | no |
| FR-002 | Plafonds du prestataire et politique effective | En tant que prestataire, je veux fixer des plafonds maximaux que la politique d'un organisateur ne dépasse jamais ; la politique effective d'un terminal est calculée par `effective_offline_policy` et signale `capped` si un plafond l'a réduite. | High | Open | [build] | no |
| FR-003 | Risque maximal affiché | En tant qu'organisateur, je veux lire le risque maximal de mon événement (somme des `max_total_per_device`) quand je règle mes plafonds, par une route du contrat. | High | Open | [build] | no |
| FR-004 | Historique des politiques par la base | En tant qu'auditeur, je veux que chaque modification, création ou suppression d'une politique écrive l'historique par un déclencheur de la base aux droits du propriétaire, et que l'application ne puisse pas l'écrire (OP-N58). | High | Open | [build] | no |
| FR-005 | Configurations servies | En tant que plateforme, je veux garder, pour chaque terminal, la politique effective de chaque configuration servie (`config_id` stable), pour juger les opérations sur la configuration détenue. | High | Open | [build] | no |
| FR-006 | Inscription d'un snapshot par la base | En tant que plateforme, je veux que la version d'un snapshot soit calculée par une fonction de la base (dernière + 1) et que l'application n'ait plus d'`INSERT` direct sur les snapshots (OP-N57). | High | Open | [build] | no |
| FR-007 | Contenu et production du snapshot | En tant que plateforme, je veux produire, pour le grand livre de chaque événement, un `FULL` (une entrée par bracelet de la vue `offline_snapshot_rows`) ou un `DELTA` (entrées modifiées et retirées depuis une version de base connue), avec l'empreinte de contenu définie par le protocole. | High | Open | [build] | no |
| FR-008 | Cadence des versions | En tant que plateforme, je veux publier une nouvelle version en 60 s au plus après un changement, et en 5 s au plus après un blocage (bracelet `SUSPENDED`, `BLACKLISTED`, `REPLACED`, `RETIRED`, lot non `ACTIVE`, portefeuille `BLOCKED`). | High | Open | [build] | no |
| FR-009 | Signature de l'en-tête | En tant que plateforme, je veux signer la sérialisation canonique de tout l'en-tête du snapshot avec la clé active du signataire central, par un port de clés ; l'algorithme est donné par `key_id` (`ECDSA_P256_SHA256` par défaut) ; au plus deux clés publiques valides par signataire. | High | Open | [build] | no |
| FR-010 | Mots de passe chiffrés pour le terminal | En tant que plateforme, je veux chiffrer chaque mot de passe de bracelet avec une clé de contenu propre à la version, enveloppée pour la clé d'accord de chaque terminal, et ne jamais remettre de clé de contenu à un terminal révoqué. | High | Open | [build] | no |
| FR-011 | Distribution et accusé du snapshot | En tant que terminal, je veux lire `getOfflineSnapshot` (avec `since_version` facultatif) et accuser réception par `ackOfflineSnapshot` ; la version appliquée est tenue par une fonction de la base ; `403 OFFLINE_NOT_ALLOWED` si le hors ligne est interdit. | High | Open | [build] | no |
| FR-012 | Session de vendeur hors ligne | En tant que plateforme, je veux qu'un vendeur connecté en ligne garde sa session hors ligne jusqu'à son expiration (12 h), sans nouvelle connexion hors ligne et sans qu'aucun secret ni aucune empreinte de PIN ne soit envoyé au terminal ; les ventes hors ligne sont attribuées à la session ouverte à leur heure. | High | Open | [build] | no |
| FR-013 | Réception et validation d'un lot | En tant que terminal, je veux envoyer un lot (`submitOfflineBatch`) dont les contrôles d'entrée sont faits avant tout traitement : signature (`400 BATCH_SIGNATURE_INVALID`), numéros continus (`400 SEQ_OUT_OF_ORDER`), taille (500 opérations, 1 Mio), série égale au jeton, borne `CL021`, un seul lot en vol (`409 BATCH_IN_PROGRESS`), autorité `EDGE` (`409 DEBIT_AUTHORITY_EDGE`). | High | Open | [build] | no |
| FR-014 | Chaînage des lots | En tant que plateforme, je veux vérifier que la chaîne du lot raccorde au dernier numéro dont le central connaît l'empreinte (règle d'`open_offline_batch`) ; une rupture refuse le lot (`409 CHAIN_BROKEN`) ou ouvre `CHAIN_BROKEN` si elle est constatée plus tard. | High | Open | [build] | no |
| FR-015 | Traitement opération par opération | En tant que plateforme, je veux traiter chaque opération dans l'ordre des numéros, dans sa propre transaction, et inscrire son résultat au registre avant de passer à la suivante, de sorte qu'un lot interrompu reprenne là où il s'est arrêté. | High | Open | [build] | no |
| FR-016 | Idempotence et registre des numéros | En tant que plateforme, je veux écrire chaque clé `<série>:<numéro>` au plus une fois : numéro déjà au registre avec la même empreinte, résultat mémorisé (`DUPLICATE` si écrit) ; autre empreinte, `REJECTED` (`IDEMPOTENCY_KEY_REUSED`) et `IDEMPOTENCY_CONFLICT` ; clé déjà écrite en ligne, `DUPLICATE`. | High | Open | [build] | no |
| FR-017 | Forme de l'empreinte du contenu | En tant que plateforme, je veux calculer l'empreinte d'une opération de lot exactement comme le chemin en ligne (forme canonique RFC 8785 de `{seq, type, occurred_at, amount, currency, tap, lines}`, champs absents omis, sans champ d'état) et m'appuyer sur les vecteurs fixes de la mission 5b (ADR-128). | High | Open | [build] | no |
| FR-018 | Opérations sans effet | En tant que plateforme, je veux traiter `VOID` et `ONLINE_REF` en enregistrant le numéro sans écriture (`ACCEPTED`, effet `NONE`), signaler `VOID_CONFLICT` si la clé existe, et ouvrir `ONLINE_CONFIRMED_MISSING` pour une opération confirmée en ligne introuvable. | High | Open | [build] | no |
| FR-019 | Écriture d'une vente hors ligne | En tant que plateforme, je veux, pour une vente, enregistrer le passage (`register_tap`, source hors ligne), écrire `PURCHASE` en source `OFFLINE_SYNC` (portefeuille, attente, commerçant, frais calculés sur le montant total), consommer le passage une seule fois, et recalculer au plus trois fois sur solde concurrent (`CL007`). | High | Open | [build] | no |
| FR-020 | Règles de conflit | En tant que plateforme, je veux déterminer part couverte, part non couverte et raison selon la table du protocole (solde, blocage avant ou après la vente, copie, UID, signature, portefeuille bloqué), et ouvrir `OFFLINE_SHORTFALL` pour toute part non couverte. | High | Open | [build] | no |
| FR-021 | Annulation hors ligne | En tant que plateforme, je veux écrire une annulation hors ligne comme les lignes exactement opposées de la vente visée (part en attente comprise) et réduire d'autant l'anomalie liée ; une cible absente, d'un autre terminal ou déjà annulée est `REJECTED`. | High | Open | [build] | no |
| FR-022 | Conformité sur la configuration détenue | En tant que plateforme, je veux contrôler chaque opération autorisée hors ligne contre la politique en vigueur du terminal (`policy_in_force(terminal, config_id)`) : devise, hors ligne permis à `occurred_at`, plafonds par vente, par bracelet et par terminal recalculés sur les opérations non reflétées, snapshot connu, âge, bracelet présent et utilisable, bon événement, `PACK` vérifié ; un `config_id` absent, inconnu ou servi à un autre terminal compte comme dépassement. | High | Open | [build] | no |
| FR-023 | Opération non conforme | En tant que plateforme, je veux rejeter une opération non conforme sans l'écrire, avec une anomalie `NON_COMPLIANT_OPERATION` qui indique la partie porteuse de la perte selon `provided_by` du terminal. | High | Open | [build] | no |
| FR-024 | Contrôles de période | En tant que plateforme, je veux rejeter, pour toute opération y compris confirmée en ligne, une date dans une période close (`PERIOD_CLOSED`, `PERIOD_CLOSED_OPERATION`) ou un grand livre `LOCKED` (`LEDGER_LOCKED`), et une vente ou annulation en `SETTLING` ou au-delà (`SYNC_DEADLINE_PASSED`, anomalie `LATE_OFFLINE_SYNC`). | High | Open | [build] | no |
| FR-025 | Horodatage corrigé | En tant que plateforme, je veux ramener une date future à l'heure du serveur et une date antérieure au snapshot à l'heure de celui-ci, ouvrir `CLOCK_SKEW`, garder l'original dans `metadata.device_occurred_at`, et signaler une inversion de dates entre numéros sans changer le résultat. | High | Open | [build] | no |
| FR-026 | Signature d'originalité | En tant que plateforme, je veux ouvrir `SIGNATURE_MISMATCH` quand la signature d'originalité est absente alors que la puce en a une, en gardant l'opération ; une signature différente met le bracelet en liste noire et la part en attente. | High | Open | [build] | no |
| FR-027 | Recharge espèces hors ligne | En tant que plateforme, je veux écrire une recharge espèces hors ligne (`TOPUP_CASH`), la découper au-delà d'un plafond réglementaire (portefeuille jusqu'à `wallet_topup_headroom`, reste en `L-ESP-A-RENDRE`, `CASH_TOPUP_OVER_LIMIT`), l'accepter même tardive avec `LATE_OFFLINE_SYNC`, et la refuser si la politique ne la permet pas. | High | Open | [build] | no |
| FR-028 | Session de caisse d'une recharge hors ligne | En tant que plateforme, je veux rattacher une recharge espèces hors ligne à la session du même terminal qui couvre `occurred_at` si elle est encore ouverte ; si cette session est déjà fermée, ou s'il n'y en a aucune, l'opération est `REJECTED`, rien n'est écrit (ni portefeuille ni caisse) et une anomalie porte le montant pour régularisation au back-office ; la garde de caisse n'est pas modifiée. | High | Open | [build] | no |
| FR-029 | Résultat et reprise d'un lot | En tant que terminal, je veux relire le résultat mémorisé d'un lot (`getOfflineBatchResult` : `200`, `202` avec `Retry-After`, `404`), et que le plus grand numéro continu acquitté, les numéros manquants et la version de snapshot suivante accompagnent chaque réponse. | High | Open | [build] | no |
| FR-030 | Lot abandonné | En tant que plateforme, je veux passer `REJECTED` (`ABANDONED`) tout lot resté `PROCESSING` plus de 15 min à l'ouverture du lot suivant du même terminal, en gardant les résultats déjà inscrits. | High | Open | [build] | no |
| FR-031 | Trous de séquence | En tant que plateforme, je veux traiter un lot qui suit un trou, rendre `missing_seqs`, ouvrir une anomalie `SEQ_GAP` par numéro manquant, et clore l'anomalie quand le numéro est renvoyé. | High | Open | [build] | no |
| FR-032 | Levée d'un trou à deux | En tant que `SUPERVISOR`, je veux demander `waiveSeqGap` (motif d'au moins 10 caractères) ; une seconde personne `SUPERVISOR` approuve ; l'anomalie passe `RESOLVED` et le plus grand numéro continu avance, sans écriture comptable ; contrôles `CL010` et `CL012` à la demande et à l'exécution. | High | Open | [build] | no |
| FR-033 | Trous hérités et grands numéros | En tant que plateforme, je veux lever par la procédure des trous le numéro laissé sans ligne au registre par un corps en ligne qui n'était pas un objet JSON, et traiter un numéro supérieur à 2^53 sans perte de précision. | High | Open | [build] | no |
| FR-034 | Alerte des trous anciens | En tant qu'exploitant, je veux être alerté une fois par trou ouvert depuis plus de 24 h. | Medium | Open | [build] | no |
| FR-035 | Import du journal d'un terminal révoqué | En tant que `SUPERVISOR`, je veux importer le journal exporté d'un terminal `REVOKED` : signatures et chaîne vérifiées dès la demande, demande `DEVICE_JOURNAL_IMPORT` approuvée par une seconde personne, lots traités selon l'algorithme des lots, une seule fois, sans passer par l'ouverture de lot ; terminal non révoqué refusé. | High | Open | [build] | no |
| FR-036 | Sonde de numéro falsifié | En tant qu'auditeur, je veux une sonde qui pose un numéro hors idempotence puis présente un paiement falsifié, et qui prouve qu'une anomalie est ouverte et qu'aucun second débit n'est écrit. | Medium | Open | [build] | no |
| FR-037 | Port de clés de signature | En tant que prestataire, je veux que la signature des snapshots passe par le port de clés existant, avec un faux simulé tant que l'adaptateur AWS KMS n'existe pas (mission 12b), et que ce faux refuse de se construire en production. | High | Open | [ratchet] | no |
| FR-038 | Droit par défaut sur les fonctions | En tant que plateforme, je veux retirer l'exécution à `PUBLIC` sur toutes les fonctions futures par un droit par défaut global, adapter les suites de tests qui en dépendent et lever OP-N68. | High | Open | [build] | no |
| FR-039 | Écritures du terminal par fonctions | En tant que plateforme, je veux que le plancher de numérotation, la présence, le nom de station, la version de snapshot, `personal_phone` et `app_mode` d'un terminal ne s'écrivent que par des fonctions de la base (plancher qui ne descend jamais, présence à l'heure de la base), l'application n'ayant plus d'`UPDATE` direct (OP-N69). | High | Open | [build] | no |
| FR-040 | Rôle de maintenance | En tant que plateforme, je veux un rôle et une connexion de maintenance dédiés aux purges des nonces et des essais d'enrôlement, l'application perdant l'exécution de ces purges (OP-N75). | High | Open | [build] | no |
| FR-041 | Bornage des dettes levées | En tant que relecteur, je veux, pour chacun des cinq points OP-N57, OP-N58, OP-N68, OP-N69 et OP-N75, un test qui échoue si le droit s'élargit, et la levée consignée dans `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md`. | High | Open | [ratchet] | no |
| FR-042 | Contrat et types | En tant que développeur des apps, je veux que le contrat couvre les routes nouvelles (politiques hors ligne, plafonds du prestataire, risque maximal) et les précisions de cette mission, et que les types TypeScript et Dart soient régénérés. | High | Open | [build] | no |
| FR-043 | Audit | En tant qu'auditeur, je veux une trace de chaque modification de politique, snapshot produit, lot reçu ou refusé (signature, chaîne, borne), levée de trou, import de journal et recharge espèces hors ligne refusée ou en attente (auteur, terminal, date). | Medium | Open | [build] | no |
| FR-044 | Tests minimaux du protocole | En tant que relecteur, je veux les tests minimaux de `sync_protocol.md` §13 côté serveur : rejeu de lots, panne au milieu d'un lot de 500, scénario de référence (transaction 22), horloges à +2 h et -2 h, bracelet bloqué pendant un isolement. | High | Open | [ratchet] | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Aucune double écriture | 0 double écriture sur 100 rejeux (dont concurrents) d'un même lot et d'une même opération, tous chemins confondus (en ligne, lot, import). | Reliability | High | Open |
| NFR-002 | Reprise après panne | Après une coupure du serveur au milieu d'un lot de 500 opérations puis un rejeu, 100 % des résultats sont identiques à un traitement sans panne, 0 double écriture, plus grand numéro continu correct. | Reliability | High | Open |
| NFR-003 | Débit d'un lot | Un lot de 500 opérations est traité en 60 s au plus pour 95 % des lots, mesuré côté serveur sur le jeu d'essai (seuil proposé, à confirmer au plan). | Performance | Medium | Open |
| NFR-004 | Production d'un snapshot | Un `FULL` de 50 000 bracelets est produit en 30 s au plus et signé ; un `DELTA` est servi en 2 s au plus pour 95 % des demandes (seuils proposés). | Performance | Medium | Open |
| NFR-005 | Fraîcheur après blocage | 100 % des blocages sont visibles dans une nouvelle version publiée en 5 s au plus ; 100 % des autres changements en 60 s au plus. | Performance | High | Open |
| NFR-006 | Version toujours croissante | 0 version de snapshot non croissante ou plantée par l'application sur 100 % des essais (OP-N57). | Security | High | Open |
| NFR-007 | Aucun secret exposé | 0 mot de passe de bracelet, clé privée, clé de contenu non enveloppée, PIN ou empreinte de PIN en clair dans la base, les journaux, les réponses, les snapshots et les variables d'environnement, vérifié par un balayage avec canari. | Security | High | Open |
| NFR-008 | Aucun faux en production | Le démarrage en configuration de production est refusé pour 100 % des faux de la mission (faux du port de clés de signature, et tout autre faux ajouté), prouvé par test. | Security | High | Open |
| NFR-009 | Droits de la base | 0 écriture directe de l'application sur les snapshots, l'historique des politiques, les colonnes de terminal listées en OP-N69 ; 0 exécution des purges par l'application ; 0 fonction nouvelle exécutable par `PUBLIC`, prouvé par tests de droits. | Security | High | Open |
| NFR-010 | Cloisonnement | 0 lecture ou écriture d'une politique, d'un snapshot, d'un lot, d'un registre ou d'une anomalie d'un autre prestataire ou organisateur, sur toutes les nouvelles opérations. | Security | High | Open |
| NFR-011 | Tout ou rien | 0 écriture partielle : une opération est écrite avec son résultat au registre dans une même transaction, ou ni l'un ni l'autre. | Reliability | High | Open |
| NFR-012 | Aucune perte silencieuse | 100 % des numéros reçus ou manquants ont un résultat final ou une anomalie `SEQ_GAP` ouverte ; 0 numéro sans trace. | Reliability | High | Open |
| NFR-013 | Un lot à la fois | 100 % des lots concurrents d'un même terminal au-delà du premier sont refusés (`BATCH_IN_PROGRESS`), sur 50 envois concurrents. | Reliability | High | Open |
| NFR-014 | Garde de caisse | 0 écriture sur une caisse sans session couvrante, y compris par synchronisation hors ligne, prouvé par test. | Security | High | Open |
| NFR-015 | Non-régression | 100 % des tests existants (pgTAP, Jest) restent verts. | Reliability | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Priorité des sources | SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée en silence. | Regulatory | High | Open |
| C-002 | Fichiers générés | Les `.sql` générés de `packages/ledger-sql/` ne se modifient pas à la main : migrations, générateurs ou `scenario_reference.json`. | Technical | High | Open |
| C-003 | Pile | `docs/08-pile-logicielle.md` (ADR-78) ; toute nouvelle dépendance vérifiée et épinglée. | Technical | High | Open |
| C-004 | Fonctions existantes | Les fonctions S4 à S11 du schéma de référence (`open_offline_batch`, `complete_offline_batch`, `check_offline_snapshot`, `effective_offline_policy`, `policy_in_force`, `record_device_seq`, `device_missing_seqs`, `waive_seq_gap`, `max_seq_jump`, `event_sync_deadline`) sont appelées et complétées par migration, jamais réécrites ni affaiblies. | Technical | High | Open |
| C-005 | Écritures par la base | Les écritures du grand livre et les changements d'état contrôlés (snapshots, historique des politiques, colonnes de terminal, purges) passent par des fonctions de la base ; l'application n'a pas d'écriture directe sur ces tables. | Technical | High | Open |
| C-006 | Secrets | Aucun nouveau secret dans `loadConfig` sans ADR (ADR-125) ; les clés privées de signature ne sortent jamais du port de clés. | Technical | High | Open |
| C-007 | Faux | Aucun faux en production (règle 2 de CLAUDE.md), démarrage refusé et test. Le faux de signature des snapshots est une dette nommée jusqu'à la mission 12b. | Regulatory | High | Open |
| C-008 | Dette nommée | Tout écart accepté qui affaiblit la sécurité : point ouvert, ADR, test de borne, reports PROMPTS/PRD (règle 3 de CLAUDE.md) ; tout écart est soumis au porteur avant d'être codé (règle 1). | Regulatory | High | Open |
| C-009 | Hors périmètre | Passerelle locale et son snapshot propre (mission 8) ; application du terminal (équipe déléguée) ; adaptateurs AWS KMS réels et OP-N41, OP-N73 (mission 12b) ; rapprochements, versements et clôture (mission 9) ; écrans du back-office (mission 11). | Business | High | Open |
| C-010 | Idempotence | Clé d'une opération : `<série>:<numéro>` (numéro complété à 4 chiffres au moins, jamais tronqué) ; clé d'un lot : `batch_id` ; unicité `(grand livre, clé)` quel que soit le chemin. | Technical | High | Open |
| C-011 | Pas de nouvelle écriture hors du protocole | Les opérations jamais permises hors ligne (QR, recharge PSP, remboursement, activation, caution, restitution, remplacement, rendu d'espèces dues) sont refusées si un lot les porte. | Business | High | Open |
| C-012 | Tolérance d'horloge | 120 s ; abandon d'un lot à 15 min ; saut maximal de numéro 10 000 ; session de vendeur 12 h : valeurs de plateforme, non réglables par l'organisateur. | Technical | High | Open |
| C-013 | Garde de caisse | La base refuse toute écriture sur une caisse inscrite sans session couvrante (ADR-132) ; la mission ne la contourne pas ; toute évolution de la garde est soumise au porteur avant d'être codée. | Regulatory | High | Open |

### Key Entities

- **Politique hors ligne** : portée (organisation, événement, terminal), hors ligne permis, plafonds (par vente, par bracelet et par terminal), âge maximal du snapshot, recharge espèces permise, version, auteur.
- **Plafonds du prestataire** : valeurs maximales par champ de politique, au niveau du prestataire.
- **Historique des politiques** : une ligne par modification (portée, version, valeurs, suppression, auteur), écrite par la base.
- **Configuration servie** : terminal, `config_id`, politique effective figée, époque, plancher de numérotation.
- **Snapshot** : grand livre, version, base, type (`FULL` ou `DELTA`), en-tête signé, empreinte de contenu, génération, validité, époque d'autorité, clé de signature.
- **Clé de signature** : identifiant, signataire (central), algorithme, statut, référence externe (simulée).
- **Lot** : identifiant, terminal, grand livre, numéros de début et de fin, empreintes des opérations, chaîne, signature, statut (`PROCESSING`, terminé, `REJECTED`/`ABANDONED`), résultats.
- **Registre des numéros** : terminal, numéro, empreinte de contenu, résultat final, transaction éventuelle, canal (en ligne, lot, import, passerelle), date.
- **Trou** : terminal, numéro, anomalie `SEQ_GAP` ouverte ou résolue, demande de levée.
- **Anomalie hors ligne** : type (`OFFLINE_SHORTFALL`, `SEQ_GAP`, `CHAIN_BROKEN`, `CLOCK_SKEW`, `SIGNATURE_MISMATCH`, `NON_COMPLIANT_OPERATION`, `PERIOD_CLOSED_OPERATION`, `LATE_OFFLINE_SYNC`, `CASH_TOPUP_OVER_LIMIT`, `IDEMPOTENCY_CONFLICT`, `VOID_CONFLICT`, `ONLINE_CONFIRMED_MISSING`), terminal, bracelet, numéro, montant, transaction liée, partie porteuse de la perte.
- **Import de journal** : terminal révoqué, lots exportés, demande d'approbation, auteur, valideur, résultat.
- **Rôle de maintenance** : connexion dédiée aux purges.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : un parcours complet (politique réglée et plafonnée, snapshot reçu, blocage d'un bracelet suivi d'un delta en 5 s, ventes hors ligne dont une partiellement couverte, lot synchronisé, trou levé à deux, import du journal d'un terminal révoqué) se déroule par l'API, sans intervention en base — [build] · no-op passable: no
- **SC-002** : aucune opération n'est écrite deux fois sur l'ensemble des tests de rejeu et de concurrence (100 rejeux d'un même lot, panne au milieu d'un lot de 500) — [build] · no-op passable: no
- **SC-003** : aucun numéro consommé n'est perdu en silence : chaque numéro a un résultat final ou une anomalie de trou, et les trous ne se lèvent qu'à deux personnes — [build] · no-op passable: no
- **SC-004** : le commerçant d'un terminal conforme est crédité du total et le festivalier n'est jamais débité au-delà de son solde ni pour un usage postérieur au blocage ; chaque part non couverte a son anomalie — [build] · no-op passable: no
- **SC-005** : toute opération d'un terminal non conforme est rejetée sans écriture, avec une anomalie qui nomme la partie porteuse de la perte — [build] · no-op passable: no
- **SC-006** : la nouvelle version d'un snapshot paraît en 5 s au plus après un blocage et en 60 s au plus après un autre changement ; aucun terminal révoqué ne reçoit de clé de contenu — [build] · no-op passable: no
- **SC-007** : aucun mot de passe de bracelet, clé privée, PIN ou empreinte de PIN n'apparaît en clair dans la base, les journaux, les réponses ou les snapshots (balayage avec canari) — [build] · no-op passable: no
- **SC-008** : le démarrage en configuration de production est refusé pour chaque faux de la mission ; les snapshots ne sont donc pas servis en production avant la mission 12b — [build] · no-op passable: no
- **SC-009** : OP-N57, OP-N58, OP-N68, OP-N69 et OP-N75 sont levés, chacun par un test nommé qui échoue si le droit s'élargit — [build] · no-op passable: no
- **SC-010** : aucune recharge espèces hors ligne n'est écrite sans session de caisse couvrante ; sans session, le montant est en attente avec une anomalie ; aucune exemption silencieuse à la garde — [build] · no-op passable: no
- **SC-011** : aucune fuite entre prestataires ou organisateurs sur les nouvelles opérations (balayage d'isolation) — [build] · no-op passable: no
- **SC-012** : les tests minimaux de `sync_protocol.md` §13 passent côté serveur, dont l'écriture de la transaction 22 identique à `scenario_reference.json` — [build] · no-op passable: no

## Assumptions

- **Colonnes des tableaux d'exigences** : les colonnes de la mission 6 (`ID`, `Title`, `User Story`, `Priority`, `Status`) sont reprises ; `Delivery` et `No-op passable?` sont ajoutées en fin. Le texte de l'exigence se lit dans la colonne `User Story`, comme dans la mission 6.
- **Signature des snapshots simulée** (décision `01M645SWY4PETSJE3PJ7YXKYTP`) : le port de clés existant est utilisé avec un faux de signature, refusé en production ; la vérification de signature côté terminal est hors périmètre (application déléguée), mais la mission fournit un jeu d'essai (clé publique, vecteurs) pour la tester. L'algorithme par défaut est `ECDSA_P256_SHA256` ; Ed25519 est prévu par l'identifiant de clé et sera vérifié sur le KMS réel en 12b (OP-N13).
- **Routes de politique absentes du contrat** : `openapi.yaml` ne contient aucune route pour régler la politique hors ligne, les plafonds du prestataire ni lire le risque maximal. Le plan les ajoute au contrat (FR-042) ; la forme exacte est arrêtée au plan.
- **Seuils de performance** : NFR-003 et NFR-004 sont des propositions de l'agent, à confirmer au plan ; les valeurs du protocole (60 s, 5 s, 500, 1 Mio, 15 min, 10 000, 120 s) sont normatives.
- **Terminal `SUSPENDED`** : il peut encore envoyer ses lots ; ses opérations datées après la suspension sont rejetées comme non conformes. Terminal `REVOKED` : lots refusés, import à deux.
- **Suspension automatique du hors ligne après 24 h de trou** : le protocole dit « PEUT ». Non retenue : l'exploitation est alertée (FR-034) ; la décision de suspendre reste humaine. Une suspension automatique éventuelle serait une mission ultérieure.
- **Recharge espèces hors ligne sans session couvrante** : le résultat est `REJECTED` (raison à arrêter au plan), non écrit au portefeuille, avec une anomalie portant le montant ; « montant en attente » signifie que le montant reste tracé par l'anomalie et, si le plan le permet sans toucher à la garde, au compte d'attente. Le type d'anomalie (nouveau ou `CASH_TOPUP_OVER_LIMIT` avec motif) est arrêté au plan.
- **Garde de caisse inchangée** : aucune écriture sur une caisse dont la session est fermée ; la recharge tardive est rejetée avec une anomalie (décisions `01M64AEGKJ7GTEXZRXCCNKP28X`, `01M64AEZ8SBKNQTD4AHV15YBWA`).
- **Session de vendeur** : la durée de 12 h et la vérification du PIN par le serveur viennent de la mission 5b ; la mission n'ajoute aucun chemin d'authentification du vendeur hors ligne.
- **Plus grand numéro** : une valeur de numéro supérieure à 2^53 est lue sans perte de précision ou refusée explicitement ; le choix est arrêté au plan.
- **Production des snapshots** : un processus planifié (modèle des processus existants) produit les versions ; la fréquence interne est choisie pour tenir 60 s et 5 s.
- **Niveau d'identification** : tous les portefeuilles restent non identifiés (mission 10 de la feuille de route) ; les plafonds réglementaires appliqués sont ceux calculés par la base.
- **Conservation des snapshots** : la durée de conservation des anciennes versions (pour les deltas et pour juger `snapshot_version`) est arrêtée au plan ; une version inconnue donne `SNAPSHOT_VERSION_UNKNOWN`.
- **Rôle de maintenance** : la connexion dédiée est un secret de plus ; son ajout à `loadConfig` est justifié par un ADR (C-006).

## Contradictions de sources

1. **Politique hors ligne sans route** : SPECIFICATION §9.3 (réglée par l'organisateur, plafonds du prestataire, risque maximal affiché) ; `openapi.yaml` n'a aucune route pour cela. Appliqué : SPECIFICATION ; les routes sont ajoutées au contrat au plan (FR-042).
2. **Écriture tardive d'une recharge sur une caisse fermée** : `sync_protocol.md` §7.5 et §11 cas 39 (« écrites normalement », « la caisse est déjà fermée ») ; garde de caisse ADR-132 (aucune écriture sans session ouverte). Appliqué : décision du porteur du 29/10/2026 : la garde l'emporte ; recharge rattachée seulement à une session encore ouverte qui couvre `occurred_at`, sinon `REJECTED` avec anomalie portant le montant (rien d'écrit).
3. **Session de la recharge hors ligne** : PROMPTS Mission 7 propose « session couvrant `occurred_at`, ou session de rattrapage » ; la décision du porteur écarte la session de rattrapage. Appliqué : la décision.
4. **Colonnes encore écrites par l'application** : OP-N69 (`POINTS_OUVERTS`) liste le plancher, la dernière présence, le nom de station et la version de snapshot ; PROMPTS Mission 7 ajoute `app_mode`, `nfc_enabled` et `personal_phone`, et un autre passage cite l'affectation. Appliqué : les deux listes réunies, `personal_phone` et `app_mode` inclus (décision `01M647MH0SF6Q7KTM3CMXQZR0B`) ; la liste exacte est vérifiée au plan contre les droits réels de la base.
5. **« Signature invalide »** : l'intention parle d'une anomalie `SIGNATURE_MISMATCH` ; le protocole en distingue deux sortes. La signature du lot invalide (`400 BATCH_SIGNATURE_INVALID`, lot non traité, sans anomalie comptable) et la signature d'originalité du bracelet (`SIGNATURE_MISMATCH`, anomalie, opération gardée). Appliqué : les deux sont traitées (FR-013, FR-026), le refus du lot étant signalé dans l'audit.
6. **Signature des snapshots** : SPECIFICATION §9.4 et `sync_protocol.md` §4.1 exigent une clé dans le KMS/HSM ; la décision `01M645SWY4PETSJE3PJ7YXKYTP` simule le KMS jusqu'à la mission 12b. Appliqué : la décision, faux refusé en production, dette nommée (C-007) ; aucun snapshot réel n'est servi en production avant 12b.
7. **Fréquence des versions** : `sync_protocol.md` §4.2 « DEVRAIT » 60 s mais « DOIT » 5 s après un blocage ; SPECIFICATION §9.4 « nouvelle version toutes les 60 s s'il y a un changement ». Appliqué : 60 s au plus et 5 s au plus après un blocage, tenus tous les deux (NFR-005).
8. **Algorithme de signature** : `sync_protocol.md` §4.1 (ECDSA P-256 par défaut, Ed25519 si le KMS le permet) ; OP-N13 (ECDSA P-256 retenu) ; PROMPTS Mission 7 (vérifier Ed25519 dans KMS). Appliqué : ECDSA P-256 par défaut ; la vérification d'Ed25519 est reportée avec le KMS réel (12b).

## Decisions

| Décision | Statut |
|---|---|
| Services externes simulés (DM `01M645SWY4PETSJE3PJ7YXKYTP`) | Résolue le 29/10/2026 par le porteur : la signature des snapshots passe par le port de clés existant, dont le faux est refusé en production ; adaptateurs AWS KMS (signature, OP-N41, OP-N73) en mission 12b (feuille de route révisée) |
| Connexion du vendeur hors ligne (DM `01M647M2MDHBNDZ1AVC93PFR16`) | Résolue le 29/10/2026 par le porteur : un vendeur connecté en ligne garde sa session hors ligne jusqu'à expiration (12 h) ; aucune nouvelle connexion hors ligne ; aucun secret ni empreinte de PIN envoyé au terminal |
| Recharge espèces hors ligne et session de caisse (DM `01M647M9W14H6E7BWZDRWPGNDZ`) | Résolue le 29/10/2026 par le porteur, précisée par les deux décisions suivantes : rattachée à la session du même terminal qui couvre `occurred_at` si elle est encore ouverte ; jamais d'exemption à la garde |
| Héritages de droits levés dans la mission (DM `01M647MH0SF6Q7KTM3CMXQZR0B`) | Résolue le 29/10/2026 par le porteur : OP-N57 (snapshot inscrit par une fonction qui calcule la version), OP-N58 (historique par déclencheur `SECURITY DEFINER`, `INSERT` retiré à l'application), OP-N68 (droit par défaut global), OP-N69 (écritures du terminal par fonctions, `personal_phone` et `app_mode` compris), OP-N75 (rôle de maintenance dédié), chacun avec son test et la levée du point |
| Session couvrante déjà fermée (DM `01M64AEGKJ7GTEXZRXCCNKP28X`) | Résolue le 29/10/2026 par le porteur : refus complet (`REJECTED`), rien écrit (ni portefeuille ni caisse), anomalie portant le montant, régularisation au back-office ; garde de caisse inchangée |
| Aucune session couvrante (DM `01M64AEZ8SBKNQTD4AHV15YBWA`) | Résolue le 29/10/2026 par le porteur : rejet et anomalie portant le montant ; rien écrit |
| Trou de numérotation de plus de 24 h (DM `01M64AFDTANCENGM3N0FQ56BDB`) | Résolue le 29/10/2026 par le porteur : alerte seulement, le terminal continue ; levée à deux |
| Autres choix ci-dessus (Assumptions, Contradictions) | Propositions de l'agent, égales ou plus strictes que les sources ; à confirmer par le porteur |
