# Contrat : catalogue versionné

Exigences : FR-007, FR-008, FR-011, FR-012. Décision : `DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD` (prix servi ou actuel).

## Gestion (back-office)

- Qui : `ORGANIZER_ADMIN` de l'organisateur de l'événement du point de vente (et `OPERATOR_ADMIN`) ; le `MERCHANT_ADMIN`
  du commerçant du point de vente si `point_of_sale_catalog_policy.merchant_manages` est vrai (réglé par l'organisateur).
- Opérations : catégories (créer, renommer, ordonner, désactiver), articles (créer, modifier prix, taux, libellés,
  catégorie, désactiver), lecture du catalogue courant et d'une version.
- Chaque écriture passe par une fonction de la base qui, dans la même transaction, crée la version suivante du point de
  vente (copie des articles actifs). Pas de suppression : désactivation.
- Bornes : `unit_price > 0` ; `vat_rate_bps` de 0 à 10 000 ; libellés FR et EN non vides (120 caractères au plus).
- Audit : une ligne par écriture, avec la version créée.
- Événement `CLOSED` : écriture refusée.

## Configuration servie

`DeviceConfigService.build` (terminal `CATALOG_POS`) : lit la dernière version du point de vente, l'écrit dans
`device_catalog_served` si elle n'y est pas pour ce terminal, et sert
`catalog = {version, items: CatalogItem[]}` (articles de cette version ; `category` = libellé de la catégorie dans la
langue de l'en-tête `Accept-Language`, `name` idem). L'ETag change avec la version ; `config_id` (déduplication de
`record_config_served`) est inchangé. Terminal sans point de vente ou point de vente sans catalogue : version 0,
`items: []`.

## Contrôle des lignes d'une vente (A2 : retour à la décision du porteur)

`record_sale_lines(p_tx uuid, p_device uuid, p_lines jsonb)` (SECURITY DEFINER), appelée dans la transaction de la
vente, après l'écriture et avant `consume_tap` :

1. La vente `p_tx` est une `PURCHASE` du terminal `p_device`, sans lignes encore.
2. Versions admises : la version **courante** du point de vente et la **dernière version servie** à ce terminal
   (`device_catalog_served`, plus récente ligne pour ce terminal et ce point de vente) — et aucune autre. Une version
   servie puis remplacée par une version servie plus récente n'est plus admise.
3. **Une seule version par vente** : la première des deux (courante, puis dernière servie) où **toutes** les lignes
   ont leur article actif au prix reçu ; aucune → `CL034` → `422 SALE_LINES_INVALID`, et le terminal se resynchronise.
4. Écrit les lignes (libellés, prix, taux copiés de la version retenue, numéro de version), `line_total = quantity ×
   unit_price`.
5. Σ `line_total` ≠ montant de la vente → `CL034`.

Test de borne : version 1 servie, puis version 2 servie, puis version 3 courante → une ligne au prix de la version 1
est refusée ; une vente mêlant les prix des versions 2 et 3 est refusée.

Un mode `KEYPAD_TPE` refuse des lignes ; un mode `CATALOG_POS` les exige (contrôle dans l'API, avant l'écriture).

## Concurrence et délégation (A21)

Chaque fonction d'écriture du catalogue verrouille la ligne `point_of_sale_catalog_policy` du point de vente
(créée à la première écriture) avant de calculer la version suivante : deux modifications simultanées donnent deux
versions successives. La délégation au commerçant (`merchant_manages`) est revérifiée par ces fonctions : l'auteur
passé est un `MERCHANT_ADMIN` du commerçant du point de vente seulement si la délégation est active (la base relit le
rôle de l'auteur), sinon refus.
