# Points ouverts — système cashless multi-tenant

État au 2 octobre 2026 (après la revue de cohérence n° 2). Ce document liste ce qui n'est pas encore décidé. Chaque point indique s'il **bloque le code** et s'il **bloque la mise en production**, qui décide, et ce que l'agent code en attendant.

**Deux catégories :**

- **Bloque le code (OP-Bn).** Sans la réponse, l'agent ne peut pas écrire le module concerné correctement. Il code l'interface (port) et un faux pour les tests, puis s'arrête sur ce module.
- **Ne bloque pas le code (OP-Nn).** Une valeur par défaut sûre existe. L'agent la code, la rend paramétrable, et la décision la remplacera sans refonte. Beaucoup de ces points bloquent en revanche la **mise en production**.

Quand un point est tranché : on ajoute une fiche dans `DECISIONS_ADR.md`, on met à jour `SPECIFICATION.md` (§17 pour les valeurs par défaut) et on retire le point d'ici.

## Vue d'ensemble

| Point | Sujet | Bloque le code | Bloque la production | Qui décide |
|---|---|---|---|---|
| OP-N3 | Taxes, caution acquise, correspondance SYSCOHADA (la casse est tranchée : ADR-67) | Non | **Oui** | Expert-comptable |
| OP-N11 | Région d'hébergement AWS : Paris (`eu-west-3`) retenue à titre provisoire (ADR-65) | Non | **Oui** (confirmation) | Mesure de latence et juriste |
| OP-N12 | Durées de conservation des données | Non | **Oui** | Juriste |
| OP-N13 | Algorithme de signature des snapshots | Non | Non | Agent (vérification technique) |
| OP-N36 | Capture différée dans la cible V2 (reporté au cadrage V2) | Non | Non | Porteur du projet, avec le premier partenaire de caisse |
| OP-N37 | Outils de sécurité en CI (reporté) | Non | Non | Porteur du projet |
| OP-N40 | Durée de conservation des clés d'idempotence : 30 jours au contrat, 24 h codées | Non | Non | Porteur du projet |

Les points sont détaillés aux sections 2 (points non bloquants), 6 (reportés) et 9 (questions de la revue n° 2). OP-N21 à OP-N37 viennent de la revue de cohérence du 30 septembre 2026 (§8) : OP-N21 à OP-N35 sont tranchés, ainsi qu'OP-N38, né de la décision OP-N28 (§5) ; OP-N36 et OP-N37 sont reportés (§6). Aucun ne bloque le code. Q1 à Q6 viennent de la revue n° 2 du 2 octobre 2026 (§9) : toutes sont tranchées (ADR-72 à ADR-77).

---

## 1. Points qui bloquent le code

Aucun depuis le 2 octobre 2026 (OP-B1 : ADR-70 ; OP-B2 : ADR-66).

## 2. Points qui ne bloquent pas le code

### OP-N3 — Casse, taxes, caution acquise, correspondance SYSCOHADA

- **Questions.** La casse est-elle légale, après quel délai, et au profit de qui ? Taux et fait générateur des taxes sur frais et commissions ? Une caution acquise est-elle taxable ? La correspondance comptable indicative est-elle juste ?
- **Recommandation.** Coder avec les hypothèses actuelles, qui sont toutes paramétrables, puis faire valider par un expert-comptable SYSCOHADA avant la production. Questions détaillées : §3 (expert-comptable ; casse aussi au juriste).
- **Casse tranchée le 2 octobre 2026** (ADR-67) : réversible pendant 5 ans après le verrouillage ; reste à confirmer par l'expert-comptable et le juriste (si la date limite suffit : `late_claim_years = 0`).
- **Défaut codé.** TVA 18 % TTC ; casse à `refund_deadline`, partagée selon le contrat, réversible 5 ans ; caution acquise sans taxe ; `account_mapping` indicatif. **Bloque la production.**

### OP-N9 — Contestations de paiement par carte

