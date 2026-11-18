---
work_package_id: WP08
title: Coffre et masque d'IBAN (OP-N140)
dependencies: [WP04]
requirement_refs: [FR-009]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/durcissements-serveur. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T031, T032, T033]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/common/iban-vault.ts
create_intent:
- apps/api/src/common/iban-vault.ts
- apps/api/test/unit/common/iban-vault.spec.ts
- apps/api/test/unit/errors/redact.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/errors/redact.ts
- apps/api/src/common/iban-vault.ts
- apps/api/test/unit/errors/redact.spec.ts
- apps/api/test/unit/common/iban-vault.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 : Coffre et masque d'IBAN (OP-N140)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- la note de lane de **WP04** : noms **réels** des champs de configuration de l'anneau et du `kid` actif
  (variables `IBAN_KEYRING`, `IBAN_ACTIVE_KID`), forme du type exposé, clé de test nommée hors production ;
- `research/R-9b-iban-remboursements-versements.md` §1.1 (masque : constat, conception, tests) et §1.4 points 1 à 3,
  8 et 9 (coffre, clé, droits, options, fichiers à relire) ;
- `apps/api/src/errors/redact.ts` (43 lignes, entier) et son seul appelant `errors/problem.filter.ts:85-100` ;
- `apps/api/src/common/iban.ts` (`normalizeIban`, `isValidIban`, `maskIban`) et `test/unit/common/iban.spec.ts`
  (modèle de test et IBAN valides d'exemple) ;
- `apps/api/src/config/config.ts` l. 245-300 (`TEST_HMAC_KEYS`, `hmacKey`, refus d'une clé de test en production) ;
- `plan.md` « Décisions différées » n° 1 et IC-07 ; `interfaces.md` (table « TypeScript », format chiffré).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi. Contradiction : tu la signales.

## Objective

Livrer les deux briques de l'IBAN que les lots suivants consomment : (1) le masque (`redact.ts`) : aucun IBAN, avec
ou sans nom de champ, avec ou sans espaces, ne paraît dans un journal (FR-009) ; (2) le coffre `IbanVault` :
chiffrement AES-256-GCM applicatif d'un IBAN lié au prestataire, ouverture, rotation par `kid`. WP09 et WP10 écrivent
et lisent les IBAN chiffrés avec ce coffre (FR-010) ; ce lot ne touche aucune table ni aucune route.

## Context

- **Décision du porteur du 18/11/2026 (écart accepté, règle 1)** : la clé de chiffrement de l'IBAN est lue en
  configuration de l'API (`IBAN_KEYRING`, `IBAN_ACTIVE_KID`, lus par `config.ts` de WP04), aux trois emplacements de
  l'IBAN. Limite résiduelle déjà consignée au plan : la clé est dans le processus public (gain : base, sauvegardes,
  réplicas, autres rôles SQL, injection en lecture) ; levée par un vrai KMS (OP-N41, mission 12b). **Aucun port KMS**
  n'est ajouté au processus public (`architecture.spec.ts:158-170` l'interdit) ; ne t'en approche pas.
- **Point ouvert** : OP-N140. **Aucun faux** : l'anneau est une vraie clé exigée en production (WP04 refuse le
  démarrage sans lui) ; hors production, la clé de test nommée de WP04 sert, et un test prouve qu'elle est refusée en
  production (test de WP04 ; toi tu ne la recrées pas).
- **Interface possédée** (`interfaces.md`) : `IbanVault.seal(iban, operatorId): string`, `.open(envelope,
  operatorId): string`, `.isSealed(v): boolean`. Format : `enc:v1:<kid>:<base64url(iv12 ‖ chiffré ‖ tag16)>`,
  AES-256-GCM, AAD `CASHLESS/IBAN/v1|<operator_id>`, IV de 12 octets aléatoires, type de colonne inchangé (`text`).
- **Fichiers à faire relire par une personne** (règle 4) : `redact.ts` et `iban-vault.ts` (cryptographie). Le dire dans
  le compte rendu : l'agent qui les écrit ne vaut pas relecture indépendante.
- **Effet de bord attendu, à ne pas corriger ici** : `test/integration/invariants-cloture/limits-9b.spec.ts` (WP09)
  attend encore l'ancienne liste de `REDACTED_FIELDS` et un IBAN non masqué ; il échouera après ton lot jusqu'à ce
  que WP09 l'inverse. Signale-le dans ta note, ne l'édite pas.

## Subtasks

### T031 : `redact.ts` masque `iban` et l'IBAN par sa forme

