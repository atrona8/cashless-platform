# Contrat : contrôle de stabilité en CI (NFR-012, SC-006, C-002)

Objectif : prouver, à chaque exécution de la CI, que `packages/contracts/openapi.yaml` n'a pas bougé pour les équipes
clientes, et que le seul écart admis est l'ajout facultatif décrit dans `replication-page-additions.yaml`.

Rien de ce qui suit n'existe encore : c'est la cible de mise en oeuvre (IC-15). Aucun fichier du dépôt n'est modifié par ce
document.

## Référence

| Élément | Valeur |
|---|---|
| Contrat de référence | `packages/contracts/openapi.yaml` sur `main`, commit `d2a7c538c81a2a790c1aec6902aaf09283bab58f` (merge de la PR #10, 05/11/2026) |
| Empreinte SHA-256 du fichier de référence | `7c93e918f4d1d524278431051c5963e78eade10e7621e0fbe2240a66932d2787` |
| Taille | 17 377 lignes ; le fichier courant de la branche lui est identique à l'ouverture de la mission |
| Récupération | `git show d2a7c538:packages/contracts/openapi.yaml` ; le job de CI fait déjà `fetch-depth: 0` (`ledger-tests.yml`, étape `actions/checkout`) |
| Garde-fou | le script recalcule la SHA-256 du fichier extrait et refuse de comparer s'il diffère de la valeur épinglée (référence falsifiée ou commit absent : échec, jamais « rien à comparer ») |

La référence est épinglée dans un petit fichier `packages/contracts/contract-baseline.json` (commit, SHA-256, liste des
changements admis). Changer ce fichier est une décision du porteur, pas d'un lot. **Garde-fou de propriété (A23)** : le
dépôt n'a pas de `CODEOWNERS` ; le lot crée `.github/CODEOWNERS` qui désigne le porteur pour `contract-baseline.json` et
`check-stability.mjs`, et un second contrôle de CI (`scripts/check-baseline-decision.mjs`) échoue si `contract-baseline.json`
diffère de la version de `main` sans qu'une ligne `Décision du porteur : <date> <référence ADR>` figure dans le message du
dernier commit qui le touche ou dans `docs/DECISIONS_ADR.md` (à défaut de `CODEOWNERS` appliqué par le dépôt distant, c'est
ce contrôle qui tient).

## Mise en oeuvre cible

| Pièce | Chemin | Rôle |
|---|---|---|
| Comparateur | `packages/contracts/scripts/check-stability.mjs` | charge les deux contrats avec le paquet `yaml` déjà présent (`2.9.1`), compare, classe chaque différence, sort `1` s'il en reste une non admise |
| Tests du comparateur et témoin positif | `packages/contracts/scripts/check-stability.test.mjs` | lanceur de tests intégré à Node (`node --test`), aucune dépendance nouvelle (C-011) |
| Référence épinglée | `packages/contracts/contract-baseline.json` | commit, SHA-256, motifs admis |
| Script npm | `check:stability` dans `packages/contracts/package.json` | `node scripts/check-stability.mjs && node --test scripts/check-stability.test.mjs` |
| Étape de CI | `.github/workflows/ledger-tests.yml`, juste après « Types du contrat à jour (TypeScript et Dart) » | `npm run check:stability -w @cashless/contracts` |

Sorties : une ligne par différence (`ADMISE` ou `REFUSÉE`), le pointeur JSON, l'ancienne et la nouvelle valeur ; un total.
**Codes de sortie distincts (A23)** : `0` aucune différence refusée ; `2` au moins une différence `REFUSÉE` (le message
nomme chaque pointeur refusé) ; `1` erreur d'usage ou de l'outil (fichier absent, syntaxe invalide, module `yaml` absent,
référence introuvable ou falsifiée). Toute autre valeur est une panne du script. Seul `2` prouve un refus.

## Ce qui est comparé et ce qui est admis

Comparaison **sémantique** (les deux documents sont chargés, pas comparés ligne à ligne) : l'ordre des clés, les commentaires
et le style de mise en forme ne comptent pas. Chaque différence est un couple (pointeur JSON, ajout | retrait | changement).

Une différence est **admise** si, et seulement si, toutes ces conditions sont vraies :

1. c'est un **ajout** : aucune clé, aucune valeur, aucun élément de liste existant n'est retiré ou changé ;
2. elle se trouve sous l'un des trois motifs de la liste blanche :
   - propriétés ajoutées sous `/components/schemas/ReplicationPage/properties/` (y compris sous
     `wallets/items/properties/`) et sous `/components/schemas/EdgeSyncBatch/properties/` (une seule : `staff_token_audit`,
     décision 18 du porteur) ; ces deux schémas ne sont référencés que par `GET /edge/replication-feed` et
     `POST /edge/sync-batches` ;
   - schémas nouveaux de `/components/schemas/` dont le nom commence par `Edge` et qui ne sont atteints, par `$ref`, que
     depuis `ReplicationPage`, `EdgeSyncBatch` ou un autre schéma `Edge*` nouveau ;
   - un paramètre ajouté en fin de liste `parameters` de `GET /edge/replication-feed`, avec `in: query` et sans
     `required: true` ;
3. elle ne touche aucun tableau `required` (ni à l'ajout, ni au retrait) ; un champ ajouté est donc toujours facultatif ;
4. aucun `$ref` d'un schéma ou d'une route hors du périmètre ne pointe vers un schéma nouveau ;
5. elle ne change aucun schéma partagé avec des routes hors `/edge/*` (`SnapshotEntry`, `WrappedKey`, `EncryptedBlob`,
   `OfflinePolicy`, `DeviceConfig`, `CashSession`...) : tout pointeur sous ces schémas est refusé, même pour un ajout.

Tout le reste est **refusé** : opération retirée ou renommée, `operationId`, méthode, chemin, paramètre, corps, code de
réponse, énumération, `x-edge-available` (le décompte des opérations marquées doit rester 16, même ensemble), sécurité,
exemples, descriptions, `info`, `servers`, tags, composants autres que ceux ci-dessus.

Cas particuliers voulus :

- une **description** modifiée sur une route cliente est refusée (le texte du contrat est lui aussi le contrat) ;
- **aucune** route ou opération nouvelle, y compris sous `/edge/*`, n'est admise ;
- les seuls ajouts connus sont ceux de `replication-page-additions.yaml` (schéma unique du flux, A02) : sur `ReplicationPage`,
  `edge_seq_applied`, `device_seq_acked`, `pwd_pack_key` et `reference` ; sur les portefeuilles, `kyc_verified` et
  `topup_month_paid` ; sur `EdgeSyncBatch`, `staff_token_audit` ; le paramètre `after_change_seq` ; et les schémas `Edge*`
  nouveaux (`EdgeReference`, `EdgeGatewaySelf`, `EdgeWalletState`, `EdgeEventSettings`, `EdgeDevice`, `EdgeDeviceSeqAcked`,
  `EdgeDeviceConfig`, `EdgeCashSession`, `EdgeVendor`, `EdgeVendorSession`, `EdgeStaff`, `EdgeCatalog`, `EdgeMediaRef`,
  `EdgeUnassignedMedia`, `EdgeStaffTokenAudit`) ; la liste blanche nomme leurs pointeurs exacts dans
  `contract-baseline.json`, pour qu'un ajout non prévu soit refusé tant que le plan n'a pas été mis à jour ;
- **aucune valeur d'énumération n'est ajoutée** (A11) : `ShortfallReason` et `OfflineRejectReason` sont partagées avec des
  routes de terminal ; la mission réutilise `INSUFFICIENT_FUNDS` et `MALFORMED_OPERATION`, le détail va dans `detail` ;
- les types générés (`generated/`) ne sont pas comparés ici : leur cohérence avec le contrat reste prouvée par les étapes
  existantes « Types du contrat à jour » et « Types du contrat régénérés sans écart ».

## Témoin positif (SC-006)

Un contrôle qui ne peut jamais échouer ne prouve rien. Le fichier de tests prouve que le contrôle échoue sur un contrat
modifié, en fabriquant des contrats d'essai en mémoire à partir de la référence, sans toucher au dépôt :

| Cas | Modification faite sur la copie | Résultat attendu |
|---|---|---|
| T1 | `operationId` de `createPayment` renommé | échec, 1 différence refusée |
| T2 | code de réponse `409` retiré de `POST /payments` | échec |
| T3 | champ `required` ajouté à `ReplicationPage` | échec |
| T4 | propriété facultative ajoutée à `OfflineSnapshot` (schéma partagé hors `/edge/*`) | échec |
| T5 | paramètre obligatoire ajouté à `GET /edge/replication-feed` | échec |
| T6 | description de `getEdgeReplicationFeed` modifiée | échec |
| T7 | `x-edge-available` retiré d'une des 16 opérations | échec |
| T8 | route nouvelle `POST /edge/nouvelle` | échec |
| T9 | valeur d'énumération retirée de `DeviceStatus` | échec |
| T10 | copie identique à la référence | succès, 0 différence |
| T11 | copie avec les seuls ajouts de `replication-page-additions.yaml` | succès, uniquement des différences `ADMISE` |
| T12 | référence dont la SHA-256 ne correspond pas | échec, code `1` (garde-fou) |
| T13 | valeur ajoutée à l'énumération `ShortfallReason` ou `OfflineRejectReason` | échec, code `2` (A11) |
| T14 | propriété autre que `staff_token_audit` ajoutée à `EdgeSyncBatch`, ou `staff_token_audit` ajoutée à `required` | échec, code `2` |

Les cas T1 à T9, T13 et T14 sont le **témoin positif** (code `2` attendu, message nommant le pointeur) ; T12 attend `1`.
Chacun doit faire échouer le comparateur ; si l'un réussit, le test échoue. T10 et T11 sont les témoins négatifs : le
contrôle ne refuse pas à tort.

Preuve en CI sur le dépôt réel, en plus des tests (A23) : le job fabrique une copie mutée du contrat dans
`$RUNNER_TEMP`, **vérifie que la mutation a eu lieu** (`! cmp -s packages/contracts/openapi.yaml "$RUNNER_TEMP/mutated.yaml"`,
sinon le job échoue : un motif `sed` périmé ne doit pas faire passer le test), puis exige un code de sortie précis et le nom
du pointeur muté dans la sortie :

```bash
set +e
node packages/contracts/scripts/check-stability.mjs --candidate "$RUNNER_TEMP/mutated.yaml" > "$RUNNER_TEMP/out.txt"
code=$?
set -e
test "$code" -eq 2 && grep -q "$MUTATED_POINTER" "$RUNNER_TEMP/out.txt"
```

Un chemin de fichier erroné, une erreur de syntaxe du script ou un module absent sortent en `1` : le job échoue au lieu
de passer. Le contrat versionné n'est jamais modifié par le job.

## Exécution locale (cible)

```bash
# Contrôle du contrat courant contre la référence
npm run check:stability -w @cashless/contracts

# Contre un autre fichier (essai à la main)
node packages/contracts/scripts/check-stability.mjs --candidate /chemin/vers/essai.yaml
```

Aucune base de données n'est utilisée.

## Ordre dans la CI

1. `npm run check -w @cashless/contracts` (types à jour) ;
2. `npm run generate` puis `git diff --exit-code -- packages/contracts` (types sans écart) ;
3. `npm run check:stability -w @cashless/contracts` (nouveau), avant les suites lentes, pour échouer vite.

## Limites connues

- Le contrôle compare le contrat, pas le comportement : il ne prouve pas que l'API reste identique en `CENTRAL`. C'est le rôle
  des suites existantes, relancées à chaque lot (IC-16).
- Une fois la mission fusionnée, la référence épinglée reste `d2a7c538` tant que le porteur n'a pas décidé de la déplacer.
  Les missions suivantes qui doivent légitimement changer le contrat mettent à jour `contract-baseline.json` par une décision
  consignée, pas en contournant le contrôle.
- Les ajouts de la liste blanche sont facultatifs pour les clients : la compatibilité des clients Dart générés est prouvée par
  `npm run check -w @cashless/contracts` (régénération Dart et analyse).
