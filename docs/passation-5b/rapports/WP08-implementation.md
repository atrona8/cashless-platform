# Compte rendu du lot WP08 — Socle : argon2, secret, contexte du terminal, idempotence, garde, erreurs

Lane `lane-h`, commit `38faf72a` (`feat(WP08): …`). Sous-tâches T032 à T038 marquées `done`. Pas de `move-task`.

## Reprise d'une session interrompue

**Venu de la session précédente** (non commité, relu point par point contre le prompt, gardé tel quel sauf mention) :
toute la partie `src/` (`config.ts`, `vendor-pin/` ×3, `device-identity.module.ts` avec `PublicDeviceDirectory` et
`PublicDeviceIdentityModule`, `device-identity.port.ts`, `device.guard.ts`, `device-or-caller.guard.ts`,
`identity-tenant-context.ts`, `idempotency/` (`device-key.ts`, intercepteur, décorateur), `errors/` (`sqlstate-map.ts`,
`redact.ts`, `problem.filter.ts`), `app.module.ts`, `enrollment.service.ts`), `package.json`/`package-lock.json`,
`env.sh`/`env.test.example`, `test/support/{test-terminal,tls}.ts`, `device-auth-cases/registry.ts`, la matrice des
preuves et le test d'intégration `CL031` de `enrollment.spec.ts`. Relecture : aucun défaut trouvé ; typecheck vert tel quel.

**Ajouté par cette session** : tous les tests unitaires du lot (aucun n'existait) :
`test/unit/vendor-pin/{argon2-supply-chain,vendor-pin.hasher}.spec.ts`,
`test/unit/device-route/{device-context,device-key,device-or-caller.guard,tenant-context}.spec.ts`, compléments de
`test/unit/config.spec.ts` (VENDOR_PIN_SECRET) et `test/unit/errors/sqlstate-map.spec.ts` (CL031–CL040, `23505`,
`redactSecrets`, `logProblem`) ; `npm audit signatures` ; lint, typecheck, Jest.

## Écarts au plan (et leur sens)

1. **Verrou : une entrée de plus que la liste attendue** — `node_modules/@epic-web/invariant@1.0.0` (dépendance de
   `cross-env@10.1.0`), et `node-addon-api@8.9.2` imbriqué sous `argon2/node_modules` (la racine garde sa version).
   Le prompt dit « toute autre entrée nouvelle : s'arrêter et signaler » : **signalé ici, à trancher par
   l'orchestrateur/porteur**. Aucune n'a de script d'installation (testé), `ignore-scripts=true`. Neutre pour la
   sécurité à l'exécution (cross-env n'est jamais chargé), mais surface de chaîne d'approvisionnement un peu plus large
   qu'écrit dans R-01 ; option : l'ajouter à R-01 / document 08.
2. **`cross-env` installé en production** (R-01 le prévoyait, signalé) ; en conséquence `cross-spawn`, `isexe`,
   `path-key`, `shebang-command`, `shebang-regex`, `which` perdent `"dev": true` dans le verrou (même versions).
3. **Vecteur figé « calculé avec le secret » (plan)** impossible avec le secret de production : le calcul est prouvé
   par le vecteur RFC 9106 §5.3 (secret 8 × 0x03, données associées 12 × 0x04 — `associatedData` est bien exposé par
   0.44.0), le secret de production par l'aller-retour au démarrage (dont « empreinte sans secret refusée »). Consigné.
