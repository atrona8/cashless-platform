# Quickstart — Identité, rôles et double validation

Prérequis : outillage de la mission 1 (`tools/dev-db`, `README.md`), cluster local démarré
(`bash tools/dev-db/start.sh`).

```bash
npm ci --ignore-scripts
npm run reset-db -w @cashless/ledger-sql          # migrations 0001-0005, roles.sql, post-roles.sql
npm run test:pgtap -w @cashless/ledger-sql         # + tests_identity, tests_audit_log, tests_approvals
npm run reset-db -w @cashless/ledger-sql && npm test   # tests Jest (faux serveur d'identité, aucun service externe)
```

Démarrage local de l'API avec un serveur d'identité réel (facultatif) :

```bash
export OIDC_ISSUER=https://idp.example/realms/cashless
export OIDC_AUDIENCE=cashless-api
export OIDC_APPROVAL_AUDIENCE=cashless-approval
export OIDC_JWKS_URI=https://idp.example/realms/cashless/protocol/openid-connect/certs
npm run bootstrap-admin -w @cashless/ledger-sql -- --issuer "$OIDC_ISSUER" --subject <sub> --name "Admin plateforme"
npm run build -w @cashless/api && npm run start -w @cashless/api
```

Parcours vérifié par les tests d'intégration : amorçage d'un `PLATFORM_ADMIN` → création d'un `OPERATOR_ADMIN` →
attribution `ORGANIZER_ADMIN` → demande d'une action à deux de démonstration (`202`) → refus de l'auteur (`409`) →
approbation par une seconde personne (`200`, `EXECUTED`) → lignes d'audit chaînées et vérifiées.
