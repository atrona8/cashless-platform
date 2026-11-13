# WP15 - relecture cycle 1 : changements demandes

Verification faite : pgTAP `tests_edge_media_to_pack.sql` + `tests_execute_grants.sql` (verts), Jest
`test/integration/edge/packs` (5 suites, 14 tests) et `tools/edge-admin` (4 suites, 29 tests) verts sur cashless_wp15.
Mutations qui font echouer un test : STANDBY servie (0067), delai retire (0067), derivation sans identifiant de
passerelle, UUID invalide accepte, `app.operator_id` non pose, titulaires non distincts, mode 0644, O_EXCL retire,
URL non `cashless_edgeadmin`. 0067 (DEFINER, search_path, assert_tenant, EXECUTE tagkeys seul, isolation) : conforme.

## Constats bloquants (tests de borne exiges par l'ADR-184 et CLAUDE.md regle 3 : absents ou trop faibles)

1. **La source de derivation n'est pas figee au niveau du travailleur** (ADR-184 : "test qui echoue si la source de
   derivation change"). `pack-derivation.spec.ts` ne teste que `deriveContentKey(dek, ...)` avec une cle fournie. Mutation
   `ORDER BY created_at, key_index, version, id` -> `ORDER BY created_at DESC` dans `edge-packs.service.ts#contentKey` : les 14 tests
   restent verts. Correction : un test d'integration avec DEUX cles de donnees pour le prestataire (l'ancienne et une
   plus recente), qui verifie que la cle de contenu ouverte par la passerelle est celle derivee de la PLUS ANCIENNE
   (HKDF recalcule dans le test), et qu'elle reste identique apres l'ajout d'une cle plus recente.
2. **L'AAD du scellement de la cle n'est pas epinglee** (alignement avec `pack-crypto.ts` de la lane w). Mutation
   `PWDPACK-KEY/EDGE/v1` -> `v2` dans `pack-sealing.ts` : tout reste vert, car `pack-canary.spec.ts` importe `sealedKeyAad`
   de la source testee. Correction : dans un test, comparer `sealedKeyAad(ledger, gateway)` a un vecteur code en dur
   (`CASHLESS/PWDPACK-KEY/EDGE/v1|<ledger>|<gateway>`, ASCII, minuscules), identique a celui de la passerelle.
3. **"Sans liste, rien" (decision 43, ADR-184 "travailleur sans liste : aucun depot") n'est pas prouve sur le travailleur.**
   Seul `parsePackOperators('')` est teste. Correction : test d'integration avec `EDGE_PACK_OPERATORS` absent/vide et une
   PRIMARY eligible avec colis a sceller : `runOnce()` (sans argument) rend 0 et rien n'est depose ; puis liste a un
   prestataire A : rien deposé pour la passerelle d'un prestataire B non liste. Ajouter un test de demarrage (ou au moins
   de construction du service) qui refuse un UUID mal forme dans `EDGE_PACK_OPERATORS`.

## Mineurs (a corriger dans le meme cycle si peu couteux, sinon a consigner)

4. ADR-184 (Contexte) et l'en-tete de `pack-sealing.ts` affirment que le central ne peut pas rouvrir K : faux, puisque K
   derive de la cle de donnees que le central detient (il lit deja les mots de passe par cette cle, donc pas
   d'exposition supplementaire, mais l'affirmation est inexacte). Corriger les deux textes.
5. `register --ledger` n'est pas verifie contre l'evenement (aucune fonction de lecture) : un ledger errone entre dans le
   fichier d'enrolement. Le consigner dans les limites connues (effet : disponibilite, pas de fuite).
6. `EDGE_PACK_OPERATORS` n'est documente nulle part (ni exemple de configuration, ni doc d'exploitation).
7. Message de `register` : delai de 30 min code en dur (`DEFAULT_PACK_DELAY_SECONDS`) alors que le reglage de plateforme fait
   foi ; deja mentionne dans le message, acceptable.
8. Un bracelet illisible (`SKIP`) est rendu a chaque page : plus de 200 bracelets illisibles affameraient la file. Borne a noter.
