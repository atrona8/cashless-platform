# Note aux équipes du back-office web et de l'app terminal : routes du back-office (mission 11b)

Version du 25 novembre 2026. Ce document dit comment se servir du contrat livré (`packages/contracts/openapi.yaml`) : il ne le
remplace pas. En cas d'écart, le contrat fait foi. Routes préfixées par `/v1`. Décisions : ADR-235 ; limites : ADR-236.
Aucun écran n'est livré (c'est la mission 11) et **aucune de ces opérations n'écrit au grand livre**.

## 1. Les 11 opérations

Toutes avec le jeton du personnel (OIDC) ; un jeton festivalier ou un jeton de terminal est refusé. Dates en UTC. Montants
en unités mineures. **`x-roles`** de chaque opération (dans le contrat) dit quels rôles peuvent l'appeler : s'en servir pour
masquer les actions, jamais pour décider à la place du serveur.

| Opération | Méthode et chemin | Rôles | Filtres et remarques |
|---|---|---|---|
| `getStaffProfile` | `GET /staff/me` | tous les rôles du personnel | `user_id`, `display_name`, `operator_id`, `assignments[]` (`role`, `scope_type`, `scope_id`). Une personne sans rôle actif reçoit `200` avec `assignments` vide. Une personne de la plateforme s'appelle « Administration de la plateforme » (OP-N191). |
| `listEventSales` | `GET /events/{event_id}/sales` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `MERCHANT_ADMIN` | `pos_id`, `merchant_id`, `vendor_id`, `from`, `to`, `status` (`VALID`, `REVERSED`), `cursor`, `limit`. Un `MERCHANT_ADMIN` ne voit que les ventes de ses commerçants. |
| `getSale` | `GET /sales/{transaction_id}` | idem | Lignes (`lines[]`) et annulation éventuelle ; aucun identifiant de portefeuille ni donnée du festivalier. |
| `listAnomalies` | `GET /anomalies` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | `event_id`, `kind`, `status`, `from`, `to`, `cursor`, `limit`. Une anomalie sans grand livre n'est vue que de `OPERATOR_ADMIN`. |
| `classifyAnomaly` | `POST /anomalies/{anomaly_id}/classification` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Corps `{ "reason": "…" }` (1 à 500 caractères) ; `Idempotency-Key` obligatoire. |
| `searchMedia` | `GET /search/media` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN` | **Un seul** de `nfc_uid` ou `printed_code` ; réponse `{ "data": [ ... ] }` de 0 ou 1 élément. |
| `getWalletOverview` | `GET /search/wallets/{wallet_id}` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER` | Soldes, statut, bracelets, `customer_ref` masqué. |
| `searchCustomerByPhone` | `POST /search/customers` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR` (**pas** `PLATFORM_ADMIN`) | Corps `{ "phone": "+221…" }`, E.164 strict, égalité exacte. |
| `listPhoneModels` | `GET /phone-models` | `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | `cursor`, `limit` ; tri fabricant puis modèle. |
| `upsertPhoneModel` | `PUT /phone-models/{manufacturer}/{model}` | `PLATFORM_ADMIN` | Corps `{ "nfc_level": "RECOMMENDED" \| "TOLERATED", "measured_at": "AAAA-MM-JJ" }`. Casse et espaces sans effet. |
| `deletePhoneModel` | `DELETE /phone-models/{manufacturer}/{model}` | `PLATFORM_ADMIN` | `404` si le modèle est absent. |

## 2. Pagination

Curseur **opaque** : ne pas le fabriquer ni l'interpréter, le rendre tel quel (`next_cursor`, `has_more`). `limit` : entier de
1 à 200, 50 par défaut ; hors bornes ou curseur invalide : `422 VALIDATION_FAILED`. Garder les mêmes filtres d'une page à
l'autre. Les listes de ventes et d'anomalies vont de la plus récente à la plus ancienne.

## 3. Codes et `reason`

Aucun code d'erreur nouveau. À distinguer :

- `422 VALIDATION_FAILED` avec `reason = ANOMALY_KIND_NOT_CLASSIFIABLE` : le type de l'anomalie ne se classe pas (il laisse de
  l'argent en attente). `reason` est une **propriété de premier niveau** du corps de l'erreur, à côté de `code` (OP-N197).
  Autres `422` : motif vide ou de plus de 500 caractères, paramètre mal formé, curseur invalide.
- `409 CONFLICT_STATE` : l'anomalie est déjà traitée (le premier motif est conservé).
- `404 NOT_FOUND` : objet inconnu **ou hors de la portée** de la personne (aucune différence visible, voulu). Une vente sans
  attribution rend aussi `404` (OP-N192).
- `403` : rôle non autorisé pour l'opération. `401` : pas de jeton.
- `429 RATE_LIMITED` avec l'en-tête `Retry-After` (secondes) : plus de 20 recherches par numéro en une minute pour la même
  personne (réglable côté serveur).
- `searchMedia` : `400` si aucun critère, les deux critères ou un critère répété ; un code imprimé mal formé ou inconnu rend
  une liste vide, comme un bracelet inconnu ou d'un autre prestataire.

## 4. Anomalies : lire `classifiable`

Chaque `Anomaly` porte `classifiable` (booléen) : **le lire, ne pas recopier la liste des types**. 10 types sur 23 se
classent ; pour les autres (`OFFLINE_SHORTFALL`, `PSP_TOPUP_NOT_CREDITED`, `CASH_TOPUP_OVER_LIMIT`, etc.), n'afficher aucune
action « classer » : le serveur refuse, et la résolution d'argent viendra avec une mission suivante (OP-N185). Classer ne
déplace aucun argent et ne se défait pas. `classification` (motif, auteur, date) est présent une fois l'anomalie classée.
`media_id` sort ; le détail libre de l'anomalie ne sort pas. Rejouer la même `Idempotency-Key` rend la même réponse.

## 5. Recherche par numéro

Le numéro va dans le **corps** (jamais dans l'URL). La réponse ne le rend que **masqué** (`+221 77 *** ** 12`) ; ne jamais le
demander ni le stocker côté écran au-delà de la saisie. Pas de recherche partielle ni approchée. La recherche est
journalisée sans le numéro. Un `SUPERVISOR` ne trouve que les portefeuilles de ses événements. Prévoir le `429` (afficher le
délai de `Retry-After`).

## 6. Niveau NFC et `device_model` (back-office et app terminal)

- **App terminal.** Envoyer le champ **facultatif** `device_model { manufacturer, model }` dans `DeviceEnrollmentRequest` et
  `HeartbeatRequest`. Valeur déclarée, informative, non vérifiée. Une valeur absente, inconnue ou mal formée ne fait **jamais**
  refuser l'enrôlement ni l'usage du terminal.
- **Back-office.** La fiche d'un terminal (`DeviceAdminDetail`) et la liste (`DevicePage`) portent `device_model` et
  `nfc_level` : `RECOMMENDED`, `TOLERATED` ou `UNTESTED` (modèle absent de la liste ou inconnu). Signaler les niveaux
  `TOLERATED` et `UNTESTED` ; **ne jamais bloquer** un terminal sur ce niveau. Le niveau est recalculé à chaque lecture : un
  changement de la liste des modèles change le niveau des terminaux déjà enrôlés (OP-N190).

## 7. Limites à connaître

OP-N185 (résolutions d'argent non livrées), OP-N191 (nom fixe de la plateforme), OP-N192 (ventes non attribuées invisibles),
OP-N188 (huit opérations sans route n'ont pas de `x-roles`), OP-N190 (niveau NFC sans historique). Détail :
`docs/POINTS_OUVERTS.md` §15.
