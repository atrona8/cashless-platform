# Données de démonstration de l'API partagée

Écrites une seule fois par `tools/demo-data/seed-demo.ts` (lancé par `demarrer-local.sh`), puis **gardées** : ce que
vous faites (rattachements, QR, demandes) reste en base d'un redémarrage à l'autre. Les identifiants ci-dessous sont
**fixes** : vous pouvez les écrire dans votre application. Développement seulement, jamais en production.

## 1. S'identifier comme festivalier

Aucun jeton. En configuration de développement, l'API croit trois en-têtes (faux fournisseur d'identité, dette
OP-N43, remplacé par un vrai jeton de compte avec l'app festivalier) :

| En-tête | Valeur |
|---|---|
| `X-Test-Customer-Id` | identifiant du festivalier (tableau §2) |
| `X-Test-Operator-Id` | identifiant de SON prestataire |
| `X-Test-Customer-Device` | référence libre de l'appareil, ex. `app-awa-pixel7` (`[A-Za-z0-9._:-]`, 100 car.) |

Le festivalier doit exister en base pour ce prestataire, sinon `401`. Toute requête `POST` porte aussi
`Idempotency-Key` (UUID neuf par opération ; le même pour un rejeu). Derrière ngrok (offre gratuite), ajouter
`ngrok-skip-browser-warning: 1`. Préfixe des routes : `/v1`.

```bash
curl -X POST "$API/v1/me/customer-qr-tokens" \
  -H 'ngrok-skip-browser-warning: 1' -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'X-Test-Customer-Id: c10e0ac3-f0ca-43fc-9b1a-8fcf53cd07ae' \
  -H 'X-Test-Operator-Id: ec04692a-229e-482b-8542-7492544766c8' \
  -H 'X-Test-Customer-Device: app-demo' \
  -d '{"wallet_id":"44f1a187-a49c-4152-8f5d-8f4991cdb6c8"}'
```

## 2. Qui est en base

