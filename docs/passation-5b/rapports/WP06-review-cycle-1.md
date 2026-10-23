# Relecture WP06 (cycle 1) : OP-N74, enrôlement et état de l'événement (migration 0035)

**Verdict : APPROUVÉ** (aucun constat bloquant ni majeur ; 3 constats mineurs, à consigner, non bloquants).

Relecteur distinct de l'implémenteur. Lane f, commit `a7525775` (seuls fichiers :
`packages/ledger-sql/migrations/0035_enrollment_event_state.sql`,
`packages/ledger-sql/tests/tests_enrollment_event_state.sql`). Le HEAD de la lane (`a817c1e1`) ne
touche pas `packages/ledger-sql` après ce commit.

## Vérifications faites

1. **Corps remplacés, rien de retiré** (extraction et diff faits par moi, pas seulement le diff du
   compte rendu) :
   - `create_device_enrollment_code` contre 0022 §3a : seuls diffèrent l'en-tête (`CREATE OR
     REPLACE`, mise en page), la variable `v_status`, et le bloc OP-N74 placé après
     `device_admin_allowed`, avant l'`INSERT`. Tous les contrôles de 0022 sont présents, dans le même
     ordre.
   - `enroll_device` contre 0022 §3c : seuls diffèrent l'en-tête, `v_status`, et les blocs 3a/3b
     insérés entre le contrôle du mode (CL027) et `pg_advisory_xact_lock`. Les paramètres (CL001),
     le code `FOR UPDATE` (CL025), CL026, CL027, le verrou du serial, CL028 avec la traduction de
     `device_serial_active`, `next_seq`, la consommation du code, `REENROLLED`, le jeton et
     l'historique sont tous présents. `#variable_conflict use_column` et `p_device_id DEFAULT NULL`
     sont gardés.
   - `record_enrollment_attempt` contre 0027 : une seule ligne diffère (`'EVENT_CLOSED'` ajouté à la
     liste). Aucune migration postérieure (0030 incluse) ne redéfinit ces trois fonctions : 0030 ne
     fait que les appeler (`record_enrollment_refusal` → `record_enrollment_attempt`). Aucune autre
     lane (0031 en b, 0032 en c) ne les touche.
   - La contrainte `device_enrollment_attempt_result` reprend les 8 valeurs de 0022, plus
     `EVENT_CLOSED`. Un test vérifie qu'elle contient exactement 9 valeurs.
2. **Matrice des 7 états × 4 modes** : `CLOSED` est refusé pour tout mode. `CLOSING`,
   `RECONCILING`, `SETTLING` et `REFUND_WINDOW` sont refusés quand
   `coalesce(mode,'CATALOG_POS') ∈ {CATALOG_POS, KEYPAD_TPE}`. `TOPUP_DESK` est permis jusqu'à
   `REFUND_WINDOW` inclus. `NULL` vaut `CATALOG_POS` à l'émission (`coalesce(p_mode…)`) comme à
   l'enrôlement (`v_mode`). C'est conforme à FR-024 et à DM-01M5HKDXSTFR5JS88GZ4B2EA5J. Les tests
   comptent explicitement 16 refus et 12 réussites, à l'émission comme à l'enrôlement.
3. **Auteur hors périmètre → P0002 avant CL031** : l'état est lu après `device_admin_allowed`.
   Cas couverts : CLOSED/TOPUP_DESK, CLOSING/CATALOG_POS, LIVE. Les CL001 et P0002 placés avant
   l'auteur (point de vente d'un autre événement, événement d'un autre prestataire) datent de 0022 ;
   ils n'apprennent rien de l'état.
4. **Verrous** :
   - Émission : l'événement est relu `FOR SHARE`.
   - Enrôlement : le code est pris `FOR UPDATE`, puis l'événement `FOR SHARE`, puis le verrou
     consultatif du serial.
   - `set_event_status` prend l'événement `FOR NO KEY UPDATE`, qui entre en conflit avec
     `FOR SHARE`. En READ COMMITTED, une clôture validée pendant l'attente est relue. Aucun chemin ne
     verrouille l'événement puis `device_enrollment_code` (aucun UPDATE du code hors 0022/0035) :
     pas d'inversion d'ordre, pas d'interblocage.
   - La preuve par `pgrowlocks` exclut à juste titre `For Key Share`, que la clé étrangère pose seule.
5. **Rien d'écrit sur refus** : les refus passent par une exception, qui annule tout. Les tests
   vérifient le compteur terminal / code consommé / jeton / historique, et que le code reste non
   consommé. Seuls l'essai et l'audit d'ADR-117 restent écrits, par `record_enrollment_refusal` dans
   une transaction distincte (§7 de la suite).
6. **`search_path`, REVOKE, droits** : les trois fonctions restent `SECURITY DEFINER` avec
   `search_path=public, pg_temp`. `REVOKE ALL … FROM PUBLIC` est rejoué, sans aucun `GRANT`. Les
   droits de `cashless_app` sont conservés et testés.
7. **Mutations** (mes propres essais) :
   - Sans `FOR SHARE` dans `enroll_device` : les cas 9 et 91 échouent.
   - Sans le contrôle `mp.event_id = c.event_id` : les cas 84 à 88 échouent.
   - Les tests distinguent donc bien l'implémentation de son absence.

## Tests (base privée `cashless_wp06r`, Docker 127.0.0.1:5433, supprimée à la fin)

