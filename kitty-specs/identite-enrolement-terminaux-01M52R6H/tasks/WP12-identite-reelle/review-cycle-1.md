---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command: spec-kitty agent tasks move-task WP12 --to approved --mission identite-enrolement-terminaux-01M52R6H
reviewed_at: '2026-10-20T15:19:32Z'
reviewer_agent: user
wp_id: WP12
---

Approved by user: Relecture indépendante (session distincte de l'implémenteur), verdict enregistré par l'orchestrateur. # WP12 : relecture indépendante, APPROUVÉ (20/10/2026)

Diff relu : `b52170b..ddc4520` (lane l). Tests sur un cluster PG18 privé (port 5494) : pgTAP 1972/1972, Jest 1493/1493.
L'ordre des contrôles suit `contracts/device-authentication.md` (1 à 7, puis le statut dans la garde). Aucune preuve
n'est facultative. Le nonce n'est écrit qu'après le certificat, le jeton, le terminal et sa famille, la liaison
cert/jkt, le `Content-Digest`, l'`@authority` et la signature. Les refus ne disent pas quelle preuve a échoué ; le
journal ne contient ni jeton, ni signature, ni certificat. Le faux d'identité n'existe que hors production et sous
`DEVICE_IDENTITY_FAKE=1` ; en production, il fait refuser le démarrage (test). `X-Staff-Authorization` n'est lu que
sur les 9 routes `@CounterAuth()` et il est refusé sur `/taps` et sur le processus des clés. Un jeton de personne
placé dans `Authorization` est refusé.

20 mutations sur 23 font échouer au moins un test : TLS/authorized, validité, famille, cert_sha256, jkt, digest,
authority, rawBody, nonce sauté, nonce écrit trop tôt, keyid, composants, idempotency-key, expires, @query, refus du
jeton de la personne dans DeviceGuard, nfcOnly, suspendu, faux en production, source du jeton de la personne,
`assert_device_active` dans AuthKeysService.

Trois mutations passent tous les tests (mineurs, sans faille de sécurité constatée) :
- M1 `authentication.guard.ts:37` : retirer le refus de `X-Staff-Authorization` hors des routes de guichet ne fait
  échouer aucun test. Sur `/taps`, la garde des terminaux refuse quand même. Une route des personnes ou une route
  publique de l'API publique n'est pas testée. Ajouter un test (WP18).
- M2 `tap.service.ts:49` et `counter-access.ts:65` : aucun test ne couvre `assert_device_active` sur ces deux chemins.
  Le test de révocation pendant une requête en cours est confié à WP16.
- M3 `config.ts` `requestAuthorities` : rien ne teste que le joker `:*` est refusé en production, ni que le réglage
  est obligatoire en production. C'est un renforcement, mais non prouvé.
- M4 (redondance) `request-signature.ts:278` : le contrôle de longueur à 64 octets est redondant avec `ieee-p1363`.

Point à faire confirmer par le porteur : les purges sont accordées à `cashless_app`. Les relectures de WP03 et WP07
disaient « pas à cashless_app ». Les reports de WP04 et WP07 donnaient ce droit au processus qui les planifie, et ce
processus est l'API publique. Le risque est faible : ce sont des fonctions SECURITY DEFINER qui ne retirent que des
lignes au-delà de leur fenêtre. Orchestrateur : pgTAP 1972/1972 et Jest API 1493/1493 (SKIP_LATENCY) sur la base partagée. --force autorisé par le porteur : garde kitty-specs limité aux artefacts du runtime, vérifié après réalignement.
