---
affected_files: []
cycle_number: 1
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-11-02T10:48:48Z'
reviewer_agent: claude
wp_id: WP11
---

# Relecture WP11 (commit 9d97a0bc) : REJET, 1 constat bloquant

## Bloquant

1. (haute, disponibilité) Réservation mémoire `mem.reserved` jamais levée si le brouillon disparait sans être publié.
   `snapshot-content.worker.ts` `process()` : tant que `lastVersion < reserved.version`, le passage rend la main
   (alarme 2 toutes les 5 min, `reserved.at` renouvelé) et ne retente JAMAIS `save_`. Or WP13 jette un brouillon dont
   `verifyDraft` échoue (`discard_offline_snapshot_draft`), et `DRAFT_ALREADY_OPEN` pose aussi `reserved ??=`. Reproduit :
   FULL scellé, brouillon passé DISCARDED, 12 passages à +60 s : 0 version produite, alarme 2, grand livre figé jusqu'à
   redémarrage (les terminaux perdent leur snapshot valide en 15 min). Correction attendue : au franchissement de
   STUCK_DRAFT_MS (ou à chaque BUSY_RETRY_MS) lever `reserved` pour retenter `save_` (la base refuse par `DRAFT_ALREADY_OPEN`
   si le brouillon existe encore) ; test d'intégration : brouillon READY jeté par un tiers, la version suivante est
   produite sans redémarrage.

## Mineurs
- `OWNED_FIELD_MISMATCH` : `return` sans journal ni compteur (mutant survivant : retirer la ligne ne casse aucun test) ;
  un désaccord persistant serait silencieux. Ajouter un test de course et compter après N essais.
- `purge_offline_snapshot_content` : suppression de l'appel = mutant survivant (aucun test de purge, critère T048).
- Échec répété d'un grand livre (ex. ligne avec mot de passe avant WP12) : relecture complète de la source et
  `console.error` à chaque passage de 1 s, sans temporisation (hors `DRAFT_ALREADY_OPEN`).
- `writeDraft` avale l'échec de `discard_` : une coupure base en cours d'écriture crée l'orphelin OPEN du point 1 de
  la liste hors lot.
