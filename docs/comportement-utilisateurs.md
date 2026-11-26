# Cashless — comportement du système côté utilisateurs

État au 23/11/2026. Copie du document de travail en ligne
(https://claude.ai/artifact/G1r6uMd5LYzEXeGR4Vah6j). En cas d'écart, `docs/SPECIFICATION.md`, `openapi.yaml` et
`PRD.md` font foi (règle de priorité de SPECIFICATION §0.3).

## Vue d'ensemble

Le festivalier charge un portefeuille (mobile money, carte, espèces), paie avec un bracelet NFC ou un QR code, puis
récupère son solde à la fin. Le système tient une comptabilité exacte de chaque franc et continue de vendre quand le
réseau tombe. Lancement au Sénégal, en XOF.

**Le bracelet n'est qu'un identifiant ; l'argent est dans le portefeuille.** Un bracelet perdu se remplace, le solde reste.

```
bracelet ──rattachement──▶ portefeuille ──▶ compte festivalier (facultatif)
```

| Acteur | Rôle dans le système | Outil |
| --- | --- | --- |
| Festivalier (`CUSTOMER`) | Recharge, paie, consulte, se fait rembourser ; anonyme ou avec un compte | Bracelet, app festivalier (Flutter) |
| Caissier (`CASHIER`) | Recharge et rembourse au guichet, identifie un festivalier, remplace un bracelet | Terminal en mode guichet |
| Superviseur (`SUPERVISOR`) | Seconde personne au guichet, fermeture de caisse, annulation de vente hors fenêtre | Terminal (jeton sur place) |
| Vendeur (`VENDOR`) | Encaisse les ventes, se connecte par PIN | Terminal en mode caisse |
| Commerçant (`MERCHANT_ADMIN`) | Gère ses vendeurs, éventuellement son catalogue, reçoit ses versements | Back-office |
| Organisateur (`ORGANIZER_ADMIN`) | Événements, catalogues, points de vente, clôture, approbations | Back-office |
| Prestataire (`OPERATOR_ADMIN`) | Fournit bracelets et terminaux, lots, configuration, approbations ; unité d'isolation des données | Back-office |
| Plateforme (`PLATFORM_ADMIN`) | Éditeur du logiciel, redevance sur chaque prestataire | Back-office, commandes d'exploitation |

**Vocabulaire utile.**

- **Portefeuille** : deux comptes, crédits payés (remboursables) et crédits offerts (jamais remboursables). Par défaut,
  les crédits offerts partent en premier.
- **Code de rattachement** : 10 caractères imprimés sous un QR sur chaque bracelet public (`K7QM-4XH9RT`). Il sert à
  rattacher le bracelet à un compte et à consulter le solde sans compte.
- **Numéro imprimé** : le numéro lisible gravé sur le bracelet, montré dans l'app.
- **Caution** : facultative, par lot ; prise sur le solde payé (mode C) ou payée à part (mode D).
- **Double validation** : les actions sensibles exigent deux personnes, sur place (jeton) ou au back-office (demande
  puis approbation sous 24 h).

## Parcours du festivalier

Le festivalier peut tout faire avec son seul bracelet, sans compte ; le compte dans l'app ajoute la recharge en ligne,
le paiement par QR, la déclaration de perte et le remboursement à distance.

### 1. Obtenir et activer son bracelet

Le bracelet lui est remis à l'entrée ou au guichet. Il n'est utilisable qu'une fois activé, c'est-à-dire rattaché à un
portefeuille. L'événement choisit les modes permis :

| Mode | Qui active | Comment |
| --- | --- | --- |
| `DESK` | Le personnel | À l'entrée ou au guichet |
| `SELF_APP` | Le festivalier | Dans l'app : scan du QR imprimé ou saisie du code |
| `FIRST_TOPUP` | Automatique | À la première recharge |

Selon l'événement, le bracelet peut rester anonyme (`ANONYMOUS_ALLOWED`, par défaut) ou exiger un compte dès
l'activation (`ACCOUNT_REQUIRED`). Un bracelet non activé est refusé en caisse (`NOT_ACTIVATED`). Un lot peut être
préchargé de crédits offerts, crédités à l'activation.

### 2. Recharger

- **Au guichet** : en espèces, Wave, Orange Money ou carte. Pas de recharge en espèces hors ligne, sauf par la
  passerelle locale sur site.
- **Dans l'app** (avec un compte) : Wave, Orange Money ou carte. Le crédit n'apparaît qu'à la confirmation du paiement
  par le prestataire de paiement, jamais à la demande.
- Si une caution est due, elle est prélevée automatiquement sur la recharge suivante.
- Les plafonds de solde et de recharge mensuelle dépendent du niveau d'identification (section Flux transverses).

### 3. Payer

- **Par bracelet** : le vendeur passe le bracelet sur le terminal Android ; le paiement se fait en un aller-retour, même
  hors ligne dans les plafonds de l'événement.
- **Par QR commerçant** (`MERCHANT_QR`) : le terminal affiche un QR valable 60 s ; le festivalier le scanne dans l'app,
  voit le montant et le commerçant, et confirme par PIN ou biométrie.
- **Par QR client** (`CUSTOMER_QR`) : l'app affiche un QR à usage unique valable 60 s, que le terminal scanne. Le
  festivalier ne valide pas le montant.
- Le QR exige que le téléphone et le terminal soient en ligne ; sur iPhone, le terminal n'encaisse qu'en QR.

### 4. Consulter son solde

- **Sans compte** : en scannant le QR ou en saisissant le code imprimé, il voit son solde et ses 10 derniers
  mouvements, en lecture seule. Limite : 20 consultations par code et 60 par adresse IP, par heure.
- **Avec un compte** : l'app montre ses bracelets (avec leur numéro imprimé) et ses portefeuilles (`/me`, `/me/media`,
  `/me/wallets`).
