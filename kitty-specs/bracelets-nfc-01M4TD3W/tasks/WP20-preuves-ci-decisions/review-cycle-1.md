---
affected_files: []
cycle_number: 1
mission_slug: bracelets-nfc-01M4TD3W
reproduction_command:
reviewed_at: '2026-10-14T15:19:55Z'
reviewer_agent: user
wp_id: WP20
---

# Relecture WP20 — cycle 1 : changements demandés

Les livrables propres au lot sont solides : `media-journey`, `media-port-swap`, `media-secrets` (avec son contrôle du contrôle), `media-isolation` (39 opérations lues par `x-process`), `media-latency`, la CI, `CI.md` et les ADR-83 à ADR-92. `tsc --noEmit` et `eslint` ne signalent rien. Un seul constat bloque, et il vient de la retouche hors carte du commit 4e3407c (corrections des relectures des lots 16 à 19).

## Constat 1 (bloquant, gravité moyenne) : une erreur de clé du KMS sur le calcul du MAC fait tomber tout le contrôle quotidien

**Fichier** : `apps/api/src/media/daily-check/daily-check.service.ts`, `runOnce` (ligne 101 : `if (!(error instanceof KmsUnavailableError)) throw error;`) et `checkOne` (ligne 464 : `await this.mac.generateMac(...)`, sans `try`).

**Ce qui se passe** : `openDek` transforme bien une `KmsKeyError` du déchiffrement de la clé de données en écart. En revanche, une `KmsKeyError` levée par `generateMac` (clé HMAC du bracelet désactivée ou inconnue dans le KMS alors que `tag_key.status` n'est pas `RETIRED` ; `kms_key_ref` modifié) n'est pas interceptée dans `checkOne`. `runOnce` la relance. Résultat : aucun compte rendu, aucune ligne d'audit, et l'exception remonte par `DailyCheckWorker.runOnce` jusqu'à `WorkerRegistry.drain`.
- Avec `--once`, le processus s'arrête sur une exception. Les prestataires qui suivent ne sont pas contrôlés.
- En boucle, le processus s'arrête. Au redémarrage, `due()` est toujours vrai pour ce prestataire (rien n'a été inscrit), donc il retombe sur le même prestataire et s'arrête de nouveau. Le contrôle des autres prestataires est bloqué indéfiniment.

Avant le commit, toute erreur était inscrite comme `ERROR`. Le changement contredit aussi son propre commentaire (« une erreur propre à un bracelet ou à une clé … est un écart pour ce bracelet ; seule l'indisponibilité du service de clés interrompt le passage ») et le message du commit (« erreurs traitées bracelet par bracelet »). Le relancement ajouté n'a pas de justification d'échec bruyant (anti-pattern n° 8). C'est précisément la clé désactivée ou altérée qu'un contrôle d'intégrité doit signaler, pas subir. Et l'état d'un prestataire ne doit pas interrompre le contrôle des autres.

**Correction attendue** :
1. Dans `checkOne`, entourer `generateMac` d'un `try` : une `KmsKeyError` donne un écart (`return false`), une `KmsUnavailableError` est relancée.
2. Dans `runOnce`, une erreur inattendue ne doit pas laisser le prestataire sans compte rendu. Deux options : l'inscrire `ERROR` avec le nom de l'erreur, ou documenter explicitement pourquoi on échoue bruyamment et faire en sorte que le travailleur passe au prestataire suivant.
3. Test dans `test/integration/media/daily-check.spec.ts` : clé HMAC désactivée dans le faux KMS (`kms.disableKey(keyRef)`) alors que la `tag_key` est `ACTIVE`. Attendu : `MISMATCH` pour ses bracelets, alerte d'audit, code d'alerte 2. Un second prestataire du même passage est contrôlé normalement.

## Remarques non bloquantes (à traiter si simple, sinon à consigner)

- `media-secrets.spec.ts` déroule son propre parcours, qui ne lance ni le contrôle quotidien, ni la commande d'administration, ni remplacement/restitution/liste noire. Les journaux de ces processus ne sont donc pas capturés. Aucun journal n'existe aujourd'hui dans `src/media/{daily-check,keys,auth-keys,personalization}`, d'où un risque faible. Ajouter au moins un passage de `DailyCheckWorker` au parcours renforcerait la preuve de NFR-002.
- FR-034 couvre aussi l'identité du festivalier. `media-port-swap.spec.ts` ne remplace que le port du terminal (conforme à T082). Aucun test d'intégration ne remplace `CUSTOMER_IDENTITY`.
- `docs/POINTS_OUVERTS.md` : OP-N48 à OP-N55 ne figurent pas au tableau récapitulatif du haut (OP-N41 à OP-N47 y sont).
- Écart des médianes NFR-007 : `CI.md` dit 0,2 ms, ADR-90 dit 0,1 ms. Harmoniser ou préciser que ce sont deux mesures.
- ADR-88 nomme trois dettes. Le prompt du lot en annonçait quatre (la quatrième, OP-N44, est rattachée à l'ADR-84) : à préciser dans l'ADR-88 pour la traçabilité.

## Grille anti-patterns

1. Code mort : PASS (`lastBlacklisting`, `reinstatable`, `ALARM_*` ont des appelants en production).
2. Test sur données fabriquées : PASS (tous les tests passent par HTTP ou par les travailleurs réels).
3. Retour vide silencieux : PASS (`openDek` → `null` et `derivationMessage` → `false` sont documentés).
4. Couverture des FR : PASS (FR-034 terminal, FR-035 audit, FR-036 contrat ; voir la remarque sur le festivalier).
5. Surface figée : PASS (aucun `.sql` généré modifié ; `tests_media_claim_tap.sql` est écrit à la main).
6. Décision verrouillée : PASS.
7. Propriété des fichiers partagés : PASS avec note. 4e3407c retouche des fichiers des lots 16 à 19 (blacklist, claims, daily-check, lifecycle, `openapi.yaml`, `tag-format/src/envelope.ts`) ; ces retouches renforcent la sécurité sauf le constat 1.
8. Fragilité en production : **FAIL** (constat 1).
