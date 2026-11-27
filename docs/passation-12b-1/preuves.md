# Preuves de la mission 12b-1 (`adaptateurs-fournisseurs-choisis-01M8BXJA`)

Écrit par WP13 le 27/11/2026, **d'après les notes de lane de WP01 à WP12 (journal d'états de la mission,
`status.events.jsonl`, cité « note WPxx »), les comptes rendus de relecture (`tasks/WPxx-*/review-cycle-N.md`, cité
« relecture WPxx ») et les décisions du porteur**. Seuls les gardes de la section « Relancé par WP13 » l'ont été : aucun test de
lot n'a été relancé pour les autres lignes. Un chiffre qu'aucune note n'établit est écrit « non établi ». La matrice
d'acceptation (`acceptance-matrix.json` de la mission) est tenue par l'orchestrateur, qui ajoutera la batterie complète ; ce
tableau en est la source de commandes et de résultats. Chemins `apps/api/test/...` abrégés en `api/...`. Aucun appel réseau
externe dans aucun test (garde `test/support/no-external-network.ts`, limite : OP-N207). **Rien n'a été essayé contre un vrai
service** : tout « à confirmer à l'essai » reste ouvert (OP-N206).

Conventions. Jest : depuis `apps/api` de la lane, `export PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh` puis
`SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit` (toutes les `DATABASE_URL_*` vers la base du lot). Contrat :
`node tools/contract-stability/check.mjs`.

## Relancé par WP13 (lane m, base `cashless_wp13`, après `reset-db.sh`)

