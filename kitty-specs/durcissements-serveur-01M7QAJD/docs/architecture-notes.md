# Notes d'architecture : mission durcissements-serveur-01M7QAJD

> État : **relue le 19/11/2026** (14 lots sur 14 approuvés), **acceptée le 19/11/2026, dans `main` par la PR #20 le 20/11/2026 (`27d0ec50`)** ; revue post-fusion PASS WITH NOTES (B-1 corrigé : masque d'IBAN des versements recoupé à l'exécution, `ae432316`). Recalé sur l'implémentation (lane `n`, qui contient toute la mission) le 19/11/2026. Pas de diagramme dans ce fichier (routage `.docmeta/diagram-style-routing.md`). Dettes et décisions : `docs/POINTS_OUVERTS.md` (OP-N150 à OP-N162) et `docs/DECISIONS_ADR.md` (ADR-216 à ADR-224), déjà à jour.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **Processus `vendor-pin`** (`main.vendor-pin.ts`, dossier `apps/api/src/vendor-pin/`, **port 3003 en loopback**) : rôle de base `cashless_pin` (`DATABASE_URL_PIN`), seul détenteur de `VENDOR_PIN_SECRET` (il refuse de démarrer sans lui). Routes internes : ouvrir une session (essai compté, argon2, `open_vendor_session`, audits) et hacher un PIN. **L'API ne voit plus ni l'empreinte ni le secret du PIN** ; elle voit encore le PIN en transit (OP-N151).
- **Appel interne API vers `vendor-pin`** (premier du projet) : HMAC-SHA256 sur le corps, la route et `x-pin-ts` (**en millisecondes**, fenêtre de 30 s), clé `VENDOR_PIN_CALL_KEY` (≥ 32 octets) ; **cache de signatures vues** (garde `vendor-pin-call.guard.ts`, 20 000 entrées, TTL 70 s ; plein = 401) : un rejeu est refusé en 401, un corps sans `rawBody` aussi ; refus si le processus ne répond pas, **aucun repli**. Écart au plan : le plan n'avait pas d'anti-rejeu, ajouté sur décision du porteur du 19/11/2026.
- **Fonctions `SECURITY DEFINER`** (base, `0091`) : `create_media_batch` (acteur obligatoire), `update_media_batch` (liste blanche, `CL056` sinon), `set_media_batch_status`, `media_set_status`, `issue_claim_codes` ; `search_path = public, pg_temp` ; `REVOKE INSERT, UPDATE ON media_batch FROM cashless_app`. Côté API, le `PATCH` d'un lot prend un **verrou consultatif** (`hashtextextended('media-batch:' || id)`) : un prestataire peut en retarder un autre sans accès aux données (OP-N161).
- **IBAN chiffré** : coffre `common/iban-vault.ts` (AES-256-GCM, format `enc:v1:<kid>:…`, AAD liée au prestataire, anneau `IBAN_KEYRING` + `IBAN_ACTIVE_KID` en configuration de l'API), aux trois emplacements (`refund_request.iban`, `payout.iban`, contenu des demandes d'approbation) ; `CHECK … LIKE 'enc:v1:%'` **`NOT VALID`** en base (`0093`) : une ancienne ligne en clair ne change plus d'état (OP-N155, **bloquant la production, levé par la mission 12b**). La clé est dans le processus public (OP-N150, levée avec le vrai KMS en 12b).
- **Base, autres** : `UNIQUE (id, vendor_id)` et clé étrangère composite sur `sale_attribution` (`0090`) ; `INSERT` de `refund_request` limité à des colonnes et déclencheur `refund_request_insert_guard` (`CL057`, `0092`) ; `refund_deposit_for_session` retirée, `refund_deposit(uuid, uuid)` gardée, exécutable par personne (OP-N153, retrait en mission 13) ; `register_edge_gateway` rend `(gateway_id, ledger_id)`, `CL058` si aucun ou plusieurs grands livres (`0094`) ; table `device_app_attest_key` et `advance_app_attest_counter` (`DEFINER`, `CL059`, `0095`).
- **API** : crochet `guardDecision` des approbations (refus aussi gardé par classe), plafond de régularisation dans `closing/fees.ts`, **masque** dans `errors/redact.ts` : IBAN (par champ et par forme : tirets, espaces insécables, collés) et **numéro de mobile money** (`msisdn`, `phone`, `mobile` par nom de champ ; E.164 en texte libre), levé par renforcement (OP-N156) ; vérificateur App Attest `attestation/ios-app-attest*.ts` **sans appelant en production**, borne iOS gardée (OP-N64 : serveur prêt, non levé).
- **Outil `edge-admin`** : `register` refuse l'option `--ledger` (même vide ou identique) ; le grand livre vient de la base (OP-N162).
- Migrations `0090` à `0095` ; codes d'erreur `CL056` à `CL059`. Tests de borne : `tests_11a_bounds.sql` (46 assertions), specs Jest `vendor-pin-bounds`, `vendor-pin-call-replay`, `redact`, `limits-9b`, `architecture`.

