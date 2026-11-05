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
| API locale (archive « API ») | Pour jouer de vrais parcours, avec les faux de l'équipe serveur | Voir `LISEZMOI.md` de l'archive API : PostgreSQL dans Docker, migrations, API en configuration de développement. |
| Documentation interactive | Pour parcourir et essayer les routes | `http://localhost:3000/docs` avec l'API locale de l'archive « API » (port 3000 par défaut, `PORT`). Affiche `openapi.yaml` tel quel ; absente en production ; Swagger UI se charge depuis un CDN public (accès Internet requis). |
| Environnement d'intégration | Quand l'équipe serveur l'aura ouvert | URL, comptes d'essai par rôle et codes d'enrôlement fournis par le référent. |

Le serveur simulé ne vérifie ni les droits, ni l'idempotence, ni le cloisonnement entre prestataires : un écran qui
marche contre le simulé n'est pas prouvé. La preuve se fait contre l'API réelle.

## 3. Authentification

Schémas déclarés dans `components/securitySchemes` :

- `humanBearer`, `staffBearer` : jetons des personnes (back-office, festivalier, personnel). En local, le serveur
  d'identité est un faux, refusé en configuration de production.
- `deviceToken` + `deviceMtls` : terminaux enrôlés (certificat client et jeton court ; voir les contrats
  complémentaires « terminaux »).

Les routes qui écrivent exigent un en-tête `Idempotency-Key` ; un rejeu renvoie la même réponse.

## 4. Ce qui n'est jamais remis

Secrets, fichiers d'environnement réels, clés, accès aux comptes PSP, KMS ou SMS, accès direct à la base, journaux
bruts du serveur. Les valeurs présentes dans `tools/dev-db/env.sh` sont des valeurs de test publiques, refusées en
production.

## 5. Demander un changement de contrat

Seule l'équipe serveur modifie `openapi.yaml`. Une demande passe par le référent (motif, route, schéma proposé,
urgence). Une demande qui touche la sécurité (droit élargi, donnée exposée, contrôle déplacé vers le client) va au
porteur du projet avant toute réponse.
