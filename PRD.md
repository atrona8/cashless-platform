# PRD — Système cashless multi-tenant (V1)

> **Source.** Ce PRD structure `docs/SPECIFICATION.md` (v1.2, 2 octobre 2026), `docs/DECISIONS_ADR.md`,
> `docs/POINTS_OUVERTS.md`, `docs/sync_protocol.md` et `packages/contracts/openapi.yaml`.
> Il ne remplace aucun de ces fichiers : en cas de doute ou de contradiction, **la règle de priorité de
> SPECIFICATION §0.3 s'applique** (tests exécutables > schéma SQL, OpenAPI, protocole de synchronisation > SPECIFICATION > ce PRD).
> Chaque section renvoie à la section normative (`§n`) qui porte le détail complet.

## 1. Vision produit

**Problème résolu.** Les festivals, concerts et lieux permanents (cinémas, hôtels, supermarchés) ont besoin
d'un paiement fermé (cashless) rapide, qui fonctionne même quand le réseau tombe, et d'une comptabilité
exacte de l'argent encaissé et dû à chaque intervenant. (§1.1)

**Utilisateurs cibles.**
- Prestataires cashless (opérateurs, unité d'isolation des données) qui fournissent bracelets et terminaux.
- Organisateurs d'événements, émetteurs des crédits par défaut.
- Commerçants (internes et externes) et leurs vendeurs.
- Festivaliers, anonymes ou avec un compte.
- La plateforme, éditeur du logiciel, qui perçoit une redevance sur chaque prestataire. (§3.1)

**Proposition de valeur.**
- Le festivalier charge un portefeuille (mobile money, carte, espèces), paie avec un bracelet NFC ou un QR code,
  et récupère son solde à la fin.
- Le système tient une comptabilité en partie double par réserve d'argent (pool), calcule les frais de chaque
  intervenant et prépare les versements. (§1.1)
- Les ventes continuent hors ligne dans des plafonds qui bornent la perte, ou via une passerelle locale sur site. (§9)
- Contexte de lancement : Sénégal (XOF, Wave, Orange Money, BCEAO, SYSCOHADA). (§6.5, §11.1, §12.3)

## 2. Périmètre fonctionnel détaillé

### 2.1 Grand livre et moteur d'écritures (§5)
- Grand livre en partie double par pool (une devise) ; invariants G1 à G8 (somme nulle, rien ne s'efface,
  idempotence, montants entiers, pas de passage du mauvais côté, cache = recalcul). (§5.1)
- Plan de comptes : argent (`A-*`), droits (`L-*`), attente (`S-ATTENTE`) ; comptes chauds sans cache. (§5.2)
- Liste fermée de types de transaction (`TOPUP`, `PURCHASE`, `REVERSAL`, `BREAKAGE`, `PAYOUT_*`…) avec leur
  schéma d'écriture. (§5.3)
- Moteur NestJS : un constructeur par type, unique appelant de `post_transaction` (seul point d'écriture en base),
  sauf cinq fonctions SQL (`take_deposit`, `refund_deposit`, `forfeit_deposit`, `refund_cash_due`, `preload_media`). (§5.4, §2.2)
- Calculs : entiers en unités mineures, arrondi demi vers l'extérieur, un arrondi par frais, taxe extraite une
  fois par transaction et par bénéficiaire ; 19 cas normatifs. (§5.5)
- Règles de frais (`fee_rule`) pour les quatre flux ; assiette `GROSS` ou `NET_OF_REFUNDS`. (§5.6)
- Erreurs métier : SQLSTATE `CL001` à `CL024` traduits en `ProblemCode` stables (RFC 9457). (§5.7)
- Scénario de référence de 48 transactions à rejouer par l'API, jusqu'à `CLOSED` et `LOCKED`. (§5.8)

### 2.2 Configuration, contrats, détenteur des fonds (§4)
- Cascade plateforme → prestataire → organisateur → événement → participation, versionnée ; bornée par le
  profil de législation (refus à l'enregistrement d'une configuration qui viole la loi). (§4.1)
- Paramètres : `wallet_scope`, `funds_holder` (choix obligatoire), `issuer`, `identity_mode`, `activation_modes`,
  `spend_order`, `refund_deadline`, `sync_deadline_hours`, plafonds carte, `breakage_destination`, etc. (§4.2)
- Contrats versionnés `PLATFORM_OPERATOR` et `OPERATOR_ORGANIZER` (porteurs des pertes, part de casse, assiette, contestations). (§4.3)
- Détenteur des fonds : `ORGANIZER`, `OPERATOR` ou `THIRD_PARTY` ; même modèle comptable. (§4.4)

### 2.3 Portefeuilles (§6)
- Portefeuille séparé du support ; comptes payé (remboursable) et offert (non remboursable). (§6.1)
- Ordre de consommation `PROMO_FIRST` / `PAID_FIRST`. (§6.2)
- Plafonds réglementaires ; niveau d'identification calculé (KYC au guichet, 4 derniers caractères de la pièce). (§6.3)
- Plusieurs devises : un portefeuille par devise sur un même bracelet. (§6.4)
- Règles du réseau limité (pas de transfert, pas de retrait sauf remboursement, pas d'intérêt, durée limitée). (§6.5)

### 2.4 Bracelets NFC (§7)
- MIFARE Ultralight EV1, format B 1.0 (28 octets, CRC), identité opaque, aucun montant sur la puce. (§7.1, §7.2)
- Mot de passe propre à chaque bracelet, dérivé par KMS (SP 800-108), stocké chiffré (AES-256-GCM, DEK enveloppée). (§7.3, §7.4)
- Personnalisation ; lecture à chaque passage avec `READ_SIG`, compteur, détection de copie ; un passage = une écriture. (§7.5, §7.6)
- Lots (kind, clé partagée ou dédiée, préchargement, caution, politique de réutilisation), cycle de vie. (§7.7)
- Cycle de vie du bracelet, activation (`DESK`, `SELF_APP`, `FIRST_TOPUP`), code de rattachement imprimé, remplacement. (§7.8)
- Caution en mode C (sur le solde) ou D (à part) ; ordre imposé au guichet de retour. (§7.9)
  Le serveur enchaîne les étapes du guichet de retour (caution, crédits offerts, solde, restitution) : livré par la
  mission 9, la mission 4 servant la restitution seule (décision du porteur du 15/10/2026, ADR-91, OP-N51).
- Cadrage de la mission 4 (porteur, 13/10/2026) : la bibliothèque de format existe en TypeScript et en Dart dès la
  mission 4 ; les routes de terminal et de festivalier y sont servies derrière un port d'identité, l'enrôlement réel
  des terminaux venant en mission 5a et les comptes festivaliers avec leur mission ; le KMS est un port avec un faux,
  l'adaptateur AWS réel venant quand la région et les comptes seront arrêtés (OP-N11) ; la caution payée à part se
  règle en espèces ; la mission 6 ne l'ouvre pas au mobile money ni à la carte (sa restitution exigerait un
  remboursement PSP, absent en V1 ; décision de spécification du 27/10/2026, à confirmer par le porteur). Les routes back-office des lots, des clés, de la
  personnalisation et de la liste noire sont à ajouter au contrat.
- Lots de bracelets créés et modifiés par des fonctions seulement (`create_media_batch`,
  `update_media_batch`), statut d'un bracelet par `media_set_status` (`SUSPENDED` et `BLACKLISTED`
  avec motif) : `cashless_app` n'a plus aucun droit d'écriture direct sur `media_batch` ni sur le
  statut ; la vente est attribuée au vendeur de sa session par clé étrangère (mission 11a, OP-N60 et
  OP-N79 levés, ADR-216).

### 2.5 Terminaux et encaissement (§8)
- Modes `CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK` (`PAIRED_TPE` refusé en V1). Catalogue à prix TTC fixe. (§8.1)
- Enrôlement sans MDM par code à usage unique ; clés dans le Keystore ; vendeurs par code PIN ; révocation. (§8.2)
- Ouverture de session de vendeur par un **processus séparé** `vendor-pin` (processus et rôle de
  base `cashless_pin` de plus), seul détenteur du secret des PIN : l'API lui passe le PIN par un
  appel interne signé (HMAC, loopback, rejeu refusé) et ne lit plus les empreintes (mission 11a,
  OP-N76 levé, ADR-217). Limite nommée : l'API voit le PIN en transit (OP-N151, levée par la preuve
  du PIN en missions 12 et 12b). Enrôlement iOS : la clé App Attest est gardée par le serveur, qui
  sait vérifier une assertion ; borne iOS gardée tant que l'app n'en envoie pas, vecteur réel
  d'Apple exigé avant la mission 12 (OP-N64 « côté serveur prêt », ADR-222).
