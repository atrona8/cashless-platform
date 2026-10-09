# Research — Identité, rôles et double validation

Décisions de plan. Les choix marqués « décidé par l'agent » le sont sur délégation du porteur du projet et sont
consignés en Decision Moments (`decisions/`).

## R-01 — Serveur d'identité et vérification des jetons

- **Décision** : port `IdentityVerifier` ; implémentation `jose` : `createRemoteJWKSet(OIDC_JWKS_URI)` (cache et
  délai de rechargement de la bibliothèque), `jwtVerify` avec `issuer`, `audience`, algorithmes `RS256`/`ES256`,
  `clockTolerance` 10 s, `exp` obligatoire. Clés injoignables : `503 SERVICE_UNAVAILABLE`, jamais d'acceptation.
- **Rationale** : le contrat (`humanBearer`) impose un JWT OIDC ; `jose` est la référence du domaine, sans
  dépendance. La connexion, l'authentification renforcée et le rafraîchissement restent chez le serveur d'identité
  (C-005).
- **Alternatives** : vérification maison avec `node:crypto` (risque de défaut sur la gestion des algorithmes) ;
  `jsonwebtoken` + `jwks-rsa` (deux paquets, dépendances transitives).
- **Faux serveur d'identité** : paire de clés générée en mémoire (`generateKeyPair('ES256')`), JWKS local
  (`createLocalJWKSet`) injecté à la place du distant ; fabrique de jetons valides et volontairement défectueux.

## R-02 — Contradiction : `result` des demandes d'approbation (signalée, §0.3)

- **Constat** : `openapi.yaml` (`ApprovalRequest.result`, réponse de `approveApprovalRequest`) renvoie le résultat
  de l'action ; `approval_request` (schéma de référence) n'a pas de colonne pour le conserver. Contrat et schéma
  sont au même niveau de priorité.
- **Décision** : migration `0005` ajoute `result jsonb` (NULL sauf `EXECUTED`) ; `post-roles.sql` accorde
  `UPDATE (result)` au rôle applicatif ; le déclencheur de garde de la table n'est pas modifié (il ne contrôle pas
  cette colonne ; le passage `APPROVED → EXECUTED` reste le seul moment où l'API l'écrit). Signalé dans les
  contradictions de la mission.

## R-03 — Identité interne et `sub`

- **Constat** : le contrat dit « `requested_by` : `sub` de la session », mais `requested_by` est un UUID et le `sub`
  d'un serveur d'identité est une chaîne opaque.
- **Décision** : `app_user.id` (UUID) est l'identité interne écrite partout (`requested_by`, `decided_by`,
  `created_by`, `approved_by`, `audit_log.actor_id`) ; `app_user.subject` + `issuer` relient la personne au serveur
  d'identité. « `sub` de la session » est lu comme « la personne authentifiée de la session ». Signalé.

## R-04 — Résolution de la personne avant le prestataire

