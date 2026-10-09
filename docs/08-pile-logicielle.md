# Pile logicielle et choix d'implémentation

> **Référence arrêtée le 09/10/2026** (ADR-78). Origine : document « Pile logicielle » du porteur du projet,
> confronté aux sources normatives et au code livré ; le porteur a décidé de **prioriser l'existant** : là où son
> document divergeait de la SPECIFICATION, du contrat `openapi.yaml` ou du code déjà livré, c'est l'existant qui
> est retenu. Les éléments du document sans conflit sont repris tels quels comme cible des missions à venir.
>
> Toute nouvelle dépendance reste soumise à la vérification faite pour `jose` (registre officiel, mainteneur,
> scripts d'installation, ancienneté de la version, intégrité dans le lockfile) et est épinglée à la version exacte.

Légende « Statut » : **en place** (déjà dans le dépôt) · **cible** (à introduire par la mission indiquée) ·
**écarté** (proposé puis écarté par ADR-78, avec la raison).

## 1. Serveur (API centrale et passerelle locale)

| Domaine | Logiciel | Version | Statut | Remarque |
|---|---|---|---|---|
| Runtime | Node.js | 22 LTS (`engines: >=22 <23`) | en place | |
| Runtime | TypeScript | 5.9.3 | en place | le document proposait 5.8 |
| Framework | @nestjs/core, @nestjs/common, @nestjs/platform-express | 11.2.7 | en place | Express ; Fastify écarté (§4) |
| Base de données | PostgreSQL | **17** (minimum) | en place | SPEC §1.2, ADR-55 (`transaction_timeout`) ; le document proposait 16 |
| Base de données | pg (pilote) | 8.23.1 | en place | aucun ORM : fonctions SQL appelées par `TenantTx` (SPEC §2.2) |
| Base de données | pgTAP | — | en place | tests de la base (CI et base locale) |
| Authentification | jose | 6.2.12 | en place | vérification des jetons OIDC (mission 2) ; le document proposait 5 |
| Authentification | argon2 | 0.45 | cible (vendeurs, S2) | empreinte argon2id du code PIN des vendeurs |
| Limitation de débit | @nestjs/throttler | 6 | cible | compteurs en mémoire ; stockage partagé à décider avec le déploiement multi-instance |
| Validation | zod | 3.25 | cible (facultatif) | les routes livrées valident explicitement ; à adopter route par route si utile |
| HTTP sortant | axios | 1 | cible (PSP, mission 6) | |
| Observabilité | pino / nestjs-pino | 9.14 / 4 | cible | remplace le journal JSON maison sans changer son contenu (`X-Request-Id`, une ligne par requête) |
| Observabilité | @opentelemetry/sdk-node, auto-instrumentations-node | à fixer à l'introduction | cible | le document ne donnait pas de version exploitable pour la seconde |
| Observabilité | AWS CloudWatch | service managé | cible | |
| Documentation d'API | @nestjs/swagger | 11 | facultatif | le contrat `openapi.yaml` écrit à la main fait foi ; Swagger ne peut servir qu'à l'afficher |

## 2. Back-office (mission 11)

| Logiciel | Version | Statut |
|---|---|---|
| Next.js | 15 | cible |
| react / react-dom | 19 | cible |
| tailwindcss | 4 | cible |
| shadcn/ui | copié dans le projet (pas de paquet npm) | cible |
| @tanstack/react-query | 5 | cible |
| axios | 1 | cible |
| Types de l'API | générés depuis `openapi.yaml` (`packages/contracts`) | en place |

## 3. App terminal et app festivalier (missions 10 et 12)

| Logiciel | Version | Statut | Remarque |
|---|---|---|---|
| Flutter SDK / Dart SDK | 3.32 / 3.8 | cible | |
| Base locale chiffrée | SQLCipher | cible | une seule couche d'accès à choisir au plan de la mission 12 (`drift` + `sqlcipher_flutter_libs`, ou `sqflite_sqlcipher`) ; pas les deux |
| flutter_secure_storage | 9 | cible | |
| dio | 5 | cible | |
| riverpod | 2 | cible | |
| Types de l'API | générés en Dart depuis `openapi.yaml` | cible | |

## 4. Choix d'implémentation

| Sujet | Règle retenue | Origine |
|---|---|---|
| Style d'API | REST, ressources et champs en snake_case, version dans l'URL (`/v1/`). Nouvelle version majeure annoncée 3 mois à l'avance, ancienne dépréciée sur 6 mois | contrat + document du porteur |
| Format | JSON (`application/json`) ; erreurs en **RFC 9457 `application/problem+json`** avec un `code` stable en SCREAMING_SNAKE_CASE (`ProblemCode`) | contrat (en place) |
| Pagination | **Curseur opaque** : `cursor`, `limit` (≤ 200, défaut 50) ; réponse `data`, `next_cursor`, `has_more` ; pas de total | contrat (en place) |
| Idempotence | `Idempotency-Key` sur toute écriture comptable ou création ; terminaux : `<serial>:<seq>`, qui devient la clé de l'écriture au grand livre ; autres clients : clé libre (UUID conseillé), préfixée par le serveur ; **stockée en base** (`api_idempotency`), réponse enregistrée dans la même transaction que le travail | contrat + mission 1 (en place) |
| Accès aux données | aucun ORM ; règles métier en fonctions SQL ; `set_config('app.operator_id', …, true)` par transaction (`TenantTx`) | SPEC §2.2 + mission 1 (en place) |
| HTTP | HTTP/2 sur les points d'entrée publics ; HTTP/1.1 accepté pour les rappels internes **et pour les webhooks entrants des PSP** (appels externes) | document du porteur, ajusté |
| TLS | 1.3 préféré, 1.2 minimum ; 1.0 et 1.1 désactivés ; certificats AWS Certificate Manager | document du porteur |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains`, posé devant l'application (répartiteur de charge) ; pas de Nginx dans l'architecture | document du porteur, ajusté |
| Limitation de débit | AWS WAF (2000 requêtes / 5 min / IP) devant le répartiteur ; `@nestjs/throttler` par route (ex. 20 paiements initiés / min, 200 lectures / min) ; dépassement : `429` (`RATE_LIMITED`) en `problem+json` avec `Retry-After`. En-têtes `X-RateLimit-Limit`, `-Remaining`, `-Reset` à ajouter au contrat lors de leur mise en place. Pas de limitation « par clé API » : les personnes et les terminaux n'en ont pas | contrat + document du porteur, ajusté |
| Base locale mobile | SQLCipher ; clé de la base **enveloppée par une clé AES-GCM de l'Android Keystore** (non exportable), `journal_mode = WAL`, `synchronous = FULL`. Le code PIN identifie le vendeur ; il ne chiffre pas la base | SPEC §8.2 |

## 5. Propositions écartées (ADR-78)

| Proposition du document | Raison |
|---|---|
| PostgreSQL 16 | `transaction_timeout` (PostgreSQL 17) exigé pour le rôle applicatif (SPEC §13.7, ADR-55) |
| Erreurs `{ success: false, error: { code, message, details } }` | Contrat RFC 9457 déjà implémenté et testé sur toutes les routes |
| Pagination `page` / `per_page` avec `meta.total` | Contrat par curseur ; un total exact coûte un comptage sous RLS à chaque page |
| Idempotence dans Redis (UUID v4, 24 h) | Une écriture validée doit garder sa réponse : enregistrement dans la même transaction ; la clé d'un terminal est la clé du grand livre |
| Redis, ioredis | Plus nécessaire sans l'idempotence ; à reconsidérer seulement pour des compteurs de débit partagés |
| Prisma (ORM et migrations) | Règles en fonctions SQL (SPEC §2.2), migrations SQL pures, accès par `TenantTx` vérifié par un test d'architecture |
| Fastify 4 (`@nestjs/platform-fastify`) | Express en place. Le document se trompait : NestJS 11 utilise Fastify **5** ; Fastify 4 n'est plus pris en charge |
| @nestjs/jwt, @nestjs/passport | Les jetons sont émis par le serveur d'identité externe ; l'API ne fait que les vérifier (`jose`) |
| jose 5 | 6.2.12 en place et vérifiée |
| TypeScript 5.8 | 5.9.3 en place |
| Clé SQLCipher dérivée du PIN (PBKDF2) | Un terminal sert plusieurs vendeurs et garde un journal hors ligne qui vaut de l'argent : un PIN changé ou oublié le rendrait illisible |
| Throttling AWS API Gateway par clé API et par organisateur | Pas de clé API pour les personnes ni les terminaux (jetons OIDC, jetons d'appareil, mTLS) |
| Nginx pour HSTS | Absent de l'architecture AWS cible |

## 6. Reste ouvert

- **OP-N40 — Durée de conservation des clés d'idempotence** : le contrat dit « au moins 30 jours » (paramètre
  `IdempotencyKey`), la mission 1 a codé 24 h par défaut (`IDEMPOTENCY_TTL_HOURS`). Contradiction entre deux
  existants : non tranchée par ADR-78 (voir `POINTS_OUVERTS.md`).