- Paiement par QR (`MERCHANT_QR`, `CUSTOMER_QR`), toujours en ligne. (§8.3)
- Découpage (16/10/2026) : la mission 5a livre l'identité réelle du terminal (jeton d'appareil, mTLS, requêtes signées),
  les codes d'enrôlement (S5), l'enrôlement, la révocation, la configuration servie et le battement de cœur ; la
  mission 5b livre les vendeurs (S2), le catalogue et les lignes de vente (S18), le paiement par bracelet et par QR,
  l'annulation et l'identification au guichet (S24). Le schéma de référence n'a ni tables ni routes de contrat pour
  le catalogue et les vendeurs : la mission 5b les ajoute. Héritage de la mission 5a : l'enrôlement d'un terminal sur
  un événement clos ou un point de vente supprimé doit être refusé (OP-N74, ADR-120).
- Cadrage de la mission 5a (porteur, 19/10/2026) : jeton lié, mTLS et signature de chaque requête exigés ensemble sur
  les routes de terminal (contradiction avec §10.3 signalée) ; attestation vérifiée à l'enrôlement sur Android et iOS ;
  routes back-office des terminaux (liste, suspension, réactivation, révocation) ajoutées au contrat ; OP-N50 levée en 5a.
  Au plan (19/10/2026) : mTLS vérifié dans les processus ; terminaux Android 12 au moins ; `serial` unique par
  prestataire (ADR-109) ; grâce de 60 s au rafraîchissement d'un jeton (OP-N65) ; limite iOS consignée (OP-N64).
  À l'analyse (19/10/2026) : tout terminal est enrôlé pour un événement (code d'enrôlement lié à un événement).
- Cadrage de la mission 5b (porteur, 22/10/2026) : périmètre complet (vendeurs, catalogue, paiement par bracelet en un
  aller-retour ou en deux temps, annulation, QR commerçant et client, identification au guichet, OP-N74). Le PIN d'un
  vendeur (6 chiffres) est vérifié par le serveur, qui ouvre une session de vendeur liée au terminal (12 h au plus) et
  attribue lui-même chaque vente ; aucune empreinte de PIN ne quitte le serveur ; 5 échecs, comptés par vendeur sur
  tous les terminaux, bloquent le vendeur jusqu'au déblocage par le commerçant. Le PIN hors ligne est tranché par la
  mission 7. Seul le vendeur de la vente l'annule depuis le terminal d'origine dans la fenêtre, sinon un
  `SUPERVISOR`. Le prix d'une ligne de vente doit être celui du catalogue de la configuration servie au terminal ou le
  prix actuel. OP-N74 : enrôlement refusé dès `CLOSING` pour `CATALOG_POS` et `KEYPAD_TPE`, permis en `TOPUP_DESK`
  jusqu'à `CLOSED` ; `CLOSED` et point de vente supprimé refusent tout. Révocation d'une identification à deux
  (contrat et SPECIFICATION §6.3 point 5, amendé le 23/11/2026, OP-N164 levé).
