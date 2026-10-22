# Relecture WP15, cycle 1 (rafraîchissement des jetons d'appareil)

Relecteur : claude (indépendant de l'implémenteur). Lane `lane-o`, diff `546f67c..d3ec00f` hors `kitty-specs/`
(commit d3ec00f, 8 fichiers). Prompt de relecture obtenu par `spec-kitty agent action review WP15 --mission
identite-enrolement-terminaux-01M52R6H --agent claude` (lancé sans erreur ; verdict non enregistré par le relecteur).

Exécuté par le relecteur, sans base : liens `node_modules/@cashless/*` vérifiés (pointent vers la lane) ;
`npm run typecheck -w @cashless/api` (vert) ; `npx eslint src/devices/tokens src/device-identity/real-device-identity.ts`
(vert) ; `npx jest test/unit/real-device-identity.spec.ts` (8/8) ; longueur des lignes des fichiers du lot comptée en
caractères (aucune au-delà de 100). Worktree combiné `.worktrees/tmp-combo-5a` (q+p+o) lu, non testé. Suites sur base :
résultats de l'orchestrateur (refresh.spec.ts 18/18 ; lane 1578 OK + course connue d'`enrollment-codes.spec.ts` ;
combinaison 1618 OK + même échec), non relancées.

## Vérifications de sécurité (toutes tenues)

- **mTLS** (`refresh.service.ts:94-97`, `real-device-identity.ts:71-89`) : `peerCertificate` exige une connexion TLS,
  `socket.authorized` (autorité des terminaux), un certificat présent et dans sa validité (revérifiée, session reprise
  comprise) ; extraction sans changement de comportement pour la garde (même ordre, mêmes raisons). `O=` lu une seule
  fois, UUID strict, une valeur exactement (`subjectOperator`), ne sert qu'à poser le prestataire de la session ; le
  terminal est relu sous RLS par `operator_id` + `serial` + `cert_sha256` (`:100-108`, `LIMIT 2` / exactement une
  ligne). L'autorité impose `O=<operator_id>` (`device-ca.port.ts:105`).
- **Preuve de possession** (`refresh.dto.ts:52-64`, `refresh.service.ts:111-128`) : message
  `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ serial ‖ 0x00 ‖ refresh_token`, champs à jeux de caractères sans
  octet nul (découpage unique), longueur 64 octets exigée, `dsaEncoding: 'ieee-p1363'`, clé `device.public_key` ;
  toute exception → refus. Tests : autre clé, sans séparateur, autre domaine (`cashless-request-v1`), signature DER,
  sans certificat, certificat d'un autre terminal, serial d'un autre terminal → 401 sans aucune écriture (jeton intact,
  aucun nonce, aucun audit).
- **Nonce** (`:142-150`) : `consume_device_nonce(…, now(), tolérance)` à l'heure de la base, dans sa propre transaction,
  APRÈS les trois preuves et AVANT l'échange ; rejeu → 401 sans atteindre l'échange (test « preuve rejouée » : sans le
  nonce, le rejeu tomberait dans la grâce et rendrait 200, le test échouerait).
- **Rotation seule dans sa transaction** (`:178-208`) : `TenantTx.run` au niveau par défaut (READ COMMITTED, jamais
  élevé) ; seule la fonction est appelée, puis l'audit (REUSED) ou la signature du jeton d'appareil (ROTATED / GRACE),
  dans la transaction : un échec de signature annule l'échange. Test 25000 sous REPEATABLE READ présent.
- **Grâce ADR-108** : bornes tenues par `rotate_device_refresh_token` (0023, inchangée) et prouvées par la route :
  une fois (`grace_used_at`), même certificat (contrôle 4 avant le statut), 60 s (constante), successeur jamais
  consommé. Tests de borne : seconde représentation, après 61 s, autre terminal (avec et sans grâce) → famille révoquée,
  audit, jeton d'appareil de la famille refusé par la garde (`guarded` → 401). Successeur perdu → 401 sans révoquer.
- **Réutilisation** (`:189, 240-264`) : audit `DEVICE_TOKEN_REUSE` écrit dans la transaction qui valide la révocation
  de la famille (la fonction rend un résultat, pas une exception) ; 401 levé après la validation. Le test lit l'audit
  après le 401 : le retirer ou le placer dans une transaction annulée fait échouer `expectFamilyRevoked`. Audit sans
  jeton ni empreinte (vérifié par le test).
