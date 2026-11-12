---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-09T10:43:13Z'
reviewer_agent: claude
wp_id: WP18
---

# Relecture WP18, rejet n° 1

## B1 (bloquant, argent) : purge des deltas ACCEPTED page par page : solde effectif surestimé
`delta-purge.ts` `onPageApplied` (appelé à CHAQUE page par `page-applier.ts`) supprime tout delta
d'`edge_seq <= page.edge_seq_applied` pour une opération ACCEPTED. Or `edge_seq_applied` est lu par le
central dans le snapshot de la page, alors que les soldes d'une page sont limités à la tranche de postings
(`to_posting_id`, `limit`). Un portefeuille dont le posting est au-delà de la page 1 n'est pas servi par la
page 1, mais son delta est déjà purgé : solde effectif trop haut jusqu'à la page suivante, et sans borne si
le lien tombe en milieu de passe (cas offline typique).
Preuve (test jetable, retiré) : central_paid 1000, delta -400 ACCEPTED, page non finale
(`has_more: true`, `edge_seq_applied` = seq, autre portefeuille seul) : solde effectif lu = 1000 (vrai : 600).
Correction attendue : ne purger que ce que le solde répliqué du portefeuille couvre, par exemple
`DELETE ... USING edge_wallet w WHERE w.wallet_id = d.wallet_id AND d.edge_seq <= w.applied_edge_seq`
(la lecture `effectiveBalance` utilise déjà `applied_edge_seq` par portefeuille : elle est juste), ou ne purger
qu'à la dernière page. Idem `onOpResult` (ACCEPTED), qui compare à `last_edge_seq_applied` global : le comparer à
`edge_wallet.applied_edge_seq` du portefeuille du delta. Ajouter un test « page non finale qui couvre
`edge_seq` sans porter le portefeuille : le delta reste, le solde effectif ne remonte pas ».

## B2 (bloquant, règle « aucun faux en production ») : le test de garde survit à la mutation
`evaluateProviderRules` ne contrôle `catchUp` que si la clé est présente (`'catchUp' in providers`) ; les
tests de `production-guard.spec.ts` appellent la fonction directement. Mutation faite : retirer `catchUp` de
l'appel dans `bootstrap.ts` (`assertRuntimeSafe`) ne fait échouer aucun test (test/replication/production-guard +
test/startup : 138/138 verts avec la mutation). La garde réelle peut donc disparaître sans bruit.
Correction attendue : rendre `catchUp` obligatoire dans la signature (mettre à jour les appelants de test) et ajouter
un test qui passe par `assertRuntimeSafe` (application Nest de test en configuration de production avec le bouchon
`unavailableCatchUp`, puis sans fournisseur) et attend `StartupRefusedError`.

## Mineurs
M1. `pwd-pack-key.spec.ts` « contrôle positif » ne teste que `variants()` sur une chaîne littérale : il ne prouve pas
que le détecteur échoue si le code journalise le canari. Brancher un journal fautif réel (ou injecter `logger.warn(canari)`)
et vérifier que la même assertion de `haystack` échoue.
M2. Rétrogradation PRIMARY -> STANDBY : `edge_pwd_pack_key` et les `pwd_pack_enc` déjà stockés restent (vérifié :
1 clé, 1 colis après passage en STANDBY). A16 vise la STANDBY non promue ; à consigner (POINTS_OUVERTS) ou purger au
changement de rôle.
M3. `usable_on_edge` : une session vue pendant `activated_at IS NULL` (entre l'octroi et l'accusé) devient
`true` (COALESCE) et n'est jamais réévaluée ; R-24 dit « ouverte avant la bascule ». Fenêtre étroite ; comparer à
l'heure centrale d'octroi, ou figer à l'activation.
M4. edge-0003 : `media_id` nullable est acceptable (accepté sous réserve, décision 29), mais ajouter
`CHECK (media_id IS NOT NULL OR wallet_id IS NULL)` pour qu'une ligne non liée ne porte jamais de portefeuille ;
les lecteurs (WP21) doivent traiter `media_id IS NULL` comme non utilisable. `usable_on_edge` dérivé conforme à R-24
sauf M3.
M5. `to_posting_id` n'est borné que par le recul : un horizon qui saute loin devant (central défaillant) crée un
trou silencieux. Hors périmètre du lot, à noter pour WP08/WP25.
M6. `wallets[].kyc_verified` absent n'efface pas un `kyc_verified:true` déjà stocké (`limits || ...`).
M7. `applyHook` (panne injectée) est un champ public de la classe de production : sans effet hors test, mais préférer le
module `testing/failpoints.ts`.
