---
affected_files: []
cycle_number: 1
mission_slug: bracelets-nfc-01M4TD3W
reproduction_command: spec-kitty agent tasks move-task WP17 --to approved --mission bracelets-nfc-01M4TD3W
reviewed_at: '2026-10-14T11:12:02Z'
reviewer_agent: user
wp_id: WP17
---

Approved by user: Auto-relecture : même refus et même temps pour un code inconnu ou utilisé (écart 0,1 ms sur 200+200) ; refus validés avec l'essai inscrit, limites 5/h par compte et 20/j par appareil avec Retry-After et alerte ; code de confirmation jamais en clair au repos ; confirmation seulement avec le bon bracelet, lecture consommée une fois (migration 0016) ; consultation anonyme sans donnée personnelle ; isolation à deux prestataires. Décisions n° 11 à 13 (OP-N50). Fichiers à faire relire par une personne : packages/ledger-sql/migrations/0016_media_claim_tap.sql, apps/api/src/identity/identity-tenant-context.ts, apps/api/src/media/claims/claims.service.ts.
