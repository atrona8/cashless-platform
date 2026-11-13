# Relecture WP08, cycle 1 : refus (suites voisines cassées)

Base cashless_wp08r remise à zéro ; tests_edge_replication 160/160 OK ; sur 58 suites pgTAP, 48 passent et 10 échouent.
(_grants_for_tests.sql n'est pas une suite.)

**1. BLOQUANT. 0063 casse 7 suites voisines que rien ne réaffecte à un lot ultérieur.** Adapter chacune, sans toucher aux
.sql générés, et lister ces retouches hors carte dans le compte rendu.
 a) « cannot ALTER TABLE ... pending trigger events » : tests_catalog (l.94, ALTER TABLE event DISABLE TRIGGER après un
    INSERT/UPDATE), tests_configuration, tests_enrollment_event_state, tests_offline_anomalies. Correction : `SET CONSTRAINTS
    ALL IMMEDIATE;` avant chaque ALTER TABLE du fixture (ou en tête de suite, comme le fait tests_edge_replication l.18).
 b) tests_edge_gateway 73 (« journal vide », a 4 lignes) : remplacer par un contrôle de structure/RLS, ou par « aucune
    ligne d'un autre grand livre ». tests_edge_handover (l.56, 23505 sur (ledger, 1)) : le grand livre porte déjà la ligne
    EVENT de l'amorce ; partir de max(change_seq)+1 ou supprimer les lignes d'amorce par le propriétaire (DISABLE TRIGGER immutable).
 c) tests_definer_trigger_writers 16 et tests_payments 6 : edge_ref_trigger est un déclencheur SECURITY DEFINER sur
    vendor_session (et ~20 autres tables). Ajouter les entrées à la liste exacte, avec le commentaire de justification
    (écrivain unique : edge_ref_emit_many, journal en ajout seul). tests_payment_rights 56 : ajouter edge_device_seq_acked
    à la liste des vues, avec contrôle qu'aucun rôle cashless_* n'y écrit.
 (tests_offline_rights 1 : liste de tables, déjà en échec pour edge_platform_setting/edge_sync_batch avant WP08 ; affectée à
 WP09 par interfaces.md l.21 et tasks/WP09 l.127. Pas de retouche ici.)

**2. MAJEUR. Le mode de production du journal n'est pas testé.** Toute la suite tourne en `SET CONSTRAINTS ALL IMMEDIATE`.
Ajouter, par dblink (déjà utilisé § 7), un cas en différé réel : deux connexions écrivent une entité de référence du même
grand livre, la seconde valide avant la première ; les change_seq suivent l'ordre de validation, sans trou ; et le cas
d'une transaction qui écrit puis valide sans SET CONSTRAINTS (le journal reçoit la ligne au COMMIT).

**3. MINEUR. En-tête de 0063 : documenter le piège DDL.** migrate.ts exécute TOUTES les migrations en une seule transaction
(BEGIN l.90, COMMIT l.160). Une migration future qui écrit une table chaude puis fait ALTER TABLE / CREATE INDEX / DROP sur
elle échoue (« pending trigger events »). Ajouter à l'en-tête : « avant tout DDL sur une table à déclencheur du journal,
après une écriture : SET CONSTRAINTS ALL IMMEDIATE ». (Un correctif de données seul est sûr : le journal se remplit au COMMIT.)

**4. MINEUR. edge_ref_ledger (AFTER INSERT ON ledger, non différé)** prend le verrou `edge-reference` en cours de transaction.
Sans danger (verrou propre au grand livre neuf), mais contredit « verrou pris au COMMIT seulement » de l'en-tête : le préciser.

**À trancher par le porteur (pas bloquant pour ce cycle)** : devices[].token_family toujours null (colonne edge_exposed
absente de device_refresh_token, OP-N102 / décision 11). Sécurité : renforcement. Fonction : la passerelle ne peut pas
renouveler un jeton d'appareil hors ligne tant que la colonne et le rendu manquent ; le contrat l'accepte (nullable) mais
WP18 en dépend. Il faut décider quel lot ajoute edge_exposed (migration) et le rendu.