- Plan de la mission 5b (porteur, 22/10/2026) : pile du document 08 (Node 22, `argon2` 0.44.0, la 0.45 n'ayant pas de
  binaire macOS Intel) ; empreinte du PIN avec un secret hors base (`VENDOR_PIN_SECRET`, exigé en production) ; PIN
  jamais en clair dans l'empreinte d'idempotence, remplacé par un dérivé argon2 sous un secret distinct
  (`VENDOR_PIN_IDEMPOTENCY_SECRET`, ADR-126, porteur 26/10/2026) ; une
  session de vendeur par terminal, désignée par son identifiant dans chaque vente ; côté festivalier du QR servi
  derrière le port d'identité du festivalier (utilisable en production avec la mission 10) ; **identification au
  guichet reportée à la mission 10** (comptes festivaliers au numéro vérifié). Renforcements : annulation unique
  garantie par la base, demandes QR écrites par fonctions de la base, écritures directes de `kyc_verification` et
  réaffectation directe d'un terminal retirées à l'API. Passe contradictoire (27 constats, tous traités) : registre des
  numéros des terminaux, PIN « compté d'abord », annulation par un `SUPERVISOR` au terminal (jeton sur place) ou au
  back-office (demande à deux). Limite acceptée : OP-N76 / ADR-121 (la base croit l'API pour la vérification du PIN),
  levée par la mission 11a (processus `vendor-pin`, ADR-217).
- Livraison de la mission 5b (état au 26/10/2026, lot WP14) : parcours complet prouvé par l'API
  (`payment-journey.spec.ts` : vendeurs, catalogue, enrôlement d'une caisse, paiement en un aller-retour et en deux
  temps, QR commerçant et client, annulation par le vendeur puis par un `SUPERVISOR`, blocage d'un vendeur sur tous les
  terminaux et déblocage, changement de prix) ; isolation des routes (lues du contrat) et des tables, secrets absents
  de toute table, de tout journal et de toute réponse, latence du paiement p95 ≤ 200 ms et p99 ≤ 500 ms, 20 envois
  simultanés → une vente. OP-N74 levé (migration 0035). Dettes héritées : OP-N76 et OP-N79 (levés
  par la mission 11a), OP-N77, OP-N78
  et OP-N80 (mission 13, dimensionnement du verrou d'essai de PIN), OP-N43 complété (mission 10).
- Recharges (Wave, Orange Money, carte, espèces), remboursements (mobile, virement, espèces, espèces dues), OTP. (§8.5)
- Remboursement partiel en espèces au guichet **sans restitution du bracelet** (décision du porteur du 23/11/2026,
  mission 9c) : tout ou partie du solde payé rendu en espèces, bracelet gardé actif, **permis ou non par l'organisateur**
  pour chaque événement (désactivé par défaut) ; seconde personne au-delà de `event.cash_refund_single_max` ; crédits
  offerts et caution non touchés. Aujourd'hui le solde ne se rend en espèces qu'à la restitution (`releaseMedia`) : écart
  avec SPECIFICATION §8.5 relevé le 23/11/2026, résolu par cette mission (route et réglage nouveaux, soumis au porteur).
  Réalise ADR-53 (point 3) ; seuil de la seconde personne appliqué au cumul des rendus partiels (ADR-190).
  **Livrée (mission 9c `remboursement-partiel-especes-01M84932`, 23/11/2026)** : lots WP01 à WP05 approuvés,
  consignation WP06. Décisions du porteur du 23/11/2026 (ADR-233) : cumul du jour **par portefeuille** (tous bracelets ;
  renforcement du choix initial par bracelet) ; bracelets anonymes acceptés, frais à chaque rendu ; le prestataire
  autorise (`cash_partial_refund_allowed`), l'organisateur active (`event.cash_partial_refund_enabled`) ; le montant saisi
  est débité, les espèces remises sont nettes des frais ; ajouts au contrat acceptés (`refundPartialCash`). Limites
  OP-N173 à OP-N184 (ADR-234). `SPECIFICATION.md` §8.5 et §17 amendés sans changer le numéro de version.
- App festivalier : compte par téléphone, rattachement, perte, consultation anonyme du solde. (§8.5)
- Gestion des clients par une application cliente (décision du porteur du 05/11/2026, mission 10c) : l'application
  s'authentifie de serveur à serveur, crée ou retrouve un client par son identifiant externe, liste, recherche,
  désactive, et obtient un jeton court pour agir en son nom sur les routes `/me` ; ses utilisateurs ne voient pas le
  cashless. Cloisonnement entre applications et entre prestataires. Risque à trancher au cadrage : l'application devient
  garante de l'identité de comptes qui portent de l'argent ; identification du client à soumettre au juriste.
  Cadrage du porteur du 23/11/2026 (avant le specify) : numéro de téléphone du client **obligatoire et vérifié** par code ;
  au nom du client, l'application consulte solde et bracelets, rattache un bracelet, déclare une perte, recharge et demande
  un remboursement ; risque d'une application compromise **non tranché**, soumis au juriste, point ouvert bloquant la
  production de la fonction.
  Servi en avance le 10/11/2026 (porteur, hors Spec Kitty) : connexion par numéro et code à usage unique, jetons d'accès et de renouvellement, déclaration de perte ; l'envoi réel du code (12b) et l'identification au guichet restent à faire (OP-N120, ADR-180).
  Mission 10a (`serveur-app-festivalier-01M7WB69`, **livrée** : lots WP01 à WP10 approuvés, consignation WP11,
  décisions du porteur du 20/11/2026) : identification au guichet (pièce : type, pays, 4 derniers caractères,
  expiration ; compte au numéro vérifié exigé ; refus de l'agent dont le téléphone est le numéro vérifié du compte,
  **limite OP-N163** pour un agent sans numéro ou avec un autre ; pièce déjà expirée refusée ; écriture par des fonctions
  `DEFINER` de la base seules, ADR-226) ; révocation à deux personnes (contrat ; **OP-N164 levé le 23/11/2026** : SPECIFICATION §6.3 point 5 amendé
  sur décision du porteur, ADR-227) ; rotation **immédiate** du secret des codes de rattachement,
  sans période de double empreinte (**OP-N47 levé le 20/11/2026**, ADR-228) : version du secret sur chaque
  empreinte, les codes émis avant sont refusés comme inconnus, réémission par une **commande d'exploitation**
  (`reissue-claim-codes`) sous un rôle de base dédié, `cashless_claimadmin`, jamais `cashless_app`, qui rend un
  fichier de cinq colonnes (`rank,code,url,uid,printed_number`) pour l'imprimeur ; `printed_number` (troisième
  colonne facultative du fichier de l'imprimeur, trois ajouts rétrocompatibles au contrat, ADR-225) et
  `pending_offline_notice` (par terminal et grand livre, approximation assumée, OP-N168, ADR-230) dans `/me` ; chaîne
  d'envoi des codes WhatsApp puis SMS principal (10 s) puis SMS de repli (20 s), code gardé en mémoire du processus
  seulement (35 s au plus), trois fournisseurs simulés refusés au démarrage en production (OP-N120, OP-N166, ADR-229),
  jusqu'à la 12b.
  Limite ajoutée le 23/11/2026 (revue post-fusion, OP-N172, ADR-232) : un changement du secret des codes sans hausse de
  sa version n'est pas refusé au démarrage (codes émis inutilisables sans message clair) ; levée par la 12b (KMS réel).
  Recharge PSP testable de bout en bout en développement (10/11/2026) : configurations de démo, secrets de démo du faux coffre, route de simulation du paiement hors contrat, absente en production ; levée par la 12b (OP-N121, ADR-181).

### 2.6 En ligne, hors ligne, passerelle locale (§9, `sync_protocol.md`)
- Snapshot signé, plafonds hors ligne par politique (`offline_policy`), refus par défaut. (§9.1 à §9.4)
- Numérotation `seq` par terminal, lots de 500 opérations, registre des numéros, trous de séquence. (§9.5)
- Conflits à la synchronisation : commerçant garanti, part non couverte en compte d'attente. (§9.6)
- **Aucune recharge espèces hors ligne** (décision du porteur du 30/10/2026, mission 7) : `cash_topup_offline` est
  toujours faux ; un `TOPUP_CASH` porté par un lot est rejeté seul (`OFFLINE_NOT_ALLOWED`), rien n'est écrit et une
  anomalie `NON_COMPLIANT_OPERATION` porte le montant. Écart signalé à `sync_protocol.md` (§5.4, §7.5, §8, §11 cas 22
  et 39) et à SPECIFICATION §9, à mettre en accord. La passerelle locale (mission 8) n'est pas concernée (décision du
  porteur du 05/11/2026) : elle sert les recharges espèces sous session de caisse ouverte sur site, garde de caisse
  inchangée.
- Vendeur hors ligne : session ouverte en ligne valable jusqu'à son expiration (12 h), aucune connexion hors ligne,
  aucun secret de PIN sur le terminal (porteur, 29/10/2026). Plafonds jugés sur la configuration détenue ; exposition
  = ventes non acquittées (acquittement de moins de 120 s compté, porteur 30/10/2026).
- Snapshots produits par un processus dédié (seul détenteur des clés), une version signée par pas ; signature par un
  faux KMS refusé en production : aucun snapshot servi en production avant la mission 12b (OP-N89).
- Passerelle locale qui prend l'autorité de débit pendant une coupure (bascule, époque, reprise forcée). (§9.7)
  Décisions du porteur du 05/11/2026 (mission 8) : bascule demandée par un admin par anticipation, jamais prise par la
  passerelle ; recharges espèces sur sessions de caisse ouvertes au central avant la bascule, fermées au central après
  le rendu ; aucune relève de guichet pendant la coupure ; promotion d'une passerelle de secours par handover normal ;
  clés derrière un port de stockage matériel dont le faux est refusé en production : passerelle non utilisable en
  production avant la mission 12b.
- Contrat d'API stable depuis le 05/11/2026 : les routes sont partagées avec les équipes clientes ; aucun renommage,
  retrait ni changement ; un ajout seulement s'il est indispensable et rétrocompatible.
- Écarts acceptés de la mission 8 (passe contradictoire du plan, décisions du porteur du 05/11/2026, `OP-N100` à `OP-N110`, `ADR-155` à `ADR-165`) :
  clés de la passerelle simulées jusqu'à la 12b ; jetons d'appareil de la passerelle sans rotation ; jeton de personne expiré toléré au guichet (12 h) ;
  ventes `EDGE_ONLINE` bornées au rejeu avec perte maximale chiffrée ; inscription par une personne avec alerte et délai ; purge des secrets (limite du
  mini-PC volé) ; passerelle perdue sans rejeu automatique ; dépassement temporaire d'un plafond réglementaire à la recharge espèces (à signaler au
  juriste) ; `STALE` seulement si confirmé ou plausible ; « même moteur » devient « mêmes modules ».
- Écarts de la mission 8 décidés en cours d'implémentation (09/11/2026, `OP-N111`, `OP-N112`, `ADR-166`, `ADR-167`) : rôle unique propriétaire de la
  base locale de la passerelle (`TRUNCATE` refusé, le reste consigné) ; détention des deux clés de site par une seule personne non détectable ;
  clé TLS client de la passerelle en fichier durci jusqu'à la mission 12b (`OP-N113`, `ADR-168`). Ordres locaux à deux personnes versés à l'audit
  du central par un champ facultatif sous `/edge/*` (`ADR-169`). Abandon du retour de l'autorité par une seconde demande consigné
  (`OP-N114`, `ADR-170`) ; `edge_base_url` et `authority_epoch` facultatifs au schéma `Problem` (`ADR-171`).
  Renforcements décidés le même jour : recul d'horloge du central borné à quelques minutes ; plafond par recharge au guichet (500 000 XOF par défaut,
  réglable) ; certificat client de la passerelle signé par le composant matériel ; frais recalculés par le central à la réception.
- Purge des secrets de la passerelle (11/11/2026, `OP-N118`, `ADR-186`) : WAL et blocs libres non effacés, tables d'ajout seul non
  vidées, purge hors de la transaction de la file, consignés jusqu'à la mission 12b ; TLS du port d'administration et purge
  manuelle versée au central avant destruction faits dans la mission 8.
- Ventes relayées par la passerelle : le central croit `pack_verified` sans pouvoir le vérifier, seule la passerelle détient la clé des
  colis (`OP-N122`, `ADR-188`, décision du 12/11/2026, revue post-fusion C1) ; perte bornée par les plafonds de rejeu (`OP-N104`) ; levée
  par la mission 12b (preuve signée du terminal relayée et vérifiée).
