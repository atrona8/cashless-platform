# Relecture WP09 « Vendeurs : back-office et sessions » — cycle 1

Relecteur distinct (claude). Commit relu : `10d9d59f` (lane-i). Base : `cashless_wp09r` (toutes les
`DATABASE_URL_*` pointées dessus, `reset-db` OK), supprimée à la fin. `move-task` non exécuté (consigne).

## Verdict : REJETÉ

Un seul constat bloquant, de tests : le verrou « un essai à la fois par terminal », contrôle de sécurité
exigé par l'arbitrage et par le contrat (`429`), n'est prouvé par aucun test. Deux mutations le rendent
inopérant ou le laissent fuir sans qu'un test échoue. Le code du verrou me paraît juste à la lecture ;
la correction ne touche que les tests. Si le porteur préfère consigner plutôt que rouvrir un cycle
(règle d'arrêt des boucles de relecture), le constat 1 peut devenir un report vers WP11, avec son accord.

## Tests rejoués

- `npx jest --runInBand test/unit/vendors test/integration/vendors test/integration/end-to-end/device-auth-matrix.spec.ts test/unit/architecture.spec.ts`
  sur `cashless_wp09r` : 6 suites, **100 réussis**, 0 échec.
- Jest complet : non rejoué, déjà fait par l'orchestrateur (111 suites, 1901 réussis, 6 ignorés, 0 échec).

## Mutations (fichiers restaurés par `git checkout`, arbre propre, rien de commité)

Suites : `test/unit/vendors` et `test/integration/vendors` (68 tests). Journaux dans `scratchpad/wp09r/`.

| # | Mutation | Attrapée ? |
|---|---|---|
| M1 | Garde : `assert_vendor_session` remplacé par `SELECT vendor_id FROM vendor_session WHERE id = $2`, sans vérifier le terminal, la fermeture, l'expiration ni le vendeur | **Oui**, 4 échecs (REPLACED, FR-005 fermetures, expiration, garde directe) |
| M2a | Compteur : B appelée même quand A vient de poser le blocage (`!check.locked` retiré) | **Oui**, test unitaire « 5e essai… B jamais appelée ». Le refus de la base (CL033) tient de toute façon |
| M2b | Audit C des essais comptés supprimé | **Oui**, 8 échecs |
| M2c | Pas d'empreinte factice : `401` immédiat quand A ne rend rien (fuite par le temps de réponse) | **Oui**, test unitaire « empreinte factice » |
| M3a | Verrou : `pg_advisory_unlock` juste après `pg_try_advisory_lock`, donc verrou inopérant | **NON**, 68/68 verts |
| M3b | Verrou jamais relâché (connexion rendue au pool avec le verrou tenu) | **NON**, 68/68 verts |
| M4a | Back-office : un `MERCHANT_ADMIN` reçoit la portée de tout le prestataire | **Oui**, « NFR-007 : hors périmètre… 404 » |

## Constats

### 1. BLOQUANT : le verrou d'essai par terminal n'est pas prouvé (M3a, M3b)
- `test/integration/vendors/vendor-sessions.spec.ts:326` (« 20 essais simultanés… même terminal ») accepte
  `401` ou `429` mais n'exige aucun `429`. Il reste vert sans verrou, puisque la base borne déjà le
  compteur à 5. Le prompt T043 demande pourtant « même terminal : `429` pour les essais concurrents ».
- Le test `:305` ne fait que tenir le verrou depuis une connexion externe. Il prouve la lecture du verrou,
  pas que l'API le tient pendant A → argon2 → B → C, ni qu'elle le relâche.
- M3b passe parce que les verrous consultatifs de session sont réentrants sur la même connexion et que le
  pool rend la même connexion aux appels en série. En production, un verrou qui fuit renverrait `429` à ce
  terminal tant que la connexion inactive reste ouverte.
- **Correction attendue (tests seulement)** :
  - (a) Dans le test des 20 essais simultanés, exiger au moins un `429`. Encore plus sûr : un test
    déterministe qui ralentit `VendorPinHasher.verify` (espion Jest), lance deux essais du même terminal et
    exige un `401` et un `429`.
  - (b) Après un essai réussi, un essai refusé et un essai dont B lève une erreur (500), vérifier depuis
    une autre connexion que `pg_try_advisory_lock(PIN_ATTEMPT_LOCK_KEY)` sur le terminal rend `true`, puis
    le relâcher. Variante : `pg_locks` ne montre aucun verrou `advisory` pour cette clé.
  - (a) doit faire échouer M3a, (b) doit faire échouer M3b.

### 2. QUESTION AU PORTEUR : le PIN entre dans `api_idempotency.request_hash`
- `request-hash.ts` calcule un HMAC-SHA256 (`IDEMPOTENCY_HMAC_KEY`) du corps canonique, PIN compris, pour
  `openVendorSession`, `createVendor` et `setVendorPin`. La ligne est gardée **30 jours** (TTL par défaut).
  Pour `createVendor` et `setVendorPin`, l'empreinte porte donc le PIN valide en vigueur.
- Risque : avec la base et `IDEMPOTENCY_HMAC_KEY`, retrouver un PIN demande 10^6 HMAC, moins d'une
  seconde. Le chemin prévu (base et `VENDOR_PIN_SECRET`) demande 10^6 argon2id, soit des heures. Le
  secret est donc plus exposé que le contrat ne le suppose (« le PIN n'est… pas gardé au-delà de la
  requête »), et sous une autre clé que `VENDOR_PIN_SECRET`.
- Pas un écart silencieux : le mécanisme existe déjà (ADR-99, même cas que les codes d'enrôlement), il
  est imposé par `@Idempotent` dans le prompt, et l'implémenteur l'a signalé (point 2 de son compte rendu).
  Je ne le classe donc pas bloquant. Il reste un « secret plus exposé » au sens de la règle 1 :
  décision du porteur requise.
- Options :
  - (a) Exclure `pin` du corps haché pour ces trois routes : liste de champs exclus dans
    `@Idempotent`, ou remplacement par une constante. Conséquence : la même clé renvoyée avec un autre PIN
    rejoue la réponse d'origine (`409` ou `401`) au lieu de `IDEMPOTENCY_KEY_REUSED`. C'est sans risque
    ici, aucune réponse ne dépend du PIN au-delà du refus.
  - (b) Accepter et consigner : étendre ADR-99 aux PIN de vendeur, entrée dans `POINTS_OUVERTS.md`, et un
    test qui échoue si un autre champ secret entre dans le hash.
  - (c) Raccourcir le TTL de ces routes. Partiel.
  - Recommandation : (a), peu coûteux, à WP09 ou à un lot transverse.

### 3. QUESTION AU PORTEUR (mineur) : liste du terminal sans les vendeurs bloqués
- `vendor-sessions.service.ts:93` (`AND NOT v.locked`) suit le prompt T040. `contracts/vendors.md` (A22)
  dit seulement « ACTIVE ». La contradiction est signalée par l'implémenteur.
- Fuite d'information : négligeable. Ce que le terminal apprend, c'est qu'un vendeur est bloqué. Celui qui
  a fait les 5 essais le sait déjà, puisque le blocage au 5e est public dans le contrat. Les autres
  utilisateurs du stand l'apprendraient de toute façon par un `401` systématique. NFR-004 vise la réponse
  de l'ouverture, qui reste uniforme : vérifié, bloqué compris.
- C'est donc ce que demande la source du lot (prompt, plus strict), pas une fuite. Il reste à aligner
  `contracts/vendors.md` sur le choix retenu.

### 4. QUESTION AU PORTEUR (mineur) : écart de temps entre essai compté et non compté
- Un essai compté fait une transaction d'audit C en plus (quelques ms, contre environ 50 ms d'argon2
  commun). Inhérent à « essai non compté sans audit » (arbitrage).
- Faible portée : la liste du terminal (A22) révèle déjà quels vendeurs sont actifs pour ce commerçant.
  À accepter, ou à niveler par une transaction factice.

### 5. MINEUR : `429` enregistré dans le registre d'idempotence
- `RATE_LIMITED` n'est pas dans `NON_FINAL_CODES` (`device-key.ts:29`). Le `429` est donc enregistré et
  rejoué pour toujours sous cette clé, avec `Retry-After: 1`.
- `openapi.yaml` demande « un nouvel essai avec une nouvelle clé », donc le comportement est conforme.
  Mais un terminal qui suit `Retry-After` avec la même clé reste bloqué 30 jours sur cette clé.
- Aucun effet sur la sécurité. Correction possible : ajouter `RATE_LIMITED` aux refus non définitifs pour
  cette route, ou préciser la consigne au client.

### 6. MINEUR : `Idempotency-Key` UUID non contrôlée sur ouverture et fermeture
- L'arbitrage et `openapi.yaml` disent « UUID ». Aucune vérification : toute chaîne de 255 caractères au
  plus est acceptée.
- Pas de faiblesse : portée `device:<id>:`, et l'empreinte est liée à l'appelant. Simple conformité au
  contrat.

### 7. MINEUR : fichier hors carte `apps/api/src/db/session-lock.ts`
- Légitime : `architecture.spec.ts` interdit `pg` hors de `src/db/`. C'est un fichier nouveau, aucun
  fichier existant de `db/` n'est modifié, et la retouche est consignée par l'implémenteur.
- À valider par l'orchestrateur, sans réserve sur le fond.
- Note de capacité : le pool du verrou prend `max = DB_POOL_SIZE`, ce qui double le plafond de connexions
  par processus de l'API.
- Exactitude relue :
  - échec de `pg_try_advisory_lock` → connexion détruite ;
  - verrou non pris → connexion rendue ;
  - `fn` qui lève → `finally` relâche le verrou ;
  - échec du relâchement → connexion détruite ;
  - plantage du processus → verrou libéré avec la session.
  - Aucune fuite de connexion repérée.
- Pas d'interblocage avec le pool principal : le verrou est attendu sans blocage, et le pool du verrou
  n'attend jamais le principal.

### 8. Points vérifiés, conformes
- **`422` pour un PIN mal formé** (au lieu du `401` du prompt) : `openapi.yaml` (`openVendorSession` et
  `VendorSessionOpen`) et `contracts/vendors.md` disent `422`. §0.3 bien appliqué et signalé. Neutre pour
  la sécurité : contrôle avant toute lecture, identique pour tout vendeur, rien n'est compté (prouvé à
  `vendor-sessions.spec.ts:259`).