1. Ajoute `'iban'` à `REDACTED_FIELDS` (couvre `"iban":"…"`, `iban=…`, `destination_iban=…` grâce au nom préfixé).
   `'msisdn'` : la recherche le recommande « à confirmer » ; **ne l'ajoute pas sans accord** : décris dans ta note
   (donnée personnelle de même nature, déjà masquée par `maskPaymentData`) et laisse le porteur trancher. Le masque
   d'`iban` est un renforcement : fait.
2. Ajoute une passe **par valeur**, exécutée **avant** les deux passes par champ : motif d'IBAN nu
   `\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Za-z0-9]){11,30}\b`, insensible à la casse (flag `i`), espaces simples tolérés,
   remplacé par `[masqué]` (constante `REDACTED`). Pas de contrôle modulo 97 : une saisie invalide dans un message
   d'erreur reste sensible. Faux positifs acceptés dans un journal (mieux vaut masquer trop).
3. Pièges : (a) l'ordre : si la passe `TEXT_FIELD` passe d'abord, elle ne masque que le premier groupe d'un IBAN à
   espaces ; (b) l'enveloppe `enc:v1:<kid>:<base64url>` ne doit pas être traitée comme un IBAN, mais elle ne doit pas
   non plus fuir : un journal qui la cite est tolérable (chiffrée), un IBAN en clair ne l'est pas ; (c) `maskIban`
   déjà masqué (`FR14*******************2606`) ne doit pas casser ; (d) une chaîne ordinaire (UUID, date, montant,
   référence `CL0xx`) n'est pas touchée : teste des faux positifs probables (références de lot, SQLSTATE) et accepte
   ceux qui sont inévitables en les nommant ; (e) mets à jour le commentaire d'en-tête (liste des champs masqués).
4. Vérifie que `problem.filter.ts` n'a pas besoin de changer (il appelle `redactSecrets` sur le message).

Validation : `SKIP_LATENCY=1 npx jest test/unit/errors --runInBand --forceExit`.

### T032 : `iban-vault.ts` : chiffrement, ouverture, `kid`, données associées

1. Classe `IbanVault` (`@Injectable`) construite à partir de l'anneau de WP04 : `Map<kid, Buffer(32)>` et `kid` actif
   (présent dans l'anneau). `seal` : `node:crypto` `createCipheriv('aes-256-gcm', clé, iv12)`, `setAAD`
   (`CASHLESS/IBAN/v1|<operatorId>`), tag de 16 octets, format ci-dessus. `seal` d'une valeur déjà chiffrée : refus
   (jamais de double chiffrement). `open` : analyse stricte du format, `kid` inconnu → erreur nommée, tag ou AAD faux
   → erreur nommée, **sans jamais citer la valeur, le clair, la clé ni l'enveloppe** dans le message ; jamais le clair
   en repli. `isSealed` : préfixe `enc:v1:` exact.
2. Rotation : plusieurs clés en lecture, une seule en écriture (`kid` actif). Une enveloppe écrite avec l'ancien
   `kid` s'ouvre tant que l'ancien `kid` est dans l'anneau.
3. Fourniture : `IbanVaultModule` (`@Global()`, même fichier ou fichier voisin dans `common/` **seulement si tu le
   déclares**) exportant `IbanVault`, fabriqué depuis `APP_CONFIG`. Hors carte, une ligne, à lister dans ta note :
   `apps/api/src/app.module.ts` importe `IbanVaultModule` (processus public seulement ; aucun autre processus ne le
   charge, donc aucun n'a l'anneau). N'ajoute rien à `kms/`.
4. Normalisation : le coffre reçoit l'IBAN **tel que l'appelant l'a normalisé** (`normalizeIban`) ; il ne le valide
   pas (WP09 et WP10 valident avant de chiffrer). Pas de journal, pas de `console`.

Validation : `npx tsc -p tsconfig.json --noEmit` ; tests de T033.

### T033 : unitaires du masque et du coffre

`test/unit/errors/redact.spec.ts` (nouveau) :
- JSON `{"iban":"SN08SN0100152000048500003035"}`, formulaire `iban=…`, texte `iban: …`, nom préfixé
  `destination_iban`, IBAN avec espaces (`SN08 SN01 0015 2000 0485 0000 3035`) : aucun fragment du numéro ne reste ;
- IBAN nu dans un message d'erreur libre, en minuscules, au milieu d'une phrase : masqué ;
- secrets déjà couverts (PIN, jeton, empreinte argon2) toujours masqués ; `maskIban` déjà masqué et chaîne ordinaire
  non cassés ; liste `REDACTED_FIELDS` = ancienne + `iban` (le test de borne de WP09 reprend cette liste).

`test/unit/common/iban-vault.spec.ts` (nouveau) :
- aller-retour ; deux `seal` du même IBAN donnent deux enveloppes différentes (IV aléatoire) ;
- ouverture avec **le prestataire d'un autre** : refusée ; enveloppe altérée (un octet de chiffré, de tag, d'IV) :
  refusée ; `kid` inconnu : refusée ; format invalide : refusé ; `seal` d'une enveloppe : refusé ;
