---
affected_files: []
cycle_number: 1
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-26T14:17:00Z'
reviewer_agent: claude
wp_id: WP04
---

# Relecture WP04 (commit 18353321) : a corriger

Le contrat est conforme (trois changements exacts, empreintes recalculees identiques, `check.mjs` 0 refus, `npm run check`
du paquet vert, test de gel a mutations). Mais le commit casse deux gardes existantes, hors `owned_files`, non signalees.

## Constats bloquants
1. `tools/contract-stability/check.test.mjs` l. 156 : `assert.match(out, /310 admise\(s\), 0 refusée/)` echoue (313 apres
   WP04). `node --test tools/contract-stability/` : 57 pass, 1 fail. Mettre 313 et completer le commentaire l. 152-155
   (+3 : description de l'operation, contenu formulaire, description de `pspHmac`, mission 12b-1 / D9).
2. `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` l. 315 (« ne modifie ni ne retire rien d existant ») echoue :
   les trois differences D9 ne sont pas dans la liste d'exemptions (voir `ADDED_BY_11B`, l. ~305-314). Ajouter une
   liste D9 limitee a ces trois pointeurs exacts (pas de motif large).
Ces deux fichiers sont hors carte : retouche de gardes imposee par le changement, a nommer dans la note de lane.
Relancer ensuite `npx jest test/unit/contracts test/unit/architecture.spec.ts` (tout vert) et `npm run check:stability`.

## Mineur (non bloquant, a consigner)
- Description de `pspHmac` : le texte conserve dit « t + "." + corps_brut (Wave : meme format) », ce qui contredit le point 1
  (Wave : horodatage + corps SANS separateur, research.md R-03). Ne pas reecrire ici (l'ajout seul etait permis) ;
  noter en point ouvert / ADR de WP13 pour correction par le porteur.
- « aucune ecriture a la reception » (PayDunya) vs conservation du corps brut (point 3) : a trancher au WP06.