- **Question.** Qui supporte une recharge par carte contestée quand le portefeuille est déjà dépensé ?
- **Options.** A : l'organisateur. B : le prestataire. C : selon le contrat. D : selon le contrat, avec une part au commerçant.
- **Recommandation.** C, l'organisateur par défaut, avec 3-D Secure obligatoire, un plafond de recharge par carte et par jour, et une alerte quand plusieurs cartes rechargent le même portefeuille. Le contrat doit porter la partie qui supporte les contestations.
- **Statut.** **Tranché le 2 octobre 2026** (ADR-77) : option C (selon le contrat, organisateur par défaut, avec 3-D Secure, plafond par carte et par jour, alerte multi-cartes) ; contestation tardive écrite dans le grand livre verrouillé.
- **Codé.** Le portefeuille est débité jusqu'à son solde et bloqué ; le reste va au compte de pertes de la partie désignée par `contract.chargeback_bearer`.

### OP-N11 — Région d'hébergement AWS

- **Préalables.** Mesurer la latence depuis Dakar vers Paris, l'Irlande, Milan et Le Cap, sur les réseaux Orange, Free et Expresso (protocole du banc). Obtenir l'avis d'un juriste sur la localisation des données (CDP, BCEAO).
- **Critère ajouté le 1er octobre 2026.** La région retenue DOIT proposer PostgreSQL 17 sur AWS RDS (ADR-55).
- **Statut.** Provisoire le 1er octobre 2026 : Paris (`eu-west-3`), ADR-65, à confirmer après ces deux préalables. La seconde région des sauvegardes reste à choisir.
- **Défaut codé.** Région paramétrable par prestataire, sauvegardes dans une seconde région. **Bloque la production.**

### OP-N12 — Durées de conservation des données

- **Question.** Combien de temps garder les historiques des festivaliers identifiés, pays par pays ?
- **Défaut codé.** Écritures comptables : 5 ans (à confirmer) ; données personnelles anonymisées 13 mois après la dernière activité. Paramètre `rules.retention_days`. **Bloque la production.**

### OP-N40 — Durée de conservation des clés d'idempotence

- **Question.** `openapi.yaml` (paramètre `IdempotencyKey`) dit « conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre) » ; la mission 1 a codé 24 h par défaut pour les clés applicatives (`IDEMPOTENCY_TTL_HOURS`, `api_idempotency.expires_at`). Contradiction entre le contrat et le code, relevée le 9 octobre 2026 (ADR-78, D19).
- **Défaut codé.** 24 h, paramétrable. Les clés des terminaux ne sont pas concernées (clé du grand livre, conservée).
- **Options.** (A) passer le défaut à 30 jours (720 h) pour suivre le contrat ; (B) corriger le contrat à 24 h. Recommandation : A (le contrat fait foi, coût de stockage faible).
- **Qui décide.** Porteur du projet.

### OP-N13 — Algorithme de signature des snapshots

- **Question.** Ed25519 si AWS KMS le propose dans la région retenue, sinon ECDSA P-256.
- **Défaut codé.** ECDSA P-256 (`ECC_NIST_P256`) ; l'algorithme et `key_id` sont dans l'en-tête, pour changer sans rupture. L'agent vérifie la disponibilité d'Ed25519 et ouvre une PR s'il est disponible.

## 3. Relectures d'experts