**Prestataire A** `ec04692a-229e-482b-8542-7492544766c8`, événement « Festival Démo A »
`16f8cb90-4cfd-4052-89e6-e3f155d0b29d` (EN SERVICE, XOF, rattachement depuis l'app autorisé).
**Prestataire B** `6c4bedbe-a509-40c0-a6df-ecad419ef5d5`, événement `6ccda773-c3c4-493c-bfa8-895fc96c96b0`.

| Festivalier | `X-Test-Customer-Id` | Prestataire | Portefeuille (`wallet_id`) | Solde | Code de son bracelet | Sert à |
|---|---|---|---|---|---|---|
| Awa Diop | `c10e0ac3-f0ca-43fc-9b1a-8fcf53cd07ae` | A | `44f1a187-a49c-4152-8f5d-8f4991cdb6c8` | 25 000 | `9TS5N-FFKZB` | cas nominal |
| Moussa Ndiaye | `22ba6846-28a5-46bc-91e4-6502de5d2a1b` | A | `921f33c9-93fc-474a-b93d-6a5747b2b151` | 8 000 | `ATZAX-A9K5N` | petit solde |
| Fatou Sarr | `96a58580-81a1-4d4d-b3ea-cfd78f010075` | A | aucun (créé au 1er rattachement) | — | — | compte neuf |
| Ibrahima Fall | `d22ffa2b-71ab-4b4b-929d-dbc8f80f1795` | A | `3437eecc-da19-42a5-9abe-01fc864a9455` (BLOQUÉ) | 5 000 | `MS4XC-3MPWM` | écrans d'erreur |
| Khady Ba | `7696da46-ee8f-4ae2-9839-7ef3965241c2` | B | `5f2da6b2-0018-4adf-b353-f9630cafb820` | 7 000 | — | cloisonnement |

Montants en XOF (entiers). Sur un code déjà utilisé, l'API répond `422 MEDIA_CLAIM_INVALID`.

**Bracelets libres du prestataire A** (jamais activés ; un code = un rattachement, puis il est consommé) :
`SL6WM-28D6E` `DLSG2-8YNX4` `H3CZY-ZYL5A` `UKK77-UPV5P` `QBQ56-PRCJT` `VMW3S-EJU9M` `GKZL5-CTWXP` `XV3EM-AXKFJ`
`TBA56-D2VYY` `XVYBX-HJLF8` `Q3GKJ-EYGSV` `KMHLV-A6VW6` `VW5SG-BDCLK` `NAQPU-LHLB7` `63NFN-88TBA` `8RJGE-5K6D5`
`8HMM9-SG72M` `D926Y-TSWK4` `NW53W-YM5UW` `STGGV-8K25P`

**Bracelets anonymes du prestataire A** (actifs, sans compte) : `FNT97-9A3JD` (10 000), `82CFB-WJUG9` (2 500),
`WZ6WZ-DEEQE` (0).

Catalogue (prestataire A) : Bar Démo (Jus de bissap 1 500, Soda 1 000, Eau 500), Restauration Démo (Thiéboudienne 3 500,
Dibi 3 000), Boutique Démo (T-shirt 7 500, Casquette 4 000). Il est servi aux terminaux, pas à l'app festivalier.

## 3. Ce que l'app festivalier peut faire aujourd'hui

| Opération | Route | Essai | Réponse attendue |
|---|---|---|---|
| QR client à usage unique | `POST /me/customer-qr-tokens` `{wallet_id}` | Awa | `201`, `qr_payload` valable 60 s |
| … sur un portefeuille bloqué | idem | Ibrahima | `404 NOT_FOUND` |
| Rattacher un bracelet libre | `POST /me/media` `{claim_code}` | Fatou + un code libre | `201`, `ACTIVE`, portefeuille créé |
| Rattacher un bracelet déjà crédité | `POST /me/media` | Fatou + `FNT97-9A3JD` | `202 PENDING_DESK_CONFIRMATION` + code à 6 chiffres (confirmation au guichet) |
| Code d'un autre prestataire | `POST /me/media` | Khady + un code libre de A | `422 MEDIA_CLAIM_INVALID` |
| Se dire d'un autre prestataire | n'importe quelle route | Khady avec l'en-tête de A | `401` |
| Solde d'un bracelet anonyme, sans compte | `POST /public/balance-lookups` `{claim_code}` | `82CFB-WJUG9` | `200`, solde et opérations récentes ; bracelet rattaché à un compte : `404` |

Client d'exemple, sans dépendance : `node exemple-app-festivalier.mjs` (un appel par écran de l'app, avec ce qui
diffère de la spécification xaamga en commentaire). Pour `POST /topups/psp`, `return_url` doit être en `https:` ou
`cashless:` : un schéma propre à l'app (`xaamga://`) est refusé (`422`).

## 4. Pas encore possible sur cette instance

- **Connexion OTP** `/customer-auth/*`, **déclaration de perte** `report-lost` et **remboursements**
  `refund-requests` : déclarées au contrat, **pas encore servies** (`404`) ; elles arrivent avec la mission de l'app
  festivalier. Utilisez le serveur simulé (`ACCES-API.md` §2) pour ces écrans.
- Lectures servies depuis le 10/11/2026 avec les en-têtes de test : `GET /me` (`phone` vide : aucun numéro gardé
  avant les comptes par numéro), `GET /me/wallets` (`refund.eligible` toujours faux avant la mission des
  remboursements), `GET /me/wallets/{id}/transactions` (curseur, `limit` 1 à 200, défaut 50 ; portefeuille d'un
  autre compte : `404`), `GET /me/media`.
- **Recharge PSP** `POST /topups/psp` : `409 PSP_NOT_CONFIGURED` (aucun moyen de paiement configuré ; le faux PSP n'a
  pas de secrets dans le processus qui tourne).
- **Payer une demande QR d'un commerçant** `POST /payment-requests/{id}/pay` : la demande est créée par un terminal
  enrôlé (certificat client), qui ne passe pas par ngrok. Demander au référent une demande fraîche (elle expire vite).
- Routes du personnel (jeton OIDC) et des terminaux (mTLS) : non joignables par ngrok, voir `ACCES-API.md` §3.

## 5. Remettre à zéro

Côté serveur seulement : `REINIT_DB=1 bash demarrer-local.sh` efface la base puis réécrit ces mêmes données
(mêmes identifiants, bracelets libres de nouveau disponibles).
