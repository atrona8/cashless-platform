# Pile logicielle et choix d'implémentation

> Source : document transmis par le porteur du projet le 09/10/2026 (reproduit ci-dessous), confronté le même jour
> aux sources normatives (`SPECIFICATION.md`, `openapi.yaml`, schéma SQL) et au code déjà livré (missions 1 et 2).
>
> **Statut : référence cible, à arbitrer.** La règle de priorité de SPECIFICATION §0.3 s'applique : tests
> exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > `PRD.md`. Ce document, apporté
> après coup, n'a pas plus de poids que `PRD.md` : là où il contredit une source normative (divergences D1 à D8
> ci-dessous), **la source normative reste appliquée** jusqu'à décision du porteur (point ouvert OP-N39). Là où il
> ne contredit rien (versions des fronts et des apps Flutter, observabilité…), il devient la référence des missions
> concernées.

Légende de la colonne « Dépôt » : ✅ conforme · ⚠️ écart mineur · ❌ divergence (voir §3) · ➕ ajout compatible
(pas encore utilisé) · — sans objet pour l'instant.

## 1. Pile logicielle du serveur (backend)

| Domaine | Logiciel | Version demandée | Dans le dépôt (09/10/2026) | Dépôt |
|---|---|---|---|---|
| Runtime | Node.js | 22 LTS | `engines: >=22 <23` ; Node 22.14 | ✅ |
| Runtime | TypeScript | 5.8 | 5.9.3 (épinglé, mission 1) | ⚠️ D9 |
| Framework | @nestjs/core | 11.2 | 11.2.7 | ✅ |
| Framework | @nestjs/platform-fastify / fastify | 11.2 / 4.29 | `@nestjs/platform-express` 11.2.7 (Express) | ❌ D7 |
| Framework | @nestjs/swagger | 11 | non utilisé (le contrat `openapi.yaml` est écrit à la main et fait foi) | ➕ |
| Framework | @nestjs/jwt, @nestjs/passport | 11 / 11 | non utilisés : vérification OIDC par `jose` (mission 2, R-01) | ⚠️ D10 |
| Framework | @nestjs/throttler | 6 | non utilisé | ➕ |
| Base de données | PostgreSQL | 16 | **17** (SPECIFICATION §1.2 « 17 au minimum », ADR-55) | ❌ D1 |
| Base de données | @prisma/client, prisma | 6.19 | aucun ORM : migrations SQL pures, fonctions SQL appelées par `TenantTx` | ❌ D6 |
| Base de données | pg | 8.23 | 8.23.1 | ✅ |
| Cache | Redis / ioredis | 7.2 / 5 | absent | ➕ (voir D4) |
| Authentification | jose | 5 | **6.2.12** (épinglée et vérifiée, plan de la mission 2) | ⚠️ D8 |
| Authentification | argon2 | 0.45 | pas encore utilisé ; conforme à S2 (code PIN des vendeurs en argon2id) | ✅ |
| Validation | zod / class-transformer | 3.25 / 0.5 | non utilisés (validation explicite par route) | ➕ |
| HTTP sortant | axios | 1 | non utilisé (PSP : mission 6) | ➕ |
| Observabilité | pino / nestjs-pino | 9.14 / 4 | journal JSON maison (une ligne par requête, `X-Request-Id`) | ➕ |
| Observabilité | @opentelemetry/sdk-node / auto-instrumentations-node | 0.222 / « 0 » | absent ; « 0 » n'est pas une version exploitable | ⚠️ D18 |
| Observabilité | AWS CloudWatch | service managé | — | — |

## 2. Fronts et terminaux

| Domaine | Logiciel | Version demandée | Dépôt |
|---|---|---|---|
| Back-office | Next.js / react, react-dom | 15 / 19 | — (mission 11) ; conforme à SPECIFICATION §1.2 (React, Next.js) |
| Back-office | tailwindcss / shadcn/ui | 4 / copié dans le projet | — |
| Back-office | @tanstack/react-query / axios | 5 / 1 | — |
| Terminaux et app festivalier | Flutter SDK / Dart SDK | 3.32 / 3.8 | — (missions 10, 12) ; conforme à §1.2 (Flutter) |
| Terminaux | sqflite_sqlcipher / drift | 2 / 2 | — ; voir D12 (deux accès SQLite) |
| Terminaux | flutter_secure_storage / dio / riverpod | 9 / 5 / 2 | — |