- Purge manuelle forcée sans accusé tant qu'un lot sans opération ne peut pas porter l'ordre (`OP-N119`, `ADR-187`) ;
  levé le 11/11/2026 par WP25 : lot de la passerelle sans opération accepté s'il porte des ordres locaux. Reprise forcée
  bornée en haut (`OP-N117`, levé par WP25). Restent consignés : page de 200 bracelets illisibles qui arrête le service
  des colis (`OP-N115`, `ADR-184`, mission 12b) ; grand livre passé à la main non vérifié par l'outil d'inscription
  (`OP-N116`, levé par la mission 11a : l'inscription rend le grand livre, ADR-221).

### 2.7 API (§10, `openapi.yaml`)
- `/v1`, problem+json, pagination par curseur, `Idempotency-Key` obligatoire sur toute écriture. (§10.1, §10.2)
- Un PIN de vendeur n'entre dans l'empreinte d'idempotence que sous un dérivé argon2 (ADR-126, 26/10/2026, mission 5b).
- Authentification par type d'appelant ; jeton d'approbation pour la seconde personne au guichet. (§10.3)
- Endpoints back-office à ajouter au contrat (organisateurs, événements, catalogues, lots, clôture, versements…). (§10.4)
  Routes absentes, vérifiées le 23/11/2026, confiées à la mission 11b (décision du porteur du 23/11/2026) et **livrées le
  25/11/2026** (ADR-235, ADR-236 ; OP-N170 levé) : profil et rôles de la personne connectée (`getStaffProfile`), `x-roles`
  lisible par machine sur 226 opérations (huit sans route : OP-N188), liste et détail des ventes (`listEventSales`,
  `getSale`), liste des anomalies et classement « traitée » sans écriture d'argent pour 10 types sur 23 (`listAnomalies`,
  `classifyAnomaly`), recherche (`searchMedia`, `getWalletOverview`, `searchCustomerByPhone`, numéro exact, masqué, limité
  en débit, audité sans le numéro), modèles de téléphone et niveau NFC (`listPhoneModels`, `upsertPhoneModel`,
  `deletePhoneModel`, `device_model`, `nfc_level`). **Reporté : la résolution des anomalies qui écrivent de l'argent**
  (13 types, OP-N185 : bloque la production, confirmé le 25/11/2026), mission 11c validée (`PROMPTS-A-ENVOYER.md`). Limites
  consignées : OP-N185, OP-N186, OP-N187, OP-N188, OP-N189, OP-N190, OP-N191, OP-N192, OP-N193, OP-N194, OP-N195, OP-N196, OP-N197, OP-N198 ; OP-N194 levé avant la fusion.

### 2.8 Argent réel : PSP, caisses, rapprochements, versements (§11)
- Configurations PSP par organisateur, choix par événement ; interface commune d'adaptateur et faux par fournisseur
  (mission 6). Adaptateurs Wave, Orange Money, PayDunya, Stripe et coffre AWS des secrets : mission « Adaptateurs
  PSP réels », dès les accès de test obtenus (décision du porteur du 27/10/2026, OP-N81, ADR-131) ; d'ici là, aucune
  recharge en ligne en production. Remboursement au payeur d'un paiement non crédité : hors plateforme (OP-N82). (§11.1)
