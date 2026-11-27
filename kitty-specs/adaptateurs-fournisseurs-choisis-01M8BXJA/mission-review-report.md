# Revue post-fusion : adaptateurs-fournisseurs-choisis-01M8BXJA (mission 12b-1)

**Relecteur** : Claude Sonnet 5.5 (agent distinct des implémenteurs et relecteurs de lots) | **Date** : 2026-11-27
**Baseline** : `1aa8f05f` | **Fusion** : `52876ff5` (squash, code identique à la tête testée `7a9e43e6`) | **HEAD** : `48a8177c` | **Lots** : WP01 à WP13 (13 sur 13 `done`)
**Méthode** : lecture de spec, plan, interfaces, matrice d'acceptation, ADR-237 à 240, OP-N199 à OP-N212, journal d'événements ; relecture des trois correctifs postérieurs (`66860a7c`, `61054041`, `48a8177c`) ; relecture du code des gardes de production, de la configuration, du port et de l'adaptateur PayDunya, du client HTTP, du confirmateur de statut ; relance ciblée de tests sur `cashless_review12b1` (remise à zéro avant) ; une mutation sur `vendor-pin-bounds.spec.ts`.

## Verdict : PASS WITH NOTES

Aucun constat bloquant. Les écarts de sécurité ouverts (OP-N199 à OP-N212, ADR-237 à ADR-240) sont tous consignés. Les trois correctifs postérieurs sont cohérents (une réserve mineure par correctif). `PRODUCTION_ENABLED_SERVICES` est vide, la garde suit la règle I1, aucune migration, aucun `.sql` généré modifié, aucun appel réseau en test.

## Partie 1 : les trois correctifs postérieurs

### `66860a7c` (OP-N202 décidé, OP-N207 « proposé ») : cohérent
- `POINTS_OUVERTS.md` (ligne OP-N202, § 16), `DECISIONS_ADR.md` (ADR-239), `PRD.md` § 2.8, `note-equipes.md` : la formule « ne bloque pas la production, décision du porteur du 27/11/2026 » y figure partout ; la mention « proposition de l'Agent, en attente du porteur » a disparu d'OP-N202 et d'ADR-239 (grep : plus aucune occurrence). PROMPTS conserve « proposé, en attente du porteur » pour le seul durcissement d'OP-N207, comme voulu ; la ligne OP-N207 le dit aussi (« durcissement proposé (en attente du porteur) »).
- Test `consignation.spec.ts` : la ligne OP-N202 doit contenir « Décision du porteur : 27/11/2026 » et ne plus contenir « proposition de l'Agent » ; ADR-239 idem ; PROMPTS contient « proposé, en attente du porteur ». Le test contraint donc bien l'état des fichiers (non synthétique). Relancé : vert.
- Réserve (BAS) : OP-N202 reste un écart ouvert sans test de borne (chaîne RKP) ; c'est consigné (mission 12), la décision ne change que « bloque la production ».