- **Avis de solde provisoire** : si un terminal a vendu hors ligne et n'a pas encore tout remonté, l'app signale que le
  solde affiché peut changer.

### 5. Créer un compte et se connecter

1. Il saisit son numéro de téléphone.
2. Il reçoit un code à usage unique : par WhatsApp d'abord, par SMS si WhatsApp ne confirme pas sous 10 s, par un second
   fournisseur SMS 20 s plus tard. L'app propose toujours « Recevoir par SMS ».
3. Il saisit le code et reçoit ses jetons de session. Changer de téléphone = se reconnecter avec le même numéro.

Limites : 3 envois par numéro sur 15 min, 10 demandes par adresse IP et par heure, 5 essais par code puis blocage de
30 min. Pas de connexion par Google ou Apple.

### 6. Rattacher un bracelet à son compte

- Il scanne le QR ou saisit le code imprimé. Un code ne sert qu'une fois ; un code inconnu et un code déjà utilisé
  donnent la même réponse.
- **Bracelet qui contient déjà de l'argent** : le rattachement n'est pas immédiat. L'app crée une demande en attente
  (24 h) et affiche un code à 6 chiffres ; le festivalier va au guichet, où l'agent lit le bracelet, scanne le code
  imprimé et saisit ce code.
- Une fois rattaché, la consultation anonyme par le code est refusée : il faut se connecter.
- Limites : 5 essais par compte et par heure, 20 par appareil et par jour.

### 7. Se faire identifier (KYC)

Au guichet, l'agent enregistre sa pièce d'identité : type, pays, 4 derniers caractères et date d'expiration seulement.
Il faut un compte au numéro vérifié ; une pièce déjà expirée est refusée. Le portefeuille devient « identifié », ce qui
relève ses plafonds.

### 8. Perdre son bracelet

1. Il déclare la perte dans l'app (ou au guichet) : le bracelet est suspendu immédiatement, les terminaux le savent en
   moins de 5 s.
2. En attendant, l'app propose de payer par QR client.
3. Au guichet, on lui remet un nouveau bracelet rattaché au même portefeuille : solde et caution suivent, sans aucune
   écriture comptable.
4. Bracelet retrouvé : réactivé ou retiré selon la règle de l'organisateur.

### 9. Être remboursé