| Garde | Commande | Résultat |
|---|---|---|
| Unitaires de la mission et gardes transverses | `npx jest test/unit/psp test/unit/external-services test/unit/kms test/unit/sealing test/unit/attestation test/unit/contracts test/unit/architecture.spec.ts test/unit/production-guard.spec.ts test/unit/webhooks test/unit/processes.spec.ts` | 30 suites, 716 tests : 715 verts ; `processes.spec.ts` a échoué une fois (« function claim_key_version_max() does not exist » : base `cashless_wp13` non migrée), vert après `reset-db.sh` (avec `consignation.spec.ts` : 160 tests) |
| Réception et recharges PSP | `npx jest test/integration/webhooks test/integration/topups` | 14 suites, 147 tests verts, 1 ignoré |
| Garde de consignation | `npx jest test/integration/invariants-cloture/consignation.spec.ts` | 128 tests verts (blocs 9b, 11b et 12b-1) |
| Contrat (C-001) | `node tools/contract-stability/check.mjs` ; `node --test tools/contract-stability/check.test.mjs tools/contract-stability/check-baseline-decision.test.mjs tools/contract-stability/x-roles/x-roles.test.mjs` | 313 différences, 313 admises, 0 refusée ; 58 verts, 0 en échec |
| Décision du porteur sur la référence | `node tools/contract-stability/check-baseline-decision.mjs` | « décision du porteur consignée : 09/11/2026 ADR-169 » (la ligne d'ADR-237 est lue aussi : voir `consignation.spec.ts`) |
| Fichiers générés intacts (C-006) | `bash packages/ledger-sql/scripts/check-generated.sh` ; `git diff --quiet 825263fc..HEAD -- packages/ledger-sql` | « suites pgTAP à jour » ; différence vide (aucun fichier de `packages/ledger-sql` modifié par la mission) |

**Mutations de la garde de consignation** (WP13, rejouées puis annulées, 1 test rouge chacune) : `OP-N205` retiré de `PRD.md` ;
une seconde racine ajoutée à l'exception par défaut d'`android-key-attestation.ts` ; ligne « Décision du porteur : 26/11/2026
ADR-237 » retirée de `DECISIONS_ADR.md` ; `apple_validation_category_01` ajouté à `ios-app-attest.ts`.

## Résultats par lot (repris des notes)

| Lot | Contenu | Mutations (note de lane, relecture) |
|---|---|---|
| WP01 | Socle, garde réseau, réglages. Aucune suite existante n'appelle le réseau (psp, receive, android verts) | endpoint de production, faux en production, seau, `https`, `http` local hors production, rejeu de POST, journal des en-têtes, garde réseau (installation, connexion), redirections : tests rouges. Relecture : 32 paquets ajoutés, `registry.npmjs.org` avec intégrité, aucun script d'installation |
| WP02 | Port à deux verdicts, `hmac-signature.ts` | séparateur de Wave `.`, entrées inconnues de Wave, second calcul supprimé, précédent échu accepté |
| WP03 | Réception d'un signal, relecture, litige Stripe | cycle 1 : secret précédent d'un signal, borne par identifiant, tolérance, formulaire Wave, borne par minute, relecture dans la requête ; cycle 2 : `delete` après `FAILED` retiré, `close` retiré, garde « déjà traité » retirée, référence marchande non remplie, résolution `null` ignorée ; cycle 3 : marquage « traité » remis (6 rouges), résolution désactivée dans `apply` (3 rouges) |
| WP04 | Contrat D9, 313 entrées admises | retrait du JSON : 3 tests rouges ; autre champ : empreinte rouge ; `node --test` 58/58, x-roles 16/16, `npm run check` ok, `jest contracts` 23/23 (note WP04 cycle 2) |
| WP05 | Wave | séparateur `.`, création idempotente (rejeu), montant décimal, `succeeded` non exigé, devise XOF ; cycle 2 : 8 mutations rejouées par le relecteur (filtre `client_reference`, montant et devise de la reprise, id de session, 429, 5xx, 31 jours, devise des lignes) |
| WP06 | PayDunya | `timingSafeEqual` remplacé par `!==`, `NOTIFICATION`, JSON accepté, `threeDs: 'SUCCEEDED'`, précédent, montant non entier |
| WP07 | Stripe | 13 mutations (cycle 1), 5 (cycle 2 : `attempt_acknowledged` remis en succès, litige, `expires_at` stable, filtre `payment_intent`) |
| WP08 | Coffre AWS | appel avant contrôle du détenteur, cache d'erreur, précédent après échéance, L4 PayDunya, durée du cache ; relecture : préfixe détenteur, segment vide, fournisseur en cache, précédent PayDunya : rouges |
| WP09 | KMS et S3 | `DIGEST`, `IfNoneMatch`, `GOVERNANCE`, `forCapabilities` exposant tout, mise à zéro, borne de 4 096 octets, DER, empreinte divergente, message du SDK dans l'erreur |
| WP10 | Garde de production | retrait du service de la liste, défaut absent = `real`, refus du faux, `allowed = true`, garde `service` ; cycle 2 : marques sur les six adaptateurs, architecture des sites de construction (avec mutation), défaut de `createSealCopy`, causes exactes de `processes.spec.ts` ; 36 suites vertes |
| WP11 | Commande d'essai | 17 mutations rouges : refus de production, fuite de la valeur lue, `looksSecret`, saut des dépendantes, désactivation KMS, clé restée active, état `PENDING`, expiration, signature vérifiée, écrasement S3, relecture S3, isolement du détenteur, nom du bac à sable, base explicite, MAC stable, aller-retour de la clé de données, motif `ASIA` ; gardes transverses : 594 tests verts, `tsc`, `eslint`, `prettier` propres (relecture) |
| WP12 | Attestations | 3 mutations de borne rouges (exception étendue à toute racine, à la feuille, révocation) ; échantillon de 7 points Android et 7 points Apple vérifié contre les documentations (relecture) |
| WP13 | Consignation | 4 mutations de la garde (ci-dessus) |

## Par exigence

| Exigence | Lot | Test | Commande | Résultat |
|---|---|---|---|---|
| FR-001 (port fidèle) | WP02, WP03 | `api/unit/psp/hmac-signature.spec.ts`, `fake-signal-psp-adapter.spec.ts`, `api/integration/topups/signal-relecture.spec.ts` | `npx jest test/unit/psp test/integration/topups` | verts (relancé par WP13) |
| FR-002, FR-003, FR-004 (Wave) | WP05 | `api/unit/psp/wave/wave-adapter.spec.ts` | `npx jest test/unit/psp/wave` | verts (relancé) ; signature `t + corps` sans séparateur, plusieurs `v1`, ±300 s |
| FR-005, FR-006 (PayDunya, signal) | WP06, WP03 | `paydunya-adapter.spec.ts` (« borne OP PayDunya (D2) »), `signal-relecture.spec.ts`, `real-adapters-credit.spec.ts` | `npx jest test/unit/psp/paydunya test/integration/topups` | verts (relancé) ; aucun crédit sans confirmation |
| FR-007, FR-008 (Stripe) | WP07, WP03 | `stripe-adapter.spec.ts`, `dispute-relecture.spec.ts` | `npx jest test/unit/psp/stripe test/integration/topups` | verts (relancé) ; 3-D Secure strict, litige relu |
| FR-009 (coffre) | WP08 | `api/unit/psp/aws/secrets-manager-store.spec.ts` | `npx jest test/unit/psp/aws` | verts (relancé) |
| FR-010 (KMS) | WP09 | `api/unit/kms/aws/aws-kms.spec.ts`, `api/unit/kms/kms-module.spec.ts` | `npx jest test/unit/kms` | verts (relancé) |
| FR-011 (S3) | WP09 | `api/unit/sealing/s3-seal-copy.spec.ts` | `npx jest test/unit/sealing` | verts (relancé) |
| FR-012 (attestations) | WP12 | `docs/passation-12b-1/attestations-comparaison.md` ; `api/unit/attestation/android.spec.ts` | `npx jest test/unit/attestation` | verts (relancé) ; deux écarts décidés par le porteur (OP-N202, OP-N203) |
| FR-013 (garde par service) | WP10 | `api/unit/external-services/production-enabled.spec.ts`, `api/unit/production-guard.spec.ts`, `api/unit/processes.spec.ts`, `api/unit/psp/psp-providers.spec.ts`, `api/unit/architecture.spec.ts` | `npx jest test/unit/external-services test/unit/production-guard.spec.ts test/unit/processes.spec.ts test/unit/psp test/unit/architecture.spec.ts` | verts (relancé) |
| FR-014 (essai par service) | WP11 | `api/unit/external-services/trial/trial.spec.ts` | `npx jest test/unit/external-services` | verts (relancé) ; **aucun essai réel** |
| FR-015 (paramètres à poser) | WP13 | revue de `docs/SERVICES-EXTERNES.md` §2.3 à 2.10 et §5 ; `consignation.spec.ts` | lecture ; `npx jest test/integration/invariants-cloture/consignation.spec.ts` | six services documentés (identifiants, clés, emplacement, adresse de notification, commande d'essai, levée) ; test vert |
| FR-016 (faux inchangés) | WP10, WP13 | `git diff` des fichiers `customer-auth`, `device-ca`, `device-tokens`, `apps/gateway/src` | `git diff --stat 825263fc..HEAD -- apps/api/src/customer-auth apps/api/src/device-ca apps/api/src/device-tokens apps/gateway/src` | différence vide ; seul commentaire ajouté dans `apps/gateway/test/e2e/production-refusals.spec.ts` (WP10) |
| NFR-001 (aucun réseau) | WP01 | `api/support/no-external-network.ts` (enregistré dans `jest.config.cjs`), `api/unit/psp/psp-http.spec.ts` | toute suite Jest | aucune suite n'a échoué par la garde ; **limite** : contournable par `lookup` (OP-N207) |
| NFR-002 (vecteurs, forgé, rejoué, hors délai) | WP02, WP05, WP07 | `hmac-signature.spec.ts`, `wave-adapter.spec.ts` (« hors délai (au-delà de 300 s, dans les deux sens) »), `stripe-adapter.spec.ts` | `npx jest test/unit/psp` | cas forgé, rejoué (notification identique) et hors délai testés ; **exemples publiés par les documentations : non établi par les notes** ; recherche du 27/11/2026 (décision du porteur du même jour) : la clause « lorsqu'elle en publie un » est sans objet pour Stripe et PayDunya ; PayDunya publie un exemple de hash incohérent avec `sha512(clé)` (OP-N212) |
| NFR-003 (aucun secret journalisé) | WP01, WP08, WP09, WP11 | `psp-http.spec.ts` (journal), `signal-relecture.spec.ts` (« aucun secret dans le journal »), `secrets-manager-store.spec.ts`, `aws-kms.spec.ts`, `trial.spec.ts` | `npx jest test/unit test/integration/topups` | verts ; mutations : journal des en-têtes, message du SDK dans l'erreur, fuite de la valeur lue |
| NFR-004 (délais bornés) | WP01, WP05 | `psp-http.spec.ts`, `wave-adapter.spec.ts` (création non rejouée, recherche d'abord) | `npx jest test/unit/psp` | verts ; mutation « rejeu de POST » |
| NFR-005 (crédit unique) | WP03, WP10 | `real-adapters-credit.spec.ts` (Wave, Stripe, PayDunya : 100 notifications identiques), `signal-relecture.spec.ts` | `npx jest test/integration/topups` | verts (relancé) |
| C-001 (contrat stable) | WP04 | `receive-psp-webhook-12b1.spec.ts`, `contract-additions-9b.spec.ts` ; `check.mjs` | `node tools/contract-stability/check.mjs` | 313 admises, 0 refusée ; ajout D9 seul (ADR-237) |
| C-002 (aucun faux en production) | WP10 | `production-guard.spec.ts`, `processes.spec.ts`, `psp-providers.spec.ts` | `npx jest test/unit` | verts ; PSP et coffre : indisponibles, démarrage permis (règle I1) ; KMS et copie : démarrage refusé |
| C-003 (écart PayDunya consigné) | WP06, WP13 | OP-N199 à OP-N201, ADR-238, `paydunya-adapter.spec.ts` (« borne OP PayDunya (D2) ») | `consignation.spec.ts` | verts |
| C-004 (dépendances épinglées) | WP01 | `package-lock.json`, `docs/08-pile-logicielle.md` | relecture WP01 | `axios` 1.21.1 et SDK AWS 3.1172.0 ; aucun script d'installation |
| C-005 (un droit par processus) | WP09, WP10 | `aws-kms.spec.ts`, `kms-module.spec.ts`, `processes.spec.ts` | `npx jest test/unit/kms test/unit/processes.spec.ts` | verts ; mutation `forCapabilities` exposant tout |
| C-006 (fichiers générés intacts) | tous | `check-generated.sh`, `git diff` | voir « Relancé par WP13 » | différence vide, « suites pgTAP à jour » |
| SC-001 (aucune étape de code) | WP13 | `docs/SERVICES-EXTERNES.md` §2.3 à 2.10 et §5 | lecture | chaque service : identifiants, clés, références ; aucune étape de code. **Aucun essai réel n'a validé les listes** |
| SC-002 (forgé, rejoué, hors délai refusés ; 0 crédit PayDunya sans confirmation) | WP02, WP03, WP06 | `hmac-signature.spec.ts`, `paydunya-adapter.spec.ts`, `signal-relecture.spec.ts` | `npx jest test/unit/psp test/integration/topups` | verts (relancé) |
| SC-003 (refus au démarrage, service nommé) | WP10 | `processes.spec.ts` (classe d'erreur exacte et élément fautif par processus), `production-guard.spec.ts` | `npx jest test/unit` | verts ; nuance : un PSP ou le coffre non listé reste indisponible et ne refuse pas le démarrage (analyse I1) |
| SC-004 (faux de fournisseurs non décidés inchangés) | WP10, WP13 | voir FR-016 | `git diff --stat` | différence vide |

## Retouches hors carte

Voir `docs/POINTS_OUVERTS.md` §16 (« Retouches hors carte relevées »). WP13 : aucune ; fichiers écrits : `docs/SERVICES-EXTERNES.md`,
`docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`, `PRD.md`, `PROMPTS-A-ENVOYER.md`, `consignation.spec.ts`, ce fichier et
`note-equipes.md`.

## Ce qui n'est pas établi

- Aucun essai contre un vrai service (OP-N206, OP-N209) : les adaptateurs sont « conformes à la documentation, à essayer ».
- Les exemples de signature publiés par les documentations ne sont pas cités par les notes (NFR-002).
- Le test de borne manque pour OP-N202 (chaîne RKP), OP-N203 (extensions Apple), OP-N207 (`lookup`), OP-N205 (instances
  multiples) et OP-N208 (transaction ouverte pendant la résolution du litige).
- Le résultat de la CI de la PR n'est pas établi à la date de ce document.
