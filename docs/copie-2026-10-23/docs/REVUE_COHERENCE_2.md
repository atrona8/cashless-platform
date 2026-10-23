# Revue de cohérence n° 2

Date : 2 octobre 2026. Périmètre : schéma SQL et tests, openapi.yaml, sync_protocol.md, SPECIFICATION, DECISIONS_ADR, POINTS_OUVERTS, kit.

Trois relectures indépendantes : base de données, API et protocole, documents. Les constats ont été croisés. Le défaut B1 a été vérifié contre le scénario de référence.

> **Statut (2 octobre 2026).** La partie A est appliquée : schéma, `roles.sql` (nouveau), API, protocole et documents. Les tests passent : 434 assertions (370 + 64), et le scénario de référence va maintenant jusqu'à `CLOSED` puis `LOCKED`. Une relecture croisée a suivi, et ses écarts sont corrigés.
>
> Questions de la partie B : toutes tranchées le 2 octobre 2026 — Q1 option C (ADR-72), Q2 option B, 72 h (ADR-73), Q3 option C (ADR-74), Q4 option A (ADR-75), Q5 option C, 50 000 et 48 h (ADR-76), Q6 = OP-N9 parties 1 C et 2 B (ADR-77).
>
> Restent ouverts, sans décision nécessaire :
>
> - test de concurrence des verrous (hors pgTAP) ;
> - retrait des bracelets par tranches dans `close_batch` (seules les cautions sont traitées par tranches) ;
> - opération back-office de création d'une demande de remboursement ;
> - chiffrage du p99 NFC et du coût de la vérification ECC (banc de mesure).

Le document est en trois parties :

- **A. Corrections sans décision.** Ce sont des bugs ou des oublis de propagation. Je propose de les appliquer en bloc.
- **B. Questions à trancher.** Chacune a des options et une recommandation.
- **C. Améliorations.** Elles sont facultatives : performance, structure, lisibilité.

