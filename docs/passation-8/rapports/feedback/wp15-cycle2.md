# WP15 - relecture cycle 2

Constats 1 a 3 du cycle 1 LEVES. Mutations rejouees sur cashless_wp15, tests du lot : 6 suites, 18 tests verts, git diff vide.
- ORDER BY created_at DESC : echoue (pack-worker-bounds, vecteur HKDF recalcule dans le test, deux cles d'ages differents).
- AAD v1 -> v2 : echoue (vecteur litteral ASCII dans le test).
- liste ignoree / vide : echoue (2 tests dont pack-canary) ; UUID mal forme accepte : echoue ; unreadable.add retire : echoue.
- Bracelet illisible : un bracelet lisible n'est pas perdu (2 colis deposes, 1 illisible journalise une fois).

## Constat bloquant restant (CLAUDE.md regle 3 : dette nommee)

1. **Limite de 200 bracelets illisibles non consignee.** Si une page (PACK_PAGE = 200) ne contient que des bracelets
   illisibles, `serve()` s'arrete (media.length === 0) et les bracelets lisibles au-dela de la page ne sont jamais
   servis ; chaque illisible est journalise, mais aucun message n'annonce le colis manque. Ni ADR-184, ni
   docs/POINTS_OUVERTS.md, ni le code (edge-packs.service.ts, module) ne mentionnent cette borne (constat 8 du cycle 1).
   Correction attendue : consigner la borne (ADR-184 "Risque" ou entree POINTS_OUVERTS, avec condition de levee :
   exclure les illisibles dans la requete ou journaliser "page entierement illisible") ; un message de journal
   "page entierement illisible, colis restants non servis" serait un plus. Aucun changement de logique exige.
2. (mineur, a consigner) `register --ledger` non verifie contre l'evenement (constat 5 du cycle 1) : aucune trace trouvee
   dans les limites connues.