- **NFR-008 et report WP04** : la rotation du premier est TENUE ouverte (signature suspendue), le verrou consultatif
  de famille est constaté dans `pg_locks`, puis 19 requêtes → 19 × 409 `retryable`, ancien jeton intact ; le client
  réessaie après 409 (nouveau nonce) → grâce. Tests à deux connexions (`cashless_app`) : échange de `s` ouvert →
  `IN_PROGRESS` puis `REUSED` ; révocation de famille qui attend le verrou (`pg_stat_activity`) et voit le successeur.
  Ordre contrôlé, pas de course au hasard : la condition bloquante du report du 20/10 est remplie.
- **ADR-115** (`:131-140, 156-174`) : terminal `REVOKED` → 403 seulement si certificat (étape 2), signature (étape 3)
  et jeton valides (le sien, révoqué pour `DEVICE_REVOKED`, jamais consommé, non expiré) ; sinon 401 ; lecture seule
  dans les deux cas (ni nonce, ni rotation). Cohérent avec l'étape 6 bis de la garde (403 après les preuves, avant le
  nonce). Tests : 403 avec preuves valides ; 401 avec autre clé, jeton inconnu, jeton d'un autre terminal, sans
  certificat ; jeton déjà consommé → 401 ; familles, nonces et audits inchangés.
- **Absence d'oracle** : toutes les preuves fausses → même `ProblemException('REFRESH_TOKEN_INVALID')`, la raison va
  au journal seulement. 403 / 409 n'apparaissent qu'après preuve complète (détenteur des clés du terminal).
- **Aucun secret** : journal = `requestId`, étape, raison, `deviceId` ; réponses = paire du contrat (`TokenResponse`,
  `token_type: Bearer`, vérifié par le test des clés de réponse).
- **Isolation** : session sous le prestataire du certificat ; jeton de A présenté par B (autre prestataire) → INVALID
  (fonction : prestataire de session ≠ prestataire du jeton), 401 sans fuite de l'identifiant de A, famille de A
  intacte, aucun audit.
- **Point d'intégration (tmp-combo-5a)** : `real-device-identity.ts` combiné correct : étape 1 via `peerCertificate`,
  `Step` contient `'6 bis'`, l'étape 6 bis (famille ignorée seulement si `REVOKED`, 403 après les étapes 4 à 6, avant
  `nonces.consume`) est intacte. `audit.service.ts` (union WP14 + WP16 + WP15) et `devices.module.ts` (WP17 + WP16 +
  WP15) fusionnés proprement.

## Liste de contrôle (anti-patterns)

