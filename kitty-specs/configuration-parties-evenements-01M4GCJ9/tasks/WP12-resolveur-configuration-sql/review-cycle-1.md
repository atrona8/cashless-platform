---
affected_files: []
cycle_number: 1
mission_slug: configuration-parties-evenements-01M4GCJ9
reproduction_command: spec-kitty agent tasks move-task WP12 --to approved --mission configuration-parties-evenements-01M4GCJ9
reviewed_at: '2026-10-12T12:33:56Z'
reviewer_agent: claude
wp_id: WP12
---

Approved by claude: Review passed. Checklist : 1 PASS (SqlConfigResolver fourni au moteur par ConfigResolverModule, importé par AppModule), 2 PASS (rejeu des 48 transactions par le moteur sur la vraie base ; lignes comparées une à une à scenario_reference.json ; le scénario n'a pas été modifié), 3 PASS (une règle unique absente lève une erreur explicite à sa lecture, pas un zéro), 4 PASS (FR-016 : config_version_id sur chaque transaction écrite par le moteur, fee_rule_id sur chaque ligne de frais ; SC-004), 5 PASS (scenario_reference.json et .sql générés intacts), 6 PASS, 7 : fichiers hors périmètre touchés, minimalement — moteur de la mission 1 (ledger/money/fee.ts, types.ts, cinq constructeurs, db/ledger-queries.ts, ledger-engine.service.ts, ports/config-resolver.ts) pour porter fee_rule_id et passer le client au résolveur : le prompt supposait à tort que c'était déjà fait ; app.module.ts (une ligne, prévu), 8 PASS. Écarts consignés : les transactions de caution, écrites par les fonctions de la base, n'ont pas de config_version_id ; les lignes de crédit de OPERATOR_FEE, somme de plusieurs règles, ne citent pas de règle (les lignes de débit, une par règle, la citent) ; les droits de place n'ont pas de règle de frais (montant de la participation) ; les frais d'un canal de paiement sont lus par une convention provisoire (bénéficiaire PSP:<canal>) en attendant la mission des PSP ; une opération datée d'avant la première version de configuration de l'événement prend cette première version.
