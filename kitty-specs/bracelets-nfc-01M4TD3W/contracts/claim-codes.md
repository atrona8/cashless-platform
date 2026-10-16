# Contrat — codes de rattachement et demandes en attente

## Vie d'un code

1. **Commande** (`issueClaimCodeOrder`, une fois par lot `PUBLIC`) : le serveur tire `quantity` codes, enregistre leurs
   empreintes, rend le fichier de commande (CSV : rang, code, URL `https://<domaine>/c/<code>`). La réponse n'est ni
   journalisée ni conservée par le registre d'idempotence ; une seconde demande reçoit `409`.
2. **Association** : au scan par le poste (`associateClaimCode`) ou par import du fichier code ↔ UID de l'imprimeur
   (`importClaimCodeAssociations`, réponse : lignes acceptées et refusées avec leur motif).
3. **Usage** : rattachement (une fois) ; avant cela, consultation anonyme du solde.
4. **Fin** : à la clôture du lot, un code jamais associé est invalidé.

## Empreintes

`HMAC-SHA256(CLAIM_CODE_HMAC_KEY, "CASHLESS/CLAIM/v1" || code normalisé)`. Code de confirmation :
`HMAC-SHA256(clé, "CASHLESS/CLAIM-CONFIRM/v1" || id de la demande || 6 chiffres)`. La clé est obligatoire en
production (au moins 32 octets) ; hors production, une valeur de test fixe.

## Rattachement (`claimMedia`, festivalier)

| Situation | Réponse |
|---|---|
| Code valide, solde disponible nul | `200` rattaché ; `claim_code_used_at` posé |
| Code valide, solde non nul | `202` demande en attente : identifiant, code de confirmation à 6 chiffres, expiration |
| Code inconnu, déjà utilisé, invalidé, lot `POOL` déjà rattaché | même refus, même corps |
| Limite d'essais atteinte | `429` avec le délai ; trace `BLOCKED` et alerte |

Un code mal formé (caractère hors alphabet) est refusé en `400` avant toute recherche, sans compter comme un essai.
Le refus et le succès suivent le même chemin de calcul (une empreinte, une recherche), pour tenir NFR-007.

## Confirmation au guichet (`confirmMediaClaim`)

Le terminal lit le bracelet (lecture enregistrée) et l'agent saisit le code. Refus si la lecture désigne un autre
bracelet que la demande, si la demande a expiré, ou après 5 essais faux. Succès : portefeuille rattaché au compte sans
écriture comptable, code imprimé consommé, autres demandes du bracelet annulées, le tout dans une transaction.

## Consultation anonyme (`lookupBalanceByClaimCode`)

Solde et 10 derniers mouvements, sans donnée personnelle, tant que le bracelet n'est pas rattaché. Mêmes limites
d'essais par appareil, même réponse pour un code inconnu ou utilisé.
