# Contrat — lecture et cycle de vie d'un bracelet

Les routes ci-dessous existent au contrat (`openapi.yaml`, tag « Bracelets ») ; la mission les sert sans les modifier.

| Opération | Processus | Fonction de la base | Idempotence |
|---|---|---|---|
| `getMediaAuthKey` `POST /media/auth-keys` | clés de bracelet | lecture de `media`, `tag_data_key` | non (lecture) ; jamais conservée |
| `createTap` `POST /taps` | API publique | `register_tap(mode ONLINE)` | par nature (même terminal, UID, compteur) |
| `activateMedia` `POST /media/activations` | API publique | `activate_media`, `take_deposit` | clé `serial:seq` |
| `getMedia` `GET /media/{id}` | API publique | `media_summary` | — |
| caution `POST /media/{id}/deposit` | API publique | `take_deposit` | oui |
| rendu `POST /media/{id}/deposit/refund` | API publique | `refund_deposit` | oui |
| `releaseMedia` `POST /media/{id}/release` | API publique | `release_media` (+ `reassign_pool_media`) | oui |
| `replaceMedia` `POST /media/{id}/replace` | API publique | `replace_media` | oui |
| espèces dues `POST /media/{id}/cash-due-refunds` | API publique | `refund_cash_due` | oui |
| `confirmMediaClaim` | API publique | `confirm_media_claim` | oui |

## Demande de mot de passe

1. Identité du terminal. 2. Recherche du bracelet par (prestataire, UID) et contrôle de l'index. 3. Un seul
déchiffrement de la clé de données au plus, aucun si elle est dans le cache court (research R-05). 4. Ouverture du chiffré stocké,
enveloppe pour la clé d'accord du terminal, mise à zéro des tampons. 5. Réponse.

Bracelet inconnu, d'un autre prestataire, sans chiffré ou d'une clé retirée : `404 MEDIA_UNKNOWN` après un délai
constant, sans appel au service de clés.

## Frontières de transaction (§7.6)

1. `POST /taps` : `register_tap` seul, validé.
2. Opération avec lecture embarquée : `register_tap`, la fonction métier et `consume_tap` dans la même transaction ;
   un refus annule tout.
3. Résultat `UID_MISMATCH`, `SIGNATURE_MISMATCH` ou `CLONE_SUSPECTED` : la transaction est annulée, puis
   `register_tap` est rejoué seul et validé (liste noire et anomalie durables), avant la réponse d'erreur.
4. Prise d'une caution due : toujours dans une transaction distincte de celle qui a crédité le portefeuille.

## Traduction des résultats

`POST /taps` rend le résultat tel quel, en 200. Les opérations d'écriture le traduisent en `MEDIA_UNKNOWN`,
`MEDIA_NOT_ACTIVATED`, `MEDIA_BLOCKED`, `MEDIA_REPLACED`, `MEDIA_RELEASED`, `MEDIA_RETIRED`, `MEDIA_UID_MISMATCH`,
`MEDIA_SIGNATURE_MISMATCH`, `MEDIA_SIGNATURE_MISSING`, `MEDIA_CLONE_SUSPECTED`, `MEDIA_WRONG_EVENT`,
`MEDIA_BATCH_INACTIVE`. Les codes `CL020` et `CL022` suivent la table de la mission 1.

## Activation

Portefeuille absent : portefeuille anonyme créé au grand livre de l'événement, avec ses comptes payé et offert, dans la
transaction de l'activation. `identity_mode = ACCOUNT_REQUIRED` sans compte : refus. Caution `SEPARATE` : espèces
seulement dans cette mission (C-007) ; tout autre moyen est refusé avec la règle citée. Pendant que la passerelle a
l'autorité (`EDGE`), la règle du contrat s'applique (`409 DEBIT_AUTHORITY_EDGE`).

## Guichet de retour

L'ordre imposé (§7.9) est tenu par les refus de `release_media` : l'API n'enchaîne rien à la place de l'agent. Les
étapes 2 et 3 (expiration des crédits offerts, remboursement du solde payé) relèvent de la mission 9.