Seuls les crédits payés sont remboursables ; les crédits offerts expirent.

| Canal | Qui le demande | Déroulement |
| --- | --- | --- |
| Espèces au guichet | Tout porteur du bracelet, même anonyme | En rendant le bracelet : le caissier le lit, le serveur enchaîne caution, crédits offerts, solde et restitution ; seconde personne au-delà de 50 000 XOF (réglable) |
| Espèces au guichet sans rendre le bracelet (mission 9c, en cours) | Tout porteur du bracelet, même anonyme | Seulement si le prestataire l'autorise et l'organisateur l'active ; montant choisi débité du solde payé, espèces remises moins les frais ; seconde personne quand le cumul du jour du portefeuille dépasse le seuil |
| Wave ou Orange Money vers son numéro vérifié | Le festivalier, dans l'app | Demande, approbation par deux personnes, paiement manuel hors système, confirmation |
| Wave ou Orange Money vers un autre numéro | Le festivalier, dans l'app | Code envoyé au nouveau numéro ; le titulaire peut confirmer ou bloquer ; sans réponse, la demande part après 48 h |
| Virement bancaire | Le back-office seulement (gros montant) | Même circuit à deux personnes |

Pas de remboursement par carte. **Au guichet de retour**, l'ordre est imposé : caution rendue, crédits offerts expirés,
solde payé remboursé, espèces dues rendues, puis restitution du bracelet (qui exige un solde nul).

## Parcours au guichet et en caisse

Le guichet (terminal en mode `TOPUP_DESK`) est le seul endroit où l'argent liquide entre et sort (la passerelle locale
le relaie pendant une coupure). Toute opération en espèces exige une session de caisse ouverte sur ce terminal, sinon
elle est refusée.

**Session de caisse.**

1. Un caissier ou un superviseur ouvre la session de caisse sur le terminal ; une seule session ouverte par terminal.
2. Il encaisse recharges et remboursements ; chaque opération est rattachée à la session.
3. Un caissier ou un superviseur enregistre le comptage. La fermeture est faite par un superviseur qui n'a fait aucun
   comptage de la session ; l'écart est imputé au payeur prévu au contrat.

| Opération | Qui | Règles visibles |
| --- | --- | --- |
| Recharge espèces | Caissier ou superviseur | Session de caisse ouverte exigée ; plafonds réglementaires du portefeuille ; caution due prélevée ensuite. Le plafond de 500 000 XOF par recharge ne vaut que pour la passerelle locale pendant une coupure |
| Recharge Wave, Orange Money, carte | Caissier ou superviseur | Crédit à la confirmation du prestataire de paiement |
| Remboursement espèces avec restitution | Caissier ; superviseur au-delà du seuil | Guichet de retour ; seul jusqu'à 50 000 XOF (réglable), seconde personne au-delà, seuil comparé au total des espèces sorties |
| Remboursement espèces sans restitution (9c, en cours) | Caissier ou superviseur | Permis par le prestataire et activé par l'organisateur ; bracelet gardé actif ; frais à chaque rendu ; seconde personne au cumul du jour du portefeuille |
| Activation (`DESK`) | Caissier ou superviseur | Bracelet remis puis rattaché à un portefeuille (créé anonyme si besoin) ; frais d'activation et caution éventuels encaissés |
| Confirmation de rattachement | Caissier ou superviseur | Lit le bracelet, scanne ou saisit le code imprimé, puis saisit le code de confirmation affiché dans l'app (5 essais) ; impossible pendant une coupure |
| Remplacement de bracelet | Caissier ou superviseur | Ancien bracelet actif ou suspendu ; nouveau bracelet neuf ; même organisateur ; la caution suit |
| Identification (KYC) | Caissier ou `ORGANIZER_ADMIN` | Voir ci-dessous |

**Identification d'un festivalier.**

1. Le festivalier présente sa pièce ; l'agent (caissier ou `ORGANIZER_ADMIN`) désigne son portefeuille.
2. L'agent saisit type, pays, 4 derniers caractères et date d'expiration.
3. Refus si le portefeuille est anonyme (`422 ACCOUNT_REQUIRED`), si la pièce est déjà expirée, ou si l'agent est
   lui-même le titulaire (son téléphone est le numéro vérifié du compte, `403`).
