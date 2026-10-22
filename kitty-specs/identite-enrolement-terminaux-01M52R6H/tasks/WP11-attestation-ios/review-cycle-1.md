---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command: spec-kitty agent tasks move-task WP11 --to approved --mission identite-enrolement-terminaux-01M52R6H
reviewed_at: '2026-10-20T10:38:02Z'
reviewer_agent: user
wp_id: WP11
---

Approved by user: Relecture indépendante (session distincte de l'implémenteur), verdict enregistré par l'orchestrateur. WP11 approuvé (relecture indépendante, commit 2ee8aad, lane-k). Vérifié : le défi couvre le code, le serial et
les deux SPKI (iosClientDataHash, préfixe de domaine et longueurs). Des tests refusent une autre clé de signature,
une autre clé d'accord, des clés substituées après l'attestation, un autre code et un autre serial (R-06). Le
nonce vaut SHA-256(authData ‖ clientDataHash) et l'extension 1.2.840.113635.100.8.2 est comparée en entier à son
DER (30 24 a1 22 04 20 ‖ nonce). Sont aussi vérifiés : chaîne explicite jusqu'à la racine configurée, rpIdHash,
compteur nul, aaguid, credentialId = SHA-256(point non compressé). En production, l'absence de racine Apple, une
racine de test ou l'environnement de développement font refuser le démarrage. AttestationRouter propage isFake.
Chaque refus a un test au motif précis. Les 192 tests unitaires (attestation, garde, config), le typecheck,
eslint et prettier passent.
R-06/R-08 : il n'y a pas de vraie contradiction. Le « SHA-256(défi) » de R-06 est le clientDataHash de R-08, et
attestKey(keyId, clientDataHash:) reçoit déjà le condensé : un seul hachage est correct.
Mineurs reportés :
- WP12 (terminal de test) et mission 12 (app) : passer la sortie de iosClientDataHash telle quelle à attestKey,
  sans la hacher une seconde fois. Clarifier la formule de R-06.
- WP14/WP18 : keyId (credentialId) non rendu par le port, pour la levée d'OP-N64 (mission 12).
- Recette (mission 13) : tester un vrai objet Apple (racine P-384, ECDSA-SHA384), car les tests n'utilisent qu'une
  PKI P-256.
- Fusion : attestation.module.ts, lignes 5 et 29 à plus de 100 caractères (héritées de WP10, à reformater).
À faire relire par une personne : apps/api/src/attestation/ios-app-attest.ts et le diff de
apps/api/src/attestation/attestation.module.ts (cryptographie, garde de production). Orchestrateur : Jest API complet 1411/1411 sur la base (lane-k). --force autorisé par le porteur : garde kitty-specs limité aux artefacts du runtime (status.*, baseline-tests.json, review-cycle-*.md), vérifié après réalignement.