- `reset-db.sh` : migrations jusqu'à 0035, `roles.sql` et `post-roles.sql` rejoués.
- `pg_prove tests/tests_enrollment_event_state.sql` : `1..110`, PASS.
- Nouveau `reset-db`, puis `test-pgtap.sh` : `Files=34, Tests=2193, Result: PASS`. Les suites de la
  5a passent sans modification.
- Jest et typecheck : non rejoués, car aucun fichier TypeScript n'a changé. Le rejeu en série des
  intégrations d'enrôlement de la 5a reste à faire par l'orchestrateur.

## Le refus après attestation affaiblit-il quelque chose par rapport à la spec ?

**Non, au sens de la spec.**

- FR-024 et le scénario 3 exigent un refus « sans rien écrire » ; ils ne fixent pas le moment du
  refus. La décision qui fait foi est prise dans `enroll_device`, sous verrou, dans la transaction
  d'écriture. C'est le seul endroit où elle est sûre, puisqu'une lecture préalable sans verrou
  serait de toute façon à refaire.
- Le comportement est le même qu'aujourd'hui pour CL028 (serial), qui est aussi détecté après
  l'attestation.

**Coût réel, à consigner (constat 1)** : pour un code d'un événement clos, l'API fait quand même :
- la vérification d'attestation (appels Google, mis en cache) ;
- **l'émission d'un certificat par l'autorité des terminaux** (`ca.issue`, étape 8), avant
  `enroll_device`.

Ce certificat n'est jamais accepté, car son empreinte n'est enregistrée nulle part (en-tête de
`enrollment.service.ts`). Ce n'est donc pas une ouverture de droit. C'est en revanche une signature
de l'autorité, consommée pour un événement fini, que n'importe quel porteur de code peut provoquer
dans la limite R-16.

## Constats

1. **Mineur, à consigner** : la vérification précoce n'est pas faite (hors plan, signalée par
   l'implémenteur).
   - Où : `packages/ledger-sql/migrations/0022_device_enrollment.sql:313`
     (`check_device_enrollment_code` inchangée).
   - Scénario : un code émis, puis l'événement passe en CLOSED. L'enrôlement va jusqu'à l'attestation
     et la signature du certificat avant d'être refusé en CL031.
   - Correction attendue (renforcement, mission ultérieure ou point ouvert) : dans
     `check_device_enrollment_code`, ajouter le même contrôle d'état en lecture seule, sans verrou,
     comme refus rapide. Garder le contrôle sous verrou d'`enroll_device`, qui reste la décision qui
     fait foi.
2. **Mineur, dépendance d'ordre** (pas un reproche au lot) : tant que WP08 n'a pas traduit `CL031`
   en 422 `ENROLLMENT_EVENT_CLOSED` ni ajouté la ligne `ATTEMPT_RESULTS` (transférée à WP08),
   l'API répond 5xx à ce refus et ne le trace pas. Il faut vérifier, à l'acceptation, que WP08
   couvre bien les deux, et qu'un test d'intégration montre l'essai `EVENT_CLOSED` et l'audit
   `DEVICE_ENROLLMENT_REFUSED`.
3. **Mineur, style** : plusieurs lignes dépassent 100 caractères. Elles sont soit recopiées de 0022
   pour garder le diff propre, soit des signatures `regprocedure` dans la suite. C'est accepté :
   Prettier ne formate pas le SQL.

Constat d'information (non compté) : le `FOR SHARE` sur `event` met en attente, pendant un
enrôlement, tout `UPDATE` de l'événement, même sur une colonne autre que `status`. L'effet est
négligeable (transaction courte).

Contrôle « point de vente supprimé » : c'est une défense en profondeur. Il ne se déclenche qu'en
contournant `participation_guard` ou `point_of_sale_guard`, ce que fait le test en propriétaire. Le
code CL031 retenu par l'arbitrage est à faire valider par le porteur, comme le demande le compte
rendu.

## Liste anti-motifs

| # | Item | Résultat |
|---|---|---|
| 1 | Code mort | PASS : les trois fonctions sont appelées par l'API (`enrollment.service.ts`, émission) ou par `record_enrollment_refusal` |
| 2 | Test sur données fabriquées | PASS : les cas appellent les fonctions réelles ; les mutations font échouer la suite |
| 3 | Retour vide silencieux | PASS / N/A : aucun |
| 4 | Couverture des FR | PASS : FR-024 (matrice, point de vente, rien d'écrit) ; C-001 (règle tenue en base) ; C-002 (aucun `.sql` généré touché) |
| 5 | Surface figée | PASS : seuls les deux fichiers du lot |
| 6 | Décision verrouillée | PASS : aucun `GRANT`, `search_path` gardé, aucun contrôle de 0022 retiré |
| 7 | Fichiers partagés | PASS avec note : la contrainte des essais et `record_enrollment_attempt` sont touchées ici ; WP08 ajoute la valeur côté API (constat 2). Aucune autre lane ne touche ces objets |
| 8 | Fragilité en production | PASS : chaque nouveau `RAISE` est un refus métier nommé (CL031) ; le verrou n'introduit pas d'interblocage |

## Écarts de sécurité ouverts

Aucun écart qui affaiblit la sécurité n'est introduit. Les trois écarts au plan sont des
renforcements (le remplacement de `record_enrollment_attempt`, le refus fermé quand l'événement est
introuvable, la relecture `FOR SHARE` avec `operator_id`).

**À faire relire par une personne** : `0035_enrollment_event_state.sql`. Les fonctions
`SECURITY DEFINER` d'enrôlement y sont remplacées en entier, et la contrainte d'essai y est élargie.
