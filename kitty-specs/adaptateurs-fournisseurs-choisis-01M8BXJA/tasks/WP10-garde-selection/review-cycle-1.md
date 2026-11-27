---
affected_files: []
cycle_number: 1
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-26T16:29:48Z'
reviewer_agent: claude
wp_id: WP10
---

# WP10 - relecture, cycle 1 : changements demandes

## Constat 1 (bloquant) - la garde de demarrage ne voit pas S3SealCopy ni PayDunyaPspAdapter
`interfaces.md` section 6 : chaque classe reelle porte `isFake = false` et `service`. `S3SealCopy` n'a que `isFake`
(pas de `service`) et `PayDunyaPspAdapter` n'a ni l'un ni l'autre. Preuve (test temporaire, retire) : un `S3SealCopy`
construit directement passe `assertNoFakeInProduction(true, { copie })` sans erreur, alors que `seal-copy` n'est pas
dans `PRODUCTION_ENABLED_SERVICES`. Seule la fabrique `createSealCopy` refuse : la 2e ligne de defense prevue
(garde de `assertProcessIsSafe`) n'existe pas pour la copie des scellements, qui doit refuser de demarrer.
A faire :
- `S3SealCopy` : `readonly service = 'seal-copy' as const` ; `PayDunyaPspAdapter` : `isFake = false` et
  `service = 'psp.paydunya' as const` (retouches hors carte WP09/WP06, a nommer dans la note de lane).
- Test : `assertNoFakeInProduction(true, { copie: new S3SealCopy(...) })` leve `UntriedInProductionError`
  (service non liste), passe si la liste injectee contient `seal-copy` ; meme verification que chaque adaptateur reel
  (wave, paydunya, stripe, coffre, KMS, copie) porte `service` dans `EXTERNAL_SERVICES` et `isFake === false`.
- Test d'architecture : `new S3SealCopy(` n'apparait que dans `sealing/sealing.module.ts` (et `new AwsKms(` que dans
  `kms/kms.module.ts`), avec sa mutation.
- Ajouter les marques sur le registre n'est pas demande (le registre PSP reste « indisponible » en production, demarrage
  permis, conforme a I1).

## Constat 2 (bloquant : assertion affaiblie) - `processes.spec.ts`
`rejects.toThrow(FakeInProductionError)` est devenu `rejects.toThrow(/^Démarrage refusé : /)` pour les 5 processus.
Le motif accepte aussi `UntriedInProductionError` : un faux reste-t-il refuse dans les processus qui portent le KMS ?
Le test ne le dit plus (le refus du KMS reel non essaye masque tout autre faux). Rendre l'attente precise par processus :
la classe d'erreur exacte (`FakeInProductionError` ou `UntriedInProductionError`) et, pour `FakeInProductionError`, le
nom du faux dans le message ; ajouter le cas « processus avec KMS : cause = `kms` non essaye ».

## Constat 3 (mineur, a corriger au passage)
Mutation survivante : `createSealCopy`, defaut de production `real` -> `fake` ne fait echouer aucun test (le refus est
le meme, seul le message change). Asserter la classe d'erreur `UntriedInProductionError` pour « production, reglage
absent » (copie et KMS ont deja le test cote KMS).

## Verifie, sans reserve
Matrice I1 couverte pour PSP, coffre, KMS, copie (7 mutations rejouees : retrait de la liste, defaut absent=real, refus
du faux, allowed=true, garde `service` : toutes detectees sauf constat 3). Aucun reseau, aucun secret dans les erreurs,
test d'architecture KMS non assoupli (renforce), `crypto-production.spec.ts` et `psp-production.spec.ts` : attentes
equivalentes ou plus strictes. Gardes transverses et `real-adapters-credit.spec.ts` verts.