- **Renvoi de la même clé → `409`**, et `401` rejoué après un échec : conforme à `openapi.yaml` et à
  l'arbitrage. C'est plus strict que `contracts/vendors.md` (« un renvoi refait l'essai »). Contradiction
  signalée, test à `:357`.
- **Purge de `vendor_pin_check`** : confirmée. `0031` §5 remplace `purge_device_enrollment_attempts()`
  (supprime aussi les essais de plus de 24 h), et `device-maintenance.ts:59` l'appelle.
  - Réserve RLS confirmée : `vendor_pin_check` est en `FORCE ROW LEVEL SECURITY`. La fonction s'exécute
    sans `app.operator_id` et ne supprime donc quelque chose que si son propriétaire contourne la RLS.
    Sur la base locale, le propriétaire est superutilisateur (vérifié : `rolsuper = t`).
  - Avec un propriétaire non superutilisateur en production, rien ne serait purgé. Même hypothèse que
    0022 : défaut **antérieur au lot**, signalé à part, sans rejet.
  - La dette « aucune purge » du WP07 est donc inexacte, sous cette réserve.
- **OP-N76 non élargie** : la seule lecture de `pin_hash` passe par `begin_vendor_pin_check`, la seule
  ouverture par `open_vendor_session`. Aucun `SELECT … FROM vendor` dans `src/vendors/` : la lecture
  passe par `vendor_public` seulement.
  - Constat annexe : `cashless_app` peut lire `vendor_session` et `vendor_pin_check`, ce qui a rendu M1
    possible. Ce sont des droits de WP07, à relire par une personne.
- **Compter d'abord** :
  - A est validée (`TenantTx.run`) avant argon2 ; aucune transaction n'est ouverte pendant la
    vérification ; B seule ouvre la session.
  - Empreinte factice quand A ne rend rien.
  - Réponse `401` identique pour les cinq causes (test `:222`).
  - 23505 sur `vendor_session_open_per_device` → `429` (test unitaire seulement, acceptable : le verrou
    rend ce cas inatteignable par l'API).
- **`VendorSessionGuard`** :
  - UUID contrôlé avant la requête ;
  - `assert_vendor_session` contrôle le terminal, l'égalité de l'identifiant, l'ouverture, l'expiration,
    le statut `ACTIVE` et l'absence de blocage ;
  - CL032 → `409` ;
  - aucune voie n'accepte un `vendor_id` venu du terminal ;
  - le contrat d'usage est écrit en tête du fichier.
  - Le respect de l'ordre d'appel (dans la transaction de l'écriture, après le terminal) incombe à
    WP11 à WP13 : à vérifier à leur relecture.
- **Back-office** :
  - portée OPERATOR et MERCHANT correcte ;
  - `404` neutre (corps comparé) pour un autre commerçant et pour un autre prestataire, base revérifiée
    par `vendor_admin_allowed` ;
  - `403` pour un rôle non admis ;
  - empreinte calculée hors transaction et après le contrôle de portée (création) ;
  - réponses en liste blanche ;
  - audit et registre sans PIN ni `$argon2`.

## Écarts de sécurité ouverts

- Aucun écart qui affaiblit la sécurité n'a été codé en silence.
- Le point 2 (PIN dans `request_hash`) est un secret plus exposé, signalé mais non tranché : il exige une
  décision du porteur, puis, si on l'accepte, une dette nommée (`POINTS_OUVERTS.md`, ADR, test de borne).

## Fichiers à faire relire par une personne

- `apps/api/src/vendors/vendor-sessions.service.ts` : PIN, comptage, OP-N76.
- `apps/api/src/vendors/vendor-session-guard.ts`.
- `apps/api/src/db/session-lock.ts` : verrou, connexions.
- Les droits `cashless_app` sur `vendor_session` et `vendor_pin_check` (`post-roles.sql`, WP07).

## Reports proposés

- WP11 à WP13 : vérifier l'ordre d'appel de `VendorSessionGuard.assert` (dans la transaction de
  l'écriture, après `record_device_seq` / `assert_device_active`, avant le bracelet).
- Lot transverse ou porteur : point 2 (option a), point 5 (`RATE_LIMITED` non définitif), alignement de
  `contracts/vendors.md` (points 3 et 8 : `422`, `409`, liste sans les vendeurs bloqués).
- Mission d'exploitation : propriétaire des fonctions de purge et RLS forcée (réserve du point 8,
  antérieure au lot).
