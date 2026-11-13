# WP25 - relecture : verdict REFUSE (un constat bloquant, correction courte)

## Bloquant

1. Le job CI `gateway-e2e` ne prouve pas les volumes exigés par la DoD de T114. `M8_E2E_LONG` n'est posé ni dans
   `.github/workflows/ledger-tests.yml` ni dans `.github/CI.md` ; `load-support.ts:21` (`LONG = M8_E2E_LONG === '1'`)
   fait donc tourner `exclusion-under-load.spec.ts:31` avec 3 bascules (le prompt exige au moins 20, SC-002 dit
   100 % des essais) et `release-10000.spec.ts:15` avec 2 000 opérations au lieu de 10 000 (NFR-002, SC-003).
   Le fichier s'appelle release-10000 et la matrice d'acceptation le cite pour NFR-002/SC-003 : la preuve de la CI
   est plus faible que celle annoncée, sans consignation (aucun OP, aucun ADR, rien dans CI.md). Exclusion des
   débits = propriété de sécurité (double dépense).
   Correction attendue : poser `M8_E2E_LONG: "1"` dans l'`env` du job `gateway-e2e` (délai de 90 min suffisant :
   10 000 opérations mesurées à 6,6 min), ajouter à `ci-workflow.spec.ts` une règle (+ mutation de sensibilité) qui
   échoue si `M8_E2E_LONG` n'est pas "1" dans ce job, et une ligne dans CI.md. Sinon : consigner l'écart
   (OP + ADR + report PROMPTS/PRD) et le soumettre au porteur avant la fusion.

## Non bloquant (à traiter ou à consigner)

2. `ci-workflow.spec.ts` ne voit pas l'affaiblissement d'une étape par la forme de sa commande. Mutations sur copie
   du workflow, test resté vert (13/13) : `node tools/contract-stability/check.mjs || true` ; retrait de
   `--exit-code 1` du second appel Trivy ; `--passWithNoTests` sur gateway-integration ; `|| true` sur le jest e2e ;
   `if: false` sur le job `gateway-e2e`. Les règles ne contrôlent que présence et `continue-on-error`. Ajouter :
   interdiction de `|| true`, `if:`, `--passWithNoTests`, et présence de `--exit-code 1` sur le balayage.
3. Seuil du balayage Trivy : seule une vulnérabilité CRITICAL corrigeable bloque (HIGH informatif). A soumettre au
   porteur (déjà signalé par l'implémenteur).
4. Docs (hors carte, à traiter par l'orchestrateur avant la revue de mission) : OP-N115 à OP-N117 absents de
   PROMPTS-A-ENVOYER.md et PRD.md ; `consignation.spec.ts` ne l'exige que pour SECURITY_OPS. OP-N117 (levée par
   WP25) n'est pas levé. OP-N119 : levée annoncée par WP25 (lot vide + local_orders), état non mis à jour. ADR-187
   sans risque ni levée propres. Titres de tests de borne trop larges (`EDGE_REPLAY_FAILED|reprise`, `abandon`,
   `CENTRAL_UNCONFIRMED|accusé`) : ils peuvent correspondre à un commentaire.
5. `edgeDecisionOf` : pas de test unitaire REVERSAL ni d'opération sans montant avec décision falsifiée (le code est
   correct : `edge_decision` du terminal toujours retirée, raisons admises identiques à l'énumération d'openapi et à
   la liste de la 0070). VOID avec montant hostile : décision à 0, le central la refuse (DECISION_INCONSISTENT).
6. Canari (NFR-010) : pas de canari « clé de jeton » (seulement PWD||PACK, jeton de rafraîchissement, jeton d'accès) ;
   le contrôle positif ne plante pas de fuite dans le flux central.
7. Un test e2e en échec laisse les bases `cashless_m8_*` (afterAll bloqué 600 s : générateurs de charge non arrêtés).
8. `env-setup.cjs` / `assertClusterPort` : `PGPORT=080` passe le contrôle (chaîne comparée à '80'). Sans conséquence ici.
9. CI.md : en-tête (« un seul job », « 20 minutes ») périmé ; le job `ledger` est à 45 min.
