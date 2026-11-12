---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-06T10:50:14Z'
reviewer_agent: claude
wp_id: WP16
---

# Relecture WP16 – cycle 1 – rejet

Preuves relancées : 117/117 Jest verts (`--runInBand`), tsc propre. Les demandes du prompt sont couvertes ; un seul constat bloquant.

## 1. [BLOQUANT] Le faux du port matériel n'a aucune persistance : `gateway request` puis `gateway enroll` ne peuvent jamais réussir, et tout redémarrage change les clés

Preuve : deux exécutions successives de `main.ts request --serial S1 --role PRIMARY` (développement) rendent deux `batch_public_key` différentes
(`MFkw…tY8nYSe6…` puis `…MhYI-3Htw…`). `enroll` tourne dans un autre processus : son faux génère une autre clé `batch`, donc le contrôle
`client_cert_pem` = clé de lot du matériel (`KEY_MISMATCH`) échoue toujours avec le seul keystore existant. Les tests `enrollment.spec.ts` ne le voient
pas parce qu'ils partagent une instance dans le même processus.
Conséquence plus large : après un `SIGKILL` (points d'arrêt, WP25) ou tout redémarrage, les clés `token`, `snapshot`, `agreement` et `batch` sont nouvelles,
donc incohérentes avec ce que le central a enregistré, et les bancs de reprise de WP25 ne tiennent pas.
Correction attendue : le prompt T072 prévoit « clés en mémoire ou en fichier de développement » ; fournir le fichier de développement : clés du faux
persistées dans un fichier en mode `0600`, hors dépôt, chemin par un réglage (nouvelle clé de configuration à signaler comme § 12.9, développement seulement,
refusée ou sans effet en production puisque le faux y est refusé), jamais en base ni en journal. Tests : (a) deux processus `request` rendent les mêmes clés
publiques ; (b) `request` puis `enroll` de bout en bout dans deux processus ; (c) le fichier est en `0600` et sa permission est vérifiée à la lecture ; (d) `destroy`
supprime aussi la clé du fichier (NFR-013) et le test le prouve après relecture du fichier.

## 2. [MINEUR, à consigner, pas bloquant] Contradiction de conception à signaler au porteur (pas de correction à coder ici)
`enroll` exige que `client_cert_pem` porte la clé `batch` du port matériel (aucune clé privée exportable), alors que `GATEWAY_CENTRAL_CLIENT_KEY_FILE`
(§ 8, obligatoire en production) suppose une clé privée en fichier pour le TLS client vers le central. Les deux ne peuvent pas désigner la même clé : le mTLS
vers le central (WP20) devra soit signer le handshake par le port, soit utiliser un certificat distinct. À signaler dans le compte rendu de WP16.

## 3. [MINEUR] `enroll` et `request` en production n'exécutent que les règles de configuration
`main.ts offline()` joue les migrations et écrit sans `evaluateServerRules` (fsync, full_page_writes, synchronous_commit, superutilisateur) ni
`evaluateProviderRules`. Ajouter ces deux contrôles aux commandes hors service, avec un test.

## 4. [MINEUR] Secret de test : la règle ne voit qu'une liste étroite
`databasePassword` accepte un mot de passe vide (authentification `trust`) et tout mot de passe hors cinq motifs (`postgres`, `edge_app`, `admin`…). Refuser le
mot de passe vide en production au moins, et le consigner (liste de motifs non exhaustive).
