# Notes d'architecture : mission durcissements-serveur-01M7QAJD

> État : **plan finalisé le 18/11/2026**, non implémenté (mission 11a). Pas de diagramme dans ce fichier (routage `.docmeta/diagram-style-routing.md`) ; vue d'ensemble du plan dans `plan.md` (section Architecture).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **Processus `vendor-pin`** (nouveau, `main.vendor-pin.ts`, port 3003) : rôle de base `cashless_pin` (`DATABASE_URL_PIN`), seul détenteur de `VENDOR_PIN_SECRET`. Sur le modèle de `tag-keys` : pool et rôle uniques, `DenyUnmarkedRoutesGuard`, audit, garde de production. Deux routes internes : ouvrir une session (essai compté, argon2, `open_vendor_session`, audits) et hacher un PIN.
- **Appel interne API vers `vendor-pin`** (premier du projet) : HMAC-SHA256 sur le corps, la route et un horodatage (fenêtre de 30 s), clé `VENDOR_PIN_CALL_KEY` ; refus si le processus ne répond pas, **aucun repli**.
- **Fonctions `SECURITY DEFINER`** (base) : `create_media_batch`, `update_media_batch` (liste blanche), `set_media_batch_status`, `media_set_status`, `issue_claim_codes` (corps identiques) ; `search_path = public, pg_temp` ; `REVOKE INSERT, UPDATE ON media_batch FROM cashless_app`.
- **Base** : `UNIQUE (id, vendor_id)` et clé étrangère composite sur `sale_attribution` ; `INSERT` de `refund_request` limité à 16 colonnes et déclencheur d'état initial ; `register_edge_gateway` rend le grand livre.
- **API** : crochet `guardDecision` des approbations, plafond de régularisation (`closing/fees.ts`), masque d'IBAN dans `redact.ts`.
- Migrations `0090` à `0095` ; codes d'erreur nouveaux à partir de `CL056`.

## Décisions d'architecture prises dans cette mission
Proposées par l'agent en l'absence du porteur (18/11/2026), à confirmer.

| Décision | Justification | Alternative envisagée |
|---|---|---|
| R-01 Lots et statut par fonctions `DEFINER`, droits directs retirés (OP-N60) | Seules deux requêtes directes existent ; le verrou `FOR UPDATE` sur `media_batch` est retiré | Politique `RLS` restrictive (laisse `INSERT`) ; une fonction par colonne |
| R-02 Vendeur dans la clé de session (OP-N79) | `sale_attribution` copie déjà le vendeur de la session | `NOT VALID` puis `VALIDATE` |
| R-03 Processus `vendor-pin` + appel HMAC sans repli (OP-N76) | Un détenteur du secret autre que l'API ; la clé d'appel ne donne aucun accès sans PIN | mTLS (plus lourd, aucun gain contre une API compromise) ; router la route vers le processus (change `x-process`) |
| R-04 `INSERT` limité et déclencheur d'état initial (OP-N145) | `cashless_app` avait `INSERT` sur toutes les colonnes | Fonction `DEFINER` de création |
| R-05 Crochet `guardDecision` (OP-N137) | Même contrôle de classe au refus qu'à l'approbation | Contrôle dans chaque action |
| R-06 Plafond dans `buildOperatorFee` (OP-N141) | Un seul calcul de frais, plafond et total ne divergent pas | Contrôle en aval |
| R-07 Masque d'IBAN par champ et par forme (OP-N140, partie A) | Ni `iban` ni un IBAN nu n'étaient masqués | Masque par champ seul |
| R-08 `register_edge_gateway` rend `(gateway_id, ledger_id)` (OP-N116) | Aucun droit nouveau, un aller-retour atomique | Lecture séparée du grand livre |
| R-09 Table `device_app_attest_key`, compteur conditionnel (OP-N64) | `device` est répliquée vers la passerelle | Colonne sur `device` |

### Décisions différées : en attente du porteur
| Décision | Proposition de l'agent | Alternative |
|---|---|---|
| 1. Clé de chiffrement de l'IBAN (OP-N140, partie B) : **en attente du porteur** | AES-256-GCM, anneau de clés en configuration de l'API ; limite : la clé est dans le processus public | Masque seul, chiffrement reporté au vrai KMS (12b) |
| 2. `refund_deposit(uuid, uuid)` (OP-N145) : **en attente du porteur** | La garder interne (écart à FR-012, neutre, consigné) ; retirer `refund_deposit_for_session` | La retirer avec `gen_tests.py` et le schéma de référence |
| 3. `EXECUTE` pour le compteur App Attest (OP-N64) : **en attente du porteur** | `advance_app_attest_counter`, `EXECUTE` étroit pour `cashless_app` | Reporter OP-N64 serveur à la mission 12 |

Les lots qui en dépendent ne sont pas codés avant la réponse (règle du porteur du 13/10/2026).

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » (processus `vendor-pin`, appel interne signé sans repli, lots par fonctions `DEFINER`) ; la vue C4 gagnera un conteneur `vendor-pin`.

## Nécessaire pour cette mission ? Oui : un processus, un premier appel interne et des droits de base changent (réponse proposée par l'agent).
## Complet ? Oui pour le plan, hors trois décisions différées qui complèteront la table (réponse proposée par l'agent).
## Validé par : en attente de validation humaine (porteur indisponible le 18/11/2026), réponses proposées par l'agent.
