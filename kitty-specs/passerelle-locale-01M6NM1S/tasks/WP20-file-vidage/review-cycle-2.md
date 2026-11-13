---
affected_files: []
cycle_number: 2
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-09T12:13:12Z'
reviewer_agent: claude
wp_id: WP20
---

# Constats WP20 cycle 2 (correction 88b008d0)

Batterie test/queue test/startup test/authority : 24 suites, 338 tests verts ; tsc --noEmit propre.
Mutations (un contrôle retiré, tests client-key-file + startup-guard + hardening) : symlink, mode (groupe,
autres), répertoire (mode groupe, autres), fichier absent en prod, contrôle config.ts, règle startup-guard
DELTA_PURGE : tués. SURVIVANTS : voir ci-dessous.

1. BLOQUANT : le câblage de bootstrap.ts n'est prouvé par aucun test. Mutations survivantes sur toute
   test/startup : (a) retrait de `clientKeyDistinctViolations(...)` de `assertRuntimeSafe` ; (b) remplacement de
   `app.get(DrainService).hasDeltaPurge` par `true`. Cause : `child-main.ts` force `hasDeltaPurge = true` par
   defineProperty pour tout démarrage de production, et aucun test ne démarre un vrai processus (production) sans
   ce correctif pour constater le refus `DELTA_PURGE`, ni avec une clé client égale à une clé du port pour constater
   le refus (b de la décision 32). Les tests n'exercent que les fonctions pures. Correction : tests de processus
   (child) (1) production sans le defineProperty -> arrêt avec message `DELTA_PURGE` ; (2) production avec clé client
   identique à la clé du port -> arrêt ; le defineProperty doit devenir une option explicite du test positif
   seulement (il reste confiné à test/, vérifié : pas dans src).
2. BLOQUANT (décision 32, TOCTOU) : `loadTrust` contrôle par `lstat` puis lit par `readFileSync(keyFile)` : lecture
   par chemin, pas sur le descripteur contrôlé ; `clientKeyDistinctViolations` relit aussi par chemin. Un fichier
   remplacé entre contrôle et lecture (lien symbolique, mode élargi) passe. Correction : `openSync(file,
   O_RDONLY|O_NOFOLLOW)`, `fstatSync(fd)` (mode, uid, isFile) puis lecture sur ce même fd ; mêmes primitives pour la
   comparaison des publics ; test (remplacement par un lien ou chmod après ouverture/avant lecture simulé).
3. Mineur : mutants survivants sans test : propriétaire du fichier, propriétaire du répertoire, `isFile` (FIFO /
   répertoire), et le contrôle refait dans `central-client.ts::loadTrust` (retiré : 240 tests verts). Ajouter des
   tests (uid simulé via spy sur process.getuid ; fichier 0600 durci puis chmod 0644 avant premier loadTrust).
4. Mineur : `withLockForTest` exporté sans condition depuis src (faux de développement refusé en production, donc
   sans portée de sécurité) ; acceptable, à noter. Verrou à jeton : relu, la course (suppression du verrou frais
   d'un autre) est corrigée (reprise sérialisée par .break, suppression conditionnée au contenu) ; test à quatre
   processus passe.