- rotation : enveloppe d'un `kid` ancien ouverte avec un anneau à deux clés dont l'actif est le nouveau ; une
  nouvelle écriture porte le `kid` actif ;
- les messages d'erreur ne contiennent ni l'IBAN, ni l'enveloppe, ni la clé ;
- anneau invalide (clé de moins de 32 octets, `kid` actif absent) refusé à la construction ;
- format exact : préfixe `enc:v1:<kid>:`, longueur de `iv ‖ chiffré ‖ tag` = 12 + len + 16.

**Mutation NFR-004** (consignée dans la note) : (1) retire `setAAD` : le test « autre prestataire refusé » doit
échouer ; (2) fais ouvrir sans vérifier le tag (`setAuthTag` omis ou erreur avalée) : le test « altération » doit
échouer ; (3) retire la passe par valeur du masque : le test « IBAN nu » doit échouer. Remets chaque contrôle.

Validation : `SKIP_LATENCY=1 npx jest test/unit/errors test/unit/common --runInBand --forceExit`.

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP04.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP08 --agent claude --mission
  durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] `redact.ts` : `iban` dans `REDACTED_FIELDS`, passe par valeur avant les passes par champ, IBAN à espaces masqué.
- [ ] `IbanVault.seal/open/isSealed` conformes à `interfaces.md` (format, AAD, `kid`, IV aléatoire).
- [ ] Aucun message d'erreur ne cite valeur, enveloppe ou clé ; jamais de clair en repli.
- [ ] Unitaires verts ; trois mutations prouvées et consignées.
- [ ] `IbanVaultModule` fourni au seul processus public ; aucun port KMS ajouté ; `architecture.spec.ts` toujours vert
      (lance-le : `test/unit/architecture.spec.ts`).
- [ ] Aucune dépendance nouvelle (`node:crypto` seulement) ; lignes ≤ 100 ; `openapi.yaml` inchangé.
- [ ] Note de lane : retouche hors carte (`app.module.ts`), `msisdn` laissé au porteur, échec attendu de
      `limits-9b.spec.ts` jusqu'à WP09, **fichiers à faire relire par une personne : `redact.ts`, `iban-vault.ts`**.

## Risks

1. Chiffrement faux mais qui « marche » (AAD non lié, tag non vérifié, IV réutilisé) : les trois mutations le
   détectent ; un IV non aléatoire se détecte par le test « deux enveloppes différentes ».
2. Passe par valeur trop large : masque un identifiant légitime (références de lot) dans des journaux d'exploitation ;
   documente les faux positifs.
3. Clé d'anneau dans un message d'erreur de configuration (WP04) : ne la recopie jamais.
4. Dérive de `interfaces.md` : si tu changes une signature, **signale-le**, WP09 et WP10 en dépendent.

## Ce que le relecteur doit casser

- Ouvrir une enveloppe avec un autre `operator_id`, un `kid` inconnu, un octet altéré (IV, chiffré, tag), un préfixe
  tronqué : tout doit lever une erreur sans valeur. Vérifier que la mutation « sans AAD » fait échouer un test.
- Sceller deux fois la même valeur : les enveloppes doivent différer ; sceller une enveloppe : refus.
- Passer à `redactSecrets` : IBAN à espaces, minuscules, collé à du texte, dans un JSON imbriqué, dans une URL, avec
  tirets ; chercher un fragment de plus de 4 caractères du numéro dans la sortie.
- Chercher l'IBAN, l'enveloppe ou la clé dans les messages d'erreur, `toString`, `JSON.stringify` du coffre.
- Vérifier qu'aucun fichier atteignable depuis un processus autre que le public ne reçoit l'anneau, et qu'aucun port
  KMS n'a été ajouté.
- Vérifier qu'aucune clé de test n'est acceptée en production (test de WP04) et que `isSealed` n'accepte pas
  `enc:v2:` ou `ENC:v1:`.
