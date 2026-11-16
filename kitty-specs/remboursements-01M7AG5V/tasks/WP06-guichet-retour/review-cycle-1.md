---
affected_files: []
cycle_number: 1
mission_slug: remboursements-01M7AG5V
reproduction_command:
reviewed_at: '2026-11-16T10:08:47Z'
reviewer_agent: claude
wp_id: WP06
---

# WP06, relecture cycle 1 : renvoyé pour une décision du porteur (16/11/2026)

La relecture a trouvé le lot correct sur le fond : 38/38 sur `cashless_wp06`, typecheck et Prettier OK, aucun écart à
`interfaces.md` non signalé. Le renvoi tient à la décision du porteur sur le fractionnement, soumis selon la règle 1.

## 1. BLOQUANT : seuil de la seconde personne sur le cumul des espèces sorties (décision du porteur, 16/11/2026)

Constat : `cash_refund_single_max` ne porte aujourd'hui que sur le `WALLET_REFUND`. Exemple : une caution de 6000, un
solde de 6000 et des espèces dues de 6000, avec un seuil de 10000, font sortir 18000 en espèces sans jeton.

Décision du porteur : le jeton est exigé quand le TOTAL des espèces qui sortent de la caisse pour une restitution
dépasse le seuil. C'est un renforcement, et le contrat ne change pas (même `403 APPROVAL_REQUIRED`).

Correction attendue :
- Faire, avant la PREMIÈRE écriture de l'enchaînement, la somme suivante :
  - la caution rendue EN ESPÈCES (mode `SEPARATE`, 0 sinon) ;
  - le montant BRUT du `WALLET_REFUND` du solde payé (même lecture stricte qu'aujourd'hui) ;
  - les espèces dues qui seront rendues.
- Comparer cette somme avec `>` à `event.cash_refund_single_max`.
- Sans jeton : `403 APPROVAL_REQUIRED`, rien n'est écrit et la caution reste `HELD`.
- Avec jeton : le consommer une fois. L'approbateur est passé au `WALLET_REFUND` et au rendu des espèces dues, comme
  aujourd'hui. Le seuil propre des espèces dues, côté base, reste inchangé.
- Un jeton présenté alors que le cumul ne dépasse pas le seuil n'est pas consommé (comportement actuel).
- Modifier le test nommé du fractionnement :
  - 3 × 6000 sans jeton, seuil 10000 : 403, aucune écriture, caution `HELD` ;
  - la même restitution avec jeton : 200, `approved_by` renseigné ;
  - un cumul exactement égal au seuil passe sans jeton.
- Mettre à jour les commentaires et la note de lane : le seuil porte sur le cumul (décision du porteur du 16/11).

## 2. Mineur : champ mort

`ReleaseChain.idempotencyKey` est renseigné par le contrôleur mais jamais lu. Le retirer, ou le lire s'il sert.

## 3. Mineur : test manquant (point 9 du prompt)

Le cas « solde d'une autre devise ou d'un autre grand livre » n'a pas de test. Ajouter un test qui prouve
l'annulation totale : caution toujours `HELD`, aucune écriture.

## 4. Preuve à confirmer

La relecture n'a pas pu confirmer que la suite de l'autorité de débit a tourné. Le fichier est sous
`test/integration/debit-authority/` (`debit-paths-refused`), pas `transverse/`. La lancer explicitement et donner
son résultat.