4. **Renforcements** (faits, à consigner) : `redactSecrets` masque aussi `$argon2i$`/`$argon2d$` et les noms préfixés
   (`refresh_token`, `device-token`…) ; `assertDeviceMode` refuse un contexte sans mode lu ; la garde exclusive refuse
   une route sans options (jamais d'appelant par défaut) et traite un en-tête de signature vide comme marqueur ;
   `verify` rend faux pour un PIN hors motif même après calcul.
5. Le relâchement de clé sur `DEBIT_AUTHORITY_MOVING`/`EDGE` vaut pour **toutes** les routes `@Idempotent` (le prompt
   le place dans `onError`, global) : un refus non définitif levé par la base (`CL006`) n'est plus enregistré sur les
   routes existantes non plus. Rien n'est écrit dans ce cas (transaction annulée), donc le rejeu ne refait aucune
   écriture refusée ; à confirmer par le relecteur.

## Retouches hors carte (une ligne chacune)

- `apps/api/src/app.module.ts` : import de `VendorPinModule` (autorisé) **et** `DeviceIdentityModule` →
  `PublicDeviceIdentityModule` (mécanisme « deux fournisseurs de `DEVICE_DIRECTORY` » de T034).
- `apps/api/src/devices/enrollment/enrollment.service.ts` : `ENROLLMENT_EVENT_CLOSED: 'EVENT_CLOSED'` (report de WP06).
- `apps/api/test/integration/devices/enrollment.spec.ts` : test d'intégration du refus `CL031` (report de WP06).
- `apps/api/test/support/tls.ts` : `VENDOR_PIN_SECRET` dans `DEVICE_PRODUCTION` (configuration de production des tests).
- `apps/api/test/unit/errors/sqlstate-map.spec.ts` : couvert par l'arbitrage (dossier ajouté à la carte).

## Points soumis au porteur / à l'orchestrateur

- Entrée `@epic-web/invariant` du verrou (écart 1) — pas un affaiblissement codé, mais la consigne demandait de signaler.
- **Test d'intégration `CL031` rouge dans cette lane** : la lane n'a pas la migration 0035 (WP06) — reçu `201` au lieu
  de `422`. À jouer sur la combinaison des lanes (lane-f + lane-h). Il utilise `session_replication_role = 'replica'`
  (propriétaire) pour clore l'événement après l'émission du code (amorçage seulement).
- Plateforme de production non arrêtée (OP-N11) : le test des empreintes échoue explicitement sur une plateforme absente
  de R-01 (ex. `darwin-arm64`, `linux-arm64`).
- Aucun écart qui affaiblit la sécurité n'a été codé ; aucun nouveau faux (production-guard.ts inchangé).

## Fichiers à faire relire par une personne

`apps/api/src/vendor-pin/` (les trois fichiers), `apps/api/src/config/config.ts` (secret), 
`apps/api/src/device-identity/device-or-caller.guard.ts`, `apps/api/src/identity/identity-tenant-context.ts`,
`apps/api/src/device-identity/device-identity.module.ts` (requête enrichie, séparation des processus),
`apps/api/src/errors/redact.ts`.

## Critères d'acceptation couverts (preuve)

Commandes depuis la lane, base `cashless_wp08` (`reset-db.sh` avec `PGDATABASE=cashless_wp08`, supprimée à la fin).

| Critère | Preuve |
|---|---|
| NFR-009 (secret) | `config.spec.ts` : « NFR-009 : production sans VENDOR_PIN_SECRET → démarrage refusé… », « NFR-009 : production, VENDOR_PIN_SECRET égal à un autre secret… », « production : les secrets de test sont refusés même posés explicitement », « production : VENDOR_PIN_SECRET obligatoire » |
| NFR-009 (vecteur faux) | `vendor-pin.hasher.spec.ts` : « binaire faux (autre étiquette) : démarrage refusé », « binaire qui ignore le secret », « VendorPinModule.onModuleInit : échec du test → exception » |
| A16 | `argon2-supply-chain.spec.ts` (version, intégrité, dépendances, empreinte du binaire chargé `darwin-x64` = R-01, binaire réellement chargé vérifié dans un processus séparé) ; `npm audit signatures` : « 580 packages have verified registry signatures ; 102 packages have verified attestations », dont `argon2@0.44.0` (attestation vérifiée) |
| NFR-004 | `vendor-pin.hasher.spec.ts` : verify(null) toujours calculé contre l'empreinte factice (mêmes paramètres, même secret), non instantané |
| A13 | `device-or-caller.guard.spec.ts` (16 cas : certificat seul, signature seule, jeton + marqueur → 401 sans repli ; personne, festivalier, terminal complet) |
| A14 | `device-key.spec.ts` (motif, autre serial, seq < 4 chiffres, refus avant réservation, clé relâchée sur les deux codes et sur CL006, enregistrée sur un autre 409) ; `tenant-context.spec.ts` |
| T034 | `device-context.spec.ts` (DEVICE_QUERY inchangée, processus des clés n'exécute jamais la requête large, câblage des modules) |
| A19 | `sqlstate-map.spec.ts` (`23505` traduit seulement pour `journal_transaction_reverses_once`, `__proto__`/`toString` → 500) |
| T037 | `sqlstate-map.spec.ts` (CL031–CL040 au statut du contrat, ADR-123 ; `redactSecrets` ; `logProblem` masqué) |
| T038 / matrice | `device-auth-matrix.spec.ts` vert, aucun `*.cases.ts` → contenu inchangé |

- `npx eslint .` : 0 problème. `npx tsc --noEmit -p apps/api/tsconfig.json` : 0 erreur. Prettier : conforme.
- Jest complet (`SKIP_LATENCY=1 npx jest`, après `reset-db`) : 107 suites, 1831 réussis, 6 ignorés, **2 échecs** :
  `enrollment.spec.ts` (CL031, attendu : 0035 absente de la lane) et `claim-code-order.spec.ts` (délai de 5 s,
  instabilité connue). Rejeu après `reset-db` : `claim-code-order` + `device-auth-matrix` : 29/29 verts.
- pgTAP non rejoué : le lot ne touche aucun SQL.
