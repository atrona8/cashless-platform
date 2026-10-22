# Contrat : vendeurs, PIN et sessions de vendeur

Exigences : FR-001 à FR-006, FR-026, NFR-002 à NFR-004. Décisions : `DM-01M5HJXZ4QPS4NY8SABQKY95Q2` (PIN vérifié par
le serveur), `DM-01M5HKT8GW5ZCAESAJC6WV5S6H` (règles du PIN), décisions de plan (secret hors base, session du terminal,
limite consignée `DM-01M5HRNFEFWDG47YEGE5N3C3GN`). Passe contradictoire : A6, A7, A15, A20, A22, A23 (research R-11).

## Empreinte du PIN

- PIN : exactement 6 chiffres (`^[0-9]{6}$`), refus sinon (`422 VALIDATION_FAILED`, sans écho de la valeur).
- Empreinte : `argon2id(pin, sel 16 octets, m = 19456 Kio, t = 2, p = 1, secret = VENDOR_PIN_SECRET)`, format PHC,
  calculée dans l'API ; la base ne voit que l'empreinte.
- Le PIN n'est jamais journalisé, audité, renvoyé ni gardé au-delà de la requête ; le journal des requêtes masque les
  champs `pin`, `token`, `customer_qr_token`, `qr_payload` et l'en-tête `X-Approval-Token`.
