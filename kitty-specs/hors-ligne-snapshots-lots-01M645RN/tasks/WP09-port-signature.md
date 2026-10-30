---
work_package_id: WP09
title: Port de signature, faux déterministe, garde de production, rotation par key-admin
dependencies: [WP04]
requirement_refs:
- FR-037
- NFR-008
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T038, T039, T040, T041]
phase: Phase 2 - Ports et processus
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/kms/
create_intent: [apps/api/src/snapshot-keys/snapshot-key-admin.worker.ts, apps/api/src/snapshot-keys/snapshot-keys.module.ts, apps/api/test/unit/kms/sign-port.spec.ts, apps/api/test/integration/snapshot-keys/rotation.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/kms/**, apps/api/src/processes/bootstrap.ts, apps/api/src/processes/key-admin.module.ts, apps/api/src/snapshot-keys/**, apps/api/test/unit/kms/**, apps/api/test/unit/production-guard.spec.ts, apps/api/test/integration/snapshot-keys/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Port de signature et faux

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `research.md` R-07 et R-30.8, `contracts/interfaces.md`
§ 3 (fin : `rotate_snapshot_signing_key`, `snapshot_public_keys`) et § 8 (ligne `SignPort`),
`contracts/snapshots.md` (« Garde de production »), `spec.md` FR-009, FR-037, NFR-008.
Priorité des sources (SPECIFICATION §0.3) : en cas de contradiction, la signaler, ne pas choisir en
silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Ajouter le port de signature `SignPort` (capacité `sign`, clé `ECC_NIST_P256`) au service de clés, avec
un faux déterministe qui refuse de démarrer en production. Faire créer la clé de signature et appeler
`rotate_snapshot_signing_key` (WP04) par la commande `key-admin`, qui ne reçoit toujours pas `sign`.
Le lot ne crée aucun processus : `snapshot-signer` (WP13) consommera le port.

## Périmètre et arbitrages

Dans le lot : `SignPort`, `SIGN_PORT`, `KmsCapability 'sign'`, `KmsKeyKind 'ECC_NIST_P256'`
(`kms/kms.ports.ts:27-52`) ; le faux (`kms/fake-kms.ts`) ; `KmsModule.forCapabilities(['sign'])`
(`kms/kms.module.ts:21`) ; la garde (`kms/production-guard.ts`, `processes/bootstrap.ts:31`) ; la
création de clé et la rotation (`snapshot-keys/`, branchée dans `processes/key-admin.module.ts`).
Hors lot : le processus `snapshot-signer` (WP13), l'adaptateur AWS (mission 12b, dette nommée :
aucun snapshot n'est servi en production avant 12b), la lecture de la clé publique par l'API (WP15).
Décisions : R-30.8 « aucun `sign` pour `key-admin`, qui crée la clé par `KeyAdminPort` » ; signature
DER, clé publique SPKI DER (R-07) ; `sign` seul pour `snapshot-signer`.
Aucune retouche de `apps/api/src/media/keys/key-admin.worker.ts` (hors carte) : il sert de modèle.

## Subtasks

### T038 – Port, capacité, module

But : `SignPort { sign(kmsKeyRef: string, message: Uint8Array): Promise<Buffer>; publicKey(
kmsKeyRef: string): Promise<Buffer> }` (forme figée, `interfaces.md` § 8).
- `kms/kms.ports.ts` : ajouter l'interface, `SIGN_PORT = Symbol('SIGN_PORT')`, `'sign'` dans
  `KmsCapability`, `sign: SIGN_PORT` dans `KMS_PORT_TOKENS` (`:35-40`), `'ECC_NIST_P256'` dans
  `KmsKeyKind` (`:30`). Mettre à jour le commentaire du tableau des droits (`:3-8`) : ligne
  `signature des snapshots : SignPort`.
- `kms/kms.module.ts` : rien à changer si `KMS_PORT_TOKENS` est complété ; le vérifier par un test.
- Le message signé est `JCS(header)` en octets ; le port hache (SHA-256) lui-même, comme
  `kms:Sign` avec `ECDSA_SHA_256` et `MessageType RAW`. Le dire en commentaire du port.
- Critère : un processus qui demande `['sign']` n'injecte que `SIGN_PORT` ; `DECRYPT_PORT` et les
  autres lèvent une erreur d'injection (même forme que `test/unit/kms/kms-module.spec.ts`).

### T039 – Faux déterministe

Fichier : `kms/fake-kms.ts` (classe `FakeKms`, `:39`, qui implémente déjà quatre ports).
- Ajouter `implements SignPort`, `PREFIX.ECC_NIST_P256 = 'fake-kms:ecc:'` (`:22`), les opérations
  `'sign'` et `'publicKey'` dans `KmsOperation`/`calls`/`failNext` (`:32-48`), et `createKey('ECC_
  NIST_P256')` (`:108`).
- Clé P-256 dérivée de la référence : scalaire privé = HMAC-SHA256(`SEED`, référence) (comme
  `key()` pour les autres clés, `:128`) ; si le scalaire n'est pas dans `[1, n-1]`,
  réitérer avec un compteur. Construire la clé par `createPrivateKey({key: jwk, format: 'jwk'})`
  ou `createECDH('prime256v1').setPrivateKey` ; mettre le scalaire à zéro après usage (`zeroize`).
- `sign` : `crypto.sign('sha256', message, {key, dsaEncoding: 'der'})` ; `publicKey` : SPKI DER
  (`createPublicKey(...).export({type: 'spki', format: 'der'})`). Clé de type ou référence inconnue :
  `KmsKeyError` ; panne injectée : `KmsUnavailableError` (comme `enter`, `:120`).
- Déterminisme : deux instances de `FakeKms` donnent la même clé publique pour la même référence
  (les processus `key-admin` et `snapshot-signer` ne partagent aucun état : risque du plan IC-04).
  La signature, elle, n'est pas déterministe (ECDSA aléatoire) : ne pas le tester.
- Critère : `crypto.verify` (clé publique du faux) valide la signature DER ; une signature sur un
  autre message ou une autre référence échoue ; `isFake === true`.

### T040 – Garde de production

- `createKms` (`kms/kms.module.ts:13`) refuse déjà de construire le faux en production : vérifier
  que c'est vrai pour une configuration qui ne demande que `['sign']`.
- `assertProcessIsSafe` (`processes/bootstrap.ts:31`) : le faux est vu par `KMS_PROVIDER`. Ajouter
  l'entrée « le signataire de snapshots » si un jeton `SIGN_PORT` est résolu (même méthode
  `optional`, `:22`), pour que le message nomme le port. Ne rien retirer à la garde.
- Étendre `bootstrap.ts` pour les processus à cadence d'une seconde : `runWorkers(rootModule, argv,
  options?: { pollSeconds?: number })`. Aujourd'hui l'intervalle vient de `TAG_JOB_POLL_SECONDS`
  (5 s par défaut, `:83-90` et `:155`) ; `snapshot-content` et `snapshot-signer` (WP11, WP13) ont
  besoin de `SNAPSHOT_POLL_SECONDS` (1 s). Sans `options`, comportement inchangé. Le test
  d'architecture « deux appels à `assertProcessIsSafe(app)` » (`architecture.spec.ts:221`) doit
  rester vrai : n'ajoute pas de troisième appel.
- Tests dans `test/unit/production-guard.spec.ts` : (a) `createKms({production: true})` lève
  `FakeInProductionError` ; (b) la garde de démarrage refuse un processus dont le fournisseur de
  `SIGN_PORT` a `isFake` (modèle des lignes 116-140 du fichier) ; (c) hors production, accepté.
- Critère : aucun réglage ne désactive la garde ; les tests existants du fichier passent.

### T041 – Création de la clé et rotation par `key-admin`

Modèle : `media/keys/key-admin.worker.ts` (`:20` classe, `:71` `createKey`, reprise sans double effet
par `progress.kms_key_ref`), `processes/key-admin.module.ts:11`.
- Nouveau `snapshot-keys/snapshot-key-admin.worker.ts` (`ProcessWorker`, nom `snapshot-key-admin`,
  inscrit au `WorkerRegistry`) et `snapshot-keys/snapshot-keys.module.ts`, importé par
  `processes/key-admin.module.ts` à côté de `MediaKeyAdminModule`. `KmsModule.forCapabilities` reste
  `['keyAdmin']` seul : le test d'architecture le vérifie.
- Étapes : `kms.createKey('ECC_NIST_P256')` → référence ; obtenir la clé publique SPKI ; appeler
  `rotate_snapshot_signing_key(p_new_key_id, p_public_key, p_kms_key_ref, p_actor)` (WP04, rôle
  `cashless_keyadmin`) dans une transaction courte ; `CL054` (troisième clé) : échec nommé, rien
  d'autre. Ne pas créer deux clés si le travail est repris : noter la référence avant l'appel.
- **Deux points non tranchés par le plan, à ne pas deviner** (voir Sécurité) : (1) comment
  `key-admin` obtient la clé publique sans `sign` (`KeyAdminPort` n'a que `createKey` et
  `disableKey`) ; (2) ce qui déclenche une rotation (aucune table de travaux ni action
  d'approbation n'est prévue pour cette clé). Proposition à soumettre à l'orchestrateur AVANT de
  coder ces deux points : (1) ajouter `publicKey(ref)` en lecture seule à `KeyAdminPort`
  (une clé publique n'est pas un secret) ; (2) une rotation par passage explicite de l'exploitant
  (`--once` avec `SNAPSHOT_KEY_ROTATE_ACTOR=<uuid de la personne>` posé, sinon le travailleur ne
  fait rien) ; `p_actor` est cette personne. Le reste du lot avance sans attendre la réponse.
- Critère : `--list` décrit la rotation en attente ; `--once` crée la clé, inscrit une clé `ACTIVE`
  `CENTRAL`, retire l'ancienne (`RETIRED`) ; deuxième exécution sans variable : 0 unité.

## Sécurité

- Écart qui renforce ou laisse égal : se fait. Tout élargissement de port est un écart soumis au
  porteur avant d'être codé (règle 1 de `CLAUDE.md`). Ajouter `publicKey` à `KeyAdminPort` n'est
  pas un secret mais change une forme figée : le signaler, ne pas le décider seul.
- Le faux est interdit en production (règle 2) : test (a) et (b) de T040 obligatoires.
- `key-admin` ne reçoit jamais `sign` ; `snapshot-signer` ne reçoit que `sign` ; test d'architecture
  mis à jour par WP10 (qui possède `architecture.spec.ts`) : indique-lui dans ton rapport la ligne
  `CAPABILITIES` et le jeton `SIGN_PORT` à ajouter.
- Aucun scalaire privé du faux dans un journal, un message d'erreur ou un retour ; tampons mis à zéro.
- **À faire relire par une personne** : `kms/fake-kms.ts` (dérivation de clé, signature),
  `kms/kms.ports.ts`, `processes/bootstrap.ts`, `snapshot-keys/**`. L'agent qui a écrit le code ne
  vaut pas relecture indépendante (règle 4).

## Tests

- `test/unit/kms/sign-port.spec.ts` (nouveau) : signature vérifiable par `crypto.verify`, DER
  (premier octet `0x30`), SPKI importable, deux instances = même clé publique, référence d'un autre
  type refusée, panne injectée, désactivation.
- `test/unit/kms/kms-module.spec.ts` (existant, dans le périmètre) : ligne `sign` du tableau.
- `test/unit/production-guard.spec.ts` : T040.
- `test/integration/snapshot-keys/rotation.spec.ts` (nouveau) : T041, y compris la troisième clé
  (`CL054`) et la reprise sans seconde clé. Base de lot `cashless_wp09`, rôle `cashless_keyadmin`.
- Commandes (le lot ne lance pas Jest sur `cashless_test`, l'orchestrateur relance en série) :
  `npx jest test/unit/kms test/unit/production-guard.spec.ts` ; intégration en base de lot.

## Ce que le relecteur doit casser

1. Demander `['sign', 'decrypt']` à `KmsModule.forCapabilities` dans `key-admin.module.ts` : le test
   d'architecture doit échouer.
2. Construire `FakeKms` avec `production: true` via `createKms`, ou fournir un faux `SIGN_PORT` à un
   processus de production : démarrage refusé.
3. Signer avec une référence `fake-kms:hmac:…` : `KmsKeyError`.
4. Comparer les clés publiques de deux instances pour une même référence : égales ; deux références :
   différentes.
5. Rejouer la rotation après un arrêt entre `createKey` et `rotate_snapshot_signing_key` : une seule
   clé de plus dans `snapshot_signing_key`.
6. Une signature DER mal formée (r ou s sur 31 octets) reste vérifiable : pas de format brut P1363.
7. Lancer `--once` sans l'acteur : aucune clé créée, aucun appel au service de clés.
8. `runWorkers` sans `options` : intervalle encore lu dans `TAG_JOB_POLL_SECONDS`.

## Definition of Done

- [ ] `SignPort`, `SIGN_PORT`, capacité et `ECC_NIST_P256` ajoutés, formes de `interfaces.md` § 8.
- [ ] Faux déterministe : signature DER vérifiable, clé SPKI, mêmes clés entre instances.
- [ ] Garde de production : tests (a), (b), (c) verts ; aucun nouvel appel à `assertProcessIsSafe`.
- [ ] `runWorkers` accepte `pollSeconds` ; comportement par défaut inchangé.
- [ ] Création de clé et rotation par `key-admin` ; deux points non tranchés soumis à l'orchestrateur.
- [ ] Rapport : fichiers à relire par une personne, lignes à ajouter dans `architecture.spec.ts`.
- [ ] Lignes de 100 caractères au plus ; aucun `.sql` généré modifié.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP09 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
