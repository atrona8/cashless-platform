# Research: Durcissements serveur hérités

Quatre recherches en lecture seule (18/11/2026), détaillées dans `research/` avec chemins et lignes. Décisions
d'ingénierie prises par l'agent en l'absence du porteur : **proposées par l'agent, à confirmer** ; les trois décisions
qui touchent la sécurité sont différées (voir `plan.md`).

## R-01 — OP-N60 : lots et statut des bracelets

- **Décision** : fonctions `SECURITY DEFINER` `create_media_batch` (sans paramètre de statut) et `update_media_batch`
  (liste blanche : `quantity`, `print_order_ref`, `preload_promo_amount`, `deposit_amount`, `deposit_mode`,
  `reuse_policy` ; lot `ORDERED` seulement ; `quantity` refusée si `claim_codes_issued_at` est posé) ; passage en
  `DEFINER` à corps identique de `set_media_batch_status`, `media_set_status` et `issue_claim_codes` ;
  `REVOKE INSERT, UPDATE ON media_batch FROM cashless_app` ; `UPDATE` de `media` réduit à
  `(claim_code_used_at, claim_attempts)`.
- **Rationale** : seules trois requêtes SQL directes existent (`batches.service.ts:95` INSERT, `:154` UPDATE ;
  `reencrypt.worker.ts:169` sous `cashless_tagkeys`, hors sujet) ; les autres écritures passent déjà par des fonctions
  `DEFINER`. `issue_claim_codes` passe `DEFINER` pour ne pas garder `UPDATE (claim_codes_issued_at)`, qui permettrait de
  réémettre des codes.
- **Piège** : `batches.service.ts:46` fait `SELECT … FOR UPDATE` sur `media_batch` sous `cashless_app` ; PostgreSQL exige
  `UPDATE` pour `FOR UPDATE` : ce verrou est retiré, les fonctions verrouillent elles-mêmes. Les sept `FOR UPDATE OF m`
  sur `media` restent permis tant que `claim_code_used_at` et `claim_attempts` gardent `UPDATE`.
- **Fonctions `DEFINER`** : le propriétaire local est superutilisateur ; elles nomment le prestataire de session
  (`media_session_operator()`) et fixent `search_path = public, pg_temp`. `media_owner_session()` reste faux en
  `DEFINER` (session `cashless_app`) : la sortie de liste noire reste réservée à `reinstate_media`.
- **Renforcement fait puis consigné** : `media_set_status` n'accepte que `SUSPENDED` et `BLACKLISTED`.
- **Choix** : l'auteur est posé dans l'historique de création du lot (aujourd'hui nul).
- **Alternatives écartées** : politique restrictive `RLS` sur `UPDATE` seulement (laisse `INSERT` direct) ; une fonction
  par colonne.
- **À vérifier à l'implémentation** : `tools/demo-data/seed-demo.ts:296` (rôle de connexion) ; suites pgTAP sous
  `SET ROLE cashless_app` listées dans `research/R-N60-lots-bracelets.md` §7.

## R-02 — OP-N79 : vendeur dans la clé de session

- **Décision** : `UNIQUE (id, vendor_id)` sur `vendor_session` et clé étrangère `(vendor_session_id, vendor_id)` depuis
  `sale_attribution`, précédées d'un contrôle de cohérence ; la clé `(id, device_id, operator_id)`, aussi utilisée par
  `approval_token_use`, reste.
- **Rationale** : `sale_attribution` porte déjà `vendor_id` ; ses seules écritures (`record_sale_attribution`,
  `record_sale_attribution_at`) copient le vendeur de la session : les données existantes sont cohérentes par
  construction.
- **Alternative écartée** : `NOT VALID` puis `VALIDATE` (inutile avant la production ; à réserver à une table volumineuse).

## R-03 — OP-N76 : processus du PIN

- **Décision** : processus `vendor-pin` (rôle `cashless_pin`, `DATABASE_URL_PIN`, port 3003), sur le modèle de
  `tag-keys` (pool et rôle uniques, `DenyUnmarkedRoutesGuard`, audit, garde de production). Deux routes internes :
  ouvrir une session (essai compté, argon2, `open_vendor_session`, audits) et hacher un PIN (création, changement).
  `VENDOR_PIN_SECRET` n'est lu que par ce processus.
- **Appel** : client interne de l'API, authentifié par HMAC-SHA256 sur le corps, la route et un horodatage (fenêtre de
  30 s), clé `VENDOR_PIN_CALL_KEY` partagée par les deux processus ; refus si le processus ne répond pas, **aucun repli**.
  La clé d'appel ne donne aucun accès sans le PIN : le processus vérifie le PIN lui-même, et le décompte d'essais reste
  en base.
- **Rationale** : condition de levée d'OP-N76 ; l'API n'appelle aujourd'hui aucun autre processus, c'est le premier
  client interne. mTLS avec autorité interne écarté : plus lourd, aucun gain contre une API compromise (elle détiendrait
  aussi son certificat).
- **Idempotence** : le dérivé d'idempotence reste dans l'API (hacheur scindé) ; la route reste `transient`. Une session
  ouverte dont la réponse se perd suit la règle actuelle de la route (`transient`), sans régression.