- Empreinte factice (vendeur inconnu, bloqué, désactivé, d'un autre commerçant) : empreinte d'une valeur aléatoire
  tirée au démarrage du processus, mêmes paramètres et même secret ; jamais égale à un PIN.

## Back-office (`MERCHANT_ADMIN` du commerçant ; `OPERATOR_ADMIN` du prestataire)

| Opération | Effet en base |
|---|---|
| Créer un vendeur (nom, PIN) | `create_vendor(merchant, name, pin_hash, actor)` → `id` |
| Lister, consulter | lecture sous la RLS de `vendor_public` (vue : `id`, `merchant_id`, `display_name`, `status`, `locked`) ; `pin_hash`, `failed_attempts` illisibles |
| Changer le PIN (débloque) | `set_vendor_pin(vendor, pin_hash, actor)` : compteur à 0, blocage levé, sessions fermées (`PIN_CHANGED`) |
| Désactiver, réactiver | `set_vendor_status(vendor, status, actor)` ; désactivation : sessions fermées (`VENDOR_DISABLED`) |

Portée : le commerçant du vendeur ou son prestataire. Objet d'un autre périmètre : `404` neutre. Chaque action : une
ligne d'audit (sans PIN ni empreinte). `Idempotency-Key` sur chaque écriture (portée `bo:`).

## Liste des vendeurs pour le terminal (A22)

`GET /vendor-sessions/vendors` (terminal, trois preuves) : `vendor_id` et `display_name` des vendeurs `ACTIVE` du
commerçant du point de vente du terminal, rien d'autre. Sert l'écran de choix du vendeur.

## Ouverture de session : « compter d'abord » (A6)

`POST /vendor-sessions` `{vendor_id, pin}` — terminal, trois preuves, modes `CATALOG_POS` et `KEYPAD_TPE` ; `@Idempotent`
avec `transient: true` (aucune réponse enregistrée ; un renvoi refait l'essai, qui est compté). Le terminal envoie au
plus un essai à la fois : un second essai simultané du même terminal reçoit `429`.

1. **Transaction A (validée)** : `begin_vendor_pin_check(vendor, device)` (SECURITY DEFINER, verrous dans l'ordre
   global : terminal, puis vendeur `FOR UPDATE`). Si le vendeur est `ACTIVE`, non bloqué et du commerçant du point de
   vente du terminal : `failed_attempts + 1` (l'essai est compté **avant** la vérification), un jeton d'essai
   `check_id` (ligne `vendor_pin_check`, 30 s) et l'empreinte sont rendus. Sinon : rien n'est écrit (un vendeur d'un
   autre commerçant n'est jamais compté), et l'API utilisera l'empreinte factice. Un vendeur à 5 essais comptés est
   bloqué (`locked_at`) dans cette même transaction.
2. **Hors transaction** : vérification argon2id (empreinte réelle ou factice), sans verrou tenu.
3. **Transaction B** si le PIN est bon et qu'un `check_id` existe : `open_vendor_session(check_id, device)` revérifie
   tout (vendeur `ACTIVE`, non bloqué, même commerçant, terminal `ACTIVE`, mode, `check_id` non expiré et non utilisé),
   remet le compteur à 0, ferme la session précédente du terminal (`REPLACED`) et ouvre la nouvelle. Rend
   `{vendor_session_id, expires_at, vendor_display_name}`.
4. Toute autre issue : `401 VENDOR_PIN_INVALID`, même corps et même code (NFR-004), y compris le 6e essai avec le bon
   PIN. Audit : `VENDOR_PIN_FAILED`, `VENDOR_LOCKED`, `VENDOR_SESSION_OPENED`.

Le compteur ne dépasse jamais 5 (la fonction refuse de compter un vendeur bloqué). Un plantage entre A et B laisse
l'essai compté (échec sûr).

## Limite consignée (A15, `DM-01M5HRNFEFWDG47YEGE5N3C3GN`)

L'API lit l'empreinte (`begin_vendor_pin_check`) et la base ouvre la session sur la foi de la transaction B appelée
par l'API : une connexion `cashless_app` compromise ouvre une session pour n'importe quel vendeur sans PIN (en
consommant un essai). Même classe que OP-N56 (la base croit l'API sur l'auteur) ; une telle connexion peut déjà
écrire des ventes. Consigné : **OP-N76**, **ADR-121**, levée avec OP-N56 (mission 11). Test de borne : seul
`cashless_app` exécute `begin_vendor_pin_check` et `open_vendor_session` (liste figée). Le secret hors base protège
une base volée.

## Fermeture

`DELETE /vendor-sessions/current` (terminal) → `LOGOUT`. Fermetures par la base (A7) : `set_device_status` (remplacée
par migration, contrôles de 0022 gardés) ferme les sessions du terminal à `SUSPENDED` et `REVOKED` ; `set_vendor_pin`,
`set_vendor_status` et le blocage ferment celles du vendeur.

## Garde de session (ventes, annulations, demandes QR)

`assert_vendor_session(device, vendor_session_id)` (SECURITY DEFINER ; lit sans verrou le vendeur de la session, puis
prend `FOR SHARE` le vendeur puis la session, dans l'ordre global) :
session ouverte de ce terminal, égale à l'identifiant reçu, non expirée (`expires_at > now()`), vendeur `ACTIVE` et
non bloqué ; sinon `CL032` → `409 VENDOR_SESSION_INVALID`. Rend `vendor_id`.

## Ordre global des verrous (A7)

Toute fonction de la mission prend ses verrous dans cet ordre : **terminal → vendeur → session de vendeur →
demande QR → bracelet → portefeuille**. Le terminal est pris en premier par `record_device_seq` (`FOR UPDATE`) sur les
routes qui portent une clé `<serial>:<seq>` (contracts/payments.md), puis `assert_device_active` (`FOR SHARE`, même
transaction : compatible). Tests de concurrence : vente sur T1 pendant un 5e PIN faux sur T2 ; suspension pendant
une vente.

## Secret `VENDOR_PIN_SECRET`

`config.ts` : `hmacKey(env, 'VENDOR_PIN_SECRET', …)` — 32 octets au moins ; obligatoire en production ; secret de test
public refusé en production ; distinct des autres secrets HMAC. Au démarrage (A16) : chargement d'`argon2` et
vérification d'un vecteur connu (empreinte calculée avec le secret) ; échec → démarrage refusé. Test : démarrage refusé
en production sans secret, avec le secret de test, et si le vecteur échoue.
