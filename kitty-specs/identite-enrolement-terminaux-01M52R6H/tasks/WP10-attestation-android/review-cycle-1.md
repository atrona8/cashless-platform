---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command:
reviewed_at: '2026-10-20T09:42:04Z'
reviewer_agent: claude
wp_id: WP10
---

# WP10 — retour de relecture (cycle 1) : REJETÉ

Relu : `git diff 9a8e6c2..050dba3` (lane-j). Lint, prettier --check, typecheck et `npx jest test/unit/attestation`
(53 tests) verts. Le code de vérification est juste et n'a pas de contournement trouvé : chaîne, KeyDescription dans
la feuille seulement, défis liés, contrôles lus dans `teeEnforced`, liste de révocation à échec fermé, faux refusé en
production. L'écart OP-N67 / ADR-110 est consigné et borné. Le rejet porte sur **trois contrôles de chaîne (T047) sans
test de refus qui les prouve** (T051 : « un test de refus par contrôle de T047 à T049 »). On pourrait retirer chacun
de ces contrôles sans faire échouer un seul test.

## Constats bloquants

**1. `basicConstraints CA:true` des intermédiaires : aucun test de refus.**
- Code : `apps/api/src/attestation/android-key-attestation.ts:212-213` (`if (!next.x509.ca) fail(...)`).
- Défaut : `test/support/attestation/android.ts:69-74` (`caExtensions`) pose toujours `CA:true`. Aucun cas de
  `android.spec.ts` ne fabrique un émetteur qui n'est pas une autorité.
- Scénario d'échec : une retouche retire ou casse ce contrôle, et les tests restent verts. C'est la défense contre
  l'attaque connue de Key Attestation : une clé SIGN attestée et authentique (sur un vrai appareil) signe une fausse
  feuille qui porte une KeyDescription forgée. La chaîne devient [feuille forgée, vraie feuille, intermédiaire,
  racine]. Aujourd'hui, seul le contrôle « KeyDescription hors de la feuille » est prouvé contre cette chaîne.
- Correction attendue : une option du support (par exemple `intermediateIsCa: false`, ou un émetteur feuille) et
  deux tests. (a) Un intermédiaire sans `CA:true` est refusé avec `/pas une autorité/`. (b) La chaîne
  [feuille forgée signée par une feuille attestée, feuille attestée, intermédiaire, racine] est refusée. Dans ce
  deuxième test, la feuille attestée ne porte pas de KeyDescription, ou le test vérifie que le refus vient de
  `basicConstraints` : sinon il ne prouve pas ce contrôle.

**2. « Émetteur = sujet du suivant » : le refus n'est jamais prouvé.**
- Test : `apps/api/test/unit/attestation/android.spec.ts:182-192` accepte `/émetteur différent|signature invalide/`.
- Défaut : `createAndroidTestPki()` donne le même sujet à tous les intermédiaires
  (`CN=Cashless TEST Android attestation intermediate`, `android.ts:91`). La feuille de `otherPki` a donc le même
  `issuer` que l'intermédiaire de `pki`. La branche `android-key-attestation.ts:210-211` ne se déclenche jamais :
  le test passe par la signature.
- Scénario d'échec : le chaînage explicite par nom, exigé en R-05 et T047 en plus de `verify`, peut disparaître sans
  qu'aucun test ne le voie.
- Correction attendue : un intermédiaire de sujet différent (une option du support), avec une assertion stricte
  `/émetteur différent du sujet du suivant/`.

**3. Dates : seul le `notAfter` de la feuille est testé.**
- Code : `android-key-attestation.ts:204-207` contrôle les dates de **chaque** certificat (T047 : « dates
  valides »). Test : seulement `android.spec.ts:230-237` (feuille expirée).
- Scénario d'échec : une retouche qui ne contrôlerait que la feuille (`index === 0`), ou que `notAfter`, resterait
  verte.
- Correction attendue : au moins une feuille pas encore valide (`notBefore` dans le futur) et un intermédiaire
  expiré, tous deux refusés avec `/hors de sa période de validité/`. Le support devra accepter `leafNotBefore` et la
  validité de l'intermédiaire.

## Constats non bloquants (à traiter si le coût est faible, sinon à consigner)

**4. Liste de révocation : une horloge qui recule fait passer une liste périmée pour fraîche.**
`apps/api/src/attestation/google-revocation-cache.ts:132` et `:136`. Si `now() < loadedAt`, l'âge est négatif. La
liste n'est alors ni rafraîchie ni jugée périmée tant que l'horloge n'a pas rattrapé l'écart. Une horloge reculée de
48 h laisse passer une liste vieille de près de 72 h. Correction suggérée : traiter un âge négatif comme « à
rafraîchir », puis comme périmé si le rafraîchissement échoue, avec un test. C'est un renforcement : à faire, puis à
consigner.

**5. Les deux chaînes ne sont pas liées au même appareil.** Le défi S lie la clé d'accord à la clé de signature,
mais rien n'exige que les deux attestations viennent du même appareil : même `rootOfTrust.verifiedBootKey` et
`verifiedBootHash`, même intermédiaire. Un détenteur de deux appareils authentiques pourrait mettre la clé d'accord
sur l'un et la clé de signature sur l'autre. Le risque est faible, mais l'égalité de `verifiedBootKey` entre les deux
chaînes est un renforcement peu coûteux. À proposer au porteur ou à consigner pour la mission 13.

**6. Le texte d'OP-N67 (`docs/POINTS_OUVERTS.md`) est inexact.** Il dit que « la révocation » reste lue dans la
liste matérielle, alors qu'elle vient de la liste Google, pas de KeyDescription. Il doit aussi citer, comme test qui
échoue si la limite s'élargit, l'analyse de la source (`android.spec.ts:409-420`, « le code ne lit softwareEnforced
que pour attestationApplicationId ») : c'est la vraie borne, et les tests de comportement ne couvrent que
`rootOfTrust` et `origin`.
