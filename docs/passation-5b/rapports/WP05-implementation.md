# Compte rendu du lot WP05 — Demandes de paiement QR (migration 0034)

- Lane : lane-e, commit `e91f142d` (`feat(WP05): …`). Seuls fichiers :
  `packages/ledger-sql/migrations/0034_payment_requests.sql`,
  `packages/ledger-sql/tests/tests_payment_requests.sql`.
- Sous-tâches T021 à T024 marquées `done` (accepté par le runtime). `move-task` non fait (consigne).
- Aucune retouche hors carte. Aucun fichier généré touché. Aucun `GRANT`. `payment_request` inchangée
  (aucun `ALTER TABLE`, test « douze colonnes »).

## Signatures finales (pour WP07, WP11, WP13)

Toutes en `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC` :

```
create_merchant_payment_request(p_device uuid, p_vendor_session uuid, p_amount bigint,
  p_currency char(3), p_ttl_seconds int, p_nonce_hash bytea, p_idempotency_key text,
  p_lines jsonb, p_catalog_version int) RETURNS TABLE(payment_request_id uuid, expires_at timestamptz)
create_customer_qr_token(p_customer uuid, p_wallet uuid, p_nonce_hash bytea)
  RETURNS TABLE(payment_request_id uuid, expires_at timestamptz)
lock_payment_request_for_pay(p_id uuid, p_nonce_hash bytea, p_wallet uuid, p_customer uuid)
  RETURNS TABLE(device_id, vendor_session_id, vendor_id, event_id, ledger_id, amount, currency,
                idempotency_key, lines, catalog_version)
lock_customer_qr_token(p_nonce_hash bytea, p_device uuid) RETURNS TABLE(payment_request_id uuid, wallet_id uuid)
confirm_payment_request(p_id uuid, p_tx uuid, p_nonce_hash bytea) RETURNS void      -- 3 paramètres
cancel_payment_request(p_id uuid, p_device uuid, p_nonce_hash bytea) RETURNS void
payment_request_for_token(p_id uuid, p_nonce_hash bytea)                             -- STABLE
  RETURNS TABLE(status text, amount bigint, currency char(3), expires_at timestamptz, merchant_name text)
```

Erreurs : `CL037` (message unique « Demande de paiement indisponible ») pour toute issue des
fonctions de verrouillage, confirmation, annulation, consultation et pour un portefeuille refusé à la
création d'un QR client ; `CL001` paramètres ; création commerçant : `P0002` terminal inconnu,
`42501` révoqué, `CL030` suspendu, `CL001` mode/événement/devise, `CL032` session, `CL034` lignes ;
`23505` empreinte ou clé de vente déjà prise (laissé tel quel) ; `P0002` sans prestataire de session.

WP07 doit : accorder `EXECUTE` sur les sept fonctions à `cashless_app` ; retirer `INSERT`, `UPDATE` sur
`payment_request` et `payment_request_detail` (roles.sql les donne sur toute table) et la lecture de
`payment_request.nonce_hash`.

## Décisions sur les quatre points à trancher (arbitrages du 22/10 appliqués)

1. Lignes contrôlées à la création par `check_sale_lines` (WP03), sans écriture ; version **retenue
   par la base** écrite dans le détail.
