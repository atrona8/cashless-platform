# Contrat — Accès de niveau plateforme

## Règles

1. **Deux pools.** `DATABASE_URL_APP` (rôle `cashless_app`) et `DATABASE_URL_PLATFORM` (rôle `cashless_platform`),
   tous deux obligatoires en production. Le pool plateforme n'est injecté que dans les services de plateforme ;
   un test d'architecture interdit son import ailleurs.
2. **`PlatformTx.run(fn)`** : `BEGIN` → `set_config('app.scope','platform', true)` → `fn` → `COMMIT`. Jamais de
   `app.operator_id`. Aucune ligne d'un prestataire n'est visible, sauf les parties `OPERATOR`, les contrats
   `PLATFORM_OPERATOR` et les règles `PLATFORM_CONTRACT` (politiques nominatives).
3. **Routes.** Une route de plateforme exige `PLATFORM_ADMIN` sur la portée `PLATFORM` (`@Roles(['PLATFORM_ADMIN'])`
   avec `PLATFORM_CHAIN`) et utilise `@Idempotent({ scope: 'plt:', platform: true })` : la clé est réservée et la
   réponse enregistrée par `PlatformTx`, avec `operator_id` NULL.
4. **Audit.** Chaque écriture de plateforme écrit sa ligne `audit_log` (`operator_id` NULL, chaîne de la plateforme)
   dans la même transaction, avec le rôle `PLATFORM_ADMIN` exercé.
5. **Approbations.** `PLATFORM_CONTRACT_VERSION` et `JURISDICTION_LIMITS_CHANGE` créent une demande `operator_id`
   NULL ; elle est listée, approuvée ou refusée par un autre `PLATFORM_ADMIN` sur les routes `/approval-requests`
   existantes (transaction plateforme quand la personne n'a pas de prestataire). La base refuse la décision d'une
   demande de plateforme hors du rôle plateforme et d'une demande de prestataire hors de son prestataire.
6. **Ce que le rôle plateforme ne peut pas** : écrire `event`, `ledger`, `account`, `journal_transaction`,
   `posting`, `account_balance`, une partie autre que `OPERATOR`, une `config_version` autre que `PLATFORM`, une
   règle autre que `PLATFORM_CONTRACT`. **Ce que le rôle applicatif ne peut pas** : créer un prestataire, écrire un
   profil de législation, une version `PLATFORM`, un contrat `PLATFORM_OPERATOR`, une règle `PLATFORM_CONTRACT`.
   Chaque interdit a son assertion pgTAP.

## Configuration

| Variable | Défaut hors production | Production |
|---|---|---|
| `DATABASE_URL_PLATFORM` | `postgres://cashless_platform:cashless_platform_local@127.0.0.1:5433/cashless_test` | obligatoire |
| `DB_PLATFORM_POOL_SIZE` | 2 | facultatif |
| `CASHLESS_PLATFORM_PASSWORD` (migrations) | `cashless_platform_local` | gestionnaire de secrets |