1. Code mort : PASS (`peerCertificate` appelé par la garde et le service ; module importé par `devices.module.ts`).
2. Fixture synthétique : PASS (tous les tests passent par la route HTTPS ou la fonction réelle).
3. Retour vide silencieux : PASS (`null` de l'étape 2 → refus journalisé).
4. Couverture FR-010, FR-011, NFR-008 : PASS.
5. Surface figée : PASS (aucun `.sql` de `packages/ledger-sql/` modifié ; pas de migration 0028).
6. Décision verrouillée : PASS (READ COMMITTED non élevé ; aucun test dépendant de l'empreinte d'idempotence, ADR-116).
7. Fichiers partagés : PASS avec note : `real-device-identity.ts` (WP12/WP16), `audit.service.ts` (WP14/WP16),
   `devices.module.ts` (WP14/WP16/WP17) ; fusion automatique vérifiée dans `tmp-combo-5a`. Retouche hors carte de
   `real-device-identity.ts` justifiée par le prompt (« réutilise sa fonction de lecture du certificat »).
8. Fragilité : PASS (`throw new Error` de `refresh.service.ts:192-193` : incohérence inatteignable, échec bruyant
   documenté qui annule l'échange).

## Constats

Aucun constat bloquant.

1. **N1 — Report non suivi à la lettre (test).** Le report du 21/10 demande « révocation par la route du back-office,
   puis rafraîchissement ». `refresh.spec.ts:621-654` révoque par `set_device_status` (`t.setStatus`), justifié en
   tête du fichier (WP16 hors des dépendances du lot ; même fonction de base). Comportement identique, mais le chemin
   route → révocation → 403 n'est pas prouvé de bout en bout. À reporter à WP18 (branche combinée).
2. **N2 — Contradiction de contrat à signaler (renforcement).** `refresh.dto.ts:19-23` borne `nonce` à 16-64
   caractères `[A-Za-z0-9+/=_-]` et `refresh_token` à 16-128 `[A-Za-z0-9_-]` ; `openapi.yaml`
   (`DeviceTokenRefreshRequest`) ne pose que `minLength: 16` sur `nonce`, sans jeu de caractères. Un terminal conforme
   à l'openapi qui enverrait un nonce avec un autre caractère, ou de plus de 64, recevrait 400. Sens : renforcement
   (découpage du message sans ambiguïté, borne de la table `device_request_nonce`). À trancher par le porteur : préciser
   l'openapi (pattern + `maxLength: 64`) dans WP18, ou élargir le DTO.
3. **N3 — Lecture d'ADR-108 à confirmer (antérieur, WP04).** La grâce remplace la paire dont le jeton de
   rafraîchissement n'a pas servi (`s.consumed_at IS NULL`), même si son jeton d'appareil a déjà servi : le test
   NFR-008 (`refresh.spec.ts:351-359`) l'illustre (le premier a utilisé son jeton d'appareil, la reprise après 409
   remplace quand même sa paire). Ce jeton d'appareil reste valable jusqu'à son expiration (15 min, famille active).
   ADR-108 dit « la paire émise et jamais utilisée ». Risque faible (même certificat et même clé exigés) ; ne
   l'élargit pas par rapport à la fonction de WP04. Proposition : préciser le texte d'ADR-108 (« dont le jeton de
   rafraîchissement n'a jamais servi ; le jeton d'appareil de cette paire reste valable jusqu'à son expiration »).
4. **N4 — Antérieur (WP04), pour mémoire.** Terminal `SUSPENDED` : un jeton consommé représenté avec le bon
   certificat rend `SUSPENDED` (étape 5 de la fonction) sans révoquer la famille ; le nonce est consommé avant ce 403.
   Exige les clés du terminal ; pas d'action proposée.
5. **N5 — Test d'audit incomplet.** `refresh.spec.ts:238-252` n'assertit ni `request_id` (posé à
   `refresh.service.ts:249`) ni `same_device`. Ajouter une assertion de présence (WP18 ou correctif léger).
6. **N6 — Horloge.** `refresh.service.ts:95` appelle `peerCertificate(req, new Date())` (non injectable,
   contrairement à la garde) : la validité du certificat n'est pas testable par horloge simulée. Cosmétique.

## Reports proposés

- Vers WP18 : test de bout en bout sur la branche combinée : `POST /v1/devices/:id/revoke` (back-office) puis
  rafraîchissement avec preuves valides → 403 `DEVICE_REVOKED`, avec preuve fausse → 401, rien d'écrit (N1).
- Vers WP18 : préciser `DeviceTokenRefreshRequest` dans `openapi.yaml` (pattern et `maxLength` de `nonce`, jeu de
  caractères de `refresh_token`, signature `ieee-p1363` de 64 octets) si le porteur garde le DTO (N2).
- Vers WP18 : assertion de `request_id` dans l'audit `DEVICE_TOKEN_REUSE` (N5).

## Texte proposé (l'orchestrateur l'écrit si le porteur l'accepte)

ADR-108, ajout à « Décision » : « La paire remplacée est celle dont le jeton de rafraîchissement n'a jamais été
échangé ; son jeton d'appareil, s'il a déjà servi, reste valable jusqu'à son expiration (15 min). »

Aucun nouveau point ouvert : pas d'écart qui affaiblit la sécurité.

## Fichiers à faire relire par une personne

- `apps/api/src/devices/tokens/refresh.service.ts` (mTLS, lecture de `O=`, vérification ECDSA, ordre nonce /
  échange, audit de réutilisation).
- `apps/api/src/devices/tokens/refresh.dto.ts` (message signé à séparateur de domaine).
- `apps/api/src/device-identity/real-device-identity.ts` (`peerCertificate`, partagé par la garde ; version combinée
  avec l'étape 6 bis de WP16).

VERDICT: APPROVE