Rubriques « Frontend : framework SPA, composants visuels, framework CSS » du document source : laissées vides par le
porteur (à compléter).

## 3. Choix d'implémentation demandés

Repris du document source, avec l'état de conformité.

| Sujet | Demandé | Source normative / dépôt | État |
|---|---|---|---|
| HTTP | HTTP/2 obligatoire sur les endpoints publics ; HTTP/1.1 seulement pour les rappels internes | rien dans la SPEC ; webhooks PSP entrants = appels externes | ⚠️ D17 |
| TLS | 1.3 préféré, 1.2 minimum ; certificats AWS Certificate Manager | compatible | ✅ |
| HSTS | `max-age=31536000; includeSubDomains`, posé par Nginx | Nginx absent de l'architecture (`04-architecture-diagram.md`) | ⚠️ D16 |
| Style d'API | REST, snake_case, version dans l'URL (`/v1/`) ; préavis 3 mois, dépréciation 6 mois | conforme à `openapi.yaml` | ✅ |
| Format | JSON exclusivement, `Content-Type: application/json` | erreurs en `application/problem+json` (RFC 9457) | ❌ D2 |
| Idempotence | `Idempotency-Key` UUID v4 sur les créations, stockée dans Redis 24 h | `openapi.yaml` : clé `<serial>:<seq>` des terminaux = clé du grand livre, conservée au moins 30 jours (terminaux : toujours) ; stockée en base (`api_idempotency`, mission 1) | ❌ D4 |
| Pagination | `page` / `per_page` (20, max 100), objet `meta` (`total`, `total_pages`) | curseur opaque (`cursor`, `limit` ≤ 200, `next_cursor`, `has_more`) | ❌ D3 |
| Erreurs | `{ success: false, error: { code, message, details } }` | RFC 9457 `problem+json` avec `code` stable (`ProblemCode`) ; codes SCREAMING_SNAKE_CASE ✅ | ❌ D2 |
| Limitation de débit | AWS WAF (2000 req / 5 min / IP), API Gateway (100 req/min par clé API, par organisateur), `@nestjs/throttler` (Redis) ; en-têtes `X-RateLimit-*`, `429` + `Retry-After` | `openapi.yaml` : `429` (`RATE_LIMITED`) avec `Retry-After` en `problem+json` ; pas d'en-têtes `X-RateLimit-*` ; pas de clé API pour les personnes ni les terminaux | ⚠️ D15 |
| Base locale mobile | SQLCipher ; clé dérivée du PIN de l'utilisateur (PBKDF2, 100 000 itérations, sel par appareil) | SPECIFICATION §8.2 (« Stockage local ») : clé SQLCipher **enveloppée par une clé AES-GCM de l'Android Keystore** | ❌ D11 |

## 4. Divergences

### Divergences avec une source normative (la source normative reste appliquée en attendant)

| # | Sujet | Écart | Conséquence si on suivait le document | Recommandation |
|---|---|---|---|---|
| D1 | PostgreSQL 16 | SPEC §1.2 et ADR-55 : 17 au minimum, pour `transaction_timeout = 60s` du rôle applicatif (SPEC §13.7), dont dépend la sûreté du scellement ; CI et base locale en 17 | Perte de la borne de durée des transactions (seule la surveillance resterait) | **Garder 17** |
| D2 | Format des erreurs et « JSON exclusivement » | `openapi.yaml` impose RFC 9457 `application/problem+json` ; déjà implémenté (mission 1) et testé sur toutes les routes | Réécrire le contrat, le filtre d'erreurs et les clients | **Garder problem+json** |
| D3 | Pagination `page`/`per_page` + `total` | `openapi.yaml` impose le curseur ; un total exact coûte un `count(*)` sous RLS à chaque page | Contrat à changer ; pages instables quand des lignes arrivent | **Garder le curseur** |
| D4 | Idempotence en Redis, UUID v4, 24 h | Pour un terminal, la clé est `<serial>:<seq>` et devient `journal_transaction.idempotency_key` (conservée pour toujours) ; la réponse doit être enregistrée dans la même transaction que l'écriture (sinon une écriture validée peut perdre sa réponse) | Double écriture possible après une panne entre la base et Redis | **Garder la base** ; Redis possible pour le seul débit (D15) |
| D6 | Prisma | SPEC §2.2 : les règles sont en fonctions SQL, NestJS les appelle sans les réimplémenter ; `set_config('app.operator_id', …, true)` par transaction ; mission 1 : accès par `TenantTx` seulement (test d'architecture), `int8` en `BigInt` | Réécrire l'accès aux données ; RLS par transaction plus difficile à garantir | **Pas d'ORM** (décision de la mission 1) |
| D11 | Clé de la base locale tirée du PIN | SPEC : clé enveloppée par l'Android Keystore. Un terminal sert plusieurs vendeurs et doit conserver son journal hors ligne (de l'argent) quel que soit le vendeur connecté | Journal illisible après un changement ou un oubli de PIN, donc ventes hors ligne perdues ; 100 000 itérations PBKDF2 à chaque ouverture sur un terminal d'entrée de gamme | **Garder le Keystore** ; le PIN sert à identifier le vendeur, pas à chiffrer |

