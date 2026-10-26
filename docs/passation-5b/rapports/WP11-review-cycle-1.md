# Relecture WP11 « Paiement par bracelet », cycle 1 — REJETÉ

Relecteur distinct. Commits `71770dce` + `7d46eaf2`, diff `183db2a2..7d46eaf2` hors kitty-specs. Base `cashless_wp11r` (supprimée). Aucun commit, arbre propre.

## Rejoué (sur ma base)
`test/integration/payments` + `test/unit/payments` : 8 suites, 78 tests verts. `media-isolation`, `device-auth-matrix`, suites vendeurs, `architecture` : verts. `tsc --noEmit` propre. `npm run check -w @cashless/contracts` : types et Dart à jour. Concurrence (`payments-concurrency`) 3 fois : 4/4 vert à chaque fois. Code conforme aux ADR-128 et ADR-123 (solde QR gardé, `authority_epoch` au contrat et testé contre `Problem`, corps non objet 400 sans registre, `content_sha256` avec vecteurs, `CL037` → `422 QR_TOKEN_INVALID` unique).

## Constats

### 1. MAJEUR (à corriger) — un refus du registre fait sauter `settleRefusal` : une lecture suspecte n'est plus consignée
`apps/api/src/payments/payments.service.ts:303-318` (`refuse`) et `device-seq-registry.ts:99-117`. `registry.reject` est awaité AVANT `taps.settleRefusal`. Si `record_device_seq` lève `CL002` (numéro déjà rangé avec un autre contenu) ou `CL021`, l'exception sort de `refuse` et `settleRefusal` n'est jamais appelé.
Scénario (vérifié par une sonde, puis retirée) : numéro 1 déjà rangé avec un autre contenu ; le terminal envoie `POST /payments` clé `<serial>:1` avec une lecture à signature d'originalité fausse. Réponse `409 IDEMPOTENCY_KEY_REUSED`, anomalie `SIGNATURE_MISMATCH` : 0 (alors que le test « lecture suspecte » du lot en attend 1 sans registre pré-rempli). Un terminal compromis qui réutilise un numéro déjà au registre (posé hors `api_idempotency` : lots hors ligne de la mission 7, purge d'idempotence) fait taire la détection d'une lecture falsifiée. Latent aujourd'hui, réel dès la mission 7 ; même effet si `reject` échoue pour une panne de base.
Correction : dans `refuse`, entourer `registry.reject` d'un `try/catch` qui garde l'erreur, appeler `settleRefusal` dans tous les cas (`finally` ou après capture), puis relancer l'erreur du registre (ou la visible). Test : numéro pré-rangé + lecture falsifiée → anomalie présente (le test de l'implémenteur plus la ligne de pré-remplissage).

### 2. MAJEUR (à corriger) — `VendorSessionGuard` et l'ordre terminal → session ne sont prouvés par aucun test
Mutation M1 : suppression de `await this.sessions.assert(...)` (`payments.service.ts:115`) : 53/53 verts (payments + matrice). Le compte rendu cite `payments-refusals` « VENDOR_SESSION_INVALID » et `payments-concurrency` comme preuve : faux. `record_sale_attribution` refuse déjà une session fermée (même code), ce qui masque la suppression ; ce que la garde apporte en plus est le `FOR SHARE` sur le vendeur et la session (une fermeture/déconnexion concurrente attend la vente) et l'ordre global des verrous. M12 (garde déplacée AVANT la prise du terminal) n'est tuée que par accident (le test `DEVICE_MODE_NOT_ALLOWED` envoie une session sans effet) : aucun test d'ordre.
Correction : test qui tient une transaction fermant la session du terminal (UPDATE non validé) puis envoie la vente et affirme qu'elle attend/refuse puis ne s'attribue jamais à une session close ; test de l'ordre (une fermeture de session concurrente et une vente simultanées du même terminal sans interblocage, 3 passes).

### 3. MINEUR — `assert_device_active` dans la transaction n'est prouvé par rien
M30 (ligne 113 retirée) : 42/42 verts. Masqué par la garde de preuve et la fermeture des sessions à la suspension. Test à ajouter : terminal suspendu entre la garde et la prise du verrou (UPDATE tenu, vente en attente, validation, refus).

### 4. MINEUR — branches « rejeu côté moteur » et « rejeu côté registre » (renforcements) sans test
M10 (`replayed !== false` → `false`) et M11 (`|| written.replayed` retiré) : tout vert. Écrire une ligne `journal_transaction` de même clé (ou un numéro déjà `ACCEPTED`) sans entrée d'idempotence et vérifier `409 IDEMPOTENCY_KEY_REUSED` et l'absence de lien.

### 5. MINEUR — le cas `createPayment` de `media-isolation.spec.ts` refuse pour une autre raison que l'isolation
`media-isolation.spec.ts` (cas `createPayment`) : le terminal de B n'a pas de point de vente, donc le refus 409 tombe avant toute lecture du bracelet de A. M31 (levée du refus « aucun point de vente » remplacée par un bloc vide) : suite verte. Affecter le terminal de B à un point de vente de son prestataire pour que le refus soit bien « bracelet inconnu de B ». Le cas `getPayment` en `who: 'staff'` est acceptable : le chemin terminal est prouvé ailleurs (M6b, filtre `device_id` retiré : tué par `get-payment.spec.ts` « la vente d'un AUTRE terminal »).

