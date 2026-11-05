---
affected_files: []
cycle_number: 1
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-11-02T11:40:05Z'
reviewer_agent: claude
wp_id: WP15
---

# Relecture WP15 (commit 60189b18) : constats

## 1. MAJEUR : isolation des tests (règle du 02/11)
`snapshots-seed.ts` : `clearKeys` passe à REVOKED TOUTES les clés ACTIVE/RETIRED de la base (sans filtre), et
`rotateKey` fait tourner la clé CENTRAL GLOBALE (operator_id NULL) de la plateforme, `revokeTestKeys` en `afterAll`.
Preuve : `npx jest test/integration/offline --maxWorkers=2` x4 sur cashless_wp15 : ROUGE 4 fois sur 4
(9 à 12 échecs sur 20) : `snapshots.spec.ts` et `snapshots-config.spec.ts` se cassent entre elles. De plus
`clearKeys` révoque les clés par prestataire des suites du signataire de WP13 (support.ts les insère en
`operator_id = <prestataire de test>`, status ACTIVE) et une clé globale ACTIVE change `offline_enabled`/ETag de
`devices/config.spec`, `heartbeat*.spec` pendant la fenêtre. (Les passes `--maxWorkers=3` du dossier voisin n'étaient
vertes que par hasard d'ordonnancement.)
Correction attendue : aucun UPDATE/rotation global. Chaque test crée son prestataire (ou monde) et SA clé ACTIVE
par INSERT propriétaire avec `operator_id = <son prestataire>` (modèle : `snapshots-signer/support.ts:143`), la
fonction `snapshot_public_keys` rendant les clés propres du prestataire quand il en a ; "sans clé" = prestataire
sans clé propre (vérifier qu'aucune clé globale n'existe : n'en créer aucune). Retirer `clearKeys`, la rotation
globale et `revokeTestKeys` global ; la rotation à deux clés se prouve sur des clés du prestataire. Preuve :
la commande de la fiche deux fois + `test/integration/offline --maxWorkers=2` quatre fois, vertes.

## 2. MOYEN : `config.spec.ts` "téléphone personnel" ne prouve plus rien
Sans clé ACTIVE, `offline_enabled` est faux pour tout le monde : l'assertion `offline_enabled === false` du
téléphone est vraie même si la logique "téléphone = jamais hors ligne" est supprimée, et `own` n'affirme plus
`offline_enabled`. Aucun test de configuration avec clé ACTIVE pour un téléphone. Correction : avec une clé du
prestataire (voir 1), `keypad.offline_enabled === true` et `phone.offline_enabled === false`.

## 3. MINEUR : `exactSeq` sans test
Aucun test (ni unitaire) du refus au-delà de 2^53-1 / négatif : remplacer `exactSeq` par `Number()` survit.
Ajouter un test unitaire (2^53-1 accepté, 2^53 et -1 refusés).

## 4. MINEUR : `cash_topup_offline` servi
Mutant `cash_topup_offline: s.cash_topup_offline` survit (la contrainte 0043 interdit `true` : équivalent côté
base), mais aucun test ne prouve que l'API épingle `false`. Acceptable ; à consigner ou tester (dé-désactiver la
contrainte n'est pas permis : test unitaire de `build` avec une ligne `true` simulée).

## 5. MINEUR : test ETag d'un autre terminal faible
Mutant "ETag sans l'identifiant du terminal" tué seulement par le test "enveloppe pas prête" ; le test "304 : l'ETag
d'un autre terminal" passerait (clés d'accord différentes). Faire deux terminaux de même clé d'accord et même version.

## Vérifié sans constat
Identité du jeton, pas de paramètre de terminal ; `@DeviceAuth()` sans option (suspendu 403 avant 304, aussi
redoublé par CL051 DEVICE_SUSPENDED : mutant `allowSuspended` équivalent) ; aucune lecture de `content_key_wrapped`,
pas de `SELECT *` ; pas de journal de `pwd_pack_enc` (test) ; CL049/CL050/CL051 mappés, Retry-After: 2 ;
X-Snapshot-Latest posé aussi sur 304 ; `since_version` bigint texte 19 chiffres max ; ack version nombre sûr ;
battement : deux lectures dans la même `tx.run(operatorId)` (RLS). `tsc` : voir compte rendu.
Mutants tués : ETag sans terminal, offline_enabled sans clé, sync_requested figé, since ignoré (4/6 ; 2 équivalents).
Perf `NFR-009` (config/heartbeat p95) : échec par délai Jest de 5 s sur ce poste (50-67 ms/appel) ; vert avec
`--testTimeout=60000` : non imputé à WP15.
