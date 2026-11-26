# Relecture WP06, cycle 1 : changements demandés

1. BLOQUANT. Curseur à date impossible (ex. `2026-02-30T00:00:00.000000Z`) : la regex et `Date.parse` l'acceptent
   (JS déborde sur mars), PostgreSQL la refuse (22008) : `500 INTERNAL_ERROR` au lieu de `422`. Même cause pour
   `from`/`to` : `2026-02-30` est accepté en silence (200, décalé au 1er mars). Corriger : vérifier l'aller-retour
   (la date relue en UTC redonne les mêmes champs jour/mois) pour le curseur, `from` et `to`. Tests 422 à ajouter.
2. BLOQUANT (NFR-001 p95 < 500 ms, 200 000 ventes) : `sales-latency.spec.ts` rejoué deux fois, machine chargée
   (load 11) : page 1 75-95 ms, page profonde 70-100 ms, détail 51 ms (OK) mais filtre pos_id 1420 ms, merchant_id
   651 ms, MERCHANT_ADMIN 547 ms, REVERSED 270 ms (limite dépassée sur 3 à 4 cas ; EXPLAIN pos_id : 4,9 s).
   Soit un index/plan manquant pour ces filtres (WP02 n'a mesuré que « annulées »), soit consigner l'écart.
   Rejouer sur machine calme avant de conclure.
3. MINEUR. `channel` peut être null (jointure externe sur sale_attribution, ventes de back-office) alors que le
   contrat l'exige non nul (`type: string`). Correction proposée : valeur sûre non fabriquée impossible
   (enum NFC/MERCHANT_QR/CUSTOMER_QR) ; plutôt exclure de la liste les ventes sans attribution, ou le déclarer
   au porteur comme écart de contrat. Aucun test ne couvre ce cas : en ajouter un.
4. À vérifier à la consolidation : `SaleDetail` allOf (corrigé par WP04, autre lane) doit recouper ce lot.
