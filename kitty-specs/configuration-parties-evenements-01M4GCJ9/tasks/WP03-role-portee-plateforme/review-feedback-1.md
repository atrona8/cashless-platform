# WP03 — Revue 1 : changements demandés

## Bloquant

**Version de configuration `PLATFORM` écrite par le rôle applicatif.** Sous `cashless_app` avec le prestataire A en
session, cette insertion passe :

```sql
INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
VALUES ('<A>', 'PLATFORM', '<partie plateforme>', 1, now(), '{}');
```

La politique `tenant_write` ne regarde que `operator_id`. La ligne prend le numéro de version suivant du niveau
plateforme (`config_version_assign` numérote par `(scope_type, scope_id)`) et sa date d'effet borne la prochaine
version de la plateforme. C'est une écriture de plateforme par le rôle applicatif (contrat `platform-access`,
règle 6 ; invariant I-6).

Correction attendue : politique restrictive nominative `TO cashless_app` sur `config_version`
(`scope_type <> 'PLATFORM'`), comme pour `contract` et `fee_rule`, avec son assertion pgTAP dans
`tests_platform_scope.sql`.

## Sans objet de correction (à consigner seulement)

- `platform_session()` : nom de rôle fixe au lieu du réglage `app.platform_role` du data-model (un réglage de session
  est modifiable par le rôle applicatif). Écart assumé, documenté en tête de la migration.
- `approval_request_platform_scope` : équivalence (action de plateforme ⇔ sans prestataire) au lieu de la simple
  implication du data-model. Plus strict, conforme au tableau R-09.
- Les fonctions d'API du schéma de référence restent exécutables par `cashless_platform` via `PUBLIC` (la suite de
  référence l'exige pour tout rôle). Limite documentée dans `post-roles.sql`, à porter à la décision du porteur.