### 6. MINEUR — pas de test de concurrence « même clé, même numéro »
`payments-concurrency.spec.ts` fait varier la clé. Sonde faite par moi : 10 envois simultanés de la même clé et du même corps → 1 × 201 et 9 × `409 IDEMPOTENCY_KEY_IN_PROGRESS`, une vente, un débit, un `ACCEPTED` ; même clé et 10 corps différents → 1 × 201 et 9 × `IDEMPOTENCY_KEY_REUSED`. Comportement correct : le consigner en test.

### 7. INFO — conformité vérifiée
Verrous : terminal pris `FOR UPDATE OF d` en première instruction (M13 tuée par la concurrence), puis session, demande QR (`lock_customer_qr_token`), bracelet (`assert_tap_payable`/`registerOrRefuse`), portefeuille. Tout ou rien : une seule `IdempotentTx.run`, le registre de refus dans une transaction séparée (aucun effet comptable, `refused()` vérifie ventes/lignes/attributions/passages/solde). Montant, devise, vendeur : vendeur toujours celui de la session (le corps n'a pas de vendeur), canal fixé par le serveur, devise contrôlée contre l'événement (M26 tuée), montant du corps validé contre les lignes puis contre le catalogue par la base. Aucun faux ajouté, aucun jeton QR persistant ou journalisé. Rôles de `getPayment` : `SUPERVISOR` à portée organisateur suit la convention du dépôt (events.controller) ; pas d'élargissement.

## Tableau des mutations
| # | Mutation | Résultat |
|---|---|---|
| M1 | retirer `VendorSessionGuard.assert` | SURVIT (constat 2) |
| M2 | sauter `assertAuthorityEpoch` | tuée (`payments.spec` A27) |
| M3 | ranger `DEBIT_AUTHORITY_*` | tuée (2 tests) |
| M4 | refus QR distinguable (autre code) | tuée (4 tests) |
| M5 | retirer `assert_wallet_payable` | tuée (A17) |
| M6b | `getPayment` terminal sans filtre `device_id` | tuée |
| M7 | `getPayment` personne sans contrôle de rôle | tuée |
| M9 | `getPayment` hors `PURCHASE` | tuée |
| M10 | ignorer `replayed` du registre | SURVIT (constat 4) |
| M11 | ignorer `replayed` du moteur | SURVIT (constat 4) |
| M12 | garde de session avant la prise du terminal | tuée par accident (constat 2) |
| M13 | retirer `FOR UPDATE` du terminal | tuée (4 tests de concurrence) |
| M14 | ne jamais ranger un refus | tuée |
| M15 | ne pas enregistrer le numéro `ACCEPTED` | tuée |
| M17 | retirer la borne de `seq` | tuée (2 tests) |
| M19 | ne pas consommer le passage | tuée |
| M22 | retirer la langue du battement | tuée |
| M26 | retirer `CURRENCY_MISMATCH` | tuée |
| M30 | retirer `assert_device_active` | SURVIT (constat 3) |
| M31 | retirer le refus « terminal sans point de vente » | SURVIT dans media-isolation (constat 5) |
Tous les fichiers remis par `git checkout` ; sondes supprimées.

## Anti-pattern (checklist du prompt)
1 code mort : PASS (`qrTokenHash`, `DeviceSeqRegistry` exportés pour WP12/WP13, `SeqChannel` BATCH/EDGE pour la mission 7). 2 test synthétique : PASS sauf constats 2 à 5. 3 retours silencieux : PASS (`purchaseContent` → `null` documenté). 4 couverture FR : PASS avec réserve constat 2. 5 surface gelée : PASS (aucun `.sql`). 6 décision verrouillée : PASS. 7 fichiers partagés : retouches hors carte listées et justifiées. 8 fragilité : le `throw new Error` après validation (`payments.service.ts:216, 225`) est un invariant, acceptable.

## Écarts de sécurité ouverts
Aucun écart accepté. Constat 1 est un défaut de contrôle introduit par le lot (pas un écart consigné) : à corriger, pas à consigner.

## Fichiers à faire relire par une personne
`payments.service.ts` (ordre des verrous, `refuse`), `device-seq-registry.ts` (`reject`, `isRegistrable`, `content_sha256`), `qr-token-hash.ts` et la conversion `CL037`, `payment-read.service.ts`. L'agent qui a écrit le code et moi-même ne valons pas relecture indépendante pour la cryptographie (forme canonique RFC 8785) et l'ordre des verrous sous charge réelle.

## Défauts antérieurs à la mission (à part, sans rejet)
`sql-config-resolver.ts` : requêtes parallèles sur le même client `pg` (avertissement de dépréciation à chaque vente, reporté à WP14). Tests de latence NFR-009 hors `SKIP_LATENCY`.

## Reports pour WP12 à WP14
- WP12 (annulation) réutilise `DeviceSeqRegistry.reject` : appliquer la correction du constat 1 dans le même geste (un refus du registre ne doit jamais empêcher un effet durable).
- WP12/WP13 : tester la garde de session avec fermeture concurrente (constat 2), même modèle.
- WP14 : test d'ordre des verrous terminal → session → QR → bracelet → portefeuille en charge ; concurrence « même clé » (constat 6) ; sonde de la mission 7 : numéro posé hors idempotence puis paiement falsifié.