- **Limite résiduelle (nommée dans l'ADR de levée)** : l'API voit le PIN en transit ; une API compromise peut tester des
  PIN, au rythme du décompte d'essais existant, comme aujourd'hui.
- **Latence** : argon2 ≈ 60 ms déjà payé ; l'appel local ajoute quelques millisecondes : NFR-001 tenu, mesuré par une
  suite de latence.
- **Alternative écartée** : router `POST /vendor-sessions` directement vers le processus (change `x-process` du contrat).

## R-04 — OP-N145 : insertion d'une demande de remboursement

- **Constat** : la fiche sous-évalue la limite : `cashless_app` a `INSERT` sur toutes les colonnes
  (`post-roles.sql:1072`) ; seuls les `CHECK` empêchent `PAID`, et `CANCELLED` s'insère librement.
- **Décision** : `INSERT` limité aux 16 colonnes écrites par l'API ; déclencheur `BEFORE INSERT` qui, pour une session
  `cashless_app`, impose l'état initial et des colonnes de transition nulles (les fixtures en propriétaire gardent leurs
  états finals) ; retrait de `refund_deposit_for_session(uuid, uuid)` (accordée à l'API, appelée par aucun code
  TypeScript).
- **Différé** : `refund_deposit(uuid, uuid)` (décision 2 du plan).
- **Alternative écartée** : fonction `DEFINER` de création (plus lourde, aucun gain sur les droits par colonne).

## R-05 — OP-N137 : décisions de lot de versements

- **Décision** : crochet `guardDecision` facultatif dans `ApprovalActionDefinition`, appelé avant `decide` pour approuver
  et refuser ; `403` sans toucher la demande ; contrôle d'`execute` gardé en défense en profondeur ; audit
  `PAYOUT_CONFIRM_REPLAYED` ; test d'auto-approbation exact sur `409 APPROVAL_INVALID` (amendement de FR-016).
- **Lecture du point (b)** : le refus contrôle les classes de bénéficiaire comme l'approbation (lecture de l'agent,
  conforme à FR-014).

## R-06 — OP-N141 : plafond de la régularisation

- **Décision** : plafond dans `buildOperatorFee` (`closing/fees.ts:110-114`), branche régularisation ; `feeTotal`
  factorisé pour que le plafond et le calcul ne divergent pas ; bases brutes déjà dans la commande.

## R-07 — OP-N140 : IBAN

- **Constats** : `redact.ts` ne masque ni le champ `iban` ni un IBAN nu ; l'IBAN est en clair à trois endroits
  (`refund_request.iban` sans lecteur TypeScript ; `payout.iban` lu par l'export CSV `x-process: public` ;
  `approval_request.payload` des lots et des réclamations tardives) ; aucune recherche, aucun index ni unicité sur un
  IBAN ; le processus public n'a aucun port du service de clés et seul un faux existe.
- **Partie A (décidée)** : masque par champ et par forme de valeur, espaces compris.
- **Partie B (différée, décision 1)** : coffre AES-256-GCM à anneau de clés de configuration (format, données
  associées, rotation, `CHECK NOT VALID`, `iban_mask`) décrit dans `research/R-9b-iban-remboursements-versements.md`
  §1.4 ; pas de reprise de lignes (aucune donnée réelle avant la production).
- **Alternatives** : KMS (impossible sans port dans le processus public ni vrai KMS, et déplacer l'export change le
  contrat) ; masque seul avec dette consignée.

## R-08 — OP-N116 : inscription d'une passerelle

- **Décision** : `register_edge_gateway` rend `TABLE(gateway_id, ledger_id)` (`DROP` puis `CREATE`, mêmes arguments) ;
  grand livre lu sous le verrou de l'événement (`ledger.scope_type = 'EVENT'`), refus s'il n'y en a aucun ou plusieurs
  (plusieurs devises possibles par `UNIQUE(scope_type, scope_id, currency)`) ; l'outil refuse `--ledger`.
- **Rationale** : aucun droit nouveau pour `cashless_edgeadmin` ; un seul aller-retour atomique.

## R-09 — OP-N64 : App Attest

- **Décision (si décision 3 = oui)** : table dédiée `device_app_attest_key` (pas de colonne sur `device`, dont l'`INSERT`
  est répliqué vers la passerelle) ; clé gardée dans une nouvelle version d'`enroll_device` ; compteur avancé par
  `advance_app_attest_counter` (mise à jour conditionnelle, un rejeu concurrent échoue) ; vérificateur interne non
  branché. `cbor2` est déjà une dépendance.
- **Limite** : vecteurs auto-générés seulement ; une erreur de double hachage ECDSA serait invisible : vecteur réel
  d'Apple exigé avant la mission 12.

## Numérotation et codes

Migrations `0090` à `0095` dans l'ordre des IC ; codes d'erreur nouveaux à partir de `CL056` (dernier utilisé : `CL055`).

## Sécurité de la chaîne d'approvisionnement

Aucune dépendance ajoutée, retirée ni montée (DIRECTIVE_051 sans objet) ; aucune passe contradictoire de dépendance
requise.
