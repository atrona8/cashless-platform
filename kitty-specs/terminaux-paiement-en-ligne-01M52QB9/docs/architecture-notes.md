# Notes d'architecture — mission terminaux-paiement-en-ligne-01M52QB9

> État : **relue, 14 lots approuvés (26/10/2026) ; accept/merge à venir**. Rédigé au plan (22/10/2026), recalé le
> 26/10/2026 sur le code livré (lane `n`).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique** (`apps/api`, NestJS 11) : modules `vendors/` (back-office, sessions par PIN, verrou d'essai
  `pin-attempt-lock.ts`), `vendor-pin/` (argon2id, secret, essai de démarrage), `catalog/` (catalogue versionné et
  configuration servie), `payments/` (paiement, consultation, registre des numéros du terminal), `reversals/`
  (annulation ; et non `payments/` comme prévu), `payment-requests/` (QR commerçant et client) ; garde exclusive
  « terminal ou personne » (`DeviceOrCallerAuth`) ; options d'idempotence `deviceSeq: true | 'when-device'` et
  `keyUuid: 'without-device'` pour les routes partagées ; refus non définitifs (`DEBIT_AUTHORITY_*`) qui relâchent la
  clé (ADR-124) ; `VENDOR_PIN_SECRET` et `VENDOR_PIN_IDEMPOTENCY_SECRET` (distincts, ADR-126) exigés en production,
  vérification d'`argon2` au démarrage.
- **Dépendances** : `argon2@0.44.0` (document 08 ; binaires N-API précompilés, `ignore-scripts=true` respecté) ; deux
  entrées de verrou en plus de la liste prévue (`@epic-web/invariant` via `cross-env` passé en production, `node-addon-api`
  imbriquée), sans script d'installation, bornées par `argon2-supply-chain.spec.ts`.
- **Base** (`packages/ledger-sql`, migrations `0031` à `0035`) : tables S2 (`vendor`, sessions, essais de PIN) et S18
  (catalogue, versions, lignes de vente, versions servies par terminal et point de vente), attribution des ventes,
  détail des demandes QR ; fonctions SECURITY DEFINER pour chaque écriture ; index unique « une seule annulation » ;
  `consume_tap` et `set_device_status` remplacées ; `record_device_seq` accordée à l'API ; droits retirés à l'API sur
  `sale_attribution`, `payment_request.nonce_hash`, `device` (réglages) ; OP-N74 levé dans `create_device_enrollment_code`
  et `enroll_device` (0035).
- **Approbation sur place** (`approval/onsite/`) : variante pour un appelant terminal (session de vendeur et jeton lié
  à la vente) ; action `SALE_REVERSAL` à deux personnes au back-office (`requiredRole` devenu une liste).

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| PIN vérifié par le serveur, session de vendeur liée au terminal, attribution par la base d'après la session | Aucune empreinte de PIN sur le terminal ; relevés par vendeur fiables | PIN vérifié sur le terminal (empreinte volable avec l'appareil) |
| argon2id avec secret hors base (`VENDOR_PIN_SECRET`) | Un PIN de 6 chiffres se retrouve depuis une empreinte volée sans secret | argon2id seul |
| « Compter d'abord » : essai compté et validé avant la vérification, hors verrou | Blocage atomique au 5e échec, même sous essais simultanés ou plantage | Compteur dans la transaction de vérification (annulable) |
| Catalogue en versions immuables ; prix de la version courante ou de la dernière servie au terminal | Pas de vente à un prix inventé ni de refus la minute qui suit un changement de prix | Prix actuel seul ; toute version déjà servie (élargissement, écarté à la passe contradictoire) |
| Paiement en une transaction : numéro du terminal, terminal, session, lecture, portefeuille, moteur, lignes, passage | §7.6 : tout ou rien ; ordre global des verrous contre les interblocages | Fonction SQL unique (le moteur d'écritures est en TypeScript) |
| Fenêtre d'annulation mesurée à l'heure de la base ; heure du terminal bornée à ±120 s | Un terminal à l'horloge avancée n'allonge pas sa fenêtre | Heure envoyée par le terminal |
| Demandes QR écrites par la base, routes à jeton sans réponse rejouée ; jeton du festivalier en en-tête, refus sans oracle | Usage unique et aucun jeton en clair, même dans le registre d'idempotence ni les journaux | Écritures directes, réponse rejouée, jeton dans l'URL |
| PIN dans l'empreinte d'idempotence : dérivé argon2 sous un secret propre (ADR-126) | Base et clé HMAC volées ne donnent pas le PIN en 10^6 calculs bon marché | PIN retiré de l'empreinte (rejeu d'un autre PIN accepté) |
| Annulation au back-office : demande `SALE_REVERSAL` et `202`, exécution à l'approbation d'une seconde personne (ADR-129) | Le contrat prime sur l'arbitrage du `403` ; deux personnes restent exigées | `403 APPROVAL_REQUIRED` |
| Côté festivalier du QR derrière le port d'identité du festivalier | Pas d'identité réelle avant la mission 10 ; aucun faux en production | Reporter le QR côté festivalier |
| Identification au guichet reportée à la mission 10 | Pas de numéro vérifié ni de lien agent-festivalier en base | Servir avec deux contrôles en dette |

## Écarts au plan (sens)
- Renforcements : annulation unique en base ; demandes QR et identification retirées aux écritures directes de l'API ;
  réaffectation et réglages d'un terminal retirés à l'API ; dernière version servie triée par version ; clés composites
  catalogue et lignes de vente ; verrou par vente ; contrôle d'annulation lié à l'événement `LIVE`/`CLOSING` ; jeton de
  terminal consommé avant `assert_reversible`, lié à la vente ; défense en profondeur sur le vendeur ; un essai de PIN
  à la fois par terminal ; `sale_attribution` fermée à l'`INSERT` de l'API ; test de la chaîne d'approvisionnement
  d'`argon2` ; requêtes de configuration en série.
- Alignements sur le contrat (§0.3) : `422 VALIDATION_FAILED` pour un PIN mal formé ; `409` au renvoi de la clé
  d'ouverture ; `422 REVERSAL_NOT_ALLOWED`, `409 REVERSAL_WINDOW_EXPIRED` (ADR-123) ; `202` du back-office (ADR-129) ;
  `STALE_AUTHORITY_EPOCH` avec `authority_epoch` ; pas de champ `token` hors de `qr_payload`.
- Limites acceptées et consignées : OP-N76 / ADR-121 (la base croit l'API pour la vérification du PIN, levée avec
  OP-N56 en mission 11) ; OP-N77 / ADR-125 (secrets exigés par tous les processus, mission 13) ; OP-N78 (purge du
  registre des essais de PIN, mission 13) ; OP-N79 / ADR-127 (`vendor_id` hors de la clé de session, mission 11) ;
  OP-N80 / ADR-130 (pool du verrou d'essai non mesuré : saturation = `500` après 10 s, mission 13).
- OP-N43 complété (routes de paiement QR côté festivalier) ; OP-N74 / ADR-120 levé par la mission.
- Latence mesurée (paiement par bracelet, serveur seul, 200 paiements) : p95 ≈ 68,7 ms et p99 ≈ 84,3 ms, pour des
  seuils de 200 et 500 ms.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions d'architecture notables » et domaine « Terminaux et
encaissement ».

## Nécessaire pour cette mission ? Oui — cinq modules, une dépendance, cinq migrations, droits de la base touchés.
## Complet ? Oui — recalé sur le code livré le 26/10/2026 (à confirmer par le porteur).
## Validé par : en attente du porteur (proposition de l'Agent, 26/10/2026)
