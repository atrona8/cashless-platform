---
affected_files: []
cycle_number: 2
mission_slug: terminaux-paiement-en-ligne-01M52QB9
reproduction_command:
reviewed_at: '2026-10-26T11:31:43Z'
reviewer_agent: user
wp_id: WP09
---

# Relecture WP09 « Vendeurs : back-office et sessions » — cycle 2

Relecteur distinct (claude), qui n'a pas écrit ce code. Commit relu : `8ddd0863` (lane-i), diff du cycle
`10d9d59f..8ddd0863`. Base : `cashless_wp09r`, avec toutes les `DATABASE_URL_*` pointées dessus. `reset-db` OK
du premier coup. La base est supprimée à la fin. `move-task` n'a pas été exécuté, comme demandé. Rien n'a été
commité et l'arbre est propre après chaque mutation (`git checkout`).

## Verdict : REJETÉ

Il reste un seul bloquant, et il porte sur un test. ADR-126 est bien codée sur les trois routes. En revanche, sa
condition de bornage (« un test échoue si un corps portant un PIN produit une empreinte calculable sans argon2 »)
n'est pas prouvée pour la **création de vendeur** : on peut retirer `pinFields` de cette route sans qu'aucun test
échoue. La correction tient en quelques lignes de test. Si le porteur préfère consigner plutôt que rouvrir un cycle
(règle d'arrêt des boucles de relecture), l'orchestrateur peut ajouter ce test lui-même ou en faire un report, avec
l'accord du porteur.

Le bloquant 1 du cycle 1 est levé.

## Tests rejoués (sur `cashless_wp09r`)

- `test/unit/vendors`, `test/integration/vendors`, `test/unit/vendor-pin`, `test/unit/idempotency`,
  `test/integration/idempotency` et `architecture.spec.ts` : 9 suites, **136 réussis**, 0 échec.
- Batterie d'idempotence : `device-route`, `transverse/idempotency`, `engine` (ADR-124, `DEBIT_AUTHORITY_*`),
  `devices/admin`, `platform-tx`, plus les suites vendeurs. Résultat : 12 suites, **174 réussis**, 0 échec.
- `tsc --noEmit` donne 0. Prettier est conforme sur les fichiers du diff.
- Les deux tests du verrou ont été lancés 5 fois de suite : 5 fois verts.
- Jest complet : je ne l'ai pas rejoué. L'orchestrateur l'a fait (111 suites, 1909 réussis, 0 échec).
  - Remarque : le compte rendu annonce 114 suites et 3 échecs hors lot. Pour la même branche, l'orchestrateur
    compte 111 suites et aucun échec. Cet écart de décompte est sans incidence sur le lot.

## Mutations (suites : vendeurs intégration et unitaires, vendor-pin, transverse/idempotency, device-route ; 168 tests)

Journaux dans `scratchpad/wp09r2/`.

| # | Mutation | Attrapée ? |
|---|---|---|
| M3a | `session-lock.ts` : `pg_advisory_unlock` aussitôt après la prise | **Oui** : « un essai à la fois… 429 » |
| M3b | `session-lock.ts` : la requête de relâchement est remplacée par `SELECT true` (verrou jamais relâché, connexion rendue au pool) | **Oui** : « verrou libre après un succès, un refus et une erreur » |
| M5open | `pinFields` retiré de l'ouverture | **Oui** : « empreinte ≠ HMAC en clair » |
| M5setpin | `pinFields` retiré du changement de PIN | **Oui** : même test |
| **M5create** | **`pinFields` retiré de la création de vendeur** | **NON, 168/168 verts** |
| M6 | Dérivé remplacé par une constante (le PIN sort de l'empreinte) | **Oui**, 3 échecs : « autre PIN → 409 » sur les 3 routes, et l'unitaire |
| M7 | Option `nonFinal` ignorée (le 429 est enregistré) | **Oui** : « la clé du 429 reste rejouable » |
| M8 | Tout `429` rendu non définitif, sur toutes les routes | Non. Comportement hors lot ; voir le constat 5 |
| M9 | Sel indépendant de la clé et de la portée | **Oui** (unitaire « change avec la clé, la portée ») |
| M10 | Contrôle UUID de la clé retiré | **Oui** (« non UUID → 422 ») |
| M11 | Dérivé calculé sans `secret` (`VENDOR_PIN_SECRET`) | **Oui**, 2 échecs |
| M12 | Une valeur hors motif part en clair dans l'empreinte, au lieu du repère `pin-invalide` | **Oui**, 2 échecs |

M3b (première variante) : forcer `client.release()` sans destruction, en gardant la requête de relâchement, ne
fait pas fuir le verrou. Il n'y avait rien à attraper. J'ai écarté cette variante.

## Constats

### 1. BLOQUANT : condition de bornage d'ADR-126 non prouvée pour `createVendor` (M5create)

- **Fichiers** :
  - `apps/api/src/vendors/vendors.controller.ts:55` : `@Idempotent({ scope: 'bo:', pinFields: ['pin'] })` ;
  - `test/integration/vendors/vendor-sessions.spec.ts`, test « ADR-126 : l'empreinte d'une ouverture et d'un
    nouveau PIN n'est pas le HMAC du corps en clair ».
- **Scénario d'échec** :
  - Le test « ≠ HMAC en clair » ne couvre que l'ouverture et le changement de PIN.
  - Le test « même clé, autre PIN → 409 » couvre bien la création, mais il reste vert sans `pinFields`, puisqu'un
    PIN différent en clair change aussi l'empreinte.
  - Une régression qui retire `pinFields` de la création remettrait donc en silence le PIN initial du vendeur dans
    `request_hash`, sous HMAC simple, pendant 30 jours. C'est exactement ce qu'ADR-126 interdit.
- **Correction attendue** : ajouter à ce test la création
  (`POST /v1/merchants/:id/vendors`, corps `{display_name, pin}`, appelant `{person}`). Il faut que M5create fasse
  échouer un test.
- **Mineur au même endroit** : le « témoin » de ce test (`clearHash(...)` qui correspond à `/^[0-9a-f]{64}$/`) ne
  prouve rien. Les mutations M5open et M5setpin montrent que la formule est la bonne, mais rien dans le test ne
  l'établit.
  - Un vrai témoin : le HMAC calculé par le test sur le corps **dérivé**
    (`hasher.idempotencyBody(...)`) doit être **égal** à l'empreinte stockée.
  - Cela rend le « ≠ » impossible à satisfaire par une simple erreur de chemin ou d'appelant.

### 2. MAJEUR (question au porteur) : l'argon2 du dérivé est calculé avant le verrou d'essai du terminal

- **Fichiers** :
  - `idempotency.interceptor.ts:101-103` : le dérivé est calculé dans l'intercepteur, avant le contrôleur ;
  - `vendor-sessions.service.ts:109` : le verrou n'est pris que dans le service.
- **Effet** :
  - Avant ce cycle, un terminal ne pouvait avoir **qu'un argon2 en cours à la fois**, puisque la vérification se
    fait sous le verrou et que le `429` ne coûtait rien.
  - Désormais, chaque essai concurrent paie un argon2id complet (19 MiB, environ 50 ms) **avant** de recevoir son
    `429`.
  - Un terminal authentifié qui lance N essais simultanés occupe donc N calculs argon2. Le pool de threads de
    libuv (4 par défaut) est partagé par tout le processus. L'effet : retard sur toutes les ouvertures de session
    et sur les écritures du back-office qui touchent un PIN, ainsi que sur le reste du travail du pool.
  - La mémoire reste bornée par la taille du pool. L'impact porte donc sur la disponibilité ; ni le comptage ni le
    blocage ne sont touchés.
- Le contrat (`contracts/vendors.md` : « un second essai simultané… reçoit `429` ») et le comptage NFR-003 sont
  intacts. Rien ne disait non plus que le verrou servait de borne de ressources.
- Je ne le classe donc pas comme un écart de sécurité codé en silence. L'implémenteur signale bien un argon2 de plus
  par requête, mais pas qu'il précède le verrou.
- **Options** :
  - (a) Accepter et consigner (terminal à trois preuves, révocable ; limite par terminal déjà prévue ailleurs ?).
  - (b) Prendre le verrou d'essai avant l'empreinte : un intercepteur ou une garde dédiés, ordonnés avant
    `IdempotencyInterceptor`, qui tiennent le verrou jusqu'à la fin de la requête.
  - (c) Un sémaphore global sur les argon2 de `VendorPinHasher` (borne de processus, pas par terminal).
  - (d) Un report vers WP11 ou vers la mission d'exploitation, avec une entrée dans `POINTS_OUVERTS.md`.
- Même remarque, mineure, pour le back-office : la création calcule désormais un argon2 avant le contrôle de portée.
  Un administrateur authentifié peut donc faire payer un argon2 pour un commerçant hors de sa portée. Il n'y a pas de
  nouvelle fuite par le temps de réponse, puisque les deux chemins paient le dérivé.

### 3. QUESTION AU PORTEUR : réutilisation de `VENDOR_PIN_SECRET` pour le dérivé

- **Mon évaluation : neutre par rapport au plan.** Ce n'est pas un secret plus exposé.
  - Le secret ne quitte pas le processus. Il n'est ni stocké ailleurs ni journalisé, et il sert dans le même
    composant (`VendorPinHasher`).
  - Avec la base et `IDEMPOTENCY_HMAC_KEY` seulement : le dérivé n'est plus calculable. C'est strictement mieux
    qu'au cycle 1.
  - Avec la base et `VENDOR_PIN_SECRET` : 10^6 argon2 par ligne, comme pour `vendor.pin_hash`. C'est le niveau voulu
    par ADR-126.
  - Le sel est connu (dérivé de la portée et de la clé), mais il est propre à chaque clé : pas de précalcul commun.
    La séparation de domaine est assurée par le préfixe `vendor-pin-idempotency`, et la sortie brute n'est pas au
    format PHC.
- **Effet de bord, mineur** : R-10 dit qu'une rotation de `VENDOR_PIN_SECRET` invalide toutes les empreintes.
  - Elle change aussi le dérivé. Une requête rejouée après la rotation avec la même clé reçoit alors
    `409 IDEMPOTENCY_KEY_REUSED`, au lieu d'être rejouée.
  - Pour `createVendor`, un client qui repart avec une nouvelle clé peut créer un doublon de vendeur.
  - Ce cas est rare, car la rotation est déjà une opération lourde.
- R-10 dit aussi que ce secret est « distinct des autres secrets » : la réutilisation ne fusionne pas deux secrets,
  elle n'est donc pas contraire à R-10.
- **Options, sans trancher** :
  - (a) Garder en l'état, et ajouter à ADR-126 et R-10 la mention « même secret ; la rotation invalide aussi les
    empreintes d'idempotence en vol ».
  - (b) Une sous-clé dérivée, `HKDF(VENDOR_PIN_SECRET, "idempotency")` : séparation cryptographique propre, aucun
    coût d'exploitation, même effet en cas de rotation.
  - (c) Un secret distinct, `VENDOR_PIN_IDEMPOTENCY_SECRET` : la rotation devient indépendante, au prix d'un secret
    de plus à gérer, pour un gain de sécurité nul face au vol du secret du PIN.

### 4. Retouches hors carte : justes et bornées

- `idempotent.decorator.ts` : trois options facultatives (`pinFields`, `keyUuid`, `nonFinal`). Sans elles, le
  comportement de l'intercepteur est inchangé.
- `idempotency.interceptor.ts` :
  - le contrôle UUID se fait avant la réservation ;
  - le dérivé ne remplace le corps que pour le calcul de l'empreinte ; `req.body` n'est pas modifié (le test
    unitaire le vérifie) ;
  - `nonFinal` est purement additif. `NON_FINAL_CODES` (ADR-124, `DEBIT_AUTHORITY_*`) n'est pas modifié, ni
    `device-key.ts`, ni `request-hash.ts`, ni le dépôt ;
  - une réponse déjà enregistrée ou un `CommittedProblem` reste prioritaire sur `nonFinal`, puisque le contrôle
    passe après `if (recorded)` ;
  - la batterie d'idempotence passe : 174/174.
- `vendor-pin.hasher.ts`, méthode `idempotencyBody` :
  - mêmes paramètres et même secret que le reste du hacheur ;
  - une erreur d'argon2 est relancée sans son message ;
  - pas d'argon2 pour une valeur hors motif, ce qui n'ouvre pas d'écart de temps exploitable : ce cas est refusé
    en 422 plus loin, sans rien compter ;
  - le temps de réponse reste uniforme entre PIN de forme valide.
- Le couplage `moduleRef.get(VendorPinHasher, { strict: false })` :
  - une route qui déclarerait `pinFields` sans `VendorPinModule` répondrait 500 avant la réservation, ce qui
    n'écrit rien ;
  - `VendorPinModule` n'a qu'une instance ;
  - le test d'architecture est vert.

### 5. MINEUR : `nonFinal` sans test contre l'élargissement (M8)

- Rendre tout `429` non définitif, sur toutes les routes, ne fait échouer aucun test.
- Aujourd'hui, le seul `429` sous `@Idempotent` est celui du verrou d'essai : l'enrôlement passe par un autre
  chemin, et sa suite reste verte sous M8.
- La mutation est donc sans effet observable aujourd'hui. Je ne demande pas de correction dans ce lot.
- À noter pour un futur `429` enregistré : un test qui fixe « un 429 hors `nonFinal` est enregistré » le
  protégerait.

### 6. Bloquant 1 du cycle 1 : levé

- Concurrence déterministe :
  - une porte dans un espion de `VendorPinHasher.verify` garantit que le premier essai tient le verrou ;
  - le second exige `429 RATE_LIMITED` avec `Retry-After: 1` ;
  - un seul essai est compté ;
  - le premier finit en `401`.
- Verrou libre, vérifié par `pg_try_advisory_lock` depuis une autre connexion, après un refus, une erreur 500, un
  succès et un 422.
- M3a et M3b sont attrapés. 5 exécutions de suite donnent 5 succès.

### 7. Mineurs 5 et 6 du cycle 1 : traités

- `nonFinal: ['RATE_LIMITED']` ne vaut que pour l'ouverture. Le test montre que la même clé, rejouée après le 429,
  est un nouvel essai compté, et non un rejeu. Ce n'est pas un affaiblissement : chaque essai est compté en base
  (transaction A).
- `keyUuid` est posé sur l'ouverture et la fermeture. Une clé non UUID donne `422` : rien n'est enregistré ni
  compté.

## Écarts de sécurité ouverts

- Aucun écart qui affaiblit la sécurité n'a été codé en silence.
- ADR-126 est un renforcement, mais sa preuve est incomplète (constat 1).
- Le constat 2 concerne la disponibilité ; il demande une décision du porteur.
- Le constat 3 est neutre ; il demande une décision du porteur, à consigner dans ADR-126.

## Fichiers à faire relire par une personne

- `apps/api/src/vendor-pin/vendor-pin.hasher.ts` (`idempotencyBody` : sel, secret, paramètres).
- `apps/api/src/idempotency/idempotency.interceptor.ts` (ordre dérivé, réservation, verrou ; `nonFinal`).
- Déjà listés au cycle 1, inchangés : `apps/api/src/db/session-lock.ts`,
  `apps/api/src/vendors/vendor-sessions.service.ts`, `vendor-session-guard.ts`, et les droits `cashless_app` sur
  `vendor_session` et `vendor_pin_check`.

## Reports

- Toujours ouverts depuis le cycle 1 :
  - l'alignement de `contracts/vendors.md` (`422`, `409` au renvoi, liste sans les vendeurs bloqués, et
    « un renvoi refait l'essai » qui ne vaut désormais que pour le `429`) ;
  - l'ordre d'appel de `VendorSessionGuard` à vérifier pour WP11 à WP13 ;
  - le propriétaire des fonctions de purge, sous RLS forcée (défaut antérieur au lot).
- Selon la décision du porteur : constat 2, vers WP11 ou la mission d'exploitation ; constat 3, une mention dans
  ADR-126 et R-10.
