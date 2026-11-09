# Accès à l'API Cashless : guide pour une équipe cliente

## 1. La frontière, c'est le contrat

`packages/contracts/openapi.yaml` (OpenAPI 3.1) est la seule référence des routes, schémas, erreurs et schémas de
sécurité. Ne jamais écrire les types à la main : utiliser les types générés (`packages/contracts/generated/` pour
TypeScript, `packages/contracts/dart/` pour Dart/Flutter).

Une contradiction entre le contrat, `docs/sync_protocol.md` et `docs/SPECIFICATION.md` se signale à l'équipe
serveur ; elle ne se tranche pas côté client (règle de priorité : SPECIFICATION §0.3).

## 2. Trois façons de travailler, du plus simple au plus réel

| Mode | Quand | Comment |
|---|---|---|
| Serveur simulé | Dès le premier jour, pour toute route, servie ou non | `npx @stoplight/prism-cli@5.16.0 mock packages/contracts/openapi.yaml` (port 4010). Réponses tirées des exemples et schémas du contrat ; aucune règle métier. |
| API locale (archive « API ») | Pour le contrat et les routes publiques ; les routes protégées demandent un jeton valide, voir §3 | Voir `LISEZMOI.md` de l'archive API : PostgreSQL dans Docker, migrations, API en configuration de développement. |
| Documentation interactive | Pour parcourir et essayer les routes | `http://localhost/docs` (ou l'URL ngrok affichée au démarrage) avec l'API locale de l'archive « API » (port 80 dans `demarrer-local.sh`, 3000 sinon, `PORT`). Affiche `openapi.yaml` tel quel ; absente en production ; Swagger UI se charge depuis un CDN public (accès Internet requis). |
| Environnement d'intégration | Quand l'équipe serveur l'aura ouvert | URL, comptes d'essai par rôle et codes d'enrôlement fournis par le référent. |

Le serveur simulé ne vérifie ni les droits, ni l'idempotence, ni le cloisonnement entre prestataires : un écran qui
marche contre le simulé n'est pas prouvé. La preuve se fait contre l'API réelle.

## 3. Authentification

Schémas déclarés dans `components/securitySchemes` :

- `humanBearer`, `staffBearer` : jetons des personnes (back-office, festivalier, personnel). **Correction du
  05/11/2026** : le faux serveur d'identité n'est PAS lancé avec l'API locale. Il ne sert qu'aux tests de l'équipe
  serveur (`apps/api/test/support/fake-idp.ts`) et n'est pas dans cette archive. Tant qu'aucun jeton valide ne peut
  être obtenu (serveur d'identité d'intégration ou jeton fourni par le référent), les routes protégées répondent
  `401` ; seules les routes publiques et la documentation interactive répondent. Pour jouer un parcours protégé,
  demander au référent un jeton d'essai ou l'ouverture de l'environnement d'intégration.
- `deviceToken` + `deviceMtls` : terminaux enrôlés (certificat client et jeton court ; voir les contrats
  complémentaires « terminaux »).

Les routes qui écrivent exigent un en-tête `Idempotency-Key` ; un rejeu renvoie la même réponse.

## 3 bis. CORS pour une application web en développement

Une application web qui appelle l'API locale depuis un autre port se règle par la variable d'environnement
`CORS_ALLOW_ALL=1` au démarrage de l'API (en-tête `Access-Control-Allow-Origin: *`, ADR-154). Sans ce réglage,
aucun en-tête CORS n'est posé. Le réglage est **refusé en configuration de production** : l'API ne démarre pas.

## 3 ter. Routes `/edge/*` et passerelle locale

Les routes `/edge/*` et `/ledgers/{id}/debit-authority` appartiennent à la passerelle de site (mission 8, en cours de
planification) : elles ne sont pas encore servies par l'API locale. Une application cliente n'a rien à y appeler ; elle
apprend l'autorité de débit par les routes existantes (réponse `409 DEBIT_AUTHORITY_EDGE`, battement de cœur).

## 4. Ce qui n'est jamais remis

Secrets, fichiers d'environnement réels, clés, accès aux comptes PSP, KMS ou SMS, accès direct à la base, journaux
bruts du serveur. Les valeurs présentes dans `tools/dev-db/env.sh` sont des valeurs de test publiques, refusées en
production.

## 5. Demander un changement de contrat

Seule l'équipe serveur modifie `openapi.yaml`. Une demande passe par le référent (motif, route, schéma proposé,
urgence). Une demande qui touche la sécurité (droit élargi, donnée exposée, contrôle déplacé vers le client) va au
porteur du projet avant toute réponse.