| Expert | Objet | Points | Documents à fournir |
|---|---|---|---|
| Juriste (BCEAO, CDP) | Statut réglementaire, plafonds, casse, stockage des pièces KYC, conservation, localisation des données | Condition d'ADR-48 (ex-OP-N2), OP-N3 (casse), ADR-38 (stockage KYC), OP-N11, OP-N12 | SPECIFICATION §4.4, §6.3, §6.5, §13.5 ; DECISIONS_ADR |
| Expert-comptable SYSCOHADA | Plan de comptes, taxes, casse, caution, correspondance légale | OP-N3, écart de taxe par période (ADR-09) | SPECIFICATION §5.2, §5.3, §12.3 ; classeur ; scénario de référence |
| Auditeur sécurité | Cloisonnement, clés, bracelets, API, hors ligne, passerelle | ADR-44 (revue de conception, puis test d'intrusion avant le pilote) | Documents du kit : SPECIFICATION, DECISIONS_ADR, `sync_protocol.md`, `openapi.yaml`, schéma de référence et tests |

### Questions au juriste (condition d'ADR-48, ADR-38, OP-N12)

À poser par écrit, avec SPECIFICATION §4.4, §6.3, §6.5, §13.5 et ADR-11, ADR-38, ADR-48 :

1. L'instruction BCEAO n° 001-01-2024 (ou un autre texte en vigueur) exclut-elle de son champ les instruments utilisables seulement dans un réseau limité (un organisateur, ses événements et ses commerçants) ? Si oui, à quelles conditions exactes (nombre ou type de commerçants, montants, durée, fournisseur unique) ?
2. Le modèle décrit en §6.5 (pas de transfert, pas de retrait sauf remboursement du solde, pas de rémunération, validité limitée) remplit-il ces conditions ? Y a-t-il une déclaration ou une notification à faire à la BCEAO ?
3. Qui porte le risque réglementaire : l'organisateur émetteur, le prestataire, ou la plateforme ? Le choix du détenteur des fonds (ADR-11) change-t-il la réponse ?
4. Des plafonds s'appliquent-ils dans ce régime (solde, recharges mensuelles, avec ou sans identification) ? Lesquels ? Les montants de l'instruction 008-05-2015 sont-ils encore applicables ?
5. Un portefeuille durable, utilisable sur plusieurs événements du même organisateur (`wallet_scope = ORGANIZER`), reste-t-il dans l'exclusion ?
6. Le paiement par carte et par mobile money pour recharger, et le remboursement vers mobile money, posent-ils une contrainte particulière ?
7. Si l'exclusion ne s'applique pas : quels types d'établissements agréés peuvent servir d'adossement, et quelles obligations restent au projet ?
8. Stockage des pièces d'identité (ADR-38) : le minimum enregistré au guichet (type de pièce, pays, 4 derniers caractères du numéro, date d'expiration, sans photo) suffit-il aux obligations d'identification ? Faut-il conserver une copie ou le numéro complet, et pendant combien de temps ?
9. Durées de conservation (OP-N12) : combien de temps garder les écritures comptables et les historiques des festivaliers identifiés, pays par pays (CDP au Sénégal) ? L'anonymisation des données personnelles 13 mois après la dernière activité est-elle acceptable ?

### Questions à l'expert-comptable (OP-N3)

À poser par écrit, avec SPECIFICATION §5.2, §5.3, §5.5, §12.3, ADR-09, ADR-12, le classeur et le scénario de référence :