- Mission 12b-1 (décision du porteur du 26/11/2026) : adaptateurs Wave, PayDunya et Stripe conformes à leur
  documentation publique (le port suit le mécanisme de notification de chaque fournisseur), coffre AWS Secrets Manager,
  KMS et S3 Object Lock ; il ne reste qu'identifiants et clés à poser. Chaque adaptateur reste refusé en production
  jusqu'à un essai réel réussi. PayDunya : notification traitée comme un signal, crédit après confirmation par son API.
  Orange Money attend sa documentation (portail Sonatel, accès par compte). (§11.1, §13.2, §13.7)
  **Consignée le 27/11/2026 (ADR-237 à ADR-240, OP-N199 à OP-N211 ; preuves : `docs/passation-12b-1/preuves.md`).**
  Rien n'est en production : `PRODUCTION_ENABLED_SERVICES` est vide, chaque service est levé après son essai réel
  (commande `npm run essai -w @cashless/api -- <service>`) par une PR relue (OP-N209, OP-N206). Écarts de sécurité décidés
  par le porteur le 26/11/2026 : preuve d'origine PayDunya fixe (OP-N199, ADR-238), carte PayDunya non créditée faute de
  preuve 3-D Secure (OP-N200), PayDunya sans relevé ni annulation, rapprochement manuel (OP-N201) ; exception Android des
  certificats d'usine expirés sous la seule racine Google `f92009e853b6b045` (OP-N202, ADR-239) ; contrôle des extensions
  `apple_validation_category_01` et `apple_bundle_version_01` d'App Attest reporté à la mission 12 avec un vecteur réel
  d'Apple (OP-N203, ADR-239). Limites : Wave sans clé d'idempotence (OP-N204), relectures et `expires_at` en mémoire de
  chaque processus (OP-N205), points « à confirmer à l'essai » (OP-N206), garde réseau des tests contournable par
  `lookup` (OP-N207), litige Stripe relu (OP-N208, décision du porteur : un litige non rattaché garde la voie « sans
  correspondance » jusqu'à l'anomalie à 24 h), mineurs de l'essai et des relectures (OP-N210, OP-N211). Contrat : ajout
  rétrocompatible D9 à `receivePspWebhook` (ADR-237). Stripe : seul `authenticated` vaut un succès 3-D Secure
  (`attempt_acknowledged` : non crédité, lecture stricte d'ADR-77). Héritages : mission 12 (OP-N202, OP-N203), mission 12b
  (Orange Money, OTP, OIDC, matériel de la passerelle, autorité des terminaux : OP-N73), mission 13 (OP-N207, OP-N208, OP-N211, décision du porteur du 27/11/2026) ; OP-N205 : mesure à la recette avec plusieurs
  instances, puis décision du porteur (aucune mission affectée). OP-N203 ne bloque pas la production (décision du 27/11/2026) ;
  OP-N202 ne bloque pas la production non plus (décision du porteur du 27/11/2026).
- Sessions de caisse d'espèces, écarts. (§11.2)
- Rapprochement ligne à ligne des relevés. (§11.3)
- Versements manuels en V1, à deux personnes, export CSV. (§11.4)
- IBAN (remboursements et versements) masqué dans les journaux et **chiffré au repos** (AES-256-GCM,
  enveloppe `enc:v1:`) aux trois emplacements où il est gardé (`refund_request`, `payout`, contenu
  des demandes d'approbation) ; la base refuse tout IBAN en clair ; seul l'export du lot de
  virements l'ouvre. Clé en configuration de l'API (écart accepté par le porteur le 18/11/2026,
  levée avec le vrai KMS en 12b : OP-N150, ADR-218). Une demande de remboursement ne naît qu'à son
  état initial ; `refund_deposit(uuid, uuid)` reste interne (OP-N145 levé, OP-N153, ADR-219).
  Versements : refus et approbation par rôle de classe, rejeu de confirmation audité,
  auto-approbation `409 APPROVAL_INVALID`, plafond de la régularisation `OPERATOR_FEE` (OP-N137,
  OP-N141 levés, ADR-220).

### 2.9 Cycle de l'événement et clôture (§12)
- `DRAFT` → `LIVE` → `CLOSING` → `RECONCILING` → `SETTLING` → `REFUND_WINDOW` → `CLOSED`, par `set_event_status` seulement. (§12.1)
- Droit de place, synchronisations tardives, casse réversible, clôture avec soldes restants. (§12.1)
- Contrôles permanents planifiés et liste fermée des types d'anomalie. (§12.2)
- Relevés et export comptable configurable (`account_mapping`). (§12.3)

### 2.10 Double validation et rôles (§3.2)
- Rôles humains de `PLATFORM_ADMIN` à `CUSTOMER`. Actions à deux personnes : jeton sur place au guichet,
  demande puis approbation au back-office (`approval_request`, 24 h).
- Personnes du personnel authentifiées par le serveur d'identité OIDC (jeton court ; connexion et rafraîchissement
  chez le serveur d'identité) ; prestataire et rôles déduits des données de la plateforme, jamais du jeton.
- Gestion des personnes et des rôles par portée (plateforme, prestataire, organisateur, événement, commerçant) via
  des routes du back-office ajoutées au contrat, chaque action journalisée ; amorçage du premier
  `PLATFORM_ADMIN` par une commande d'exploitation. (décidé le 08/10/2026, mission 2)
- Journal d'audit chaîné par empreintes (une chaîne par prestataire) et scellé périodiquement, sur le modèle du
  scellement du grand livre ; copie des scellements d'audit hors de la base avec celle du grand livre (mission 9).
  (décidé par le porteur du projet le 08/10/2026)

### 2.11 Sécurité et données personnelles (§13)
- RLS par prestataire, `assert_tenant`, clés dans KMS, journal d'audit, scellement du journal toutes les 5 min.
- Durcissement serveur de la mission 11a : droits de `cashless_app` réduits (aucun droit de table ou
  de colonne ajouté, un seul `EXECUTE` nouveau hors lots : `advance_app_attest_counter`, OP-N152),
  rôle `cashless_pin`, inscription d'une passerelle qui rend son grand livre (OP-N116 levé, ADR-221)
  ; aucun faux en production (processus `vendor-pin` et anneau de clés d'IBAN refusent le démarrage
  sans leur secret).

## 3. Hors périmètre (V1)

- Caisses tierces : intentions de paiement, `PAIRED_TPE`, webhooks sortants, SDK de lecture (V2, ADR-43). (§1.3)
- Contrôle d'accès, billetterie, bracelet-billet (ADR-41).
- Versements automatiques (calcul, export et enregistrement seulement).
- Portail web festivalier ; paiement NFC sur iOS (QR uniquement).
- Puces anti-clonage cryptographiques (Ultralight AES, NTAG 424 DNA).
- Conversion de devises à l'intérieur d'un grand livre.
- Remboursement par carte ; vérification d'identité en ligne (interface prévue, non implémentée). (§8.5, §6.3)
- Variantes, remises et stock au catalogue. (§8.1)
- Outils de sécurité automatiques en CI (reporté, OP-N37). (§13.6)

## 4. Acteurs et systèmes externes

**Acteurs humains** (§3.2) : `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`,
`MERCHANT_ADMIN`, `VENDOR`, `CUSTOMER`.

**Systèmes externes.**
- AWS KMS (dérivation, chiffrement enveloppe, signature des snapshots), Secrets Manager, RDS PostgreSQL 17,
  S3 Object Lock (copie des scellements). (§1.2, §13)
- PSP : Wave Business, Orange Money, PayDunya, Stripe (webhooks signés, relevés). (§11.1)
- Envoi des codes à usage unique : WhatsApp puis deux fournisseurs SMS (fournisseurs à choisir sur devis). (§8.5, ADR-66)
- Serveur d'identité OIDC pour l'authentification du personnel et les jetons d'approbation ; produit à choisir. (§3.2, §10.3)
- Banque (virements, relevés), fournisseur d'impression des bracelets (fichier de commande, correspondance code ↔ UID). (§7.8, §11)
- Passerelle locale sur site (mini-PC, Docker). (§9.7)

**Contraintes d'intégration** : webhooks vérifiés, stockés bruts, idempotents ; adaptateurs PSP derrière une
interface commune ; types TypeScript et Dart générés depuis `openapi.yaml`.

## 5. Contraintes techniques connues

- **Stack** (§1.2) : API NestJS (TypeScript) ; PostgreSQL ≥ 17 sur AWS RDS ; back-office React/Next.js ;
  apps terminal et festivalier en Flutter ; passerelle NestJS en Docker ; monorepo imposé (§2.1).
  Versions et choix d'implémentation : `docs/08-pile-logicielle.md` (référence arrêtée le 09/10/2026, ADR-78 :
  l'existant prime ; Redis, Prisma, Fastify et Nginx écartés).
- **Architecture** (§2.2) : point d'écriture unique `post_transaction` ; fonctions métier en base ;
  `set_config('app.operator_id', …, true)` par transaction ; idempotence partout ; types générés ; région paramétrable ; UTC.
- **Performance** (§15) : 200 terminaux, 50 ventes/s site, 20/s stand, démontrés à deux fois ; serveur seul p95 ≤ 200 ms ;
  bout en bout p95 ≤ 1,2 s ; transaction SQL ≤ 60 s.
- **Sécurité** (§13) : RLS forcée, KMS, rôles IAM séparés, Keystore, SQLCipher, scellement externe, audit externe avant pilote.
- **Réglementaire** : instrument à usage limité (ADR-48, sous condition d'avis juridique) ; plafonds BCEAO provisoires ;
  TVA 18 % provisoire ; SYSCOHADA indicatif ; données en `eu-west-3` provisoirement.
- **Critères d'acceptation** (§16) : pgTAP (400 + 64 assertions), 19 cas moteur en TS, scénario rejoué par l'API,
  vecteurs bracelet en TS et Dart, charge, coupure, tests de `sync_protocol.md` §13, cloisonnement sur toutes les routes.

## 6. Flux critiques identifiés

1. Paiement en ligne par bracelet en un seul aller-retour (`register_tap` → `post_transaction` → `consume_tap`). (§7.6)
2. Paiement hors ligne puis synchronisation par lot, avec garantie du commerçant. (§9.3 à §9.6)
3. Bascule d'autorité vers la passerelle et retour. (§9.7)
4. Recharge PSP : demande, webhook signé, écriture `TOPUP`, prise de caution due. (§8.5, §11.1)
5. Recharge et remboursement en espèces au guichet, avec seconde personne au-delà du seuil. (§8.5)
6. Activation, rattachement par code imprimé, perte et remplacement d'un bracelet. (§7.8)
7. Guichet de retour : caution, crédits offerts, solde, espèces dues, restitution. (§7.9)
8. Clôture d'un événement jusqu'à `CLOSED` et `LOCKED`, puis réclamations tardives. (§12.1)
9. Double validation back-office : demande puis approbation. (§3.2)
10. Enrôlement d'un terminal. (§8.2)
11. Ouverture de session de vendeur par le processus `vendor-pin` (appel interne signé, décompte
    d'essais, audit), sans repli si le processus est absent. (§8.2, ADR-217)
12. Export du lot de virements : ouverture de l'IBAN chiffré par la seule route d'export, avec refus
    fermé si l'enveloppe est illisible. (§11.4, ADR-218)
13. Identification au guichet : le caissier saisit la pièce d'un festivalier au compte vérifié ; la base refuse un
    portefeuille anonyme et l'agent dont le téléphone est le numéro du compte ; les plafonds suivent le niveau calculé.
    Révocation : demande `KYC_REVOCATION` approuvée par une autre personne habilitée. (§6.3, ADR-226, ADR-227)
14. Rotation et réémission des codes de rattachement : nouveau secret et version, redémarrage (anciens codes refusés),
    commande `reissue-claim-codes` sous `cashless_claimadmin`, fichier de cinq colonnes à l'imprimeur, détruit après
    remise. (ADR-228, `docs/procedure-rotation-codes-rattachement.md`)
15. Envoi du code du festivalier : WhatsApp, puis SMS principal après 10 s ou sans WhatsApp, puis SMS de repli après
    20 s ; un seul code par défi, gardé en mémoire 35 s au plus. (§8.5, ADR-229)

## 7. Glossaire métier

Repris de SPECIFICATION, annexe A : pool, prestataire, détenteur des fonds, émetteur, casse, compte chaud,
compte de contrepartie, snapshot, marge de recharge, droit net, position soldée, passage (`tap_id`),
espèces dues, passerelle, époque d'autorité, `seq`, PSP, HT/TTC. Les définitions font foi dans l'annexe A.

## 8. Découpage anticipé en missions

Découpage validé le 07/10/2026 (détail et commandes dans `PROMPTS-A-ENVOYER.md`), dans l'ordre de dépendance :

1. Fondations du grand livre et de l'API
2. Identité, rôles et double validation
3. Configuration, parties et événements
4. Bracelets NFC (format, clés, lots, cycle de vie)
5. Terminaux, découpée en deux missions le 16/10/2026 (décision du porteur) :
   5a. Identité et enrôlement des terminaux (avec les dettes de sécurité héritées de la mission 4)
   5b. Terminaux et paiement en ligne (vendeurs, catalogue, paiement par bracelet et par QR, identification au guichet)
6. Recharges, caisses et PSP
   6b. Adaptateurs PSP réels et coffre des secrets (ajoutée le 27/10/2026 ; fondue dans la 12b le 29/10/2026)
7. Hors ligne (snapshots et lots)
8. Passerelle locale
9. Remboursements, versements et clôture, découpée le 13/11/2026 (décision du porteur) :
   9a. Remboursements (demandes par l'app et le back-office, approbation à deux, autre numéro et décision du titulaire,
       espèces au guichet, guichet de retour ordonné) ; versement externe simulé jusqu'à la 12b
       **Périmètre réel livré (état du 16/11/2026, WP01 à WP07).** Paiement manuel : l'API ne verse rien ; la demande
       est créée par l'app (`POST`/`GET /me/refund-requests`, Wave ou Orange Money ; `BANK_TRANSFER` : `422
       REFUND_NOT_ALLOWED`, reporté en 9b, OP-N123), approuvée par `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (circuit à
       deux : proposition puis validation par une autre personne, écriture `WALLET_REFUND`), payée hors système, puis
       confirmée `PAID` ou `FAILED` (le `FAILED` recrédite par `REVERSAL`, refusé au proposant et à l'exécutant :
       décision du 16/11/2026, OP-N126). Autre numéro : code envoyé au nouveau numéro, décision du titulaire (`CONFIRM`
       ou `BLOCK`, route publique `holder-decision`), attente `AWAITING_HOLDER` jusqu'à `hold_until`, vérification
       renforcée au-delà de `refund_new_number_max`. Portefeuille bloqué remboursable seulement si le blocage vient
       d'un bracelet déclaré perdu ; règle de frais obligatoire. Guichet de retour enchaîné (caution, crédits offerts,
       solde payé, espèces dues, `release_media`, en une transaction ; seconde personne au-delà de
       `cash_refund_single_max` sur le cumul des espèces sorties, ADR-190). Espèces dues d'un bracelet remplacé
       rendues (`replace_media`, `0082`). OP-N51 et OP-N55 levés ; limites consignées : OP-N124 à OP-N126 et OP-N128
       (ADR-191 à ADR-193, ADR-195) ; C-001 (FR-012) tranchée : comportement strict, OP-N127 clos (ADR-194) ; lien du titulaire (OP-N129) levé par la 9a ; `REVERSAL` d'un `WALLET_REFUND`
       `BACKOFFICE` admis (ADR-189). Mesures : NFR-004 p95 sous 500 ms, NFR-005 promotion sous 5 min, NFR-001 et
       NFR-002 par 100 et 50 requêtes simultanées.
   9b. Versements aux parties, rapprochements, clôture, réclamations tardives, scellement externe, relevés. Décisions du porteur du 17/11/2026 : mission gardée entière ; opérations absentes ajoutées au contrat, listées au plan et validées avant l'implémentation.
       **Périmètre réel livré (état du 17/11/2026, WP01 à WP14).** Paiement manuel : l'API ne verse rien. 20 opérations ajoutées au
       contrat : étapes de clôture (aperçu puis exécution des sept étapes, soldes restants), versements (droits nets, lot demandé
       puis validé par une autre personne, rôle selon le bénéficiaire, export CSV, résultat `CONFIRMED` ou `FAILED`, borne
       `PAYOUT_EXCEEDS_ENTITLEMENT`), relevés importés en CSV (rapprochement automatique par signe et montant puis manuel, état
       par compte, condition `PSP_RECONCILED` calculée), réclamations tardives (`ADJUSTMENT` ajouté), demande de remboursement
       créée par le back-office (OP-N123 levé), relevés des parties et export comptable (`account_mapping` configurable, couples
       non mappés listés). Passages `CLOSING` à `LOCKED` prouvés par les routes (`scenario/closing-journey.spec.ts`). Scellement
       et vérification quotidienne, contrôles permanents et alertes. Levés : OP-N123, OP-N124, OP-N126, OP-N128, OP-N130 et la
       partie rapprochement d'OP-N82 (ADR-210). Écarts acceptés : copie externe des scellements simulée (OP-N131, ADR-197),
       alertes sans envoi (OP-N132, ADR-198), remboursement tardif en mobile money vers un autre numéro (OP-N139, ADR-207).
       Limites consignées : OP-N133 à OP-N138, OP-N140 à OP-N145, OP-N148 (reste d'OP-N126 : alerte dédiée en 12b, ADR-212), OP-N149 (balayage d'isolation entre organisateurs d'un même prestataire, 13) ; renforcements : OP-N146 (dont le renommage des enums Dart, ADR-213) ; OP-N147 levé (ADR-211). Note aux équipes clientes :
       `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md`.
   9c. Remboursement partiel en espèces au guichet sans restitution du bracelet, permis par l'organisateur (ajoutée le
       23/11/2026, décision du porteur ; après 9a, indépendante de 10c). **Livrée** (lots WP01 à WP06, ADR-233 et ADR-234, report aux
       missions 11, 12 et 13).
10. App festivalier, coupée le 29/10/2026 : 10a serveur (nous), 10b app (déléguée) ; 10a fusionnée dans `main` le 23/11/2026 (PR #24, `ee5099a7`)
11. Back-office web (déléguée) ; 11a durcissements serveur hérités (nous)
    11b. Routes serveur manquantes au back-office (nous ; ajoutée le 23/11/2026, après la 9c, avant la mission 11). **Livrée**
       (lots WP01 à WP11, ADR-235 et ADR-236, OP-N185 à OP-N198, report aux missions 11, 11c, 12 et 13).
    11c. Résolutions d'anomalie qui écrivent de l'argent (nous ; proposée à la fin de la 11b et validée par le
       porteur le 25/11/2026 ; hérite d'OP-N185 et d'OP-N196 : les 13 types non classables, type par type, et le contrôle de l'auteur du
       classement par la base).
12. App terminal (déléguée ; NFC après la validation sur vrais bracelets)
12b-1. Adaptateurs conformes aux documentations des fournisseurs déjà choisis (26/11/2026) (nous ; **adaptateurs écrits, en attente de la fusion et des essais réels** : lots
    WP01 à WP13, ADR-237 à ADR-240, OP-N199 à OP-N211, report aux missions 12, 12b et 13). Levés côté code, en attente de
    l'essai : OP-N41, OP-N89, OP-N131 et les adaptateurs Wave, PayDunya, Stripe et coffre d'OP-N81.
12b. Intégrations réelles (services externes), avant la recette
13. Recette V1

**Réorganisation du 29/10/2026 (décision du porteur, au lancement de la mission 7).** Les services externes sont
simulés jusqu'à la mission 12b : chaque mission travaille derrière un port avec un faux refusé en production (AWS KMS
et Secrets Manager, PSP réels, fournisseurs SMS et WhatsApp, serveur d'identité réel, signatures NXP réelles). Les
applications clientes (10b, 11, 12) sont déléguées à d'autres équipes, qui codent contre `openapi.yaml` ; la partie
serveur reste chez nous (10a, 11a, et missions 7 à 9). Conséquences sur les héritages ci-dessous : la mission 6b est
fondue dans la 12b ; OP-N41 et OP-N73 (adaptateurs KMS) passent de la mission 7 à la 12b ; OP-N56 (preuve de la
personne qui décide) et OP-N46 (signature NXP côté serveur) passent à la 12b ; OP-N60, OP-N79, OP-N76 et le côté
serveur d'OP-N64 passent à la 11a ; les héritages de la mission 10 vont à la 10a. Détail et ordre de démarrage :
`PROMPTS-A-ENVOYER.md`, section « Feuille de route révisée ».

**Héritages de la mission 4 (bracelets NFC, 14/10/2026)** — besoin à reprendre par les missions suivantes, détail
dans `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md` (ADR-83 à ADR-101 ; missions d'OP-N41, OP-N44, OP-N45,
OP-N46, OP-N50 et OP-N54 proposées par l'agent et confirmées par le porteur le 15/10/2026) :
- mission 5a : identité réelle du terminal, requêtes signées (OP-N42) ; fonctions SECURITY DEFINER de la base
  protégées contre les tables temporaires de l'appelant (`pg_temp` ou `TEMPORARY` retiré), pour fermer un
  contournement probable du cloisonnement entre prestataires (OP-N59, ADR-96, bloque la production) ; droits
  d'exécution des fonctions du schéma accordés rôle par rôle, sans héritage de `PUBLIC` (OP-N44) ; lecture qui a
  confirmé un rattachement refusée par `consume_tap` (OP-N50) ; empreinte de requête à clé au registre d'idempotence,
  pour qu'un code imprimé ne se retrouve pas par essais (OP-N54, ADR-99) ;
- mission 5a, suite (correctif post-fusion n° 1 ; confirmé par le porteur le 16/10/2026) :
  retrait d'une clé dédiée possible seulement pendant un travail de retrait approuvé, y compris
  pour la personnalisation, et demande approuvée périmée refusée à l'inscription (OP-N62, ADR-102) ;
  clé d'accord d'un terminal écrite à l'enrôlement seulement, jamais réécrite par la connexion de
  l'API (OP-N63, ADR-105, bloque la production) ;
- mission 6 : compte de caisse ouvert avec la session ; sans lui, aucune espèce n'entre ni ne sort au guichet des
  bracelets (OP-N49) ;
- héritages de la mission 6 (27/10/2026) : mission 7, session d'une recharge espèces hors ligne (la base refuse toute
  écriture de caisse hors session) — sans objet depuis le 30/10/2026 (recharge espèces hors ligne retirée) ; mission 9, rapprochement qui tient compte des paiements PSP non crédités (OP-N82)
  et passage à `RECONCILING` refusé tant qu'une session de caisse est ouverte ;
- héritages de la mission 6 (29/10/2026, WP14) : cause du blocage d'un portefeuille portée par le portefeuille (OP-N83, corrigée en cycle 2 par
  la migration 0042, ADR-134) ; anciennes signatures de caisse retirées à `cashless_app` (OP-N84, levé en cycle 2,
  ADR-135) ; reprise de la caution due après un arrêt entre COMMIT et `afterCommit` (OP-N85) ; mission 13, recette ;
- dettes de sécurité de la revue post-fusion de la mission 6 (29/10/2026, ADR-136) : rôle dédié au `psp-poller` et retrait à
  `cashless_app` de `psp_poll_candidates`, `psp_events_to_retry` et de l'INSERT sur `anomaly` (OP-N86) ; rôle propriétaire
  de `posting_cash_desk_guard` contrôlé au déploiement ou garde qui refuse (OP-N87) ; mission 13 ;
- verrouillage ordonné des comptes avant la lecture des soldes par une fonction dédiée, pour `CHARGEBACK` et `PURCHASE`
  (refus à tort sous concurrence, OP-N88, porteur 29/10/2026) ; mission 13 ;
- héritages de la mission 7 (tâches, 30/10/2026, ADR-139 et ADR-140) : trace `RETRY` d'un lot réexaminée (OP-N90) ;
  droits ajoutés au signataire et au contenu des snapshots, et lecture des imports de journal en cours par
  identifiants (OP-N91) revus ; mission 13 ;
- héritages de la mission 7 (consignation de WP21, 04/11/2026, ADR-141 à ADR-147) : `INSERT` direct sur `anomaly` gardé
  pour `cashless_app` (OP-N86 étendu, sept appelants) ; rotation de la clé de signature des snapshots à deux personnes
  avec acteur vérifié, lectures de clés accordées à `cashless_keyadmin` et `cashless_snapsign` revues (OP-N92) ;
  alarme sur les entrées de snapshot sans mot de passe, référence de la clé d'emballage, reprise du brouillon scellé
  (OP-N93) ; annulation du back-office qui réduit l'anomalie de perte, contrôle d'appartenance en base de l'acteur
  d'un import, migration `0050` (OP-N94) ; `413` au-delà de 100 ko (OP-N95) ; mission 13 ; clés de signature par prestataire (OP-N93 a) en 12b
  (confirmé par le porteur le 04/11/2026) ; le refus d'un `DATABASE_URL_MAINT` propriétaire ou superutilisateur en
  production est livré par WP21 (OP-N95 point 3, 04/11/2026) ;
  relecture en mission 13 de l'enveloppe de lecture `event_device_sync_status_api` (migration `0051`, `EXECUTE` à
  `cashless_app`, OP-N96, ADR-148) ; relecture de l'exemption de garde `pwd_pack_enc` dans
  `offline-snapshots.service.ts` (OP-N97, ADR-150) ;
  écart de NFR-005 sur les changements non bloquants (visibles en 60 s plus 2,5 s au plus, `DELTA_AFTER_MS` gardé à 60 s ;
  levée par un délai de 55 s au plus ou une reformulation, OP-N98, ADR-151) ;
  câblage des refus `LEDGER_LOCKED` et `SYNC_DEADLINE_PASSED` (FR-024) à prouver en intégration (OP-N99) ;
- mission 7 : forme de `content_sha256` du registre des numéros reprise de la mission 5b, et trous laissés par un
  corps en ligne invalide levés par la procédure des trous (ADR-128, porteur 26/10/2026) ; snapshots hors ligne inscrits par une fonction qui calcule elle-même la version, pour qu'une version
  plantée ne bloque plus les snapshots suivants (OP-N57) ; historique des politiques hors ligne écrit par son seul
  déclencheur, aux droits du propriétaire (OP-N58) ; deux faiblesses du kit relevées pendant la mission 4, qui
  bloquent toutes deux la production (décision du porteur du 15/10/2026) ; adaptateur AWS KMS réel du service de clés
  des bracelets, écrit avec celui de la signature des snapshots, après le choix de la région (OP-N41, bloque la
  production) ; droit par défaut global qui retire à `PUBLIC` l'exécution des fonctions futures, y compris créées à
  la main hors de `migrate.ts` (OP-N68, ADR-111, mission 5a) ; numérotation, présence et affectation d'un terminal
  écrites par des fonctions de la base, plus directement par l'API (OP-N69, ADR-112, mission 5a) ; adaptateurs réels
  de l'autorité des terminaux et du signataire des jetons d'appareil, avec celui d'OP-N41 (OP-N73, ADR-119,
  mission 5a, bloque la production) ; rôle de maintenance dédié aux purges des nonces et des essais d'enrôlement
  (OP-N75, ADR-114, mission 5a) ;
- mission 9 : enchaînement du guichet de retour (caution, crédits offerts, solde, restitution), servi par la mission 9
  (décision du porteur du 15/10/2026, OP-N51, ADR-91) ; rendu des espèces dues d'un bracelet remplacé (OP-N55,
  ADR-100) ;
