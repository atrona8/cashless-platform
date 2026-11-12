---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-10T11:01:47Z'
reviewer_agent: claude
wp_id: WP13
---

# WP13 : renvoi en correction (orchestrateur, décisions 38 et 39 du porteur, 09/11/2026)

Relecture complète non faite : le lot est renvoyé avant pour lever les deux blocages de droits qu'il a lui-même
signalés (la route rend aujourd'hui 503 sans écriture).

1. BLOQUANT (décision 38, ADR-174) : `check_balanced()` passe en `SECURITY DEFINER SET search_path = public, pg_temp`
   dans la migration correctrice `packages/ledger-sql/migrations/0066_*.sql` (numéro réservé à WP13), au lieu d'un
   droit de lecture sur `posting` pour `cashless_edge`. `REVOKE ALL … FROM PUBLIC`, droits explicites, test pgTAP.
2. BLOQUANT (décision 39, ADR-174) : fonctions `SECURITY DEFINER` étroites, dans la même `0066`, pour le curseur du
   registre, la clé publique du terminal, les résultats mémorisés, la configuration des frais et l'audit ;
   `EXECUTE` à `cashless_edge` seul (retouche hors carte de `post-roles.sql` §9 et de `tests_edge_rights.sql`
   autorisée pour ces seules fonctions, liste figée mise à jour). Aucun droit direct sur les tables.
3. Câbler la route sur ces fonctions : plus de 503 ; tests d'intégration réels sous `cashless_edge` (pas sous le
   propriétaire), dont un test qui échoue si un droit direct sur une table est rendu.
4. Rappels du suivi : frais recalculés par le moteur central, frais de la passerelle ignorés, test hostile
   (décision 26) ; rejeu sur 40001 et 23505 ; `tap.signature_verified`, `tap.pack_verified`,
   `device_batch_verified` posés par l'API ; `edge_sync_batch_finish('DONE')` exige un résultat par numéro ;
   `begin` contrôle que `edge_seq_from` suit le registre. Migration suivante libre : `0067`.