### Écarts avec le code déjà livré (sans source normative contraire)

| # | Sujet | Écart | Recommandation |
|---|---|---|---|
| D7 | Fastify au lieu d'Express | Le dépôt utilise Express (mission 1). **Point factuel à corriger dans le document** : NestJS 11 utilise **Fastify 5** (`@nestjs/platform-fastify` 11 dépend de `fastify` 5) ; c'est Fastify 4 qui n'est plus pris en charge par NestJS 11, pas l'inverse. Passer à Fastify : changement d'adaptateur, middlewares et tests à reprendre | Rester sur Express en V1, sauf besoin de débit démontré par le test de charge (§15) |
| D8 | jose 5 au lieu de 6 | 6.2.12 retenue et vérifiée (provenance, aucune dépendance) dans le plan de la mission 2 ; la 5 est la branche précédente | Garder 6.2.12 |
| D9 | TypeScript 5.8 au lieu de 5.9.3 | Version mineure supérieure, compatible | Garder 5.9.3 (ou fixer 5.8 si une contrainte existe) |
| D10 | @nestjs/jwt + passport | Les jetons sont émis par le serveur d'identité externe (C-005) ; l'API ne fait que vérifier, avec `jose` | Inutiles en V1 |

### Points à préciser

| # | Sujet | Question |
|---|---|---|
| D12 | `sqflite_sqlcipher` **et** `drift` | Deux couches d'accès SQLite différentes ; avec `drift`, SQLCipher passe d'ordinaire par `sqlcipher_flutter_libs`. Laquelle retenir ? |
| D15 | Limitation de débit | Ajouter `X-RateLimit-*` au contrat : compatible. « API Gateway par clé API, ajustable par organisateur » : les personnes et les terminaux n'ont pas de clé API (jetons OIDC, jetons d'appareil, mTLS) ; à préciser |
| D16 | Nginx | L'architecture cible (AWS) ne prévoit pas de Nginx ; HSTS peut être posé par le répartiteur de charge ou l'application |
| D17 | HTTP/2 obligatoire | Les webhooks des PSP (Wave, Orange Money…) sont des appels externes, souvent en HTTP/1.1 : à exclure de l'obligation, comme les rappels internes |
| D18 | OpenTelemetry | « auto-instrumentations-node : 0 » n'est pas une version ; à fixer avec sdk-node |
| D19 | Rétention de l'idempotence (constat indépendant du document) | `openapi.yaml` (paramètre `IdempotencyKey`) dit « conservée au moins 30 jours » ; la mission 1 a retenu 24 h par défaut (`IDEMPOTENCY_TTL_HOURS`), comme ce document. **Contradiction non signalée jusqu'ici** : soit le contrat passe à 24 h, soit le défaut passe à 30 jours (720 h) |

## 5. Ce qui ne change pas en attendant la décision

Les missions en cours et suivantes appliquent les sources normatives pour D1 à D11 et les versions déjà épinglées
du dépôt. Les versions du §2 (fronts, Flutter) et les ajouts compatibles (➕) servent de référence aux missions qui
les introduiront ; chaque ajout de dépendance reste soumis à la vérification de provenance faite pour `jose`
(registre officiel, scripts d'installation, ancienneté de la version, intégrité dans le lockfile).