- mission 9a, suite (16/11/2026) : OP-N51 et OP-N55 levés ; reste pour la 9b : OP-N123 (création par le back-office,
  `BANK_TRANSFER`), OP-N126 (rapprochements avec les relevés Wave et Orange Money pour borner le recrédit par une seule
  personne), réclamations tardives de `WALLET_REFUND`, OP-N124 et OP-N128 (confirmé par le porteur le 16/11/2026) ; OP-N125
  en 12b (confirmé par le porteur le 16/11/2026) ; OP-N127 clos (décision 15 du 16/11/2026, FR-012 amendée) et OP-N129 levé (décision 14) ; OP-N130 (ordre des états
  d'une demande gardé par l'API seule, ADR-196 : déclencheur de transition en base) en 9b, décidé par le porteur le 16/11/2026 ;
- mission 9b, suite (17/11/2026) : OP-N123, OP-N124, OP-N126, OP-N128 et OP-N130 levés ; pour la 12b : OP-N131 (copie réelle des
  scellements), OP-N132 (envoi des alertes), OP-N133 (`pg_read_all_stats`, lecture prestataire par prestataire) et OP-N139 (code au
  numéro de destination d'un remboursement tardif) ; pour la 11a : OP-N137, OP-N140, OP-N141, OP-N145 (tous levés par la 11a, voir ci-dessous) ; pour la 12b aussi : OP-N148 (alerte dédiée « paiement vu à la banque après recrédit », ADR-212) ; pour la 13 : OP-N149 (balayage d'isolation entre organisateurs d'un même prestataire) ; à fixer avec le porteur : OP-N134, OP-N135, OP-N136, OP-N142, OP-N143, OP-N144 ;
- mission 11a, implémentée le 19/11/2026 (`durcissements-serveur-01M7QAJD`, lots WP01 à WP13
  approuvés) : OP-N79 et OP-N141 **levés le 18/11/2026** ; OP-N60, OP-N76, OP-N116, OP-N137, OP-N140
  et OP-N145 **levés le 19/11/2026** (ADR-216 à ADR-221) ; **OP-N64 « côté serveur prêt », non
  levé** : le serveur garde l'identifiant
  de clé App Attest et vérifie les assertions (vérificateur non branché), borne iOS gardée jusqu'à
  la mission 12, **vecteur réel d'Apple exigé avant la 12** (ADR-222). Décisions du porteur du
  18/11/2026 : IBAN masqué dans les journaux et chiffré au repos aux trois emplacements par une clé
  de configuration de l'API (limite : clé dans le processus public, levée avec le vrai KMS en 12b,
  OP-N150), `refund_deposit(uuid, uuid)` gardée interne et exécutable par personne (OP-N153), un
  seul droit d'exécution nouveau hors lots pour `cashless_app` : le compteur App Attest (OP-N152,
  déni de service accepté) ; grand livre d'une passerelle rendu par son inscription (argument manuel
  refusé). Décisions du 19/11/2026 : cache anti-rejeu de l'appel signé vers `vendor-pin` ; test
  d'ouverture de l'enveloppe à l'exécution des versements ; relance de Colima (conteneur de test
  seulement) ; tests de borne écrits avant la fusion ; `msisdn` et IBAN libres masqués, **OP-N156
  levé le 19/11/2026 par renforcement**. Limites nommées et reportées : PIN en transit (OP-N151,
  missions 12 et 12b), OP-N154 (12b), OP-N157 (12b), OP-N158, OP-N159 et OP-N161 (13), OP-N160
  (mission 11), OP-N153 (mission 13, confirmée par le porteur le 19/11/2026), OP-N162 (voulu),
  OP-N155 (mission
  12b : condition bloquante de passage en production, décision du porteur du 19/11/2026) (ADR-224).
  Contradiction CL058 tranchée par le porteur le 19/11/2026 : `interfaces.md` corrigé (CL058
  traduit par edge-admin, absent de l'API) ;
- mission 10 : identité réelle du festivalier (OP-N43), liste et déclaration de perte de ses bracelets ; le
  rattachement par code, la demande en attente et l'activation depuis l'app sont déjà servis côté serveur.
- mission 10a (**livrée**, décision du porteur du 20/11/2026) : rotation **immédiate** du secret d'empreinte des codes
  imprimés (`CLAIM_CODE_HMAC_KEY`), sans période de double empreinte ; les codes émis avant sont refusés et réémis par
  la commande `reissue-claim-codes` (**OP-N47 levé le 20/11/2026**, ADR-104, ADR-228). Limites nommées et reportées
  (ADR-231) : OP-N163 (agent titulaire non détecté, décision du porteur), OP-N164 (§6.3 point 5 contre le contrat : **levé le 23/11/2026**,
  spécification amendée), OP-N165 (auteur de la révocation : OP-N56, 12b ; messages d'écran : 11), OP-N166 (code en
  mémoire, plafond de 35 s sans repli : 12b), OP-N167, OP-N168 et OP-N169 (mission 13) ; hérité : mission 10b (routes
  réelles, faux fournisseurs, `X-Test-Otp-Code` encore là), mission 11 (écrans d'identification et de révocation à
  deux, règle de l'agent titulaire), mission 12b (trois fournisseurs réels, accusés, retrait de `X-Test-Otp-Code` et
  des trois libellés de refus), mission 13 (procédure de rotation sur un lot réel, délais réels de 10 s et 20 s) ;
- mission 11 : décision d'une demande d'approbation liée à une preuve signée de la personne qui décide (serveur
  d'identité réel ou signature du valideur), pour que la base ne croie plus le valideur que lui passe l'API (OP-N56,
  ADR-94) ; OP-N60 (lots de bracelets par fonctions) et OP-N79 (`vendor_id` dans la clé composite de
  session) levés par la mission 11a (ADR-216) ; hérité de la 11a (OP-N160, ADR-220) : `canSee` ne
  doit pas montrer un lot de versements mixte à un détenteur d'une seule classe (aujourd'hui lecture
  seule, test de borne `payout-mixed-visibility.spec.ts`) ;
- mission 12 : signature d'originalité NXP vérifiée aussi par le serveur à la personnalisation, avec la clé publique
  NXP et les signatures réelles de la validation de la puce (OP-N46) ;
- mission 12, suite : activation et remplacement envoient la lecture complète du bracelet dans la
  requête (`tap`, `new_media_tap`), pas un identifiant de lecture (ADR-103) ;
- mission 12, héritée de la mission 5a : sur iOS, signer les requêtes par assertion App Attest (ou preuve
  équivalente) pour prouver la clé de signature dans la Secure Enclave ; d'ici là iOS reste borné au QR (OP-N64,
  ADR-106, décision du porteur du 19/10/2026) ; le port d'attestation iOS renvoie le `keyId` App Attest, stocké par le
  serveur (fait par la mission 11a, ADR-222), et l'app passe `iosClientDataHash` tel quel à
  `attestKey` ; hérité de la 11a : envoyer les assertions (transport ajouté au contrat, soumis au
  porteur avant), brancher le vérificateur, retirer la borne iOS de `/media/auth-keys`, fournir un
  vecteur d'assertion réel d'Apple, avec le PIN en transit (OP-N151) et le compteur (OP-N152) ;
