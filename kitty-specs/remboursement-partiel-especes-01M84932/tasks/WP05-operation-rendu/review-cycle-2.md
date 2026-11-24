---
affected_files: []
cycle_number: 2
mission_slug: remboursement-partiel-especes-01M84932
reproduction_command:
reviewed_at: '2026-11-23T16:22:58Z'
reviewer_agent: claude
wp_id: WP05
---

# WP05 — retour de l'orchestrateur (batterie du code intégré, 23/11/2026)

La batterie complète sur la lane e (WP01 à WP05 réunis, `cashless_test`) fait échouer trois gardes transverses
d'anciennes missions, qui parcourent toutes les routes du contrat. La nouvelle route `refundPartialCash` n'y a pas
son cas. Correction attendue : **ajouter les cas**, jamais élargir une garde par une tolérance générale.

1. **Bloquant** — `test/integration/end-to-end/device-auth-matrix.spec.ts` (OP-N70) : « chaque route de terminal a son
   cas » signale `POST /media/{}/partial-cash-refunds (PartialRefundController, api)` ; « routes du contrat non
   servies : 404 » reçoit `400`. Ajouter le cas de la route (mêmes preuves que `releaseMedia`) dans la matrice.
2. **Bloquant** — `test/integration/end-to-end/media-isolation.spec.ts` (NFR-004, SC-005) : le contrat déclare
   48 opérations de bracelets, le test en attend 47. Ajouter le cas `refundPartialCash` (B sur A : refus sans fuite ni
   changement ; chez lui, B ne vise aucun objet de A) et passer le compte à 48.
3. **Bloquant** — `test/integration/end-to-end/media-port-swap.spec.ts` (SC-007) : « aucune ligne des contrôleurs de
   la mission 4 n'a bougé » signale `apps/api/src/media/lifecycle/partial-refund.controller.ts`, fichier NOUVEAU de la
   9c (aucun contrôleur de la mission 4 modifié). Exclure ce seul chemin exact, avec un commentaire (mission 9c,
   fichier nouveau), sans élargir la garde.

Relancer seules les trois suites puis la batterie API complète (`SKIP_LATENCY=1 npx jest --maxWorkers=2` sur
`cashless_wp05`), et noter les comptes. Ces trois fichiers sont des retouches hors carte, à lister dans la note.
