---
cycle_number: 2
mission_slug: terminaux-paiement-en-ligne-01M52QB9
reviewer_agent: claude
wp_id: WP11
---

# Relecture WP11 « Paiement par bracelet », cycle 2 : APPROUVÉ

Relecteur distinct. Commit `2a6d13b7` (diff `7d46eaf2..2a6d13b7` hors kitty-specs). Base `cashless_wp11r` (supprimée), arbre propre, aucun commit.

## Rejoué
- `test/integration/payments`, `test/unit/payments`, `media-isolation`, `device-auth-matrix`, `architecture` : 12 suites, 124 tests verts. `tsc --noEmit` propre.
- `payments-concurrency` + `payments-locks` x3 : 11/11 à chaque passage.
- Aucune régression des preuves du cycle 1 (ADR-123, ADR-128, époque, `DEBIT_AUTHORITY_*`, QR indistinguable, `getPayment` : suites vertes).

## Vérifications
- `refuse` : l'erreur du registre est gardée, `settleRefusal` a lieu dans tous les cas, puis l'erreur du registre est relancée (sinon celle du règlement). Le registre (`reject`) et `settleRefusal` ont chacun leur transaction : un échec n'en laisse pas d'état partiel, aucune écriture comptable. Code 409 `IDEMPOTENCY_KEY_REUSED` (CL002) = celui du cycle 1.
- `payments-locks.spec.ts` : attente par `pg_stat_activity` / `commitWhileWaiting`, aucun sommeil arbitraire ; 3 passages verts.
- `media-isolation` `createPayment` : en fixant `refused: [404]` le cas passe (404 bracelet inconnu de B, avec point de vente, vendeur et session de B) : le refus vient bien de l'isolation.

## Constats
1. MINEUR : le chemin « erreur du registre sur un refus qui n'est pas une lecture » (dernière ligne de `refuse`, `throw registryError ? … : thrown`, `payments.service.ts`) n'est prouvé par aucun test (N1 survit). Effet : le terminal verrait le refus d'origine plutôt que `IDEMPOTENCY_KEY_REUSED`, sans conséquence comptable. Report.
2. MINEUR : un échec de `settleRefusal` (panne de la 2e transaction) sans erreur du registre n'est pas testé (N3 survit) ; le code propage bien l'erreur (correct, non prouvé). Report WP12/WP14.
3. NOTE : `media-isolation` garde `refused: [403, 404, 409]` ; le 404 est réel, on pourrait resserrer à `[404]`. Sans gravité.

## Tableau des mutations
| Mutation | Résultat |
|---|---|
| M1 garde de session retirée | tuée (`payments-locks`, fermeture concurrente) |
| M12 garde avant la prise du terminal | tuée (3 tests) |
| M30 `assert_device_active` retiré | tuée (`payments-locks`) |
| M10 `replayed` du registre ignoré | tuée (`payments-locks`) |
| M11 `replayed` du moteur ignoré | tuée (`payments-locks`) |
| ancien `refuse` (version 7d46eaf2) | tuée (`payments-refusals` « constat 1 ») |
| N2 règlement sauté si le registre a échoué | tuée |
| N4 `settleRefusal` jamais appelé | tuée (2 tests) |
| N5 erreur du registre ignorée | tuée |
| N1 erreur du registre non relancée (refus non-lecture) | SURVIT (constat 1) |
| N3 erreur du règlement avalée | SURVIT (constat 2) |
Tous les fichiers remis par `git checkout`.

## Écarts de sécurité ouverts
Aucun. Le constat 1 du cycle 1 (consignation d'une lecture falsifiée) est corrigé : renforcement.

## Fichiers à faire relire par une personne
`payments.service.ts` (`refuse`, quelle erreur remonte), `payments-locks.spec.ts` (ordre des verrous), `device-seq-registry.ts`, `qr-token-hash.ts` (cryptographie, inchangés).

## Reports WP12 à WP14
- WP12 (annulation, réutilise `DeviceSeqRegistry.reject`) : même schéma que `refuse` (effet durable avant relance), plus tests des constats 1 et 2.
- WP12/WP13 : garde de session avec fermeture concurrente, modèles `commitWhileWaiting` / `waitBlocked`.
- WP14 : ordre des verrous terminal → session → QR → bracelet → portefeuille en charge ; sonde de la mission 7 (numéro posé hors idempotence puis paiement falsifié) ; `sql-config-resolver` (requêtes parallèles sur le même client).