- mission 12b, héritée de la 11a : vrai KMS pour la clé de l'IBAN (OP-N150, ADR-218), secrets
  distincts par rôle (OP-N154), politique `VENDOR_*` sur l'audit de `cashless_pin` (OP-N157) ;
  **condition bloquante de passage en production (OP-N155, décision du porteur du 19/11/2026)** :
  purger ou chiffrer les lignes anciennes de `refund_request` et `payout`, puis `VALIDATE
  CONSTRAINT` des deux `CHECK` d'IBAN avant la première donnée réelle, et réexaminer le statut des
  superutilisateurs exclus de la garde ;
- mission 13, héritée de la 11a : atomicité de la session de vendeur après une API tombée (OP-N158),
  tests faibles de `vendor-pin` (OP-N159), verrou des lots avant la RLS (OP-N161),
  retrait de `refund_deposit(uuid, uuid)` avec le remaniement du générateur et du schéma (OP-N153,
  confirmé par le porteur le 19/11/2026) ;
- mission 13 : purge du registre des essais de PIN des vendeurs (OP-N78, ADR-127, décision du porteur du
  26/10/2026) ; preuve que la clôture d'un lot, le rattrapage du préchargement et le rechiffrement vont au bout sur un
  lot de 5 000 bracelets (NFR-008, OP-N61, ADR-98, décision du porteur du 15/10/2026, bloque la production) ;
  aiguillage des routes vers leur processus décrit et vérifié sur l'environnement de recette (OP-N45) ; grâce de 60 s
  au rafraîchissement d'un jeton d'appareil réexaminée selon les pertes réseau mesurées (OP-N65, ADR-108, mission 5a) ;
  identité de l'app Android lue dans la liste logicielle de Key Attestation, réexaminée sur les appareils cibles
  (OP-N67, ADR-110, mission 5a) ; limite de débit en amont sur l'enrôlement des terminaux, sans compte (OP-N72,
  ADR-117, mission 5a, confirmé par le porteur le 21/10/2026) ; secrets de l'API lus par processus, chacun ne recevant que les siens (OP-N77, ADR-125,
  mission 5b, décision du porteur du 23/10/2026) ; essai d'`@peculiar/asn1-android` 2.10.0 et d'App Attest réel sur
  les appareils cibles ; à la mise en production, purge des lignes `api_idempotency` antérieures à T + 720 h (OP-N54,
  OP-N71) et réglage de `DEVICE_REQUEST_AUTHORITIES` (ADR-113).

## 9. Notes non classées

- **Points ouverts non bloquants pour le code mais bloquants pour la production** : OP-N3 (taxes, SYSCOHADA),
  OP-N11 (région AWS), OP-N12 (conservation) ; OP-N13 (algorithme de signature) à vérifier par l'agent. (POINTS_OUVERTS §2)
- **Actions préalables du porteur du projet** : validation de la puce sur de vrais bracelets et campagne de mesure NFC
  **avant le code de l'app terminal** (actions 1 et 2) ; accès de test PSP (action 11) ; devis OTP (action 10). (POINTS_OUVERTS §7)
- **Décisions de cadrage (7 octobre 2026)** : le découpage Spec Kitty couvre toute la V1 ; aucun code applicatif
  n'existe avant la première mission (un premier essai écrit hors Spec Kitty a été supprimé) ; la validation de la
  puce et la campagne NFC (actions 1 et 2) ne sont pas faites, donc la mission « app terminal » vient en dernier,
  avec cette condition préalable.
- **Environnement local** : PostgreSQL 17 installé, pgTAP et `pg_prove` absents ; Docker absent ; Flutter présent.