4. Les plafonds du portefeuille suivent immédiatement le nouveau niveau.

**Révocation d'une identification : toujours à deux personnes.**

1. Un administrateur (`OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`) demande la révocation, avec un motif.
2. Une autre personne habilitée l'approuve ; l'auteur ne peut pas approuver sa propre demande.
3. À l'exécution, une identification déjà révoquée est refusée (`409`).
4. Les plafonds du portefeuille redescendent au niveau non identifié.

**Seconde personne sur place.** Au-delà d'un seuil (remboursement espèces, espèces dues), un superviseur présent valide
avec un jeton d'approbation sur le terminal ; il ne peut pas être l'auteur de l'opération.

## Parcours du vendeur et du commerçant

Chaque vente est attribuée au vendeur connecté sur le terminal ; le commerçant est garanti même si une vente hors ligne
n'est pas couverte par le solde du festivalier.

**Mettre un terminal en service.**

1. Le back-office affiche un code d'enrôlement à usage unique (QR), lié à l'événement, au point de vente et au mode.
2. L'app terminal le scanne ; le terminal reçoit son identité et sa configuration (catalogue compris).
3. Refus si l'événement est clos ou le point de vente supprimé ; dès la clôture commencée, seuls les guichets peuvent
   encore s'enrôler.
4. Un terminal perdu ou volé est révoqué à distance ; un terminal suspendu peut encore remonter ses ventes mais
   n'encaisse plus.

| Mode du terminal | Usage | Moyens acceptés |
| --- | --- | --- |
| `CATALOG_POS` | Caisse à catalogue d'articles | Bracelet (Android), QR |
| `KEYPAD_TPE` | Saisie libre d'un montant | Bracelet (Android), QR |
| `TOPUP_DESK` | Guichet de recharge et de remboursement | Espèces, Wave, Orange Money, carte |

Un téléphone personnel encaisse en ligne seulement : ni hors ligne, ni recharge, ni remboursement.

**Ouvrir sa session de vendeur.**

- Le vendeur saisit son PIN à 6 chiffres ; la session est liée au terminal, valable 12 h au plus, et reste valable hors
  ligne jusqu'à son expiration.
- Aucune connexion de vendeur n'est possible hors ligne.
- 5 échecs, comptés sur tous les terminaux, bloquent le vendeur jusqu'au déblocage par le commerçant.

**Encaisser.**

1. Le vendeur compose la vente (articles du catalogue, prix TTC fixes) ou saisit un montant.
2. Le festivalier paie par bracelet ou par QR (section Parcours du festivalier).
3. Le terminal affiche le résultat ; un bracelet refusé affiche sa raison (`BLOCKED`, `NOT_ACTIVATED`, `REPLACED`,
   solde insuffisant…).

**Annuler une vente.** Seul le vendeur qui l'a faite l'annule, depuis le même terminal et dans la fenêtre permise ;
sinon un superviseur, au terminal (jeton sur place) ou au back-office (demande à deux). Une vente ne s'annule qu'une fois.

**Côté commerçant.** Il gère ses vendeurs, débloque un vendeur bloqué, gère son catalogue si l'organisateur l'y
autorise, et reçoit des relevés détaillés par article et par taux de taxe. Un changement de catalogue arrive au terminal
à la synchronisation suivante. Pas de variantes, remises ni stock en V1.

## Parcours organisateur et prestataire (back-office)

L'organisateur pilote un événement de sa création à sa clôture ; le prestataire fournit le matériel et approuve les
opérations sensibles. Les écrans du back-office web sont à construire (mission 11) ; le serveur sert déjà l'essentiel
des routes, les manques étant confiés à la mission 11b.

**Cycle de l'événement**, un passage à la fois :

1. `DRAFT` : configuration (points de vente, catalogues, commerçants, modes d'activation, mode d'identité, plafonds hors
   ligne, prestataires de paiement).
