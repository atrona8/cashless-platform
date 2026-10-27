# Relecture WP02 — cycle 1 — verdict : REJETÉ

Lot : `0031_vendors.sql`, `tests_vendors.sql` (lane-b, commit `b5641a30`). Relecteur distinct de l'implémenteur.
Correction attendue petite et locale (aucune signature changée : WP04/WP07 non impactés).

## Constats

### 1. BLOQUANT (sécurité) — un essai compté avant un changement de PIN ou une désactivation reste utilisable après
`packages/ledger-sql/migrations/0031_vendors.sql:185-206` (`set_vendor_pin`), `:213-239` (`set_vendor_status`),
`:355-360` (`open_vendor_session`).

`set_vendor_pin` et `set_vendor_status(DISABLED)` ferment les sessions du vendeur mais laissent valides ses
`vendor_pin_check` non utilisés (30 s). L'API a vérifié le PIN contre l'empreinte rendue par la transaction A,
c'est-à-dire l'ANCIENNE empreinte ; `open_vendor_session` ne revérifie que statut, blocage, commerçant, terminal et
check, donc ouvre la session.

Scénario reproduit sur `cashless_wp02r` (une seule session, sans concurrence) :
- `begin_vendor_pin_check(Awa, aa01)` → `set_vendor_pin(Awa, nouveau)` → `open_vendor_session(check, aa01)` :
  **session ouverte** (PIN changé parce qu'il avait fuité : l'ancien PIN ouvre encore une session).
- `begin_vendor_pin_check(Awa, aa02)` → `set_vendor_status(DISABLED)` → `set_vendor_status(ACTIVE)` →
  `open_vendor_session(check, aa02)` : **session ouverte** avec un essai antérieur à la désactivation.
- Même effet pour un déblocage : les checks des essais 1 à 4 d'un attaquant, émis avant le blocage, redeviennent
  utilisables si `set_vendor_pin` débloque dans les 30 s.
Fenêtre étroite (30 s), mais elle contredit l'intention de FR-005 (« nouveau PIN / désactivation : sessions
fermées ») et le contrat ne l'autorise pas (il est muet). Correction = renforcement (règle 1 : se fait, se consigne).

Correction attendue (au choix, la première est la plus simple et garde l'ordre vendeur → check) :
- dans `set_vendor_pin`, dans `set_vendor_status` au passage à `DISABLED` (et, par cohérence, au blocage dans
  `begin_vendor_pin_check`), après le `FOR UPDATE` du vendeur : invalider ses checks non utilisés
  (`DELETE FROM vendor_pin_check WHERE vendor_id = v.id AND operator_id = v_operator AND used_at IS NULL`, ou les
  marquer d'une manière qui fasse échouer B) ;
- ou dans `open_vendor_session` : refuser (`CL033`) un check dont `created_at` est antérieur au dernier changement
  d'empreinte ou de statut du vendeur (exige une colonne datée fiable, p. ex. `updated_at` posé par les deux fonctions
  — `begin_vendor_pin_check` ne le pose pas aujourd'hui).
Tests à ajouter dans `tests_vendors.sql` : les deux scénarios ci-dessus doivent rendre `CL033`.

### 2. MINEUR — deux ouvertures simultanées sur le même terminal, vendeurs différents : `23505` au lieu de `CL033`
`0031_vendors.sql:335, 364-368`. Le terminal n'est pris qu'en `FOR SHARE` : deux transactions B concurrentes pour deux
vendeurs sur un terminal ne se sérialisent pas ; la seconde échoue sur l'index `vendor_session_open_per_device`.
Issue sûre (refus), mais SQLSTATE non traduit (500). Le contrat prévoit `429` côté API pour un second essai simultané
du même terminal : pas de changement exigé ici, à signaler à WP09 (garder le `429`, ou traduire `23505` de cette
contrainte en `401 VENDOR_PIN_INVALID`).

### 3. MINEUR — preuve du « 5e essai bloqué avant vérification » indirecte
`tests_vendors.sql:351-362` : le check rendu au 5e essai n'est jamais passé à `open_vendor_session`. Ajouter : ce
check → `CL033` (prouve directement « 4 faux puis le bon PIN → bloqué »).

## Vérifications faites (conformes)
- A6 : transaction A sans dépendance à argon2 ; compteur sous `FOR UPDATE` du vendeur, jamais > 5 (contrainte +
  vendeur bloqué non compté) ; zéro ligne et rien d'écrit pour inconnu / autre commerçant / autre prestataire /
  DISABLED / bloqué / TOPUP_DESK / sans point de vente (testé, compteur et nombre de checks inchangés).
- A7 : ordre terminal → vendeur → check → session dans chaque fonction ; échelons sautés seulement vers le bas
  (`set_vendor_*` : vendeur → sessions ; `set_device_status` : terminal → sessions ; `assert_vendor_session` :
  vendeur → session, terminal pris par l'appelant). `open_vendor_session` (terminal FOR SHARE) se sérialise avec
  `set_device_status` (FOR UPDATE). pgrowlocks présent : cas « For Share » exécuté.
- `set_device_status` : diff du corps contre 0022 = uniquement le bloc de fermeture des sessions ; rien retiré ;
  `SECURITY DEFINER`, `search_path` et `REVOKE … FROM PUBLIC` reposés. Purge : corps de 0022 gardé + suppression
  des checks > 24 h, signature égale.
- `vendor_public` : `security_barrier`, pas `security_invoker`, filtre `nullif(app.operator_id)` ; colonnes sans
  `pin_hash`/`failed_attempts`/`locked_at` ; isolation A/B et « sans prestataire → 0 ligne » testés.
- 10 fonctions `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC` chacune ; aucun
  `GRANT` dans la migration ; messages sans écho de l'empreinte (testés au texte près).
- Lignes ≤ 100 caractères (comptées en caractères) sauf 0031 l. 464 et 479, exception déclarée (copie de 0022).

## Grille anti-motifs
1 Code mort : N/A (fonctions SQL consommées par WP04/WP07/WP09, prévu au plan). 2 Faux de test : PASS (chaque cas
appelle la fonction réelle). 3 Retour vide silencieux : PASS (les `RETURN` sans ligne de `begin_vendor_pin_check`
et le NULL de `close_vendor_session` sont contractuels et commentés). 4 Couverture FR : PASS, sauf trou du constat 1.
5 Surface figée : PASS (aucun `.sql` généré touché ; seuls les 2 fichiers du lot). 6 Décision verrouillée : PASS.
7 Fichiers partagés : PASS (aucun). 8 Fragilité : constat 2 (mineur).

## Tests rejoués (base `cashless_wp02r`, supprimée)
- `reset-db` → 0001 à 0031, roles.sql, post-roles.sql : OK.
- `pg_prove tests/tests_vendors.sql` → 156 tests, PASS.
- `reset-db` puis `scripts/test-pgtap.sh` → 34 fichiers, 2 239 tests, PASS (chiffres de l'implémenteur confirmés).

## Défauts antérieurs à la mission
Aucun relevé.

## À faire relire par une personne
`0031_vendors.sql` (SECURITY DEFINER, verrous, vue exécutée avec les droits du propriétaire, set_device_status).
