---
affected_files: []
cycle_number: 2
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T14:03:00Z'
reviewer_agent: claude
wp_id: WP14
---

# WP14 — nouveau cycle : batterie complète (orchestrateur, 17/11/2026)

Batterie complète sur lane-n (`cashless_test`, pgTAP puis `SKIP_LATENCY=1 npx jest --maxWorkers=2`) :
pgTAP vert (79 fichiers, 6 872 tests). Jest : 345 échecs dans 36 suites. Après relance en série des
suites en échec, il reste 5 suites en échec réel, plus la cause de la cascade. Toutes sont des suites
existantes cassées par la mission. Ne jamais affaiblir une condition de la base pour faire passer un test :
adapter le test à la règle nouvelle. WP14 porte la fusion de toutes les lanes, donc ces retouches se font ici,
hors carte, chacune listée dans la note de lane.

## 1 (bloquant) — suites qui recréent la base partagée
`test/integration/controls/controls-alerts.spec.ts` et `test/integration/sealing/seal-and-verify.spec.ts`
(WP12) appellent `resetDatabase()`. En passe parallèle, elles détruisent la base des autres travailleurs.
D'où des centaines d'erreurs `relation "party" does not exist` et `database "cashless_test" does not exist`.
La CI casserait aussi. Correction : ces suites ne doivent plus recréer la base partagée. Option préférée :
retirer `resetDatabase()` et rendre la suite autonome (données propres à un prestataire du test, nettoyage
ciblé). Option de repli, déjà pratiquée par le projet : écarter ces suites par `SKIP_LATENCY` et les lancer
seules en série dans le workflow de CI (`.github/workflows`). Dans ce cas, le dire dans la note.

## 2 (bloquant) — rejeux du scénario de référence
`test/scenario/replay.spec.ts` et `test/scenario/api-config-replay.spec.ts` :
« passage RECONCILING avant T25 refusé (CL019) : 1 session(s) de caisse ouverte(s) » (condition héritée
A32), puis clôture refusée (« Étapes de clôture à faire : PITCH_FEES, OPERATOR_FEE, PLATFORM_FEE »).
Les rejeux doivent fermer les sessions de caisse avant `RECONCILING` et exécuter les étapes de clôture de la
mission. Les soldes finaux restent égaux au scénario (`after_closing`), et le second rejeu, sur un grand livre
verrouillé, n'écrit toujours rien. Le test « chaque transaction porte la version de configuration (> 40) »
doit repasser, sans baisse du seuil (ou avec une baisse justifiée par le compte réel, à dire dans la note).

## 3 (bloquant) — `test/integration/events/participations.spec.ts`
« après LIVE et jusqu'à CLOSED : plus d'inscription ni de modification (409) » échoue au passage à `CLOSED`
(étapes de clôture à faire). Adapter la préparation (étapes exécutées, ou événement sans montant à
clôturer), sans contourner `set_event_status`.

## 4 (bloquant, sécurité) — balayages d'isolation
`end-to-end/configuration-isolation.spec.ts` (attend 48 opérations, en reçoit 56 :
`bodies[route.operationId] is not a function`) et `end-to-end/media-isolation.spec.ts` (attend 47) :
leur sélection d'opérations par le contrat prend maintenant les routes ajoutées par la 9b. Ne te contente pas
de changer les nombres. Chaque nouvelle route doit avoir un cas d'isolation, soit dans ces balayages (corps
de requête ajoutés), soit dans un balayage 9b dédié. Dans le second cas, restreins la sélection de ces
suites aux opérations de leur mission, par une liste figée explicite, et prouve que le balayage 9b couvre
les 20 opérations de `contract-additions.md` (test qui échoue si une opération du contrat n'a pas de cas).

## Preuve attendue
Après `reset-db` sur `cashless_wp14`, une passe parallèle complète `SKIP_LATENCY=1 npx jest
--maxWorkers=2 --forceExit`, avec toutes les `DATABASE_URL*` sur `cashless_wp14`, verte, exception faite
des instabilités connues de la fiche. Lance aussi à part les suites sorties par `SKIP_LATENCY` qui te
concernent. Donne le décompte final dans le compte rendu.
