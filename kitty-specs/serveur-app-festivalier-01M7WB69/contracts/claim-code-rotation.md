# Contrat — Rotation du secret des codes de rattachement (OP-N47)

Aucune route ajoutée ni modifiée.

## Configuration

- `CLAIM_CODE_HMAC_KEY` : secret courant (inchangé, 32 octets au moins, obligatoire en production).
- `CLAIM_CODE_HMAC_KEY_VERSION` : entier ≥ 1, défaut 1 ; doit croître à chaque rotation (une version inférieure à la plus
  haute version connue en base fait refuser le démarrage).

## Effets d'une rotation (nouveau secret, version + 1, redémarrage)

- Rattachement (`claimMedia`), confirmation au guichet, consultation anonyme (`POST /public/balance-lookups`) avec un
  code d'ancienne version : même réponse qu'un code inconnu.
- Import du fichier de l'imprimeur : un bracelet au code d'ancienne version accepte un nouveau code.
- Aucun code en clair conservé, nulle part.

## Commande d'exploitation `reissue-claim-codes`

```
node apps/api/dist/cli/reissue-claim-codes.js --operator <id> --batch <id> --out <fichier.csv>
```

- Connexion : `DATABASE_URL_CLAIMADMIN` (rôle `cashless_claimadmin`) ; lit `CLAIM_CODE_HMAC_KEY` et sa version.
- Sortie : fichier `rank,code,url` (forme de `issueClaimCodeOrder`), mode 0600, refuse d'écraser un fichier existant.
- Stdout : nombre de codes réémis seulement. Codes de sortie : 0 succès, 2 lot introuvable ou non `PUBLIC`, 3 aucun
  bracelet à réémettre, 1 autre erreur.
- Lots clos compris ; bracelets dont le code courant a déjà servi : ignorés.