1. Casse : les soldes non réclamés peuvent-ils être acquis, après quel délai, et au profit de qui (organisateur, prestataire, compte légal) ? Quel traitement comptable pour chacun ?
2. Taxes sur les frais et commissions : quel taux, et quel fait générateur (vente, encaissement, clôture de l'événement) ?
3. Écart de taxe par période (ADR-09) : la taxe est extraite par transaction et par bénéficiaire ; son total peut différer de quelques unités d'une taxe calculée sur le total de la période. Cet écart est-il acceptable, et faut-il une écriture de régularisation ?
4. Caution acquise (bracelet non rendu) : est-elle taxable, à quel taux et à quelle date ?
5. Correspondance SYSCOHADA indicative (SPECIFICATION §12.3, table `account_mapping`) : est-elle juste pour un organisateur émetteur et détenteur des fonds ? Quels comptes changent si le prestataire est émetteur ou détenteur ?

## 4. Ordre de décision conseillé

1. **Condition d'ADR-48** : choisir le juriste et lui envoyer ses questions (§3, questions 1 à 9 ; action 8). La réponse écrite est exigée avant le premier événement réel.
2. **Campagne NFC** : validation de la puce, campagne de mesure et mesure de latence (actions 1 à 3), avant le code de l'app terminal ; elle conditionne la liste des téléphones et OP-N11.
3. **Questions de la revue de cohérence n° 1** (OP-N21 à OP-N38, §8) : toutes traitées le 1er octobre 2026 ; restent les points reportés (§6).
4. **Questions de la revue de cohérence n° 2** : toutes tranchées le 2 octobre 2026 (§9).
5. **OP-N3** : envoyer les questions à l'expert-comptable (action 9), en parallèle du développement.
6. **OP-B1 et OP-B2** sont tranchés (ADR-70, ADR-66) : plus aucun point ne bloque le code.
7. Les autres points peuvent attendre le premier pilote.

## 5. Points tranchés

| Point | Décision | Date | Fiche |
|---|---|---|---|
| OP-N39 Pile logicielle | L'existant prime : PostgreSQL 17, RFC 9457, curseur, idempotence en base, sans ORM, Express, jose 6 ; le reste du document du porteur devient la cible (`08-pile-logicielle.md`) | 9 octobre 2026 | ADR-78 |
| OP-N1 Catalogue | Option B : prix TTC fixe, catégories, un taux de taxe par article ; ni variantes, ni remises, ni stock en V1 | 30 septembre 2026 | ADR-35 |
| OP-B1 Paiements | Comptes marchands au détenteur des fonds (A) ; Wave et Orange Money en direct (M3) ; carte configurée par organisateur : agrégateur local (PayDunya) ou PSP international (Stripe) | 2 octobre 2026 | ADR-70 |
| OP-B2 Codes à usage unique | WhatsApp d'abord, SMS en repli avec deux fournisseurs SMS (options C et D combinées) ; fournisseurs à choisir sur devis | 2 octobre 2026 | ADR-66 |
| OP-N3 (casse) | Casse réversible : enregistrée à la date limite, remboursement possible pendant 5 ans par annulation de casse en back-office (C) | 2 octobre 2026 | ADR-67 |
| OP-N6 Assiette des frais du prestataire | Au choix dans chaque contrat, brut par défaut (C) | 2 octobre 2026 | ADR-68 |
| OP-N7 Gestion des terminaux | Pas de MDM ; un téléphone personnel n'a jamais le hors ligne | 2 octobre 2026 | ADR-69 |
| OP-N2 Statut réglementaire | Option B : instrument à usage limité (réseau limité), règles de périmètre dans SPEC §6.5 ; plafonds paramétrables, valeurs de 2015 provisoires. **Sous condition** d'un avis écrit du juriste avant le premier événement réel ; sinon adossement à un établissement agréé | 30 septembre 2026 | ADR-48 |
| OP-N4 Code imprimé | Option B : QR code imprimé + code de 10 caractères en clair dessous | 30 septembre 2026 | ADR-36 |
| OP-N5 Capture différée | Option A : capture automatique seulement en V1 ; si un client hôtelier le demande, réservation dans le grand livre (option C) | 30 septembre 2026 | ADR-37 |
| OP-N8 Identification | Option D : vérification au guichet en V1, vérification en ligne plus tard sur le même modèle de données. Stockage minimal de la pièce à confirmer par le juriste | 30 septembre 2026 | ADR-38 |
| OP-N10 Validation terrain NFC | Téléphones : ceux déjà disponibles (option C). Critères : deux niveaux, « recommandé » (300 ms, 2 %) et « toléré » (500 ms, 5 %). Calendrier : dès maintenant, par le porteur du projet, avant le code de l'app terminal | 30 septembre 2026 | ADR-39 |
| OP-N14 Droit de place supérieur aux ventes | Option D : mode choisi par l'organisateur pour chaque commerçant (déduction avec reste dû, paiement d'avance, déduction plafonnée), défaut « déduction avec reste dû » | 30 septembre 2026 | ADR-40 |
| OP-N15 Import des billets | Sans objet : les bracelets-billets et le contrôle d'accès sont abandonnés ; les bracelets servent exclusivement au cashless | 30 septembre 2026 | ADR-41 |
| OP-N16 App festivalier | Compte par téléphone vérifié seulement (A) ; perte : suspension immédiate et paiement par QR en attendant (B) ; sans compte : consultation du solde en lecture seule par le code imprimé (B) | 30 septembre 2026 | ADR-42 |
| OP-N17 Premier partenaire de caisse tierce | Option C : caisses tierces reportées après la V1 (intentions de paiement, TPE associé, webhooks sortants, SDK) ; contrat conservé, marqué V2 | 30 septembre 2026 | ADR-43 |
| OP-N18 Audit de sécurité | Revue de conception et test d'intrusion (B) ; revue de conception dès maintenant sur les documents, test d'intrusion avant le pilote (A) ; pas d'outils de sécurité imposés dans la CI pour l'instant (B) | 30 septembre 2026 | ADR-44 |
| OP-N19 Charge et chaînage | Charge cible B (200 terminaux, 50 ventes/s sur le site, 20/s sur un stand), démontrée à deux fois ; scellement périodique du journal toutes les 5 minutes, copié hors de la base (C) | 30 septembre 2026 | ADR-45, ADR-46 |
| OP-N20 Compléments de schéma | Option C : les éléments critiques (S6 à S10, S12, S13, S25 et les colonnes associées de S4) sont écrits dans le schéma de référence avec leurs tests ; l'agent conçoit les éléments courants, et le porteur du projet relit sa première migration | 30 septembre 2026 | ADR-47 |
| OP-N21 Fin d'événement | Synchronisations tardives : écrites jusqu'à la fin de `RECONCILING`, ensuite rejet `SYNC_DEADLINE_PASSED`, anomalie et écriture par le back-office, commerçant garanti (C) ; `PROMO_EXPIRY` et `CHARGEBACK` acceptés pendant toute la clôture (A) ; clôture possible avec soldes restants listés si la casse est `NONE` ou `LEGAL_ACCOUNT`, grand livre verrouillé quand ils sont nuls (A) | 1er octobre 2026 | ADR-49 |
| OP-N22 Remboursements | Wave, Orange Money, virement bancaire au back-office, espèces au guichet ; pas de carte en V1 (B) ; espèces : une personne jusqu'à 50 000 XOF (réglable par événement), deux au-delà (B) ; bracelets anonymes remboursables en espèces sur présentation du bracelet (A) | 1er octobre 2026 | ADR-53 |
| OP-N23 Niveau d'identification | Porté par le client et calculé à chaque usage (identification non révoquée, pièce non expirée) ; table `kyc_verification` écrite dans le schéma de référence (A) | 1er octobre 2026 | ADR-54 |
| OP-N24 Renvoi d'une lecture | Le serveur reconnaît le renvoi (même terminal, bracelet, compteur, UID) dans un délai réglable par événement, 120 s par défaut, de 0 à 600 s (B) ; une opération de lot qui cite la lecture enregistrée en ligne la réutilise, quel que soit le délai (A) | 1er octobre 2026 | ADR-50 |
| OP-N25 Durée des transactions | PostgreSQL 17, `transaction_timeout = 60s` sur le rôle applicatif, plus une tâche de surveillance en filet (A + B) | 1er octobre 2026 | ADR-55 |
| OP-N26 Statut événement et grand livre | Fonction SQL unique `set_event_status` : passage contrôlé, conditions de clôture calculables vérifiées par la base, statut des grands livres, scellement final, historique (A) | 1er octobre 2026 | ADR-51 |
| OP-N27 Passerelle pendant une coupure | Passerelle intermédiaire : ventes, annulations, recharges espèces, activation sans frais sur solde, caution en espèces ; refus des autres prélèvements sur solde, des remboursements et des restitutions (B) | 1er octobre 2026 | ADR-52 |
| OP-N28 Code imprimé | Tous les lots `PUBLIC`, pas les lots `STAFF` ni `VIP` (A) ; code généré à la commande, associé à la puce à la personnalisation par scan du QR ou fichier du fournisseur (A) | 1er octobre 2026 | ADR-56 |
| OP-N29 Perte d'un terminal non conforme | Selon qui a fourni le terminal : plateforme ou prestataire → prestataire ; organisateur → organisateur ; commerçant → commerçant, sauf défaut du logiciel établi (B) | 1er octobre 2026 | ADR-58 |
| OP-N30 Chemin NFC de paiement | `READ_SIG` à chaque paiement, vérifiée par le terminal et comparée par le serveur à la signature de la personnalisation ; pas de `GET_VERSION` (B) | 1er octobre 2026 | ADR-59 |
| OP-N31 Latence | Bout en bout p95 ≤ 1,2 s, p99 ≤ 2 s ; NFC p95 ≤ 300 ms ; réseau + serveur p95 ≤ 800 ms, p99 ≤ 1,5 s ; serveur seul p95 ≤ 200 ms, p99 ≤ 500 ms (A) | 1er octobre 2026 | ADR-60 |
| OP-N32 Réglages des terminaux | Réglables par événement dans des bornes fixées par la base, par le prestataire (fenêtre d'annulation : organisateur), envoyés dans `DeviceConfig` (A) | 1er octobre 2026 | ADR-61 |
| OP-N33 Compte commerçant chaud | Tout compte commerçant est chaud par défaut (A) | 1er octobre 2026 | ADR-62 |
| OP-N34 Espèces encaissées au-delà d'un plafond | Recharge écrite en deux parts : marge au portefeuille, reste en `L-ESP-A-RENDRE`, rendu au guichet sur présentation du bracelet (B) | 1er octobre 2026 | ADR-63 |
| OP-N35 Paiement par QR | Deux sens toujours autorisés, sans réglage (C) ; pas de jeton préchargé, réseau obligatoire sur le téléphone ; sinon paiement par bracelet (A) | 1er octobre 2026 | ADR-64 |
| OP-N38 Rattachement d'un bracelet approvisionné | Libre si le solde est nul ; sinon demande en attente confirmée au guichet (lecture du bracelet et code de confirmation) ; consultation anonyme par un tiers acceptée (A) | 1er octobre 2026 | ADR-57 |

## 6. Points reportés

| Point | Statut | En attendant |
|---|---|---|
| OP-N3 : casse, taxes, caution acquise, SYSCOHADA | Regroupé dans les questions à l'expert-comptable (§3), et, pour la casse, dans les questions au juriste (§3) ; envoi : action 9 | Hypothèses actuelles paramétrables ; `account_mapping` indicatif |
| OP-N9 : contestations de paiement par carte | **Tranché le 2 octobre 2026** (ADR-77) : payeur selon le contrat (`chargeback_bearer`, organisateur par défaut), 3-D Secure, plafond par carte et par jour, alerte multi-cartes ; contestation tardive écrite dans le grand livre verrouillé | ADR-77 |
| OP-N11 : région AWS | Provisoire le 1er octobre 2026 : Paris (`eu-west-3`), ADR-65. À confirmer après la mesure de latence (action 3, §7) et l'avis du juriste | Développement, tests et pilote préparés en `eu-west-3` ; région paramétrable |
| OP-N12 : durées de conservation | Regroupé dans les questions au juriste (§3, question 9) | 5 ans pour les écritures ; données personnelles anonymisées 13 mois après la dernière activité |
| OP-N13 : algorithme de signature des snapshots | Vérification technique confiée à l'agent | ECDSA P-256 |
| OP-N37 : outils de sécurité en CI (dépendances vulnérables, analyse statique, détection de secrets) | Reporté le 30 septembre 2026 (ADR-44 : « reste à décider » ; question B17 de la revue de cohérence) | Aucun outil imposé en CI ; le test de cloisonnement sur toutes les routes reste un critère d'acceptation |
| OP-N36 : capture différée dans la cible V2 | Reporté le 1er octobre 2026 au cadrage de la V2, avec le premier partenaire de caisse (option A) | `capturePaymentIntent` reste marquée V2, sans engagement |

## 7. Actions à mener

| # | Action | Responsable | Échéance | Débloque |
|---|---|---|---|---|
| 1 | Validation de la puce sur de vrais bracelets (demi-journée, §5.0 du protocole) : `GET_VERSION`, `READ` sur page protégée, reprise après NAK, compteur 2, protection de `INCR_CNT` | Porteur du projet | Avant le code de l'app terminal | Code de lecture NFC |
| 2 | Campagne de mesure complète sur les téléphones disponibles, classés par profil ; rapport selon le gabarit du protocole | Porteur du projet | Avant le code de l'app terminal | Liste des téléphones recommandés et tolérés |
| 3 | Mesure de latence réseau depuis Dakar (Orange, Free, Expresso) vers les régions candidates | Porteur du projet, pendant la campagne | Avant le code de l'app terminal | OP-N11 (région) |
| 4 | Demander au fournisseur de bracelets le surcoût d'un QR différent par bracelet | Porteur du projet | Avant la première commande | ADR-36 |
| 5 | Préciser la taille du plus grand événement visé la première année (festivaliers, points de vente), pour confirmer la cible de charge | Porteur du projet | Avant le test de charge | ADR-45 |
| 6 | Choisir un auditeur de sécurité et lui confier la revue de conception (documents du kit) | Porteur du projet | Maintenant | ADR-44 |
| 7 | Test d'intrusion du système complet | Auditeur | Avant le premier événement pilote | Mise en production |
| 8 | Choisir un juriste (droit bancaire UEMOA) et lui envoyer ses questions (§3 : condition d'ADR-48, stockage des pièces KYC, durées de conservation) | Porteur du projet | Maintenant ; réponse écrite avant le premier événement réel | Mise en production (régime et plafonds) ; ADR-38 (stockage KYC) ; OP-N12 |
| 9 | Envoyer les questions à l'expert-comptable SYSCOHADA (§3) avec le classeur et le scénario de référence | Porteur du projet | Maintenant ; réponse avant la production | OP-N3 (casse, taxes, caution acquise, correspondance comptable) |
| 10 | Codes à usage unique (ADR-66) : demander les devis (SMS principal local couvrant Orange, Free et Expresso ; SMS de repli international ; fournisseur WhatsApp agréé Meta) et lancer la validation du nom d'expéditeur SMS (RCCM, 5 à 10 jours) et du modèle WhatsApp | Porteur du projet | Avant le pilote | Envoi réel des codes |
| 11 | Paiements (ADR-70) : ouvrir un compte Wave Business et un compte marchand Orange Money (accès de test et documentation des API) ; obtenir les accès de test PayDunya et Stripe ; vérifier pour Stripe l'ouverture de compte et le versement en XOF pour un marchand établi au Sénégal | Porteur du projet | Maintenant (validation Orange Money : plusieurs semaines) | Adaptateurs PSP réels |

## 8. Questions issues de la revue de cohérence n° 1 (30 septembre 2026)

Questions de la partie B de `REVUE_COHERENCE.md` (archivée). Toutes ont été traitées le 1er octobre 2026 : tranchées, ou reportées (§6). Le tableau est gardé pour la correspondance des numéros.

| Point | Revue | Question | Recommandation |
|---|---|---|---|
| ~~OP-N21~~ | B1 | Tranché le 1er octobre 2026 : voir §5 et ADR-49 | — |
| ~~OP-N22~~ | B2 | Tranché le 1er octobre 2026 : voir §5 et ADR-53 | — |
| ~~OP-N23~~ | B3 | Tranché le 1er octobre 2026 : voir §5 et ADR-54 | — |
| ~~OP-N24~~ | B4 | Tranché le 1er octobre 2026 : voir §5 et ADR-50 | — |
| ~~OP-N25~~ | B5 | Tranché le 1er octobre 2026 : voir §5 et ADR-55 | — |
| ~~OP-N26~~ | B6 | Tranché le 1er octobre 2026 : voir §5 et ADR-51 | — |
| ~~OP-N27~~ | B7 | Tranché le 1er octobre 2026 : voir §5 et ADR-52 | — |
| ~~OP-N28~~ | B8 | Tranché le 1er octobre 2026 : voir §5 et ADR-56 | — |
| ~~OP-N38~~ | — | Tranché le 1er octobre 2026 : voir §5 et ADR-57 | — |
| ~~OP-N29~~ | B9 | Tranché le 1er octobre 2026 : voir §5 et ADR-58 | — |
| ~~OP-N30~~ | B10 | Tranché le 1er octobre 2026 : voir §5 et ADR-59 | — |
| ~~OP-N31~~ | B11 | Tranché le 1er octobre 2026 : voir §5 et ADR-60 | — |
| ~~OP-N32~~ | B12 | Tranché le 1er octobre 2026 : voir §5 et ADR-61 | — |
| ~~OP-N33~~ | B13 | Tranché le 1er octobre 2026 : voir §5 et ADR-62 | — |
| ~~OP-N34~~ | B14 | Tranché le 1er octobre 2026 : voir §5 et ADR-63 | — |
| ~~OP-N35~~ | B15 | Tranché le 1er octobre 2026 : voir §5 et ADR-64 | — |
| ~~OP-N36~~ | B16 | Reporté le 1er octobre 2026 au cadrage V2 : voir §6 | — |
| OP-N37 | B17 | Outils de sécurité en CI : ADR-44 dit « reste à décider », sans point de suivi | Reporté (§6) |

## 9. Questions de la revue de cohérence n° 2 (2 octobre 2026)

Questions de la partie B de `REVUE_COHERENCE_2.md`. Statut : **à trancher**. Elles seront posées une par une. En attendant, l'agent ne choisit pas : il code ce qui n'en dépend pas et signale le reste. La SPEC écrit « en attente de Qx (revue 2) » aux endroits concernés.

| Point | Question | Recommandation de la revue | Statut | En attendant (texte actuel) |
|---|---|---|---|---|
| Q1 | La configuration PSP (S26) est rattachée à l'organisateur, alors que le détenteur des fonds est choisi par événement. Faut-il rattacher S26 à l'événement ? | Configuration par organisateur, avec choix par événement parmi ses configurations | **Tranché le 2 octobre 2026 : option C** (ADR-72) | S26 + S26b (SPEC §11.1, §14.2) |
| Q2 | Date limite de synchronisation : non définie, citée sur deux transitions (`CLOSING` → `RECONCILING` et `RECONCILING` → `SETTLING`) | `event.sync_deadline` = fin de l'événement + 72 h, contrôlée au passage à `SETTLING` | **Tranché le 2 octobre 2026 : option B, 72 h** (ADR-73) | `event.sync_deadline_hours`, contrôle dans `set_event_status` (SPEC §12.1) |
| Q3 | Comment fonctionne la double validation par l'API ? Aujourd'hui `approved_by` est envoyé dans le corps de la requête : une seule personne peut se valider elle-même (API-B1) | Demande, puis approbation par une seconde personne connectée, avec expiration après 24 h | **Tranché le 2 octobre 2026 : option C** (ADR-74) | Guichet : jeton d'approbation sur place (`X-Approval-Token`, 5 min) ; back-office : demande puis approbation (`approval_request`, `/approval-requests`, 24 h) ; `approved_by` du corps ignoré (SPEC §3.2) |
| Q4 | Faut-il une limite au montant et au périmètre des réclamations tardives (comptes, montant, `ADJUSTMENT` libre, `BREAKAGE_REVERSAL` accepté sur un grand livre `OPEN`) ? (DB-I6) | Limite = casse initiale du support ; double validation ; seulement par le back-office | **Tranché le 2 octobre 2026 : option A** (ADR-75) | `check_late_claim` dans `post_transaction`, `CL024` (SPEC §5.3, §12.1) |
| Q5 | Le numéro pour un remboursement mobile peut-il être différent du numéro vérifié ? | Oui, mais seulement après un code à usage unique envoyé au nouveau numéro | **Tranché le 2 octobre 2026 : option C, 50 000 et 48 h** (ADR-76) | SPEC §8.5 ; `event.refund_new_number_max`, `event.refund_new_number_hold_hours` |
| Q6 (= OP-N9) | Qui paie les contestations carte, et comment traiter une contestation reçue après `CLOSED` (flux `LATE_CHARGEBACK`) ? | Toujours ouvert ; à reposer avec le flux `LATE_CHARGEBACK` | **Tranché le 2 octobre 2026 : partie 1 option C, partie 2 option B** (ADR-77) | `contract.chargeback_bearer` ; contestation tardive par demande d'approbation (SPEC §5.3, §12.1) |