Niveaux : **Bloquant** (le système ne peut pas fonctionner ou perd de l'argent), **Important** (risque réel en production), **Mineur**.

---

## Synthèse

| Partie | Bloquants | Importants | Mineurs |
|---|---|---|---|
| A. Base de données | 3 | 14 | 11 |
| A. API et protocole | 3 | 12 | 6 |
| A. Documents | 3 | 12 | 10 |
| B. Questions | 6 questions | | |
| C. Améliorations | environ 15 propositions | | |

Le défaut le plus grave est B1 : **aucun événement réel ne peut atteindre le statut CLOSED.** La règle de clôture exige que chaque compte soit à zéro. Or le scénario de référence se termine avec des comptes non nuls qui se compensent par partie. Par exemple, L-ORG-COM vaut -4 745 et L-ORG-VERS vaut +39 225 pour l'organisateur. Les tests passent parce qu'ils clôturent des grands livres vides.

---

## A. Corrections sans décision

### A1. Base de données

**Bloquants**

| N° | Défaut | Correction |
|---|---|---|
| DB-B1 | `set_event_status(CLOSED)` et `lock_settled_ledger` exigent que tout compte non-actif soit à zéro. Les comptes d'une même partie se compensent (commissions, versements), donc la clôture est impossible. | Contrôler le **droit net par partie** (`party_position.net_claim = 0`). Contrôler compte par compte seulement les comptes sans propriétaire (attente, encours de versement). Ajouter un test qui rejoue le scénario de référence jusqu'à CLOSED puis LOCKED. |
| DB-B2 | `replace_media` avec une caution HELD perd le lien de la caution avec le grand livre. `refund_deposit`, `forfeit_deposit` et `close_batch` échouent ensuite. | Transférer la caution vers le nouveau support, ou la garder rattachée au portefeuille, dans la même transaction. Ajouter un test. |
| DB-B3 | Les numéros de séquence ne sont pas bornés. Un lot avec `seq_from` très grand crée environ un milliard d'anomalies SEQ_GAP et peut bloquer la base. | Rejeter si `seq > last_seq + N` (N configurable, par exemple 10 000). Renvoyer CL016 et créer une seule anomalie. |

**Importants**

| N° | Défaut | Correction |
|---|---|---|
| DB-I1 | Une signature NULL n'est pas vérifiée. Il suffit d'omettre la signature pour échapper au contrôle. | Signature obligatoire dès que l'événement ou le support l'exige. |
| DB-I2 | Un lot hors ligne sans `online_tap_id`, arrivé après la fenêtre de rejeu, met le support en liste noire alors que c'est un simple retard. | Distinguer le retard (LATE_OFFLINE_SYNC) de la fraude (COUNTER_DUPLICATE). Pas de liste noire automatique sur un retard. |
| DB-I3 | Aucune fonction ne consomme le tap. `register_tap` ne renvoie pas son identifiant. | `register_tap` renvoie `tap_id`. Ajouter `consume_tap(tap_id, tx_id)`, qui est idempotente. |
| DB-I4 | Risque d'interblocage : `FOR UPDATE` sur le grand livre, puis verrou consultatif, contre le `KEY SHARE` de `post_transaction`. Concerne `set_event_status`, `grant_edge_authority` et `force_central_authority`. | Ordre de verrouillage unique et documenté : d'abord le verrou consultatif, ensuite les lignes. Ajouter un test de concurrence. |
| DB-I5 | `lock_settled_ledger` ne vérifie pas l'état, ne prend pas de verrou et n'est pas idempotente. Un second appel prolonge `late_claims_until`. | Exiger l'état CLOSING, verrouiller, ne rien faire si déjà LOCKED. |
| DB-I6 | Les réclamations tardives n'ont pas de limite : tous comptes, tous montants. ADJUSTMENT est libre. BREAKAGE_REVERSAL est accepté sur un grand livre OPEN. | Limiter aux comptes autorisés et au montant de la casse initiale. Double validation obligatoire. BREAKAGE_REVERSAL seulement après la casse. |
| DB-I7 | Le schéma force `allow_negative` sur les comptes de casse. La SPEC §5.2 et le scénario disent « négatif : Non ». | Aligner sur la décision OP-N3 : la casse est réversible dans la limite de son solde, donc pas de solde négatif. |
| DB-I8 | Passer un compte de chaud à froid, ou l'inverse, ne recalcule pas `account_balance`. | Recalculer ou interdire le changement après la première écriture. |
| DB-I9 | Le déclencheur commerçant rend le compte chaud mais ne règle pas `allow_negative`. | Régler les deux attributs ensemble. |
| DB-I10 | Il y a une fenêtre de concurrence entre le calcul de `wallet_topup_headroom` et l'écriture de la recharge. `p_occurred` vaut `now()` par défaut. | Verrouiller le portefeuille avant le calcul. Rendre `p_occurred` obligatoire pour les sources terminal. |
| DB-I11 | L-ESP-A-RENDRE est un compte unique, sans contrôle par support. La libération ignore l'anomalie ouverte. | Sous-compte ou contrôle par support. Bloquer la libération si une anomalie CASH_TOPUP_OVER_LIMIT est ouverte. |
| DB-I12 | Un trou de séquence peut être levé (`waive_seq_gap`) pendant qu'un lot qui le contient est en traitement. | Refuser si un lot PROCESSING couvre la plage. |
| DB-I13 | Le passage à SETTLING ne vérifie pas la date limite de synchronisation. | Ajouter le contrôle. Dépend de la question Q2. |
| DB-I14 | `set_event_status` ignore l'autorité de débit. Un événement peut passer en CLOSING alors qu'une passerelle EDGE détient encore l'autorité. | Exiger l'autorité CENTRAL à partir de RECONCILING. |
| DB-I15 | Le garde du statut d'événement peut être contourné avec `set_config('app.event_status_change','on')`. | Remplacer par un contrôle de rôle ou de propriétaire de fonction, que l'appelant ne peut pas falsifier. |
| DB-I16 | Le sceau ne couvre que les lignes. Approbateur, source, événement et métadonnées de `journal_transaction` peuvent être modifiés sans détection. | Inclure ces champs dans l'empreinte. |
| DB-I17 | `preload_batch` et `close_batch` traitent tout le lot en une seule transaction. Pour un gros lot, il y a un risque de délai dépassé et de verrous longs. | Traitement par tranches, avec reprise. |
| DB-I18 | `operator_fee_basis = NET_OF_REFUNDS` est calculé avant les remboursements dans l'ordre de clôture. `topup_basis` fait doublon. | Calculer les frais après la fenêtre de remboursement. Supprimer `topup_basis`. |

**Mineurs (M1 à M11)**

- **Données et contrôles :**
  - M1 : le niveau KYC n'est pas historisé.
  - M2 : `register_tap` ne vérifie pas que le terminal appartient au même locataire.
  - M3 : la libération n'est pas verrouillée.
  - M4 : la clé d'idempotence de `forfeit_deposit` n'est pas déterministe.
  - M5 : `replace_media` ne vérifie pas l'état de l'ancien support.
- **Rejeux, lots et sceaux :**
  - M6 : les rejeux EDGE perdent la source et l'heure d'origine.
  - M7 : l'empreinte de requête est incomplète.
  - M8 : un lot peut rester bloqué en PROCESSING, sans délai d'expiration.
  - M9 : les grands livres LOCKED ne sont pas re-scellés après une réclamation tardive.
- **Tests et codes d'erreur :**
  - M10 : il manque des tests (rejeu EDGE, réclamation tardive refusée, concurrence).
  - M11 : les fonctions de support et de lot n'ont pas de code CL.

### A2. API et protocole

**Bloquants**

| N° | Défaut | Correction |
|---|---|---|
| API-B1 | La double validation peut être falsifiée : `approved_by` est envoyé dans le corps de la requête. Une seule personne peut donc se valider elle-même. | Flux en deux temps : une demande, puis une approbation par un second jeton authentifié. Voir la question Q3. |
| API-B2 | Aucune opération ne permet de rembourser au guichet les espèces de L-ESP-A-RENDRE. | Ajouter `refundCashDue`. |
| API-B3 | Le remboursement en espèces au guichet passe seulement par `releaseMedia`. Il accepte CARD ou un numéro libre. | Opération dédiée, limitée à CASH, avec le plafond `cash_refund_single_max`. |

**Importants**

- Les réclamations tardives ne sont pas possibles par l'API. Il faut une opération back-office `postLateClaim` avec double validation.
- La matrice des statuts (lignes CLOSED et LOCKED, BREAKAGE_REVERSAL en LIVE) ne correspond pas au schéma. Elle doit être corrigée.
- SIGNATURE_MISMATCH n'est pas dans les énumérations de l'API. `originality_sig_sha256` manque dans le contenu de l'instantané.
- Le webhook PSP ne peut pas choisir son secret avant de connaître le locataire. La clé `psp:` est ambiguë. Correction : URL de webhook par configuration, `/webhooks/{provider}/{psp_config_id}`.
- Le flux des contestations carte (chargeback) n'existe pas. Il dépend de OP-N9.
- Il faut de nouvelles anomalies : PSP_MISMATCH, PSP_TOPUP_OVER_LIMIT, LATE_CHARGEBACK, EDGE_REPLAY_FAILED.
- Le rejeu EDGE d'une ACTIVATION ou d'un DEPOSIT_CASH qui échoue n'est pas traité. Il n'y a pas de règle pour les synchronisations tardives autres que les ventes.
- Le numéro de remboursement est libre. Il doit être le numéro vérifié ou être confirmé par OTP. Il manque aussi la création d'une demande de remboursement par le back-office.
- Il manque des opérations de guichet : KYC, sessions de caisse, import du journal d'un terminal révoqué.
- Il reste des traces de MDM : cas 33 de sync_protocol, ATTESTATION_FAILED « appareil non géré ».
- sync_protocol fige encore des valeurs devenues configurables : délais, tentatives, rétention.
- READ_SIG manque dans l'ordre des commandes NFC de sync_protocol.
- `confirmMediaClaim` a deux problèmes : le type de `tap_id` est incohérent, et le guichet ne peut pas connaître `claim_id`. Il faut rechercher par `claim_code`.
- La protection OTP contre les abus est absente : limite par numéro et par IP, blocage temporaire.
- Les réglages de rôles PostgreSQL ne sont écrits qu'en commentaire. Il faut un script `roles.sql`.

**Mineurs.**

- Renvois croisés cassés.
- Libellés périmés.
- Exemples sans `config_id`.
- Statut d'ADR erroné dans les descriptions.
- `ProblemCode` incomplet.
- Risque résiduel ADR-57 au rattachement d'un bracelet à solde nul, à documenter.

### A3. Documents

**Bloquants**

| N° | Défaut | Correction |
|---|---|---|
| DOC-B1 | La SPEC §5.2 indique « négatif : Non » pour la casse, alors que le schéma l'autorise. | Voir DB-I7 : aligner les deux. |
| DOC-B2 | La ligne CLOSED et le pseudo-code de clôture décrivent la règle fausse de DB-B1. | Réécrire avec la règle « droit net par partie ». |
| DOC-B3 | Le chemin « un seul aller-retour » exige l'instantané, y compris pour un terminal en ligne seul (téléphone personnel). | Instantané facultatif si `offline_allowed = false`. |

**Importants**

- Plusieurs fiches ADR sont contredites par des décisions ultérieures, sans note datée : ADR-12, 14, 17, 29, 30, 31, 33, 36, 42, 47. Il faut ajouter une note « Modifiée par ADR-xx le … ».
- ADR-67 se contredit : débit proportionnel, puis avance par le bénéficiaire. Il faut garder une seule règle.
- La ligne WALLET_REFUND de la SPEC §5.3 ne mentionne pas L-ESP-A-RENDRE.
- La liste des anomalies de la SPEC §12.2 n'a pas SIGNATURE_MISMATCH.
- `topup_basis` est en doublon (voir DB-I18).
- `refund_deadline`, `sync_deadline` et « marge » n'ont pas de valeur par défaut ni de définition.
- Le README du kit est périmé : il dit encore « OP-B1, OP-B2 bloquent ».
- La vue d'ensemble de POINTS_OUVERTS ne correspond pas aux sections 5 à 8.
- La SPEC §17 mélange les valeurs décidées et les valeurs ouvertes.
- La liste des opérations à double validation de la SPEC §3.2 est incomplète : réclamation tardive, levée de trou, forçage d'autorité.
- `operator_fee_basis` manque dans la SPEC §4.3.
- La SPEC est toujours en version 1.1. Il faut passer en 1.2 et ajouter un journal des modifications.

**Mineurs.**

- REVUE_COHERENCE n° 1 à marquer « archivée ».
- Responsable de `cash_refund_single_max` non nommé.
- p99 NFC et coût de vérification ECC non chiffrés.
- Numérotation des sections à reprendre.
- Paragraphes trop longs.
- Glossaire absent.
- Index des ProblemCode absent.

---

## B. Questions à trancher

Elles seront posées une par une. Résumé :

| N° | Question | Recommandation |
|---|---|---|
| Q1 | La configuration PSP (S26) est rattachée à l'organisateur, alors que le détenteur des fonds est choisi par événement. Faut-il rattacher S26 à l'événement ? | Configuration par organisateur, avec choix par événement parmi ses configurations. |
| Q2 | Date limite de synchronisation : elle n'est pas définie et figure sur deux transitions différentes. | `event.sync_deadline` = fin de l'événement + 72 h, contrôlée au passage à SETTLING. |
| Q3 | Comment fonctionne la double validation par l'API ? | Demande, puis approbation par une seconde personne connectée, avec expiration après 24 h. |
| Q4 | Faut-il une limite au montant et au périmètre des réclamations tardives ? | Limite = casse initiale du support. Double validation. Seulement par le back-office. |
| Q5 | Le numéro pour un remboursement mobile peut-il être différent du numéro vérifié ? | Oui, mais seulement après un OTP envoyé au nouveau numéro. |
| Q6 | OP-N9 : qui paie les contestations carte ? | Toujours ouvert. Il sera reposé avec le flux LATE_CHARGEBACK. |

---

## C. Améliorations proposées

**Performance**

- Index sur :
  - `account (wallet_id, purpose)` ;
  - `account (ledger_id, purpose, owner_party_id)` ;
  - `posting (ledger_id, id)` ;
  - `media (event_id, status)` ;
  - `anomaly (ledger_id, status, kind)`.
- Contrôle d'équilibre une seule fois par transaction : un déclencheur différé unique au lieu d'un par ligne.
- Contrôles de cohérence incrémentaux, depuis le dernier sceau, au lieu d'un recalcul complet.
- Instantané hors ligne : utiliser `media.last_counter` au lieu de recalculer le compteur.

**Structure**

- Une seule fonction de création de comptes, `create_account`, qui règle chaud/froid, `allow_negative` et le propriétaire.
- Des fonctions SQL pour les flux composés (remplacement de support, remboursement au guichet), au lieu de les laisser à l'application.
- Des codes CL pour toutes les erreurs de support et de lot.
- Des vues de métriques : lots en attente, anomalies ouvertes par type, écart de synchronisation par terminal.

**Lisibilité pour l'agent qui code**

- Un fichier `LISEZMOI_PORTEUR.md` : ordre de lecture, ce qui est normatif, ce qui est en attente d'expert.
- Colonnes Module et Date dans l'index des ADR.
- POINTS_OUVERTS réorganisé en trois listes courtes : à décider, en attente d'expert, reporté.
- SPEC : table des matières, journal des modifications, annexe unique des paramètres (nom, valeur par défaut, qui le règle), glossaire.

---

## Prochaine étape proposée

1. Appliquer toute la partie A, avec les tests correspondants. Le test de clôture complète sur le scénario de référence passe en premier.
2. Poser les questions Q1 à Q6 une par une.
3. Appliquer la partie C après accord.
