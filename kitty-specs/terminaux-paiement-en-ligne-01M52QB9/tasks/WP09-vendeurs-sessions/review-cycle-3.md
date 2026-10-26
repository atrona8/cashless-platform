---
affected_files: []
cycle_number: 3
mission_slug: terminaux-paiement-en-ligne-01M52QB9
reproduction_command: spec-kitty agent tasks move-task WP09 --to approved --mission terminaux-paiement-en-ligne-01M52QB9
reviewed_at: '2026-10-26T12:36:18Z'
reviewer_agent: user
wp_id: WP09
---

# Relecture WP09, cycle 3 : APPROUVÉ (commit 69dc4908, diff 8ddd0863..69dc4908)

Relecteur distinct (n'a pas écrit le code). Base cashless_wp09r (supprimée). Arbre de la lane propre.

## Tests rejoués (base cashless_wp09r)
tsc --noEmit : propre. Jest en série : vendeurs (unitaire + intégration), vendor-pin, idempotence (unitaire +
intégration), transverse/idempotency, device-route, config, architecture : 15 suites, 286 réussis, 0 échec.
Tests de concurrence (vendor-sessions, -t "terminal|verrou") : 3 passages de suite, 8/8 chaque fois. Prettier --check
des .ts du diff : propre.

## Vérifications demandées
- Ordre : RequestLockInterceptor enregistré avant IdempotencyInterceptor (idempotency.module.ts:17-18) ; la mutation
  « ordre inversé » (M2) fait échouer 3 tests (aucun argon2 pour le second essai ; 429 rendu). Preuve réelle.
- Relâchement : `finalize` couvre succès, refus, erreur observable et désabonnement ; verrou libre prouvé après succès,
  refus de PIN, 500 dans le dérivé, 409 de clé réutilisée, 422. `next.handle()` est paresseux (defer) : pas de fuite
  si une exception est levée avant. Le service ne reprend plus de verrou (PinAttemptLock supprimé).
- session-lock.ts : `done` garantit un relâchement unique ; déverrouillage faux ou en erreur -> `client.release(true)`
  (connexion détruite) ; erreur de requête au verrouillage -> connexion détruite ; `LOCK_BUSY` rend la connexion.
- 429 avant contrôles de clé/mode/corps : pas de fuite. Les gardes (DeviceAuth) passent avant les intercepteurs ;
  un appelant non authentifié reçoit 401 avant tout verrou ; l'identifiant vient de `requestDevice(req).deviceId`
  (terminal authentifié), donc un terminal ne peut occuper ou voir que son propre verrou ; aucun autre terminal ne
  peut obtenir un 429 à cause de lui (M10, verrou global, est détecté). Seul un terminal authentifié concurrent de
  lui-même peut recevoir un 429 avant un 422/409/mode refusé : sans information nouvelle.
- Secret : VENDOR_PIN_IDEMPOTENCY_SECRET suit `hmacKey` (32 octets, hex/base64, exigé en production, secret de test
  refusé via TEST_HMAC_KEYS, distinct via assertDistinctHmacKeys) ; le hacheur refuse < 32 octets ou égal à l'autre
  secret ; le dérivé n'utilise plus VENDOR_PIN_SECRET (testé dans les deux sens). Environnements de test mis à jour.

## Mutations (suites : vendor-pin, config, vendor-sessions, transverse/idempotency)
| # | Mutation | Résultat |
|---|---|---|
| M1 | retirer `pinFields` de createVendor | détecté (témoin création de vendeur : empreinte = HMAC du clair) |
| M2 | verrou posé après l'idempotence | détecté (3 échecs) |
| M3 | verrou jamais relâché | détecté (8 échecs ; la suite reste suspendue jusqu'à interruption, pool non fermé) |
| M4 | dérivé sous VENDOR_PIN_SECRET | détecté (2 échecs hasher) |
| M5 | secret d'idempotence non exigé en production | détecté (3 échecs config) |
| M6 | tout 429 non définitif | détecté (1 échec idempotency) |
| M7 | secret de test d'idempotence accepté en production | détecté (1 échec config) |
| M8 | secret d'idempotence hors assertDistinctHmacKeys | détecté (1 échec config) |
| M9 | verrou relâché avant la chaîne | détecté (2 échecs) |
| M10 | verrou global au lieu de par terminal | détecté (2 échecs) |
Toutes les mutations sont annulées (`git checkout`).

## Constats
1. MINEUR : commentaires de plus de 100 caractères (Prettier ne reflue pas les commentaires, `--check` passe) :
   vendor-pin.hasher.ts (~l.98-102, le commentaire ADR-126 qui mentionne « Une valeur qui n'est pas un PIN de 6 »),
   request-lock.ts (en-tête), pin-attempt-lock.ts (~l.8), session-lock.ts (tryRun), config.ts (JSDoc du nouveau
   champ), tests (titres `it`) et env.sh. À reformater au passage de la fusion (décision du 14/10), non bloquant.
2. MINEUR : le verrou tient une connexion du pool dédié pendant toute la requête (argon2 compris) ; au-delà de
   `poolSize` terminaux simultanés, `pool.connect` attend 10 s puis lève une erreur (500). Dimensionnement, pas faille ;
   à surveiller en charge (WP14).
3. MINEUR : M3 (verrou jamais relâché) fait pendre Jest au lieu d'échouer net (pool non fermé) ; détecté quand même.

Défauts antérieurs à la mission : aucun nouveau.

## Écarts de sécurité ouverts
Aucun nouveau. Le cycle renforce : secret distinct, argon2 évité pour l'essai refusé. ADR-126 (complément), OP-N77,
PRD.md et PROMPTS-A-ENVOYER.md citent VENDOR_PIN_IDEMPOTENCY_SECRET.

## Fichiers à faire relire par une personne
config.ts (secrets), vendor-pin.hasher.ts (cryptographie, dérivé argon2), db/session-lock.ts et
idempotency/request-lock.ts (verrous, connexions), tools/dev-db/env.sh (secrets de test).

## Reports WP11 à WP14
- WP11-WP13 : ordre d'appel de VendorSessionGuard (inchangé du cycle 1) ; alignement de contracts/vendors.md ;
  propriétaire des fonctions de purge sous RLS forcée.
- Toute route future à verrou de requête : `@RequestLock` avant `@Idempotent`, id issu du terminal authentifié.
- WP14 : dimensionnement du pool de SessionLock ; exiger VENDOR_PIN_IDEMPOTENCY_SECRET dans les manifestes de
  déploiement et la rotation (invalide les empreintes d'idempotence des routes PIN seulement).
