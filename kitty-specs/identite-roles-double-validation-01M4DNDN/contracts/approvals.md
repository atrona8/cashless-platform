# Contrat — Double validation (ADR-74)

## Demande puis approbation (back-office)

```mermaid
sequenceDiagram
  participant A as Auteur
  participant API
  participant DB as Base
  participant V as Valideur
  A->>API: opération à deux (Idempotency-Key)
  API->>DB: INSERT approval_request (paramètres figés) + audit
  API-->>A: 202 demande PENDING
  V->>API: POST /approval-requests/{id}/approve
  API->>API: rôle exigé sur la même portée ?
  API->>DB: decide_approval_request(id, valideur, true)
  API->>DB: SAVEPOINT ; exécuter l'action
  alt succès
    API->>DB: EXECUTED + result + audit
  else échec métier
    API->>DB: ROLLBACK TO SAVEPOINT ; FAILED + code + audit
  end
  API-->>V: 200 (EXECUTED ou FAILED)
```

Règles :

1. Registre : chaque action (`ApprovalAction`) déclare son rôle exigé (auteur et valideur), la portée déduite de
   l'objet visé et des paramètres, et son exécuteur. Action non enregistrée : `422 VALIDATION_FAILED`.
2. Création : l'auteur doit avoir le rôle exigé ; `approval_request` (`requested_by` = personne de la session,
   `expires_at` = +24 h) ; `202 Accepted` avec la demande ; ligne d'audit `APPROVAL_REQUESTED`.
3. Approbation : rôle exigé sur la même portée (`403` sinon) ; `decide_approval_request` (`CL023` →
   `409 APPROVAL_INVALID`) ; demande expirée : passage `EXPIRED` **validé** puis `409` ; exécution unique dans un
   point de sauvegarde ; `200` ; audit `APPROVAL_EXECUTED` ou `APPROVAL_FAILED` avec auteur et valideur.
4. Refus : note obligatoire (`400 VALIDATION_FAILED` sinon) ; `REJECTED` ; audit `APPROVAL_REJECTED`.
5. Rejeu avec la même `Idempotency-Key` : réponse enregistrée, aucune nouvelle exécution.
6. Liste : prestataire de la session (RLS) ; seulement les actions que la personne peut lancer ou approuver ;
   `PENDING` échue présentée `EXPIRED` ; filtres `status`, `action` ; curseur opaque (`requested_at`, `id`).
7. Tout champ `approved_by` / `decided_by` d'un corps est ignoré.

## Jeton d'approbation sur place (`X-Approval-Token`)

Claims : `iss`, `aud` = `OIDC_APPROVAL_AUDIENCE`, `sub`, `jti`, `iat`, `exp` (≤ `iat` + 300 s), `act`,
`act_hash`.

```
act_hash = hex(SHA-256( METHOD "\n" PATH "\n" JCS(body ?? null) ))
```

`METHOD` en majuscules ; `PATH` = chemin réel avec le préfixe `/v1`, sans chaîne de requête ; corps en JSON
canonique RFC 8785, `null` si absent ; l'en-tête du jeton n'entre pas dans le calcul.

Vérification (garde `@RequiresOnsiteApproval({ operationId, role })`) :

| Condition | Résultat |
|---|---|
| En-tête absent | `403 APPROVAL_REQUIRED` |
| Signature, `iss`, `aud`, `exp` invalides | `403 APPROVAL_INVALID` |
| `act` ≠ `operationId` de la route | `403 APPROVAL_INVALID` |
| `act_hash` ≠ empreinte de la requête reçue | `403 APPROVAL_INVALID` |
| Personne du `sub` inconnue, désactivée, ou = appelant | `403 APPROVAL_INVALID` |
| Personne du `sub` sans le rôle exigé sur la portée | `403 APPROVAL_INVALID` |
| `jti` déjà consommé (insertion sans effet) | `403 APPROVAL_INVALID` |
| Sinon | valideur = personne du `sub`, consommation dans la transaction métier, audit `APPROVAL_TOKEN_USED` |