2. QR client sur grand livre `ORGANIZER` : refusé, `CL001` (vérifié après la propriété et le statut
   du portefeuille, donc rien n'est révélé d'un portefeuille d'autrui).
3. Confirmation : exige `p_nonce_hash` et revérifie tout ; pas de marque locale.
4. `payment_request_for_token` créée.

## Écarts au plan (sens)

1. **Renforcement / à confirmer par l'orchestrateur** : `payment_request_for_token(p_id, p_nonce_hash)`
   exige l'identifiant ET l'empreinte. L'arbitrage écrit `payment_request_for_token(p_nonce_hash)` ;
   le prompt T023 proposait `(p_id, p_nonce_hash)`. La route `GET /payment-requests/{id}` a l'identifiant :
   la forme à deux paramètres est plus stricte. Si WP13 veut la forme à un paramètre, c'est un
   assouplissement mineur à décider.
2. **Écart de mécanisme (sans affaiblissement)** : `lock_payment_request_for_pay` écrit
   `wallet_id = p_wallet` dans la demande (encore `PENDING`, sous `FOR UPDATE`). Sans cela,
   `confirm_payment_request` ne peut pas exiger « portefeuille = celui verrouillé » (la confirmation
   n'a ni `p_wallet` ni `p_customer`). Écriture annulée avec la transaction si la vente échoue, réécrite
   par un verrouillage ultérieur ; une confirmation sans verrouillage préalable est refusée (testé).
   Effet de bord : une demande `MERCHANT_QR` `PENDING` peut porter le portefeuille du dernier essai.
3. **Renforcements** dans `confirm_payment_request` : vente du même grand livre que le portefeuille et
   du même événement que la demande ; vente non déjà liée à une autre demande ; aucun autre
   portefeuille débité par la vente ; session de la demande encore ouverte et non expirée (refus `CL037`
   plutôt que le `CL032` de `record_sale_attribution`, pour garder la réponse unique) ; `CUSTOMER_QR` :
   terminal de la vente affecté à l'événement de la demande.
4. **Renforcement** : `payment_request_detail` porte `UNIQUE (operator_id, idempotency_key)`, une borne
   1 à 200 caractères sur la clé et `(lines IS NULL) = (catalog_version IS NULL)`.
5. **Renforcement** : `cancel_payment_request` ne vise que les demandes `MERCHANT_QR` (un QR client ne
   s'annule pas par cette route ; rien au contrat). Mode `KEYPAD_TPE` : une version de catalogue reçue est
   refusée (`CL001`) comme les lignes.
6. **Choix de sens à signaler** : `p_catalog_version` reçu n'est qu'indicatif ; la version écrite est
   celle que retient `check_sale_lines` (une version servie plus ancienne aux mêmes prix donne la courante).
   Refuser un écart serait faux dans ce cas.
7. **Choix de code** : événement non `LIVE` et terminal `TOPUP_DESK` à la création commerçant → `CL001`
   (même convention que 0033 pour l'état de l'événement). Un QR client n'est pas refusé selon l'état de
   l'événement (non demandé ; le paiement du terminal le contrôle).
8. Montant débité : Σ **net** des lignes de la vente sur les comptes `WALLET_PAID`/`WALLET_PROMO` du
   portefeuille (le prompt renvoyait à la « même définition que `record_sale_lines` », qui compte en fait
   les crédits `MERCHANT` ; j'ai suivi la phrase explicite « Σ des débits sur les comptes du
   portefeuille »). Contradiction mineure de rédaction, signalée.
9. Grand livre « de l'événement » pour le paiement d'un QR commerçant : portée `EVENT` de cet événement
   OU `ORGANIZER` de son organisateur (définition de `schema_grand_livre_cashless.sql`, configuration
   des terminaux). Un portefeuille de grand livre organisateur peut donc payer un QR commerçant (testé).

## Points soumis au porteur ou à l'orchestrateur

Aucun écart n'affaiblit la sécurité. À confirmer : la forme de `payment_request_for_token` (écart 1)
et l'écriture de `wallet_id` au verrouillage (écart 2). Une demande client `PENDING` du même
portefeuille n'est pas annulée par une nouvelle (rien au contrat ; testé).

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0034_payment_requests.sql`, en entier : droits de la base
(SECURITY DEFINER), ordre des verrous de `lock_payment_request_for_pay`, liaison de la confirmation à la
vente (montant, portefeuille, terminal, clé, type), réponse unique `CL037`.

## Critères d'acceptation couverts (preuve)

Base `cashless_wp05` (supprimée ensuite) :
- `bash packages/ledger-sql/scripts/reset-db.sh` → code 0 (migrations jusqu'à 0034, roles, post-roles).
- `pg_prove -d cashless_wp05 tests/tests_payment_requests.sql` → `Files=1, Tests=131, Result: PASS`.
- `bash packages/ledger-sql/scripts/test-pgtap.sh` après `reset-db` → `Files=37, Tests=2652, All tests
  successful` (dont `tests_definer_search_path.sql`, `tests_execute_grants.sql`).
- Jest (après `reset-db`, liens `node_modules/@cashless`, retirés ensuite) : `npx jest --runInBand
  device-secrets claim-code-order personalization` (suites qui parcourent toutes les tables) → 4 suites,
  70 tests, PASS. `lint`/`typecheck` sans objet (aucun fichier TypeScript touché).
- Mutants (14, sur ma base) : retrait du contrôle d'empreinte (verrouillage, consultation), du
  festivalier, de la session close, du statut du terminal, de la clé, du terminal, du montant, de
  l'événement, de « autre portefeuille débité », de « vente déjà liée », du terminal d'annulation, de
  l'événement du QR client, du propriétaire du portefeuille (QR client) : **tous tués** (un survivant
  initial, « autre portefeuille débité en plus », a reçu son cas).

Correspondance (fichier `tests/tests_payment_requests.sql`, nom du cas) :
- **FR-018** : section 1 « témoin CATALOG_POS : lignes contrôlées, demande créée », « demande commerçant :
  MERCHANT_QR, PENDING, montant, terminal, événement, 60 s », refus terminal suspendu/révoqué/TOPUP_DESK,
  événement non LIVE, session (CL032), montant nul, devise, 14 s/301 s, 31 octets, lignes en KEYPAD_TPE ;
  section 4 « témoin : vente exacte confirmée », « attribution MERCHANT_QR par la session de la demande ».
- **FR-019** : section 2 « QR client : événement du grand livre (A25)… », refus autre festivalier, bloqué,
  autre prestataire, ORGANIZER ; section 5 « témoin : QR client confirmé… », « montant et terminal de la
  vente écrits ».
- **FR-020 (base)** : « aucune colonne ne contient le jeton », « seconde confirmation de la même demande
  refusée », « jeton à usage unique : verrouillage après paiement refusé », « QR client à usage unique »,
  tous les refus `CL037` comparés au même message (`throws_ok` avec message exact).
- **NFR-008** : « empreintes de 32 octets seulement », « aucun paramètre nommé jeton », « détail : aucun
  jeton ».
- **NFR-007 (base)** : section 8 (B ne crée, ne verrouille, ne confirme, n'annule ni ne consulte une
  demande de A ; A ne consulte pas une demande de B).
- NFR-005 : seconde confirmation refusée ici ; vingt paiements simultanés laissés à WP13/WP14 (Jest).