## Décisions d'architecture prises dans cette mission
Décisions R-01 à R-09 du plan, plus les décisions du porteur des 18 et 19/11/2026 (ADR-223).

| Décision | Justification | Alternative envisagée |
|---|---|---|
| R-01 Lots et statut par fonctions `DEFINER`, droits directs retirés (OP-N60, ADR-216) | Seules deux requêtes directes existaient | `RLS` restrictive ; une fonction par colonne |
| R-02 Vendeur dans la clé de session (OP-N79) | `sale_attribution` copie déjà le vendeur | `NOT VALID` puis `VALIDATE` |
| R-03 Processus `vendor-pin` + appel HMAC sans repli (OP-N76, ADR-217) | Un détenteur du secret autre que l'API | mTLS ; router la route vers le processus |
| R-03b (19/11) Cache anti-rejeu de l'appel signé | Un appel rejoué dans la fenêtre de 30 s était accepté | Fenêtre seule (plan) |
| R-04 `INSERT` limité et déclencheur d'état initial (OP-N145, ADR-219) | `INSERT` sur toutes les colonnes | Fonction `DEFINER` de création |
| R-05 Crochet `guardDecision` (OP-N137, ADR-220) | Même contrôle de classe au refus | Contrôle dans chaque action |
| R-06 Plafond dans `buildOperatorFee` (OP-N141) | Un seul calcul de frais | Contrôle en aval |
| R-07 Masque d'IBAN par champ et par forme (OP-N140 A) | Ni `iban` ni un IBAN nu masqués | Masque par champ seul |
| R-08 `register_edge_gateway` rend le grand livre (OP-N116, ADR-221) | Aucun droit nouveau | Lecture séparée |
| R-09 Table `device_app_attest_key`, compteur conditionnel (OP-N64, ADR-222) | `device` est répliquée vers la passerelle | Colonne sur `device` |

### Décisions du porteur (ex-décisions différées du plan)
| Décision | Résultat | Alternative écartée |
|---|---|---|
| 1. Clé de l'IBAN (OP-N140 B, 18/11) | AES-256-GCM, anneau en configuration de l'API ; limite OP-N150 | Masque seul, chiffrement reporté à 12b |
| 2. `refund_deposit(uuid, uuid)` (OP-N145, 18/11) | Gardée interne, écart à FR-012 consigné (OP-N153), retrait en **mission 13** (confirmée le 19/11) ; `refund_deposit_for_session` retirée | La retirer maintenant |
| 3. `EXECUTE` du compteur App Attest (OP-N64, 18/11) | `advance_app_attest_counter` pour `cashless_app` ; déni de service accepté (OP-N152) | Reporter à la mission 12 |
| 19/11 : anti-rejeu, test de `checkSealed`, tests de borne avant fusion, masquage du `msisdn` | Faits (ADR-223) | |
| 19/11 : OP-N155 | Condition bloquante de passage en production, portée par la **mission 12b** | |
| 19/11 : CL058 et CL059 | `interfaces.md` corrigé : aucun des deux dans `sqlstate-map.ts` (CL058 traduit par `edge-admin`, CL059 par le vérificateur App Attest) | Ligne inutile dans l'API |

## Écarts entre le plan et la réalisation
Voir `docs/passation-11a/a-consigner.md` (28 points). Les principaux : anti-rejeu ajouté ; session de vendeur ouverte par le processus hors de la transaction de l'API (renvoi après API tombée compté, OP-N158) ; `msisdn` masqué (non prévu) ; casse de compilation WP06 vers WP07 (fusion ensemble) ; `closing-journey.spec.ts` rouge dans une lane qui a WP02 sans WP10 (état intermédiaire voulu) ; vecteurs App Attest générés localement, un vecteur réel d'Apple exigé avant la mission 12 ; rôle `cashless_pin` sans mot de passe en production et `INSERT` sur `audit_log` non restreint aux actions `VENDOR_*` (OP-N157). Déploiement : tout processus qui appelle `loadConfig` exige en production `VENDOR_PIN_CALL_KEY`, `IBAN_KEYRING` et `IBAN_ACTIVE_KID`.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » (processus `vendor-pin`, appel interne signé sans repli et anti-rejeu, lots par fonctions `DEFINER`, coffre d'IBAN) et vue C4 (conteneur `vendor-pin`, redessiné).

## Nécessaire pour cette mission ? Oui : un processus, un premier appel interne, un coffre de clés et des droits de base changent (réponse du porteur, 19/11/2026).
## Complet ? Oui, recalé sur le code de la lane `n` ; reste la relecture humaine des fichiers de clés, de droits et de cryptographie (réponse du porteur, 19/11/2026).
## Validé par : le porteur, 19/11/2026.
