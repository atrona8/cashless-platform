# Relecture post-approbation WP25 (0672717d, 82b25713) : APPROUVÉ
Fichiers changés (4, rien d'autre) : debit-paths.ts, payments.service.ts, payments-edge-early-refusal.spec.ts (nouveau), exclusion-under-load.spec.ts.
Garde après étape 3 (assert_device_active + session), avant lecture du bracelet : priorités mode/devise/époque/heure/terminal/session inchangées. CL006 intacte. Même ProblemException -> même filtre (edge_base_url), même relâche de clé.
Course : lecture dans la transaction après verrou terminal ; bascule vers EDGE après lecture -> CL006 ; retour à CENTRAL après lecture -> refus rejouable (disponibilité), jamais d'écriture à tort.
Non bloquants : (1) debit-paths.ts cite payments.service.ts:123 (commentaire ; le throw est ligne 124) et :165 (commentaire ; l'appel moteur est ligne 166). (2) en-tête du spec dit "dès l'étape 2" / "étape 1", la garde est après l'étape 3. (3) la mutation ne fait échouer que le test 1 (le test 2 passe grâce à CL006, attendu).
Mutation : garde remplacée par 'XEDGE' -> 1 échec / 3 (test "aucun register_tap") ; remise en place, git propre. Suite : 3/3. test/integration/edge : 38 suites, 265 tests verts.
Sensibilité NFR-001 : non exécutée (e2e hors périmètre) ; lecture : la vente utilise seqKey() et assert 201 PURCHASE, le débit source API après W reste détecté par la requête non bornée.