2. `LIVE` : ventes, recharges, remboursements.
3. `CLOSING` : plus d'enrôlement de caisses ; les guichets restent ouverts.
4. `RECONCILING` : rapprochement ligne à ligne des relevés (prestataires de paiement, banque, caisses).
5. `SETTLING` : calcul et versement des parts de chaque intervenant.
6. `REFUND_WINDOW` : les festivaliers réclament leur solde.
7. `CLOSED` : soldes restants en casse (réversible 5 ans par défaut), réclamations tardives possibles.

| Activité | Qui | Ce que voit l'utilisateur |
| --- | --- | --- |
| Personnes et rôles | Admin de la portée | Ajout de personnes par portée (plateforme, prestataire, organisateur, événement, commerçant), chaque action journalisée |
| Lots de bracelets | Prestataire | Commande d'un lot, fichier pour l'imprimeur (code, URL, numéro imprimé), import de la correspondance code ↔ puce, caution, préchargement, réutilisation |
| Liste noire | Prestataire | Mise en liste noire avec motif ; sortie à deux personnes |
| Terminaux | Organisateur, prestataire | Codes d'enrôlement, liste, suspension, réactivation, révocation |
| Approbations | Admins | Demande puis approbation par une autre personne sous 24 h ; l'auteur ne s'auto-approuve jamais (`409 APPROVAL_INVALID`) |
| Remboursements | Admins | Approbation à deux, paiement hors système, confirmation `PAID` ou `FAILED` (un échec recrédite le portefeuille) |
| Versements | Admins | Calcul des parts, approbation à deux, export CSV du lot de virements (seul endroit où l'IBAN est déchiffré), confirmation |
| Relevés et export comptable | Organisateur, commerçant | Relevés par partie, export comptable configurable (SYSCOHADA indicatif) |
| Anomalies | Admins | Contrôles planifiés, liste fermée de types d'anomalie |
| Passerelle locale | Admin | Bascule d'autorité demandée par anticipation, jamais prise seule par la passerelle |

**Opérations d'exploitation** (hors back-office) : amorçage du premier `PLATFORM_ADMIN` ; rotation du secret des codes
de rattachement puis réémission des codes par la commande `reissue-claim-codes`, qui produit un nouveau fichier pour
l'imprimeur (`rank,code,url,uid,printed_number`).

## Flux transverses vus par l'utilisateur

**Hors ligne : les ventes par bracelet continuent, dans des plafonds qui bornent la perte.**

- Le terminal garde une photo signée des bracelets et soldes (snapshot) et juge chaque vente sur la configuration qu'il
  détient. Ce qui n'est pas permis est refusé par défaut.
- Le QR, la recharge espèces et la connexion d'un vendeur ne marchent pas hors ligne.
- Au retour du réseau, le terminal remonte ses ventes par lots de 500. Si un solde ne couvre pas une vente déjà faite, le
  commerçant est quand même payé ; la part non couverte va en compte d'attente et ouvre une anomalie.
- Pendant ce temps, l'app du festivalier peut afficher l'**avis de solde provisoire** : son solde peut encore baisser.
- **Passerelle locale** : un mini-PC sur site peut prendre l'autorité de débit pendant une coupure longue, sur demande
  d'un admin. Elle sert alors aussi les recharges espèces des caisses ouvertes avant la bascule.

**Plafonds réglementaires**, réglés par le profil de législation du pays (valeurs du Sénégal provisoires) :

| Plafond | Portefeuille non identifié | Portefeuille identifié |
| --- | --- | --- |
| Solde payé maximal | `unidentified_max_balance` | `max_wallet_balance` |
| Recharges du mois civil | `unidentified_monthly_limit` | `identified_monthly_limit` |

Une recharge qui dépasserait un plafond est refusée (`422 WALLET_LIMIT_EXCEEDED`) ; après identification au guichet, la
même recharge passe.

**Ce que le système ne permet jamais.**

- Aucun transfert de solde entre festivaliers (sauf remplacement de son propre bracelet).
- Aucun retrait, sauf remboursement ; aucun intérêt.
- Aucun débit d'un portefeuille bloqué ou clôturé (`WALLET_BLOCKED`).
- L'app festivalier ne lit jamais la puce du bracelet.

**Réponses de refus les plus vues.**

| Réponse | Quand |
| --- | --- |
| `NOT_ACTIVATED` | Bracelet pas encore rattaché à un portefeuille |
| `BLOCKED` | Bracelet suspendu (perte) ou en liste noire |
| `REPLACED` | Ancien bracelet, remplacé par un nouveau |
| `WALLET_LIMIT_EXCEEDED` | Recharge au-delà d'un plafond réglementaire |
| `ACCOUNT_REQUIRED` | Action qui exige un compte (identification, recharge en ligne, QR…) |
| `OTP_RATE_LIMITED` (429) | Trop de codes demandés ou d'essais |
| `APPROVAL_INVALID` (409) | Auteur qui tente d'approuver sa propre demande |

## Limites connues et ce qui n'est pas encore livré

Le serveur porte tous les parcours décrits ci-dessus, mais aucune des trois interfaces n'est encore construite, et les
services externes réels (envoi des codes, paiements, clés) restent simulés jusqu'à la mission 12b. Aucun utilisateur réel
ne peut donc encore s'en servir en production.

| Mission | Contenu vu par l'utilisateur | État au 23/11/2026 |
| --- | --- | --- |
| 1 à 9b, 10a, 11a | Grand livre, rôles, événements, bracelets, terminaux, paiements, recharges, hors ligne, passerelle, remboursements, versements, clôture, identification au guichet, codes versionnés, `/me` complet, chaîne d'envoi des codes, durcissements | Fusionnées dans `main` (10a par la PR #24) |
| 9c | Remboursement partiel en espèces au guichet sans restitution | En cours d'implémentation |
| 10b | App festivalier (Flutter) | Déléguée, à faire |
| 10c | Clients gérés par une application cliente (utilisateurs qui ne voient pas le cashless) | À faire, cadrée le 23/11/2026 |
| 11 | Back-office web | Déléguée, à faire |
| 11b | Routes serveur manquantes au back-office | À faire, après la 9c |
| 12 | App terminal (NFC après validation sur vrais bracelets) | Déléguée, à faire |
| 12b | Intégrations réelles : WhatsApp et SMS, Wave, Orange Money, carte, KMS, clés de la passerelle | À faire, avant la recette |
| 13 | Recette V1 | À faire |

**Limites que l'utilisateur peut rencontrer.**

- **QR client** : le festivalier ne valide pas le montant ; pendant 60 s, le QR vaut accord pour tout montant dans la
  limite du solde. Le QR commerçant, lui, montre le montant et demande une confirmation.
- **iPhone** : pas de paiement NFC sur iOS, QR seulement.
- **Délais d'envoi des codes** : prouvés avec des horloges simulées seulement ; la mesure réelle attend les vrais
  fournisseurs (12b, 13). Si le plafond de 35 s tombe avant le SMS de repli, l'envoi s'arrête.
- **Identification** : un agent sans numéro de téléphone, ou avec un autre numéro, n'est pas reconnu comme titulaire du
  compte (OP-N163).
- **Avis de solde provisoire** : c'est une approximation ; il peut s'afficher alors qu'aucune vente du festivalier
  n'est en attente (OP-N168).
- **Rotation du secret des codes** : après une rotation, tous les codes déjà imprimés sont refusés jusqu'à la
  réémission et la réimpression ; un changement du secret sans hausse de sa version n'est pas détecté (OP-N172).
- **Remboursement** : manuel en V1 (paiement hors système) ; pas de remboursement par carte.
- **Espèces hors ligne** : impossibles sans passerelle locale.

**Hors périmètre V1.** Contrôle d'accès et billetterie, portail web festivalier, caisses tierces (V2), versements
automatiques, vérification d'identité en ligne, variantes, remises et stock au catalogue, conversion de devises.

Sources : `PRD.md`, `docs/SPECIFICATION.md` (§6 à §12), `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`, état des
missions dans `docs/spec-index.json`.