### `61054041` (OP-N212, hash d'exemple PayDunya) : cohérent, une réserve de forme
- Éléments de la règle 3 : OP-N212 a une ligne dans le tableau (risque et état, « bloque la production : Oui, pour la mise en production de PayDunya », mission qui le lève : 12b, essai réel de `psp.paydunya`), une fiche au § 16 avec condition de levée (essai réel avant toute mise en production), un rattachement à ADR-238 (puce « Incohérence de l'exemple de hash »), un report dans `PRD.md` § 2.8 et `PROMPTS-A-ENVOYER.md` (12b), un test (`consignation.spec.ts`, 14 OP au lieu de 13, rattachement `'OP-N212': 'ADR-238'`, test dédié sur le tableau, la fiche, ADR-238, PRD et PROMPTS).
- Réserve (BAS) : la puce d'ADR-238 n'a pas les quatre libellés explicites « Risque / Raison / Mission qui le lève / Condition de levée » (elle les contient en substance : à confirmer à l'essai réel, mission 12b, avant mise en production). Le risque (rejet à tort de toutes les notifications PayDunya, ou à l'inverse une preuve d'origine mal comprise) n'est pas écrit. Le comportement est fermé par défaut (PayDunya hors liste ; la mauvaise comparaison refuse), donc sans effet de sécurité immédiat. Il n'existe pas de test de borne propre à OP-N212, et il ne peut pas en exister avant l'essai ; le test de consignation et celui de `PRODUCTION_ENABLED_SERVICES` vide en tiennent lieu.
- Extensions « OP-N199 à OP-N211 » vers « N212 » : vérifiées par grep sur `PRD.md`, `PROMPTS-A-ENVOYER.md`, `docs/`, `apps/api` et le dossier de la mission. Aucune extension fausse. Les occurrences restantes de « N211 » sont correctes ou historiques : ADR-240 « OP-N204 à OP-N211 » (OP-N212 est rattaché à ADR-238), journal de `status.events.jsonl` et cycle de relecture de WP13 (état du 27/11/2026 avant OP-N212), `docs/06-docs-status.md` (journal).

### `48a8177c` (`vendor-pin-bounds.spec.ts`) : correct, avec une limite à connaître
- La requête passe de `LIKE '%PIN%'` à une regex Postgres `(^|[^0-9a-fA-F])(PIN…)([^0-9a-fA-F]|$)` (métacaractères échappés), conservant l'exclusion `^[0-9a-f]{32,}$`.
- **Mutation refaite** (cinq insertions dans une table temporaire `public.mut_pin(c text)` juste avant l'assertion de la ligne « Aucune table … ne contient un PIN », puis `git checkout` du fichier et suppression de la table ; arbre propre) :
  - `{"pin":"418263","x":1}` : ROUGE (`public.mut_pin.c` trouvé) ;
  - `pin=418263;` : ROUGE ;
  - `abc418263def` (PIN collé à des lettres hexadécimales) : VERT (non détecté) ;
  - `a3f9418263b7c1` : VERT (non détecté, voulu : faux positif d'empreinte).
  La regex n'a donc pas laissé passer un PIN en clair entouré de guillemets, d'espaces ou de ponctuation.
- Limite (BAS) : un PIN en clair **collé** à une lettre a-f ou à un chiffre (donc à une suite de 7 chiffres ou plus) n'est plus vu. Le contrôle est moins strict qu'avant sur ce cas. Un PIN écrit sans séparateur dans une journalisation (par exemple `id418263`) échapperait. Cet affaiblissement d'un test de borne (OP-N151) n'a ni OP ni ADR, seulement un commentaire dans le test ; à cause de la règle 1 de `CLAUDE.md`, je le signale au porteur. Non bloquant : le test garde les contrôles de journaux (`captured.includes(p)`) et de corps de réponse, qui eux cherchent la sous-chaîne brute.
- Relancé : `consignation.spec.ts` 132 verts et `vendor-pin-bounds.spec.ts` 3 verts (135 au total) sur `cashless_review12b1`.

## Portes (projet NestJS/Postgres, adaptées)
| Porte | Commande | Résultat |
|---|---|---|
| Contrat | `node tools/contract-stability/check.mjs` | 313 différences, 313 admises, 0 refusée (exit 0) |
| Tests du contrat | `node --test tools/contract-stability/*.test.mjs` | 42 pass, 0 fail |
| Lint | `npm run lint` | exit 0 |
| Types | `npm run typecheck` | exit 0 |
| Fichiers générés | `bash packages/ledger-sql/scripts/check-generated.sh` | « suites pgTAP à jour » (exit 0) |
| Migrations / `.sql` | `git diff --name-status 1aa8f05f..HEAD` filtré sur migrations, `.sql`, `scenario_reference`, `gen_*` | aucun ; seuls `openapi.yaml` et `generated/openapi.ts` du contrat bougent (D9, ci-dessous) |
| Registre de tickets (issue-matrix) | sans objet | aucun fichier ; pas de ticket GitHub référencé |
| Batterie complète | non relancée ici (consigne) | 4930 verts + 2 échecs connus verts seuls (preuves de l'orchestrateur sur `7a9e43e6`) |
| pgTAP | non relancé ici | aucune migration ni `.sql` modifié ; `check-generated.sh` à jour |

## Historique des lots
13 lots, tous `done`. Cycles de relecture : WP03 : 3 ; WP04, WP05, WP07, WP10, WP12, WP13 : 2 ; les autres : 1. Les 9 « force » du journal sont des retours en arrière (`in_review/approved/for_review -> planned`, un `approved -> for_review`) renvoyés par un cycle de relecture ; aucun contournement d'arbitre ni auto-approbation (0 `ReviewerSelfApproval`). Les constats de relecture ont tous une trace (mutations, tests, OP-N204 à OP-N211, ADR-240). `retrospective.yaml` existe dans le dossier de la mission. `docs/06-docs-status.md` a la ligne post-plan (26/11) et la ligne post-review (27/11).

## Couverture FR / NFR / C / SC
`acceptance-matrix.json` : 21 critères (FR-001 à FR-016, NFR-001 à NFR-005), tous `pass`, 6 invariants négatifs NI-001 à NI-006 confirmés absents. Les contraintes C-001 à C-006 et les critères SC-001 à SC-004 n'ont pas de ligne dans la matrice ; ils sont prouvés dans `docs/passation-12b-1/preuves.md` (lignes C-001 à C-006, SC-001 à SC-004).

| Exigence | Preuve (relue) | Adéquation |
|---|---|---|
| FR-001 port par fournisseur | `hmac-signature.spec.ts`, `fake-signal-psp-adapter.spec.ts`, `signal-relecture.spec.ts` ; port à deux verdicts (signature / signal) | ADEQUATE |
| FR-002 à FR-004 Wave | `wave-adapter.spec.ts` (vecteur publié par docs.wave.com, rotation, hors délai deux sens, création non rejouée, relevé 31 jours) ; 8 mutations rouges | ADEQUATE (aucun essai réel : OP-N206) |
| FR-005, FR-006 PayDunya | `paydunya-adapter.spec.ts`, `signal-relecture.spec.ts` ; comparaison `data[hash]` en temps constant (`timingSafeEqual`, code relu) ; aucun crédit sans `getStatus` | ADEQUATE, sous réserve OP-N212 |
| FR-007, FR-008 Stripe | `stripe-adapter.spec.ts` (13 puis 5 mutations), `dispute-relecture.spec.ts` ; 3-D Secure strict (`attempt_acknowledged` non crédité) | ADEQUATE (OP-N205, OP-N208) |
| FR-009 Secrets Manager | `secrets-manager-store.spec.ts` (préfixe détenteur, segment vide, précédent) | ADEQUATE (mineur : segment « . » non testé, consigné) |
| FR-010, FR-011 KMS, S3 | `aws-kms.spec.ts`, `kms-module.spec.ts`, `s3-seal-copy.spec.ts` (COMPLIANCE, `If-None-Match`, empreinte) | ADEQUATE (mineurs consignés) |
| FR-012 attestations | `android.spec.ts`, `attestations-comparaison.md` | PARTIAL : bornes manquantes OP-N202 (RKP) et OP-N203 (extensions Apple), consignées et décidées |
| FR-013 garde par service | `production-enabled.spec.ts`, `production-guard.spec.ts`, `processes.spec.ts`, `psp-providers.spec.ts`, `architecture.spec.ts` | ADEQUATE |
| FR-014 commande d'essai | `trial.spec.ts` (serveurs locaux, refus `NODE_ENV=production`, clés KMS désactivées en `finally`) | ADEQUATE (jamais exécutée contre un vrai service : OP-N206/N209) |
| FR-015 liste des paramètres | `docs/SERVICES-EXTERNES.md` §§ 2.3 à 2.10 et 5 ; lecture | ADEQUATE (preuve manuelle ; non validée par essai réel) |
| FR-016 non décidés inchangés | différence vide sur `customer-auth`, `device-ca`, `device-tokens`, `apps/gateway/src` | ADEQUATE |
| NFR-001 réseau | `no-external-network.ts` en `setupFiles`, `psp-http.spec.ts` ; batterie complète sans échec dû à la garde | ADEQUATE (OP-N207) |
| NFR-002 vecteurs | Wave : vecteur publié ; Stripe et PayDunya : sans exemple vérifiable ; cas forgé, rejoué, hors délai testés pour les trois ; décision du porteur du 27/11/2026 | ADEQUATE par décision |
| NFR-003 secrets | `psp-http.spec.ts`, `aws-kms.spec.ts`, `trial.spec.ts` (`looksSecret`), `signal-relecture.spec.ts` | ADEQUATE |
| NFR-004 délais | `psp-http.spec.ts` (délai, 2 nouveaux essais au plus, POST non rejoué) | ADEQUATE |
| NFR-005 crédit unique | `real-adapters-credit.spec.ts` (100 notifications parallèles, vraie base, trois PSP) | ADEQUATE (OP-N205) |
| C-001 contrat | `receive-psp-webhook-12b1.spec.ts`, `contract-additions-9b.spec.ts`, `check.mjs` | ADEQUATE (voir N3) |
| C-002 aucun faux en production | voir « Règle I1 » | ADEQUATE |
| C-003 PayDunya consigné | OP-N199 à OP-N201, ADR-238, `paydunya-adapter.spec.ts` (« borne OP PayDunya (D2) ») | ADEQUATE |
| C-004 dépendances | `axios` 1.21.1 et SDK AWS 3.1172.0 épinglés, aucun script d'installation (relu par WP01) | ADEQUATE |
| C-005 un droit par processus | `forCapabilities`, mutation « expose tout » rouge | ADEQUATE |
| C-006 `.sql` intacts | `check-generated.sh` exit 0 ; aucun `.sql` ni migration dans le diff | ADEQUATE |

## Vérifications transverses
- **`PRODUCTION_ENABLED_SERVICES` vide** : `production-enabled.ts` : `= []` ; `production-enabled.spec.ts` : `expect(PRODUCTION_ENABLED_SERVICES).toEqual([])` et borne « un service listé exige un compte rendu réussi ». OK.
- **Règle I1** (absent = `real`, `fake` posé = refus, `real` hors liste : PSP et coffre indisponibles, démarrage permis ; KMS et copie des scellements : démarrage refusé) : relue dans `config.ts` (`externalMode` : `fake` en production lève ; `AWS_ENDPOINT_URL` refusé en production ; adresses non `https` refusées), `psp.providers.ts` (registre vide si aucun service listé ; seuls les adaptateurs listés sont construits ; coffre `Unavailable…` hors liste), `kms.module.ts` et `sealing.module.ts` (`UntriedInProductionError`). `assertNoFakeInProduction` ajoute le refus d'un adaptateur réel non listé pour les fournisseurs qui exposent `service`. Conforme.
- **Aucun appel réseau en test** : `test/support/no-external-network.ts` (`setupFiles` de `jest.config.cjs`) refuse tout hôte hors 127.0.0.1, ::1, localhost au niveau de `net.Socket#connect` et `dns.lookup`. Limite consignée : OP-N207 (`options.lookup` personnalisé), sans test. La batterie complète n'a eu aucun échec dû à la garde.
- **Aucun secret dans le dépôt** : grep (`AKIA…`, `ASIA…`, `whsec_…`, `sk_live_…`, `rk_live_`, clés privées PEM) : seules des valeurs de test manifestes (`AKIAFAKEFAKEFAKEFAKE` du faux KMS, `AKIAIOSFODNN7EXAMPLE` d'AWS, `sk_live_CANARY…`, `sk_live_TRES_SECRETE`, `sk_live_x` de tests de non-fuite, `sk_live_51Habcdef` d'un test pgTAP de refus, clés PEM générées à l'exécution par les tests de la passerelle). Aucune vraie clé.
- **Contrat (D9)** : `openapi.yaml` modifié (contenu `application/x-www-form-urlencoded` réservé à `paydunya`, descriptions des preuves d'origine) ; ajout rétrocompatible, trois pointeurs admis, ligne « Décision du porteur : 26/11/2026 » d'ADR-237 lue par `check-baseline-decision.mjs`.

## Écarts de sécurité ouverts (règle 4)
Tous consignés : tableau de `POINTS_OUVERTS.md` § 15/16, ADR-237 à 240, reports dans `PRD.md` § 2.8 et `PROMPTS-A-ENVOYER.md`, garde `consignation.spec.ts` (présence de chaque OP-N199 à OP-N212, rattachement à un ADR, tests cités existants).

| Écart | Entrée | Nature | Bloque la prod ? | Test de borne (ou manquant nommé) | Levé par |
|---|---|---|---|---|---|
| OP-N199 : preuve d'origine PayDunya = valeur fixe, sans signature du contenu ni horodatage | ADR-238 | contrôle plus faible, décidé le 26/11 | Non (PayDunya hors liste : OP-N209) | `paydunya-adapter.spec.ts` « borne OP PayDunya (D2) », `signal-relecture.spec.ts` (100 signaux : une relecture, un crédit) | aucune mission ; réexamen à l'essai |
| OP-N200 : carte PayDunya non créditée (pas de preuve 3-D Secure) | ADR-238 | fonctionnel (échec sûr) | Non | `paydunya-adapter.spec.ts` « carte jamais déclarée 3-D Secure (D7) » | porteur, après l'essai |
| OP-N201 : ni relevé, ni annulation, ni remboursement PayDunya | ADR-238 | rapprochement manuel | Non | « sans appel : non annulé, relevé non pris en charge » | si PayDunya publie un relevé |
| OP-N202 : exception Android, certificats d'usine expirés sous la racine `f92009e853b6b045` | ADR-239 | droit plus large décidé | Non (décision du 27/11) | `android.spec.ts` (racine unique, feuille expirée refusée, révoqué refusé) ; **test RKP manquant, nommé** | mission 12 |
| OP-N203 : extensions Apple App Attest non contrôlées | ADR-239 | contrôle reporté | Non (décision du 27/11) | assertion 7 et 8 absente, **nommée** ; accès iOS à `/media/auth-keys` refusé (OP-N64) | mission 12 (vecteur réel) |
| OP-N204 : Wave sans clé d'idempotence | ADR-240 | limite | Non | `wave-adapter.spec.ts` (création non rejouée, recherche `client_reference`) | essai réel Wave |
| OP-N205 : relectures Stripe en mémoire de processus | ADR-240 | borne multipliée par les instances | Non | test de borne par minute ; **test multi-instances manquant, nommé** | mesure à la recette, puis porteur |
| OP-N206 : points « à confirmer à l'essai » | ADR-240 | non établi | Oui, par service (garde, OP-N209) | `production-enabled.spec.ts` | essais du porteur |
| OP-N207 : garde réseau des tests contournable par `lookup` | ADR-240 | test | Non | **test manquant, nommé** (`no-external-network.spec.ts`) ; durcissement « proposé, en attente du porteur » | mission 13 |
| OP-N208 : litige Stripe rattaché par relecture, sans test de transaction ouverte | ADR-240 | limite, échec sûr | Non | **test manquant, nommé** ; mutation survivante | mission 13 |
| OP-N209 : aucun service réel en production, liste vide | ADR-240 | faux/réel gardé | Oui | `production-enabled.spec.ts`, `processes.spec.ts`, `architecture.spec.ts` (preuve d'injection pour `S3SealCopy` seul) | essai réel puis PR relue |
| OP-N210 : commande d'essai, rétention S3 3 650 j COMPLIANCE par défaut ; références KMS non affichées si la désactivation échoue | ADR-240 | limite d'outil | Non | `trial.spec.ts` | porteur, à l'essai |
| OP-N211 : mineurs des relectures | ADR-240 | divers | Non | liste au § 16 | mission 13 |
| OP-N212 : exemple de hash PayDunya incohérent avec `sha512(clé)` | ADR-238 | incertitude sur la preuve d'origine | Oui, pour PayDunya en production | `consignation.spec.ts` ; pas de test de borne possible avant l'essai | essai réel (12b) |
| ADR-237 D9 : ajout au contrat | ADR-237 | contrat, rétrocompatible | Non | `contract-additions-9b.spec.ts`, `check.test.mjs` (313) | sans objet |

Renforcements faits puis consignés : Stripe 3-D Secure strict, corps brut d'un signal non conservé, session Stripe d'une autre recharge refusée, recherche Wave filtrée, faux refusé à la fabrique, sortie d'essai sans secret, adresses non `https` refusées en production, `AWS_ENDPOINT_URL` refusé en production.

## Constats
Aucun bloquant (CRITIQUE ou ÉLEVÉ).

- **N1 (BAS)** : `vendor-pin-bounds.spec.ts` n'écarte plus seulement les empreintes : un PIN en clair collé à des caractères hexadécimaux n'est plus vu (mutation `abc418263def` verte). À signaler au porteur (règle 1) ; aucun OP ni ADR. Option : ne tolérer que les chiffres voisins et une ponctuation, ou consigner une ligne dans OP-N211.
- **N2 (BAS)** : ADR-238 (puce OP-N212) n'a pas les quatre libellés de la règle 3, et le risque n'y est pas écrit (voir plus haut). Fermé par défaut, sans effet immédiat.
- **N3 (BAS)** : C-001 demande de présenter un ajout au contrat au porteur avant de le coder ; ADR-237 D9 le consigne comme décision du 26/11/2026 (ligne lue par `check-baseline-decision.mjs`). Le fichier `tools/contract-stability/contract-baseline.json` est à faire relire (voir ci-dessous).
- **N4 (BAS)** : la matrice d'acceptation n'a pas de lignes C-001 à C-006 ni SC-001 à SC-004 (prouvés dans `preuves.md`). La note de NFR-002 commence par « EN ATTENTE » alors que le critère est `pass` par décision du porteur du 27/11/2026, et elle dit « OP à ajouter après la consolidation » (OP-N212 existe maintenant) : cosmétique, `evidence` fait foi.
- **N5 (BAS)** : aucun test ne couvre le contrôle des sorties du client HTTP réel vers une vraie adresse : normal (aucun essai réel), c'est OP-N206. FR-002 à FR-011 sont prouvés contre des serveurs locaux seulement ; la conformité aux fournisseurs repose sur la lecture des documentations du 26/11/2026.
- **N6 (BAS)** : la garde réseau de test ne couvre pas la commande d'essai (`npm run essai`), qui parle volontairement au réseau ; elle refuse `NODE_ENV=production` et ne tourne qu'à la demande du porteur.
- **N7 (info)** : `bash check-generated.sh` et les suites pgTAP ne sont pas relancés ici au-delà de la vérification de génération ; aucune migration n'est ajoutée.

## Fichiers à faire relire par une personne
Aucune relecture indépendante n'a eu lieu : l'agent qui a écrit le code ne vaut pas relecture. À faire relire :
- `tools/contract-stability/contract-baseline.json` et `packages/contracts/openapi.yaml` (D9, ADR-237).
- `apps/api/src/external-services/production-enabled.ts` (liste blanche des services, unique levier de mise en production) et `apps/api/src/kms/production-guard.ts`, `apps/api/src/config/config.ts`, `apps/api/src/psp/psp.providers.ts`, `apps/api/src/kms/kms.module.ts`, `apps/api/src/sealing/sealing.module.ts` (règle I1).
- `apps/api/src/psp/paydunya/paydunya-adapter.ts` (preuve d'origine, comparaison du hash) et `apps/api/src/topups/psp/psp-status-confirmer.ts` (seule voie de crédit après un signal).
- `apps/api/src/psp/wave/wave-adapter.ts`, `apps/api/src/psp/stripe/stripe-adapter.ts`, `apps/api/src/psp/hmac-signature.ts` (signatures de notifications, rotation de secrets).
- `apps/api/src/kms/aws/aws-kms.ts` (MAC, signature, clé de données, `forCapabilities`), `apps/api/src/sealing/s3-seal-copy.ts` (COMPLIANCE, rétention 10 ans, irrévocable), `apps/api/src/psp/aws/secrets-manager-store.ts` (préfixe par détenteur, isolation entre détenteurs).
- `apps/api/src/external-services/trial/*` (commande d'essai : création de clés KMS et d'objets S3 irrévocables).
- Attestations : `apps/api/src/attestation/**` (exception Android à une racine, OP-N202) et le choix de ne pas contrôler les extensions Apple (OP-N203).
- Droits de la base : aucun changement (aucune migration), donc rien à relire de ce côté.

## Verdict : justification
Les 16 FR et 5 NFR de la spec sont tracés jusqu'à des tests qui passent par les chemins réels (adaptateurs, confirmateur, vraie base pour le crédit unique), avec des mutations consignées. Aucun faux ne peut démarrer en production et aucun service réel n'est activé (liste vide). Les écarts qui affaiblissent la sécurité (OP-N199, OP-N202, OP-N203, OP-N212) sont décidés par le porteur, consignés et gardés. Les réserves sont mineures : la tolérance accrue de `vendor-pin-bounds` (N1), la forme d'ADR-238 pour OP-N212 (N2) et les lignes de la matrice (N4). Aucun essai contre un vrai service n'a eu lieu : les adaptateurs ne sont pas prouvés face aux fournisseurs, et aucun n'a le droit de tourner en production.

### Éléments ouverts (non bloquants)
- Le porteur décide de la suite de N1 (resserrer la regex ou consigner la limite).
- Compléter la puce d'OP-N212 dans ADR-238 (risque, raison, condition de levée) lors d'une prochaine PR de documentation.
- Faire relire par une personne la liste ci-dessus avant d'ajouter le moindre service à `PRODUCTION_ENABLED_SERVICES`.

## Retrospective Reminder
Le fichier `kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA/retrospective.yaml` existe (écrit à la fusion). Suites possibles : `spec-kitty retrospect summary` (agrégation, lecture seule) et `spec-kitty agent retrospect synthesize --mission adaptateurs-fournisseurs-choisis-01M8BXJA` (propositions, à blanc par défaut), toujours sous `LC_ALL=C LANG=C`.

## Suite donnée par l'orchestrateur (27/11/2026)

- **N1** : corrigé (renforcement). `findInDatabase` retire désormais seulement les empreintes (suites d'au moins 32
  caractères hexadécimaux) et les UUID avant de chercher le PIN : un PIN en clair collé à des lettres
  (`abc418263def`, `a3f9418263b7c1`) est de nouveau détecté ; empreinte et UUID contenant 6 chiffres écartés
  (vérifié en SQL sur 7 cas). Relecture distincte demandée.
- **N2** : puce d'OP-N212 dans ADR-238 complétée (risque, raison, mission qui le lève, condition de levée).
- **N4** : note de NFR-002 de la matrice mise à jour (OP-N212 cité). Lignes C-001 à C-006 et SC-001 à SC-004 non
  ajoutées : prouvées dans `docs/passation-12b-1/preuves.md`.
- **N3, N5, N6** : connus et consignés (ADR-237 pour D9, OP-N206, commande d'essai), aucune action.