- **Décision** : `identify_person(p_issuer, p_subject)` SECURITY DEFINER, `search_path` fixé, accordée à
  `cashless_app` (fonction d'API, pas interne) : rend `user_id`, `operator_id` (NULL = plateforme), `status`, et
  les attributions actives (`role`, `scope_type`, `scope_id`). Aucune autre lecture hors RLS. Un `operator_id`
  annoncé par le jeton et différent est refusé `401` par l'API.
- **Rationale** : RLS forcée sur `app_user` ; le prestataire n'est connu qu'après identification.

## R-05 — Rôles, portées et hiérarchie

- **Portées** : `PLATFORM` (aucun objet), `OPERATOR` (prestataire), `ORGANIZER` (organisateur), `EVENT`
  (événement), `MERCHANT` (commerçant). Englobement : plateforme ⊃ prestataire ⊃ organisateur ⊃ événement ;
  un commerçant est englobé par son prestataire, et par les événements où il a une participation.
- **Qui peut attribuer** : `PLATFORM_ADMIN` → `PLATFORM_ADMIN` (plateforme), `OPERATOR_ADMIN` (prestataire) ;
  `OPERATOR_ADMIN` → `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN` dans son
  prestataire ; `ORGANIZER_ADMIN` → `SUPERVISOR`, `CASHIER` sur ses événements, `MERCHANT_ADMIN` sur les
  commerçants participant à ses événements. `VENDOR` (vendeurs à code PIN, S2) et `CUSTOMER` (app festivalier)
  ne sont pas attribuables dans cette mission. Personne ne s'attribue de rôle.
- **Rôles exigés des routes** : gestion des personnes `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`
  (restreint à ce qu'ils peuvent attribuer) ; `/approval-requests` : rôle de l'action (registre).

## R-06 — Tenant d'un `PLATFORM_ADMIN`

- **Décision** : les routes de gestion sont sous `/operators/{operator_id}/…` ; le prestataire de la transaction
  est celui du chemin si la personne est `PLATFORM_ADMIN`, sinon il DOIT être le sien (sinon `404`, identique à
  un objet inexistant). Le premier `PLATFORM_ADMIN` est créé par la commande d'amorçage ; les suivants par
  `POST /platform-admins` (rôle `PLATFORM_ADMIN`).

## R-07 — Journal d'audit chaîné et scellé (choix du porteur du projet)

- **Chaîne** : `chain_key` = `operator_id` ou la constante plateforme ; déclencheur BEFORE INSERT : verrou
  consultatif transactionnel sur la chaîne, `seq` = dernier + 1, `prev_hash` = `row_hash` précédent (genèse
  `SHA-256("CASHLESS/AUDIT/v1" ‖ chain_key)`), `row_hash` = SHA-256(`prev_hash` ‖ ligne canonique) (format :
  `contracts/audit-chain.md`). Les valeurs fournies par l'appelant pour `seq`, `prev_hash`, `row_hash` sont
  écrasées.
- **Ajout seul** : déclencheur BEFORE UPDATE OR DELETE qui refuse pour tous les rôles ; `post-roles.sql` retire
  aussi `UPDATE`.
- **Scellement** : `seal_audit(chain_key)` scelle de la dernière ligne scellée + 1 à la dernière ligne enregistrée
  il y a plus de 5 min (mêmes raisons que §13.7) ; `audit_seal` en ajout seul, `external_ref` renseignée une fois.
  `verify_audit_chain(chain_key, since)` recalcule lignes et scellements et rend les écarts. Fonctions
  d'exploitation : `EXECUTE` retiré au rôle applicatif.
- **Coût** : un verrou par chaîne sérialise les écritures d'audit d'un même prestataire ; volume d'administration
  faible, sans effet sur les ventes (qui n'écrivent pas d'audit).
- **Hors mission** : tâche planifiée, copie en écriture unique hors de la base, vérification quotidienne (mission 9).

## R-08 — Approbation : une seule transaction

- **Décision** : `approveApprovalRequest` = `IdempotentTx.run` : (1) rôle du valideur sur la portée de l'action ;
  (2) `decide_approval_request(id, valideur, true, note)` ; (3) `SAVEPOINT` ; exécuteur de l'action ; succès →
  `EXECUTED` + `result` + `executed_tx_id` ; échec métier (`ProblemException`, erreur SQL traduite) → `ROLLBACK TO
  SAVEPOINT`, `FAILED` + `failure_code` + `failure_reason` ; (4) ligne d'audit ; (5) réponse `200` enregistrée.
  Erreur inattendue (5xx) : rien n'est validé, la clé d'idempotence est relâchée.
- **Demande expirée** : la base pose `EXPIRED` et rend NULL ; l'API doit **valider** ce passage puis répondre
  `409 APPROVAL_INVALID`. Mécanisme : `ProblemException` marquée « validée » (`commit: true`) que `IdempotentTx`
  enregistre comme réponse **dans** la transaction métier au lieu de l'annuler (extension de la mission 1).

## R-09 — Jeton d'approbation sur place

- **Claims** : `iss`, `aud` = `OIDC_APPROVAL_AUDIENCE`, `sub`, `jti`, `iat`, `exp` (≤ `iat` + 300 s), `act`,
  `act_hash`. Vérifiés par la même JWKS que les jetons d'accès.
- **`act_hash`** : SHA-256 hex de `METHOD` + `\n` + chemin réel (préfixe `/v1`, sans chaîne de requête) + `\n` +
  JCS(corps, `null` si absent). Écrit dans `contracts/approvals.md` et dans la description du contrat.
- **Usage unique** : `INSERT INTO approval_token_use … ON CONFLICT (jti) DO NOTHING` dans la transaction métier
  (`IdempotentTx`) ; 0 ligne insérée → `403 APPROVAL_INVALID`. Le jeton n'est consommé que s'il est valide et que
  le travail est validé. Purge des lignes expirées : tâche future (comme S21).
- **Ordre des refus** : absent → `APPROVAL_REQUIRED` ; toute autre anomalie → `APPROVAL_INVALID`.

## R-10 — Garde de la transaction idempotente (RISK-2)

- **Décision** : test d'architecture sur les sources (méthode décorée `@Idempotent` ⇒ paramètre
  `@IdempotentTransaction()` ; le contrôleur n'injecte pas `TenantTx`) + vérification à l'exécution : une route
  `@Idempotent({ writes: true })` dont `IdempotentTx.run` n'a pas été appelé lève une erreur 500 journalisée
  (la clé est relâchée, aucune réponse enregistrée).

## R-11 — Passe adversariale (dépendance `jose`, sécurité)

| # | Objection | Disposition |
|---|---|---|
| A1 | `jose` est ESM seul : risque de chargement en production (CommonJS) | `accepted` : même mécanisme que `canonicalize`, vérifié en mission 1 (Node 22 `require(esm)`) ; test de démarrage dans la CI |
| A2 | JWKS distant : un attaquant qui détourne l'URL fournit ses clés | `changed` : URL en HTTPS imposée hors test, émetteur et audience vérifiés, algorithmes restreints à `RS256`/`ES256` (pas de `none`, pas de HMAC) |
| A3 | Rôles dans le jeton falsifiés par un serveur d'identité mal configuré | `accepted` : les rôles viennent de la base (R-04), le jeton ne prouve que l'identité |
| A4 | Rejeu d'un jeton d'approbation sur une autre requête | `accepted` : `act` + `act_hash` liés à la requête exacte, `jti` à usage unique en base |
| A5 | Auditeur qui contourne la chaîne en recalculant toutes les empreintes après altération | `deferred_with_rationale` : détectable seulement par comparaison aux copies externes des scellements (mission 9) ; dans cette mission, l'altération par le seul rôle applicatif est impossible (droits + déclencheur) |
| A6 | Désactivation d'une personne non prise en compte pendant la validité de son jeton | `accepted` : `identify_person` lit le statut à chaque requête |

## R-12 — Hors périmètre confirmé

- Terminaux, vendeurs, codes PIN (S2, S5) ; festivaliers et OTP (S17, `/customer-auth`) ; produit de serveur
  d'identité de production ; tâche de scellement et copie externe (mission 9) ; actions métier à deux.
