---
affected_files: []
cycle_number: 3
mission_slug: bracelets-nfc-01M4TD3W
reproduction_command:
reviewed_at: '2026-10-15T10:22:43Z'
reviewer_agent: claude
wp_id: WP20
---

# WP20 — réouverture après relecture (décisions du porteur, 15/10/2026)

WP20 avait été approuvé au cycle 2. L'addendum documentaire post-review a fait remonter des écarts que le porteur a tranchés le 15/10/2026. Il demande qu'ils soient corrigés **avant** `spec-kitty accept`. WP20 est rouvert parce que la lane t contient le code de tous les lots. Les retouches hors carte des lots 15 à 19 sont donc attendues ici, comme pour le commit 4e3407c.

## Constat 1 (bloquant, sécurité) : le jeton d'approbation sur place doit toujours être exigé (ADR-91)

**État actuel** : au guichet de retour, le jeton d'approbation sur place n'est exigé qu'au-delà de `cash_refund_single_max` (mode `optional` de la garde, `apps/api/src/approval/onsite/onsite-approval.ts`, `apps/api/src/media/lifecycle/release.controller.ts`). Ce contrôle affaibli a été codé avant l'accord du porteur, ce qui enfreint la règle 1 de CLAUDE.md.

**Décision du porteur** : le jeton est exigé pour **tout** remboursement en espèces, quel que soit le montant.

**Correction attendue** :
1. `releaseMedia` exige le jeton sur place dès qu'il y a un remboursement en espèces, quel que soit le montant.
2. Recense tous les autres usages du mode `optional` pour un remboursement ou un rendu d'espèces (notamment `cash-due.controller.ts` et `cash-due.service.ts`).
   - Si l'un d'eux affaiblit un contrôle que le plan ou la spécification exigeait, aligne-le sur la même règle.
   - S'il s'agit d'un comportement prévu par la spécification, ne le change pas et signale-le dans la note de passage en relecture.
3. Si le mode `optional` n'a plus aucun appelant, retire-le (sinon c'est du code mort).
4. Ajoute ou adapte les tests d'intégration :
   - un remboursement **sous** le seuil sans jeton est refusé ;
   - un remboursement avec jeton valide passe.
5. Mets à jour le contrat (`openapi.yaml`) si sa description de la garde change.

## Constat 2 (bloquant, production) : OP-N52, valideur d'une sortie de liste noire non vérifié par la base

**Correction attendue** :
1. Écris une **nouvelle migration**. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/` (CLAUDE.md) ; s'il faut changer le schéma de référence, passe par le mécanisme prévu du dépôt.
2. Avec cette migration, `reinstate_media` exige une `approval_request` `REINSTATE_MEDIA` **approuvée** pour ce bracelet. Son auteur et son valideur doivent concorder avec ceux de l'appel, et le valideur doit être distinct de l'auteur.
3. Le déclencheur refuse `BLACKLISTED → ACTIVE` hors de ce chemin. Si c'est plus sûr, retire `UPDATE (status)` sur `media` à `cashless_app` au profit de fonctions dédiées, sans casser les autres transitions.
4. Tests pgTAP :
   - sortie sans demande approuvée : refusée ;
   - demande approuvée avec un valideur inventé : refusée ;
   - `UPDATE media SET status='ACTIVE'` direct depuis `cashless_app` sur un bracelet `BLACKLISTED` : refusé ;
   - chemin nominal : passe.
5. Ajoute aussi un test Jest du chemin nominal par l'API.
6. Dans `docs/POINTS_OUVERTS.md`, passe OP-N52 à « levé », avec la référence de la migration.

## Constat 3 (bloquant, production) : OP-N53, limite par adresse sans `trust proxy`

**Correction attendue** :
1. Fixe explicitement la source de l'adresse : `trust proxy` borné au nombre de sauts du déploiement, par une variable de configuration validée au démarrage.
   - En production, une valeur absente fait **refuser le démarrage**. Pas de valeur par défaut permissive.
   - En développement et en test, une valeur sûre est autorisée (ex. `false` ou `loopback`).
2. Tests :
   - la 61ᵉ consultation de la même adresse dans l'heure donne 429 ;
   - deux adresses distinctes transmises par un proxy de confiance sont comptées séparément ;
   - un `X-Forwarded-For` falsifié au-delà du nombre de sauts ne contourne pas la limite ;
   - le démarrage en production sans la variable est refusé.
3. Documente la variable (`.env.example` ou l'équivalent du dépôt, `.github/CI.md` si la CI doit la poser).
4. Dans `docs/POINTS_OUVERTS.md`, passe OP-N53 à « levé ».

## Constat 4 (documentation) : décisions à consigner

1. **ADR-91** :
   - passe le statut à « Acceptée, 15/10/2026, décision du porteur » ;
   - décision : la **mission 9 sert l'enchaînement** des étapes du guichet de retour (le contrat `openapi.yaml` reste juste ; le refus `422 release.no_chaining` est provisoire jusqu'à la mission 9) ;
   - le jeton sur place est toujours exigé (constat 1) ;
   - dans `docs/POINTS_OUVERTS.md`, rattache OP-N51 à la mission 9 comme décidé (encore ouvert, non bloquant pour cette mission).
2. **Nouvelle ADR (n° suivant libre)** pour la route `POST /media/{media_id}/reassignment` (`reassignPoolMedia`), ajoutée au lot 16 (commit f0715fe) alors que `contracts/media-lifecycle.md` plaçait la remise en stock dans `releaseMedia`. L'ADR donne la raison, les droits requis, l'audit et le lien au contrat. Pas de changement de code.
3. OP-N54 et OP-N55 restent ouverts, sans changement.

## Contraintes

- Écarts de sécurité : tout ce qui affaiblirait la sécurité au-delà de ces décisions est soumis au porteur avant d'être codé. Arrête-toi et signale-le.
- Tests à lancer :
  - les suites Jest touchées (release, cash-due, blacklist, claims ou consultation par code) ;
  - pgTAP après `npm run reset-db -w @cashless/ledger-sql` ;
  - `typecheck` et `lint`.

  Donne la sortie réelle de chaque commande.
- Fichiers à faire relire par une personne : la nouvelle migration, `post-roles.sql` s'il est touché, `onsite-approval.ts`.
