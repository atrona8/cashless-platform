# Décisions d'architecture (ADR) — système cashless multi-tenant

Ce document explique **pourquoi** la spécification est ce qu'elle est. Une fiche par décision. Il n'est pas normatif : ce qu'il faut implémenter est dans `SPECIFICATION.md`.

**Règles du registre.**

- Une décision acceptée ne se réécrit pas. Pour la changer, on ajoute une fiche qui la remplace (statut « Remplace ADR-xx ») et on passe l'ancienne en « Remplacée par ADR-yy ». Si la nouvelle fiche ne change qu'une partie de l'ancienne, celle-ci passe en « Modifiée par ADR-yy ». Un renvoi devenu faux se corrige par une note datée à la fin de la fiche, sans toucher au texte.
- Chaque fiche renvoie aux sections de la spécification qu'elle justifie.
- Statuts possibles : Proposée, Acceptée, Acceptée sous condition, Modifiée, Remplacée, Abandonnée.

| # | Décision | Statut |
|---|---|---|
| ADR-01 | Grand livre en partie double par pool de fonds, mono-devise | Acceptée |
| ADR-02 | Point d'écriture unique `post_transaction` en base | Acceptée |
| ADR-03 | Idempotence par clé et empreinte du contenu | Acceptée |
| ADR-04 | Comptes chauds sans solde en cache | Acceptée |
| ADR-05 | Cloisonnement par RLS et garde dans chaque fonction | Acceptée |
| ADR-06 | Stack : NestJS, PostgreSQL, KMS, Next.js, Flutter, monorepo | Acceptée |
| ADR-07 | Liste fermée des types de transaction | Acceptée |
| ADR-08 | Codes d'erreur stables au format RFC 9457 | Acceptée |
| ADR-09 | Calculs entiers, taxe extraite du TTC ligne par ligne | Acceptée |
| ADR-10 | Configuration en cascade, versionnée, bornée par la législation | Acceptée |
| ADR-11 | Détenteur des fonds choisi à chaque événement | Acceptée |
| ADR-12 | Pertes, écarts de caisse, redevance et casse fixés par contrat | Modifiée par ADR-58 |
| ADR-13 | Versements en deux temps, manuels en V1 | Acceptée |
| ADR-14 | Plafonds réglementaires appliqués par la base | Modifiée par ADR-54 |
| ADR-15 | Plusieurs devises : un portefeuille par devise sur un même bracelet | Acceptée |
| ADR-16 | En ligne d'abord, hors ligne en secours et réglable | Acceptée |
| ADR-17 | Commerçant garanti, compte d'attente pour les manques | Modifiée par ADR-49 et ADR-58 |
| ADR-18 | Numérotation unique par terminal et registre serveur | Acceptée |
| ADR-19 | Passerelle locale en option, une seule autorité de débit | Acceptée |
| ADR-20 | Bracelet Ultralight EV1 au format B | Acceptée |
| ADR-21 | Mot de passe du bracelet dérivé dans KMS (SP 800-108) | Acceptée |
| ADR-22 | Mots de passe dérivés stockés chiffrés (enveloppe) | Acceptée |
| ADR-23 | Détection de copie par UID lié et compteur, pas de puce AES en V1 | Acceptée |
| ADR-24 | Lots de bracelets, validité par événement, clé dédiée en option | Acceptée |
| ADR-25 | Réutilisation réglée par lot | Acceptée |
| ADR-26 | Activation et bracelet perdu réglables par événement | Acceptée |
| ADR-27 | Caution facultative, mode C ou D au choix | Acceptée |
| ADR-28 | Billet hors du pool, bracelet-billet à usage unique | Remplacée par ADR-41 |
| ADR-29 | NFC sur Android seulement, QR pour iOS, QR toujours en ligne | Modifiée par ADR-64 |
| ADR-30 | Quatre modes d'encaissement et caisses tierces par API | Modifiée par ADR-43 (caisses tierces en V2) et ADR-69 (pas de MDM) |
| ADR-31 | Identité du festivalier réglable par événement | Modifiée par ADR-53 |
| ADR-32 | Tests exécutables et scénario de référence comme source de vérité | Acceptée |
| ADR-33 | Région d'hébergement paramétrable | Acceptée (région provisoire : ADR-65) |
| ADR-34 | Conservation des données fixée par le profil de législation | Acceptée |
| ADR-35 | Catalogue V1 : prix TTC fixe, taux de taxe par article | Acceptée |
| ADR-36 | Code de rattachement imprimé : QR et code en clair | Modifiée par ADR-56 et ADR-57 |
| ADR-37 | Caisses tierces : capture automatique seulement en V1 | Modifiée par ADR-43 (caisses tierces en V2) |
| ADR-38 | Identification des festivaliers : au guichet en V1, en ligne plus tard | Acceptée |
| ADR-39 | Validation terrain NFC : téléphones disponibles, deux niveaux, dès maintenant | Acceptée |
| ADR-40 | Droit de place : mode par commerçant, déduction avec reste dû par défaut | Acceptée |
| ADR-41 | Bracelets exclusivement cashless : abandon des bracelets-billets | Acceptée |
| ADR-42 | App festivalier : compte par téléphone, perte avec relais QR, consultation anonyme par code | Modifiée par ADR-57 et ADR-64 |
| ADR-43 | Caisses tierces reportées en V2 | Acceptée |
| ADR-44 | Audit de sécurité : revue de conception maintenant, test d'intrusion avant le pilote | Acceptée |
| ADR-45 | Cible de charge V1 : festivals moyens à grands, démontrée à deux fois | Acceptée |
| ADR-46 | Scellement périodique du journal plutôt que chaînage par transaction | Acceptée |
| ADR-47 | Éléments de schéma critiques écrits et testés avant la remise à l'agent | Modifiée par ADR-54 |
| ADR-48 | Régime visé : instrument à usage limité (réseau limité), sous réserve d'un avis juridique | Acceptée sous condition |
| ADR-49 | Fin d'événement : synchronisations tardives, expiration et contestations en clôture, clôture avec soldes restants | Acceptée |
| ADR-50 | Renvoi réseau d'une lecture de bracelet reconnu par le serveur, délai réglable | Acceptée |
| ADR-51 | Une fonction SQL unique pour le statut de l'événement et de ses grands livres | Acceptée |
| ADR-52 | Passerelle intermédiaire : activation et caution en espèces servies pendant une coupure | Acceptée |
| ADR-53 | Remboursements : canaux, espèces au guichet sous plafond, bracelets anonymes | Acceptée |
| ADR-54 | Niveau d'identification porté par le client et calculé à chaque usage | Acceptée |
| ADR-55 | PostgreSQL 17 pour borner la durée des transactions, avec surveillance en filet | Acceptée |
| ADR-56 | Code imprimé sur tous les lots publics, généré à la commande | Acceptée |
| ADR-57 | Rattachement d'un bracelet approvisionné confirmé au guichet | Acceptée |
| ADR-58 | Perte d'une opération non conforme portée par qui a fourni le terminal | Acceptée |
| ADR-59 | Signature d'originalité lue et contrôlée à chaque paiement | Acceptée |
| ADR-60 | Objectif de latence découpé en trois tranches | Acceptée |
| ADR-61 | Réglages de fonctionnement des terminaux par événement, dans des bornes | Acceptée |
| ADR-62 | Comptes commerçants chauds par défaut | Acceptée |
| ADR-63 | Recharge espèces hors ligne au-delà d'un plafond : marge au portefeuille, reste dû au client | Acceptée |
| ADR-64 | Paiement par QR : deux sens toujours autorisés, pas de jeton préchargé | Acceptée |
| ADR-65 | Région d'hébergement provisoire : Paris (eu-west-3) | Acceptée sous condition |
| ADR-66 | Codes à usage unique : WhatsApp d'abord, SMS en repli avec deux fournisseurs | Acceptée |
| ADR-67 | Casse réversible pendant 5 ans | Acceptée |
| ADR-68 | Assiette des frais du prestataire choisie dans chaque contrat | Acceptée |
| ADR-69 | Pas d'outil de gestion de flotte (MDM) | Acceptée |
| ADR-70 | Paiements : comptes au détenteur des fonds, mobile money en direct, carte configurée par organisateur | Acceptée |
| ADR-71 | Corrections de la revue de cohérence n° 2 | Acceptée |
| ADR-72 | Configuration PSP : de l'organisateur, choisie par événement | Acceptée |
| ADR-73 | Date limite de synchronisation : 72 h après la fin, contrôlée en base | Acceptée |
| ADR-74 | Validation à deux personnes : jeton sur place au guichet, demande et approbation au back-office | Acceptée |
| ADR-75 | Bornes des réclamations tardives contrôlées par la base | Acceptée |
| ADR-76 | Remboursement mobile vers un autre numéro que le numéro vérifié | Acceptée |
| ADR-77 | Contestations carte : payeur fixé par contrat, contestation tardive dans le grand livre verrouillé | Acceptée |
| ADR-78 | Pile logicielle : l'existant prime sur le document du porteur | Acceptée |
| ADR-79 | Clés d'idempotence conservées 30 jours | Acceptée |
| ADR-80 | Rôle de base distinct pour les écritures de plateforme | Acceptée |
| ADR-81 | Profils de législation gérés par la plateforme ; colonnes de configuration ajoutées au schéma | Acceptée |
| ADR-82 | Configuration : rôle strict par réglage, règle de frais portée par les lignes, dates d'effet par défaut | Acceptée |
| ADR-83 | Quatre processus à droits séparés sur les clés, et une commande d'administration | Acceptée |
| ADR-84 | Rôles de base distincts : seuls les processus des clés lisent les chiffrés | Acceptée (OP-N44 levé par la mission 5a le 21/10/2026) |
| ADR-85 | Rôle `PERSONALIZER` dédié | Acceptée |
| ADR-86 | Mot de passe de bracelet jamais en clair hors du processus qui le calcule | Acceptée |
| ADR-87 | Codes imprimés : empreinte à clé, consultation anonyme par une fonction dédiée | Acceptée |
| ADR-88 | Ports et faux pour le KMS, l'identité du terminal et celle du festivalier | Acceptée (OP-N42 levé par la mission 5a le 21/10/2026) |
| ADR-89 | Pas de compte de caisse avant la mission des caisses | Acceptée |
| ADR-90 | Rattachement par code : consultation réduite, lecture consommée, activation depuis l'app | Acceptée (OP-N50 levé par la mission 5a le 21/10/2026) |
| ADR-91 | Guichet de retour : enchaînement des étapes servi par la mission 9 | Acceptée |
| ADR-92 | Contrôle quotidien des mots de passe : alerte d'audit, pas d'anomalie | Acceptée |
| ADR-93 | Remise en stock d'un bracelet rendu : route `reassignPoolMedia` distincte de la restitution | Acceptée |
| ADR-94 | Sortie de liste noire vérifiée par la base (demande approuvée concordante) | Acceptée |
| ADR-95 | Adresse du client : `trust proxy` borné par `TRUST_PROXY_HOPS`, obligatoire en production | Acceptée |
| ADR-96 | Fonctions SECURITY DEFINER sans `pg_temp` (OP-N59) : limite acceptée, levée par la mission 5, bloque la production | Acceptée ; **levée par la mission 5a le 21/10/2026** |
| ADR-97 | Écritures directes de `cashless_app` sur `media_batch` (OP-N60) : limite acceptée, levée par la mission 11, bloque la production | Acceptée |
| ADR-98 | Traitements par tranches (NFR-008, OP-N61) : preuve sur 5 000 bracelets reportée à la mission 13, bloque la production | Acceptée |
| ADR-99 | Empreinte de requête sans clé au registre d'idempotence (OP-N54) : limite acceptée, levée par la mission 5 | Acceptée (mission de levée confirmée par le porteur le 15/10/2026) ; **levée par la mission 5a le 21/10/2026** |
| ADR-100 | Espèces dues d'un bracelet remplacé (OP-N55) : limite acceptée, levée par la mission 9 | Acceptée |
| ADR-101 | Missions de levée d'OP-N41, OP-N44, OP-N45, OP-N46 et OP-N50 | Acceptée (confirmée par le porteur le 15/10/2026) |
| ADR-102 | Travaux de clé nés d'une demande approuvée à deux seulement, vérifiés par la base et par les exécutants (SEC-1) | Acceptée (décision du porteur du 16/10/2026) ; **levée par la mission 5a le 21/10/2026** |
| ADR-103 | `activateMedia` et `replaceMedia` : lecture du bracelet embarquée dans la requête (contradiction contrat / schéma) | Acceptée (consignée le 16/10/2026) |
| ADR-104 | Mission de levée d'OP-N47 (rotation de `CLAIM_CODE_HMAC_KEY`) : mission 10 | Proposée par l'agent, à confirmer par le porteur |
| ADR-105 | Clé d'accord d'un terminal (`device.agreement_public_key`) réécrivable par l'API (OP-N63) : limite acceptée, levée par la mission 5 | Acceptée (décision du porteur du 16/10/2026) ; **levée par la mission 5a le 21/10/2026** |
| ADR-106 | Terminal iOS : clé de signature non attestée, liée à l'instance App Attest (OP-N64) : limite acceptée, réexaminée par la mission 12 | Acceptée (décision du porteur du 19/10/2026) |
| ADR-107 | Terminaux : jeton lié, mTLS et signature de chaque requête exigés ensemble (contradiction avec SPEC §10.3 et le contrat) | Acceptée (décision du porteur du 19/10/2026) |
| ADR-108 | Rafraîchissement d'un jeton d'appareil : grâce de 60 s pour le même terminal (OP-N65) : limite acceptée, réexaminée par la mission 13 | Acceptée (décision du porteur du 19/10/2026) |
| ADR-109 | `serial` d'un terminal unique par prestataire (écart au schéma de référence) | Acceptée (décision du porteur du 19/10/2026) |
| ADR-110 | Attestation Android : `attestationApplicationId` lu dans la liste logicielle (OP-N67) : limite acceptée, réexaminée par la mission 13 | Acceptée (décision du porteur du 19/10/2026) |
| ADR-111 | Fonctions nouvelles : droits rejoués dans la transaction des migrations, droit par défaut reporté (OP-N68, mission 7) | Acceptée (décision du porteur du 20/10/2026) |
| ADR-112 | Colonnes d'exploitation de `device` encore écrites par l'API (OP-N69) : levée en mission 7 | Acceptée (décision du porteur du 20/10/2026) |
| ADR-113 | Routes de guichet : jeton de la personne dans `X-Staff-Authorization` | Acceptée (décision du porteur du 20/10/2026) |
| ADR-114 | Purges des nonces et des essais d'enrôlement exécutées par l'API publique (droit plus large, borné par test) | Acceptée (décision du porteur du 20/10/2026) |
| ADR-115 | Terminal révoqué : `403 DEVICE_REVOKED` à la requête suivante | Acceptée (décision du porteur du 20/10/2026) |
| ADR-116 | Idempotence : chemin concret et appelant dans la clé (OP-N71) | Acceptée (décision du porteur du 21/10/2026) ; mise en œuvre par WP18 |
| ADR-117 | Enrôlement : audit de tous les refus, limites sans oracle, atomiques (OP-N72) | Acceptée (décisions du porteur du 21/10/2026) |
| ADR-118 | Configuration servie durcie en base (migration 0029), deux contradictions tranchées | Acceptée (décisions du porteur du 21/10/2026) |
| ADR-119 | Autorité des terminaux et signataire des jetons d'appareil : faux seulement (OP-N73), levée par la mission 7 | Acceptée (décision du porteur du 21/10/2026) |
| ADR-120 | Enrôlement sur un événement clos ou un point de vente supprimé (OP-N74) : écart consigné, levé par la mission 5b | Acceptée (décision du porteur du 21/10/2026) |
| ADR-121 | PIN des vendeurs vérifié dans l'API, session ouverte par la base sur la transaction de l'API (OP-N76) : limite acceptée, levée avec OP-N56 | Acceptée (décision du porteur du 22/10/2026) |

---

## ADR-01 — Grand livre en partie double par pool de fonds, mono-devise

- **Statut** : Acceptée, septembre 2026.
- **Contexte.** Un système cashless encaisse l'argent des festivaliers avant qu'il ne soit dépensé. Cet argent appartient, à tout moment, à plusieurs parties : festivaliers, commerçants, organisateur, prestataire, plateforme. Il faut pouvoir dire à chaque instant qui a droit à quoi, et prouver que l'argent détenu couvre exactement ces droits.
- **Décision.** Un grand livre en partie double par « pool » (réserve d'argent réel dans une devise). Deux familles de comptes : argent et droits, plus un compte d'attente. Montants entiers signés (débit positif, crédit négatif). Une transaction ne traverse jamais deux grands livres ; les flux entre pools passent par un versement réel.
- **Conséquences.** L'invariant « somme des comptes = 0 » se vérifie par une requête. Les produits et charges de chaque partie sont des sous-comptes de ses droits : chaque entité reconstitue ensuite sa comptabilité légale par un export. Un support perdu ne touche pas la comptabilité.
- **Alternatives écartées.** Soldes stockés sans journal (impossible à auditer). Un grand livre unique multi-devises (conversions implicites, invariants plus faibles).
- **Références.** SPEC §5.1, §5.2.

## ADR-02 — Point d'écriture unique `post_transaction` en base

- **Statut** : Acceptée.
- **Contexte.** Le code sera écrit par un agent IA et évoluera vite. Une erreur de code applicatif ne doit pas pouvoir casser les invariants comptables.
- **Décision.** Une seule fonction SQL `SECURITY DEFINER` écrit dans le grand livre. Le rôle applicatif n'a ni `INSERT`, ni `UPDATE`, ni `DELETE` sur `journal_transaction`, `posting` et `account_balance`. La fonction valide l'équilibre, l'idempotence, l'état du grand livre, la période, l'autorité de débit, l'appartenance des comptes, le sens des soldes (agrégé par compte) et les plafonds. Un déclencheur différé revérifie l'équilibre au `COMMIT`. Les lignes sont en ajout seul.
- **Conséquences.** Les invariants tiennent même si NestJS a un bug. Les règles sont testables en pgTAP, sans l'application. Contrepartie : une partie de la logique est en PL/pgSQL, moins familière que TypeScript.
- **Alternatives écartées.** Contrôles uniquement dans NestJS (un seul oubli suffit à corrompre le grand livre). Contrôle ligne par ligne du découvert (refuse à tort une transaction valide dont un état intermédiaire est négatif).
- **Références.** SPEC §2.2, §5.4.

## ADR-03 — Idempotence par clé et empreinte du contenu

- **Statut** : Acceptée.
- **Contexte.** Terminaux, PSP et passerelle renvoient les mêmes opérations après une coupure. Un renvoi ne doit jamais débiter deux fois ; un bug qui réutilise une clé pour une autre opération ne doit pas passer inaperçu.
- **Décision.** Clé unique par grand livre, plus l'empreinte du contenu (`request_hash`). Même clé et même contenu : on renvoie la transaction existante. Même clé et contenu différent : refus et alerte. Insertion par `INSERT … ON CONFLICT DO NOTHING`, sûre en concurrence.
- **Conséquences.** Les renvois sont sans danger. Une réutilisation de clé est détectée au lieu d'être perdue en silence.
- **Alternatives écartées.** « SELECT puis INSERT » (course entre deux appels simultanés). Clé seule sans empreinte (un second webhook de montant différent serait ignoré sans alerte).
- **Références.** SPEC §5.1 (G5), §10.2.

## ADR-04 — Comptes chauds sans solde en cache

- **Statut** : Acceptée.
- **Contexte.** Les comptes de commission, de taxe et de PSP sont touchés par presque toutes les transactions. Verrouiller leur ligne de solde à chaque vente ferait attendre toutes les ventes de l'événement les unes après les autres.
- **Décision.** Ces comptes sont marqués `hot` : ni solde en cache ni verrou. Leur solde se calcule à la lecture et leur sens est contrôlé périodiquement. Un portefeuille ne peut jamais être chaud, car son découvert doit être refusé en temps réel.
- **Conséquences.** Pas de contention sur les comptes partagés. Le sens des comptes chauds n'est vérifié qu'a posteriori, ce qui est acceptable car ils ne sont jamais débités par les ventes.
- **Alternatives écartées.** Verrou sur chaque compte (goulot d'étranglement). Un compte par terminal pour tout (complexité des rapports ; gardé comme option pour les stands très actifs).
- **Références.** SPEC §5.2.

## ADR-05 — Cloisonnement par RLS et garde dans chaque fonction

- **Statut** : Acceptée.
- **Contexte.** Plusieurs prestataires partagent la même base. Une fonction `SECURITY DEFINER` contourne la Row Level Security : une revue a montré qu'un prestataire pouvait agir sur le bracelet d'un autre et lire son solde dans un message d'erreur.
- **Décision.** RLS forcée sur toutes les tables métier. Chaque fonction privilégiée appelle d'abord `assert_tenant` sur l'objet reçu. Un objet d'un autre prestataire donne la même erreur qu'un objet inexistant. Vues en `security_invoker`. Un test échoue si la garde est retirée.
- **Conséquences.** Isolation vérifiée par la base et par les tests. Chaque nouvelle fonction doit reprendre la garde.
- **Alternatives écartées.** Une base par prestataire (coût d'exploitation et de migration élevé pour un gain limité à ce stade).
- **Références.** SPEC §2.2, §13.1.

## ADR-06 — Stack : NestJS, PostgreSQL, KMS, Next.js, Flutter, monorepo

> Note du 1er octobre 2026 : version de PostgreSQL fixée à 17 au minimum par ADR-55.

- **Statut** : Acceptée.
- **Contexte.** Un seul développeur, assisté d'un agent IA, doit livrer une API, un back-office, deux apps mobiles et une passerelle.
- **Décision.** TypeScript et NestJS côté serveur (API et passerelle, même code), PostgreSQL sur AWS RDS, AWS KMS pour les clés, Next.js pour le back-office, Flutter pour le terminal et l'app festivalier, monorepo avec types générés depuis OpenAPI, interfaces en français et en anglais.
- **Conséquences.** Deux langages principaux (TypeScript, Dart), plus Kotlin pour le canal NFC natif. Les contrats partagés évitent les divergences entre clients et serveur.
- **Alternatives écartées.** Apps natives séparées Android et iOS (double coût). Serveur en Go ou Java (pas de partage de types avec le back-office).
- **Références.** SPEC §1.2, §2.1.

## ADR-07 — Liste fermée des types de transaction

- **Statut** : Acceptée, 28 septembre 2026.
> Note du 2 octobre 2026 : un 26ᵉ type, `BREAKAGE_REVERSAL`, est ajouté par ADR-67.
- **Contexte.** Les documents utilisaient des noms différents pour la même opération (par exemple `REFUND` et `WALLET_REFUND`, `PROMO_GRANT` et `PROMO_CREDIT`). Un agent IA qui code à partir de sources divergentes crée des types incohérents, et les rapports par type deviennent faux.
- **Décision.** Une liste fermée de types (25 au 30 septembre 2026), imposés par une contrainte `CHECK` sur `journal_transaction.type`, repris à l'identique dans OpenAPI, le scénario de référence et la spécification. Une contre-passation (`REVERSAL`) doit désigner l'original ; une correction manuelle (`ADJUSTMENT`) doit venir du back-office.
- **Conséquences.** Tout nouveau type exige une migration, un schéma d'écriture et des tests. Les rapports peuvent s'appuyer sur le type.
- **Alternatives écartées.** Texte libre documenté (dérive inévitable).
- **Références.** SPEC §5.3.

## ADR-08 — Codes d'erreur stables au format RFC 9457

- **Statut** : Acceptée.
- **Contexte.** Terminaux, apps et caisses tierces doivent réagir différemment à un solde insuffisant, un bracelet bloqué ou une bascule d'autorité. Les messages SQL bruts ne sont ni stables ni sûrs (ils peuvent révéler des données).
- **Décision.** Erreurs `application/problem+json` avec un code métier pris dans une énumération `ProblemCode`. Les codes ne changent jamais de sens ; on en ajoute. Chaque refus de la base a son propre SQLSTATE (classe `CL`), traduit un à un en `ProblemCode` : l'API ne lit jamais le texte d'un message SQL.
- **Conséquences.** Les clients codent contre des codes, pas contre des textes. Les messages SQL, en français et parfois porteurs de données, ne sortent jamais de l'API.
- **Alternatives écartées.** Codes HTTP seuls (trop pauvres). Messages libres.
- **Références.** SPEC §5.7, §10.1.

## ADR-09 — Calculs entiers, taxe extraite du TTC ligne par ligne

- **Statut** : Acceptée.
- **Contexte.** Les frais et commissions sont annoncés TTC aux clients. Il faut que la somme HT + taxe soit exactement égale au TTC, que chaque ligne soit explicable, et que l'implémentation TypeScript et le tableur donnent les mêmes chiffres.
- **Décision.** Montants entiers en unités mineures, taux en points de base. Arrondi au plus proche, la moitié s'éloignant de zéro (comme la fonction ARRONDI d'Excel). Chaque frais est arrondi une fois, sur sa propre base. Dans une transaction, les frais TTC de même bénéficiaire et de même taux sont additionnés, puis la taxe est extraite une fois de cette somme, et le HT se déduit par différence. Partage : première part arrondie, la seconde reçoit le reste. Annulation : lignes opposées, jamais recalculées.
- **Conséquences.** Aucun centime perdu ou créé. Une ligne de taxe par bénéficiaire et par transaction, ce qui garde le lien avec l'opération. La taxe d'une période peut différer de quelques unités d'une taxe calculée sur le total de la période : écart à faire accepter par l'expert-comptable.
- **Alternatives écartées.** Calcul en flottants. Taxe calculée sur les totaux de la période (impossible à relier aux ventes). Taxe ligne par ligne sur chaque frais élémentaire (multiplie les arrondis sans gain de traçabilité). Arrondi bancaire (différent du tableur de l'utilisateur).
- **Références.** SPEC §5.5 ; `moteur_ecritures_reference.py`.

## ADR-10 — Configuration en cascade, versionnée, bornée par la législation

- **Statut** : Acceptée.
- **Contexte.** La plateforme sert plusieurs pays et plusieurs types de clients (festivals, cinémas, hôtels, supermarchés). Chaque niveau veut régler ses paramètres ; la loi fixe des limites.
- **Décision.** Cascade plateforme → prestataire → organisateur → événement → participation, la valeur la plus précise l'emportant. Profil de législation par pays, versionné, qui borne la cascade. Chaque transaction garde la version de configuration utilisée.
- **Conséquences.** Tout calcul passé reste explicable. Une configuration illégale est refusée à l'enregistrement.
- **Alternatives écartées.** Paramètres globaux codés (ne couvre pas la diversité des clients).
- **Références.** SPEC §4.

## ADR-11 — Détenteur des fonds choisi à chaque événement

- **Statut** : Acceptée.
- **Contexte.** Le grand livre dit qui a droit à quoi, mais pas qui paiera. Si l'organisateur encaisse, les frais du prestataire et la redevance ne sont que des créances sur lui. Les montages varient d'un client à l'autre.
- **Décision.** Le détenteur des fonds (organisateur, prestataire, tiers) est un choix **obligatoire** à la création de chaque événement, sans valeur par défaut. Le modèle comptable ne change pas ; seuls changent le titulaire des comptes d'argent et qui peut initier un versement. Un versement ne dépasse jamais le droit net.
- **Conséquences.** Le prestataire peut exiger d'encaisser lui-même pour un organisateur inconnu. Les identifiants PSP sont rattachés au détenteur des fonds.
- **Alternatives écartées.** Un montage unique imposé (perte de clients, ou risque pour le prestataire).
- **Références.** SPEC §4.4.

## ADR-12 — Pertes, écarts de caisse, redevance et casse fixés par contrat

- **Statut** : Acceptée. Modifiée par ADR-58 (note du 2 octobre 2026).
- **Contexte.** Qui supporte une fraude hors ligne, un manque en caisse ? La redevance de la plateforme est-elle prélevée dans le pool ou facturée ? Qui garde les soldes non réclamés ? Les réponses varient selon les négociations.
- **Décision.** Ces règles sont des champs du contrat versionné : `offline_loss_bearer`, `cash_diff_bearer`, `platform_fee_mode` (`IN_POOL` ou `INVOICED`), `breakage_organizer_bps` (part de la casse revenant à l'organisateur, le reste au prestataire), sauf si la loi impose une autre destination.
- **Conséquences.** Les écritures `ANOMALY_RESOLUTION`, `CASH_CLOSE`, `PLATFORM_FEE` et `BREAKAGE` lisent le contrat. Le compte `L-OPE-CASSE` existe pour la part du prestataire.
- **Alternatives écartées.** Casse entièrement à l'organisateur ; pertes toujours à l'organisateur (ne correspond pas aux demandes métier).
- **Références.** SPEC §4.3, §5.3.
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-58 : la perte d'une opération hors ligne **non conforme** ne suit pas `offline_loss_bearer`, mais celui qui a fourni le terminal (`device.provided_by`). `offline_loss_bearer` reste la règle pour les manques des opérations conformes (`ANOMALY_RESOLUTION`). Le contrat porte aussi `operator_fee_basis` (ADR-68). La casse est réversible : `BREAKAGE_REVERSAL` débite les bénéficiaires dans les proportions de la casse initiale (ADR-67, ADR-71).

## ADR-13 — Versements en deux temps, manuels en V1

- **Statut** : Acceptée.
- **Contexte.** Un versement peut échouer (numéro invalide, compte fermé). Considérer l'argent comme sorti à l'ordre fausse le grand livre. Automatiser les paiements sortants demande des intégrations et des contrôles que la V1 ne justifie pas.
- **Décision.** `PAYOUT_INITIATED` gèle le droit dans un compte de transit ; `PAYOUT_CONFIRMED` fait sortir l'argent ; `PAYOUT_FAILED` recrédite le droit. En V1, le système calcule et exporte, deux personnes valident, le paiement est fait hors système, puis confirmé dans le back-office.
- **Conséquences.** Le grand livre reste juste même en cas d'échec. La V1 exige une intervention humaine pour chaque lot de versements.
- **Alternatives écartées.** Versement en une écriture. Versements automatiques dès la V1.
- **Références.** SPEC §11.4.

## ADR-14 — Plafonds réglementaires appliqués par la base

- **Statut** : Acceptée. Modifiée par ADR-54 (note du 2 octobre 2026).
- **Contexte.** La réglementation BCEAO sur la monnaie électronique fixe des plafonds de solde et de recharge qui dépendent de l'identification du client. Un contrôle limité à l'application pourrait être contourné par un chemin oublié (webhook, lot hors ligne, passerelle).
- **Décision.** Les plafonds sont des champs du profil de législation. `post_transaction` appelle `check_wallet_limits` après toute écriture qui crédite un portefeuille payé, selon `wallet.kyc_level`.
- **Conséquences.** Tous les chemins sont couverts. Les montants restent à confirmer par un juriste.
- **Alternatives écartées.** Contrôle dans l'app seulement.
- **Références.** SPEC §6.3.
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-54 : le niveau d'identification n'est plus stocké (`wallet.kyc_level` n'existe pas) ; `wallet_kyc_level` le calcule à la date de l'opération, à partir des identifications du client faites avant cette date et pas encore révoquées (ADR-71). Le plafond de solde ne s'applique qu'à `TOPUP`, `TOPUP_CASH` et `ADJUSTMENT` (SPEC §6.3). Une recharge en espèces hors ligne au-delà d'un plafond n'est plus rejetée : elle est découpée par la marge de recharge (`wallet_topup_headroom`, ADR-63).

## ADR-15 — Plusieurs devises : un portefeuille par devise sur un même bracelet

- **Statut** : Acceptée.
- **Contexte.** Un organisateur peut tenir des événements dans plusieurs pays et devises, avec les mêmes bracelets réutilisables.
- **Décision.** Multi-devises dès la V1, avec une devise par événement et un grand livre par devise. Un bracelet porte au plus un portefeuille ouvert par devise ; aucun échange de devises dans le système.
- **Conséquences.** Le grand livre reste mono-devise et ses invariants simples. La restitution d'un bracelet exige que tous ses portefeuilles soient soldés.
- **Alternatives écartées.** Conversion automatique (risque de change, régime réglementaire différent).
- **Références.** SPEC §6.4.

## ADR-16 — En ligne d'abord, hors ligne en secours et réglable

- **Statut** : Acceptée.
- **Contexte.** Les puces bon marché ne peuvent pas porter un solde de façon sûre. Les réseaux mobiles des sites sont saturés aux heures de pointe.
- **Décision.** Chaque vente est autorisée par le serveur quand c'est possible. Hors ligne, le terminal autorise sur un snapshot signé, dans des plafonds. Le hors ligne est **désactivé par défaut** ; l'organisateur l'active et le plafonne de manière générale, par événement ou par terminal, sous les plafonds du prestataire.
- **Conséquences.** Aucune puce à falsifier. Un risque de double dépense subsiste hors ligne, borné par les plafonds, et affiché à l'organisateur.
- **Alternatives écartées.** Porte-monnaie stocké sur la puce (falsifiable sur Ultralight EV1). Refus de toute vente sans réseau (inacceptable sur site).
- **Références.** SPEC §9.1, §9.3.

## ADR-17 — Commerçant garanti, compte d'attente pour les manques

- **Statut** : Acceptée. Modifiée par ADR-49 et ADR-58 (note du 2 octobre 2026).
- **Contexte.** Un commerçant qui a servi de bonne foi, avec un terminal conforme, ne doit pas perdre sa vente parce que le même bracelet a dépensé ailleurs ou a été copié. Le festivalier honnête ne doit pas payer un usage frauduleux.
- **Décision.** À la synchronisation, le commerçant est crédité du montant total ; le portefeuille est débité au plus de son solde, et au plus jusqu'au blocage du bracelet ; le reste va au compte d'attente avec une anomalie, soldée ensuite selon le contrat. Une vente faite par un terminal non conforme (hors plafonds, snapshot trop vieux) est rejetée et n'est pas garantie : le litige se règle entre le prestataire, responsable du logiciel, et le commerçant.
- **Conséquences.** Le compte d'attente doit être à zéro avant la phase de règlement. Les responsabilités sont prévisibles pour chaque partie.
- **Alternatives écartées.** Refuser la vente à la synchronisation (le commerçant perd). Mettre le portefeuille en négatif (le festivalier paie une fraude).
- **Références.** SPEC §9.6.
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-58 : la perte d'une opération non conforme est portée par celui qui a fourni le terminal (prestataire, organisateur ou commerçant), et non plus réglée « entre le prestataire et le commerçant ». Après le début du règlement, une vente synchronisée en retard n'est plus écrite automatiquement : anomalie `LATE_OFFLINE_SYNC` et écriture `ADJUSTMENT` à deux, le commerçant restant garanti (ADR-49).

## ADR-18 — Numérotation unique par terminal et registre serveur

- **Statut** : Acceptée.
- **Contexte.** Une opération peut partir en ligne, sans réponse, puis être autorisée hors ligne, puis renvoyée dans un lot, voire via la passerelle. Il faut qu'elle ne soit écrite qu'une fois et qu'aucune ne soit perdue.
- **Décision.** Un seul compteur par terminal, commun au mode en ligne et hors ligne ; clé d'opération `<serial>:<seq>`. Les lots sont continus, signés et chaînés, y compris les opérations déjà confirmées et les numéros abandonnés. Le serveur tient un registre des numéros consommés ; un trou ne se lève qu'à deux personnes.
- **Conséquences.** Unicité et exhaustivité vérifiables. Le registre est à ajouter au schéma.
- **Alternatives écartées.** Clés aléatoires par opération (impossible de détecter une perte). Compteurs séparés en ligne et hors ligne (même opération sous deux clés).
- **Références.** SPEC §9.5 ; `sync_protocol.md` §3, §6.
- **Note du 30 septembre 2026.** « Le registre est à ajouter au schéma » : c'est fait (`device_seq_registry`, S6), écrit et testé dans le schéma de référence (ADR-47).

## ADR-19 — Passerelle locale en option, une seule autorité de débit

- **Statut** : Acceptée.
- **Contexte.** Sur un festival, la panne la plus fréquente est la liaison internet, pas le Wi-Fi entre les stands. Sans passerelle, tous les terminaux passent hors ligne ensemble et le risque de double dépense apparaît.
- **Décision.** Un serveur local optionnel, activé par événement, qui devient la seule autorité de débit pendant une coupure. Pendant ce temps, le central n'accepte que des crédits. La bascule utilise un verrou exclusif en base (les écritures prennent le même verrou en partagé) et une époque d'autorité portée par chaque requête de débit. La reprise forcée exige deux personnes et un constat physique.
- **Conséquences.** Pas de double dépense pendant une coupure d'internet. La passerelle et le Wi-Fi du site deviennent des points à surveiller.
- **Alternatives écartées.** Hors ligne pur sur tous les terminaux. Deux autorités réconciliées après coup (double dépense possible).
- **Références.** SPEC §9.7 ; `sync_protocol.md` §9.

## ADR-20 — Bracelet Ultralight EV1 au format B

- **Statut** : Acceptée.
- **Contexte.** Il faut une puce bon marché, lisible par les téléphones Android, avec une identité non devinable et une disposition mémoire qui laisse évoluer le système.
- **Décision.** MIFARE Ultralight EV1 (MF0UL11). Format B : page 4 lisible (version et index de clé sur 2 octets), identité aléatoire de 16 octets, drapeaux et réservé, CRC-32 ; pages 5 à 10 protégées par mot de passe ; `AUTHLIM = 0`. La page 4 est gelée pour toutes les versions.
- **Conséquences.** Le terminal sait quelle clé utiliser avant de s'authentifier. 65 536 index de clé par prestataire permettent une clé par grand événement. Le champ de version permettra d'ajouter d'autres puces.
- **Alternatives écartées.** Identité séquentielle (devinable). Données NDEF lisibles par tous. Solde stocké sur la puce.
- **Références.** SPEC §7.2.

## ADR-21 — Mot de passe du bracelet dérivé dans KMS (SP 800-108)

- **Statut** : Acceptée.
- **Contexte.** Un mot de passe commun à tous les bracelets serait compromis dès la première interception. La clé maître ne doit exister sur aucun terminal. HKDF a été envisagé, mais il place la clé secrète dans le message HMAC, ce que AWS KMS ne sait pas calculer.
- **Décision.** KDF NIST SP 800-108 en mode compteur, HMAC-SHA256, calculée par un seul `GenerateMac` d'AWS KMS, avec l'UID, le prestataire et l'index de clé en contexte.
- **Conséquences.** Un mot de passe intercepté ne vaut que pour un bracelet ; un prestataire ne peut pas lire les bracelets d'un autre ; rotation par index sans rappel des bracelets.
- **Alternatives écartées.** Mot de passe unique par lot. HKDF (incompatible avec KMS). Clé maître sur les terminaux.
- **Références.** SPEC §7.3.

## ADR-22 — Mots de passe dérivés stockés chiffrés (enveloppe)

- **Statut** : Acceptée.
- **Contexte.** Recalculer les mots de passe dans KMS à chaque snapshot solliciterait KMS des dizaines de milliers de fois pendant l'exploitation, avec une limite de débit partagée par tout le compte AWS, et rendrait l'encaissement dépendant de KMS. La passerelle, coupée d'internet, ne peut pas joindre KMS.
- **Décision.** Dérivation une seule fois à la personnalisation, puis stockage chiffré en AES-256-GCM avec une clé de données enveloppée par une seconde clé KMS. AAD liant le chiffré au bracelet. Contrôle quotidien par échantillon.
- **Conséquences.** Plus de dépendance à KMS pendant l'événement. La base contient un secret de plus, inutilisable sans le droit `kms:Decrypt`, réservé à un rôle de service.
- **Alternatives écartées.** Recalcul à chaque snapshot.
- **Références.** SPEC §7.4.

## ADR-23 — Détection de copie par UID lié et compteur, pas de puce AES en V1

- **Statut** : Acceptée.
- **Contexte.** L'Ultralight EV1 n'a pas d'authentification cryptographique de la puce : une puce à UID réinscriptible peut copier un bracelet. Les puces qui empêchent la copie (Ultralight AES, NTAG 424 DNA) coûtent plus cher.
- **Décision.** En V1, on rend la copie difficile (mot de passe par bracelet, pages protégées) et on la détecte (UID lié côté serveur, compteur incrémenté à chaque passage : deux passages avec la même valeur signalent deux puces). La perte est bornée par les plafonds hors ligne. Les puces AES sont reportées à une V2 pour les événements à fort enjeu.
- **Conséquences.** Une copie ne peut être détectée que si l'original et la copie servent tous les deux. Risque accepté.
- **Alternatives écartées.** Puce AES dès la V1 (coût).
- **Références.** SPEC §7.6, §7.11.
- **Note du 30 septembre 2026.** Le renvoi « §7.11 » est à lire « §7.10 » (exigences de sécurité propres aux bracelets), après la renumérotation de la SPEC.

## ADR-24 — Lots de bracelets, validité par événement, clé dédiée en option

- **Statut** : Acceptée.
- **Contexte.** Un même organisateur commande des bracelets pour plusieurs éditions. Un carton volé avant l'événement ne doit pas pouvoir payer ; un bracelet de 2026 ne doit pas payer en 2027 ; la fuite d'une clé ne doit pas exposer tous les événements.
- **Décision.** Lots avec cycle de vie (commandé, personnalisé, livré, actif, suspendu, clos). Seul un lot actif paie. Un lot est réservé à un événement ou réutilisable chez son organisateur. Option de clé dédiée à un événement, retirée et détruite après.
- **Conséquences.** Stocks traçables et facturables (inventaire par lot). Une clé dédiée coûte environ 1 $ par mois ; recommandée au-delà de 10 000 bracelets ou pour les billets.
- **Alternatives écartées.** Bracelets valables partout (risque de vol et de mélange).
- **Références.** SPEC §7.7.
- **Note du 30 septembre 2026.** La mention des billets (« ou pour les billets ») est sans objet : les bracelets-billets sont abandonnés (ADR-41).

## ADR-25 — Réutilisation réglée par lot

- **Statut** : Acceptée.
- **Contexte.** Un bracelet tissu à fermoir sert une fois ; une carte de fidélité sert à une personne pendant des années ; un badge d'hôtel passe de client en client.
- **Décision.** Politique par lot : `SINGLE_USE` (défaut), `PERSONAL`, `POOL`. En `POOL`, l'identité est réécrite à chaque réattribution et l'ancienne est conservée : un passage avec elle signale une copie.
- **Conséquences.** Une copie faite par un ancien détenteur ne peut pas payer avec l'argent du nouveau. Les pages d'identité d'un lot `POOL` ne sont pas verrouillées.
- **Alternatives écartées.** Règle unique pour tous les lots.
- **Références.** SPEC §7.8.

## ADR-26 — Activation et bracelet perdu réglables par événement

- **Statut** : Acceptée.
- **Contexte.** Chaque organisateur organise son accueil différemment : guichet, autonomie dans l'app, activation à la première recharge, bracelet déjà lié au billet. Un bracelet perdu puis retrouvé a pu être copié entre-temps.
- **Décision.** Modes d'activation autorisés par événement (un ou plusieurs ; défaut : guichet). Politique du bracelet retrouvé par événement : fin de vie (défaut, plus sûr) ou remise en service.
- **Conséquences.** La base refuse un mode non autorisé et, en mode fin de vie, toute remise en service directe d'un bracelet suspendu.
- **Alternatives écartées.** Activation au guichet seulement.
- **Références.** SPEC §7.8.
- **Note du 30 septembre 2026.** Le « bracelet déjà lié au billet » et le mode d'activation correspondant sont sans objet : les bracelets-billets sont abandonnés (ADR-41). Modes restants : `DESK`, `SELF_APP`, `FIRST_TOPUP`.

## ADR-27 — Caution facultative, mode C ou D au choix

- **Statut** : Acceptée.
- **Contexte.** Certains organisateurs veulent récupérer les bracelets réutilisables. Les uns préfèrent prélever la caution sur le solde (pas d'espèces à l'entrée), les autres la faire payer à part (solde de dépense intact).
- **Décision.** Caution par lot, facultative. Mode C : prélevée sur le solde, due si le solde ne suffit pas encore. Mode D : payée à part. Comptes dédiés : cautions détenues (dette) et cautions acquises (produit). La restitution est refusée tant que la caution est détenue.
- **Conséquences.** L'ordre au guichet est imposé : caution, solde, restitution. Le traitement fiscal d'une caution acquise est à confirmer.
- **Alternatives écartées.** Un seul mode imposé. Caution traitée comme un frais (fausse la comptabilité).
- **Références.** SPEC §7.9.

## ADR-28 — Billet hors du pool, bracelet-billet à usage unique

- **Statut** : Remplacée par ADR-41 le 30 septembre 2026.
- **Contexte.** Un bracelet peut porter à la fois l'entrée et le portefeuille. Le prix du billet est encaissé par la billetterie, souvent un autre système.
- **Décision.** Le billet est suivi à part (table `ticket`, lié à la billetterie par une référence externe) ; son prix n'entre pas dans le pool. Un lot de billets est toujours à usage unique et lié à un événement. Changement de détenteur seulement avant la première entrée.
- **Conséquences.** Le grand livre ne contient que l'argent cashless. L'import des billets dépend de la billetterie choisie.
- **Alternatives écartées.** Encaisser les billets dans le pool (mélange de régimes et de délais).
- **Références.** SPEC §7.10.

## ADR-29 — NFC sur Android seulement, QR pour iOS, QR toujours en ligne

- **Statut** : Acceptée. Modifiée par ADR-64 (note du 2 octobre 2026).
- **Contexte.** iOS ne donne pas l'accès bas niveau aux commandes Ultralight nécessaire à l'authentification par mot de passe. Un QR n'a ni compteur ni protection contre la copie.
- **Décision.** Encaissement NFC sur Android uniquement (contrainte en base) ; iOS encaisse par QR. Deux sens de QR, choisis par l'organisateur ; jetons à usage unique de 60 s, seule leur empreinte est stockée ; un paiement QR est toujours en ligne.
- **Conséquences.** Les terminaux iOS sont possibles pour de petits points de vente, sans hors ligne.
- **Alternatives écartées.** QR hors ligne (copie triviale d'une capture d'écran).
- **Références.** SPEC §8.2, §8.3.
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-64 : les deux sens de QR sont toujours autorisés, sans choix de l'organisateur, et l'app ne précharge aucun jeton.

## ADR-30 — Quatre modes d'encaissement et caisses tierces par API

- **Statut** : Modifiée par ADR-43 le 30 septembre 2026 (TPE associé, intentions de paiement, webhooks sortants et SDK reportés en V2), puis par ADR-69 (pas de MDM, note du 2 octobre 2026).
- **Contexte.** Les clients vont du festival (caisse à catalogue) au cinéma ou à l'hôtel, qui ont déjà leur propre caisse.
- **Décision.** Modes caisse à catalogue, TPE clavier, recharge, TPE associé à une caisse tierce ; caisses tierces intégrées par intentions de paiement et webhooks signés ; SDK de lecture pour les grands comptes. Enrôlement des terminaux par MDM, vendeurs par code PIN, organisateur responsable des terminaux de son événement.
- **Conséquences.** Un même code d'app terminal couvre tous les cas. L'intégration à un MDM précis reste à choisir.
- **Alternatives écartées.** Une app par cas d'usage.
- **Références.** SPEC §8.
- **Note du 2 octobre 2026 (revue 2).** Modifiée aussi par ADR-69 : pas d'enrôlement par MDM ; enrôlement par code à usage unique affiché en QR, terminaux dédiés verrouillés par l'épinglage d'écran Android. « L'intégration à un MDM précis reste à choisir » est sans objet.

## ADR-31 — Identité du festivalier réglable par événement

- **Statut** : Acceptée. Modifiée par ADR-53 (note du 2 octobre 2026).
- **Contexte.** Un festival accepte des bracelets anonymes ; un lieu permanent veut des comptes. Les plafonds réglementaires dépendent de l'identification.
- **Décision.** Mode d'identité par événement : anonyme autorisé, ou compte obligatoire. Compte par numéro de téléphone vérifié par code à usage unique. App festivalier Flutter comme seule interface en V1. Remboursements vers Wave, Orange Money ou en espèces.
- **Conséquences.** Un festivalier anonyme ne laisse aucune donnée personnelle. Le fournisseur d'envoi des codes reste à choisir.
- **Alternatives écartées.** Compte toujours obligatoire (friction à l'entrée d'un festival). Portail web en V1.
- **Références.** SPEC §8.5.
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-53 : canaux de remboursement = Wave et Orange Money vers le numéro vérifié, virement bancaire au back-office, espèces au guichet (une seule personne jusqu'à `cash_refund_single_max`) ; pas de carte en V1. Le fournisseur d'envoi des codes est choisi par ADR-66 (WhatsApp, puis SMS). Un numéro de remboursement différent du numéro vérifié est la question Q5 (revue 2).

## ADR-32 — Tests exécutables et scénario de référence comme source de vérité

- **Statut** : Acceptée.
- **Contexte.** Un agent IA code à partir de documents ; un document en prose se contredit facilement. Le tableur de l'utilisateur est parlant mais ne s'exécute pas en CI.
- **Décision.** Les suites pgTAP, le scénario de référence rejoué par la base et par l'API, les cas du moteur et les vecteurs de bracelet font foi. Le tableur est une illustration. Les fichiers de tests sont générés par des scripts ; on modifie les scripts.
- **Conséquences.** Toute contradiction se tranche par un test. Toute évolution des règles passe par un test modifié explicitement.
- **Alternatives écartées.** Le tableur comme référence.
- **Références.** SPEC §0.2, §0.3, §16.

## ADR-33 — Région d'hébergement paramétrable

- **Statut** : Acceptée (le choix de la région lui-même est ouvert).
- **Contexte.** Le choix entre Paris, l'Irlande, Milan, Le Cap ou une autre région dépend de la latence mesurée depuis Dakar et de l'avis d'un juriste sur la localisation des données.
- **Décision.** La région est un paramètre de déploiement, par prestataire ; les sauvegardes sont copiées dans une seconde région.
- **Conséquences.** Le code ne dépend d'aucune région ; la décision peut être prise après la mesure sans refonte.
- **Alternatives écartées.** Région codée en dur.
- **Références.** SPEC §2.2 ; POINTS_OUVERTS OP-N11.
- **Note du 2 octobre 2026 (revue 2).** La parenthèse du statut (« le choix de la région lui-même est ouvert ») est dépassée : une région provisoire est retenue, Paris (`eu-west-3`), sous condition (ADR-65). La décision de cette fiche (région paramétrable) ne change pas.

## ADR-34 — Conservation des données fixée par le profil de législation

- **Statut** : Acceptée.
- **Contexte.** Les durées de conservation des historiques des festivaliers identifiés diffèrent selon les pays (CDP au Sénégal, RGPD en Europe), alors que les écritures comptables doivent être conservées plus longtemps.
- **Décision.** La durée est un paramètre du profil de législation. À l'échéance, les données personnelles sont anonymisées ; les écritures restent, sans lien nominatif.
- **Conséquences.** Une tâche planifiée d'anonymisation est nécessaire. Les valeurs restent à confirmer par un juriste.
- **Alternatives écartées.** Durée unique pour tous les pays.
- **Références.** SPEC §13.5.

## ADR-35 — Catalogue V1 : prix TTC fixe, taux de taxe par article

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N1).
- **Contexte.** La caisse à catalogue doit être simple à configurer pour un bar ou un food truck, mais un même point de vente peut vendre des produits soumis à des taux de taxe différents (boissons, marchandises).
- **Décision.** Catalogue par point de vente, avec catégories et articles à prix TTC fixe. Chaque article porte son taux de taxe. Le détail des ventes est enregistré par ligne, avec le prix et le taux copiés au moment de la vente. Ni variantes, ni remises, ni stock en V1.
- **Conséquences.** Relevés par article et par taux. Une migration n'est pas nécessaire pour gérer plusieurs taux. Les variantes et remises pourront s'ajouter après le premier festival, selon les retours.
- **Alternatives écartées.** Taux unique par point de vente (option A : impose une migration dès qu'un stand vend deux types de produits). Variantes et remises (option C) et stock (option D) dès la V1 (effort élevé, besoin non démontré ; un supermarché passera par sa propre caisse).
- **Références.** SPEC §8.1, §14 (S18).

## ADR-36 — Code de rattachement imprimé : QR et code en clair

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N4). Modifiée par ADR-56 et ADR-57 (note du 2 octobre 2026).
- **Contexte.** Un festivalier sur iPhone ne peut pas lire la puce du bracelet. Pour rattacher lui-même son bracelet dans l'app (`SELF_APP`), il lui faut une information imprimée, rapide à saisir et impossible à deviner.
- **Décision.** Chaque bracelet porte un QR code et, dessous, le même code de 10 caractères en clair (alphabet sans caractères ambigus). Le code est aléatoire, indépendant de l'identité de la puce, à usage unique ; seule son empreinte est stockée ; les essais sont limités.
- **Conséquences.** Impression variable par bracelet, donc un surcoût à confirmer auprès du fournisseur. Pour un lot `POOL`, le code ne sert qu'au premier rattachement.
- **Alternatives écartées.** Code en clair seul (plus lent à saisir). Numéro de série et code envoyé par un autre canal (deux informations à croiser). Pas de code (utilisateurs d'iPhone renvoyés au guichet).
- **Références.** SPEC §7.8, §14 (S19).
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-56 et ADR-57. Seuls les lots `PUBLIC` portent le code, quels que soient les modes d'activation ; le code est généré à la commande du lot, pas à la personnalisation (ADR-56). Le code n'est consommé qu'au rattachement effectif : pour un bracelet dont le portefeuille a un solde, seulement à la confirmation au guichet (ADR-57). Avant d'être consommé, il sert aussi à la consultation anonyme du solde (ADR-42).

## ADR-37 — Caisses tierces : capture automatique seulement en V1

- **Statut** : Modifiée par ADR-43, 30 septembre 2026 (tranche le point ouvert OP-N5 ; la fonction visée, les intentions de paiement des caisses tierces, est reportée en V2 par ADR-43).
- **Contexte.** Un hôtel ou un loueur voudrait réserver un montant à l'arrivée et débiter le montant réel au départ. Cela suppose un solde réservé, qui doit être respecté partout où le solde est contrôlé : ventes en ligne, snapshot hors ligne, passerelle, remboursement, restitution.
- **Décision.** En V1, une intention de paiement est toujours capturée immédiatement. Le mode `MANUAL` du contrat d'API est refusé. Si un client le demande, la réservation sera faite **dans le grand livre** (compte de fonds réservés par portefeuille, types de transaction dédiés), et non dans une table à part.
- **Conséquences.** Aucune modification du grand livre en V1. Les hôtels et loueurs débitent à la fin, sans garantie du solde. L'ajout ultérieur ne casse pas les intégrations, car le contrat d'API prévoit déjà le mode.
- **Alternatives écartées.** Réservation dans une table hors grand livre (le solde disponible serait calculé à plusieurs endroits). Réservation dès la V1 (besoin absent du marché de départ).
- **Références.** SPEC §8.4 ; `openapi.yaml` (intentions de paiement).

## ADR-38 — Identification des festivaliers : au guichet en V1, en ligne plus tard

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N8).
- **Contexte.** Les plafonds réglementaires dépendent du niveau d'identification du portefeuille. Rien ne disait comment un portefeuille devient identifié. Sur un festival, peu de clients en ont besoin ; sur un lieu permanent, les clients réguliers peuvent atteindre les plafonds.
- **Décision.** En V1, un agent contrôle une pièce d'identité au guichet et enregistre le minimum (type, pays, 4 derniers caractères, expiration). L'identification est portée par le client, journalisée, révocable, et interdite sur son propre portefeuille. Le modèle de données prévoit une méthode de vérification en ligne, à ajouter plus tard par un fournisseur spécialisé.
- **Conséquences.** Aucun fournisseur externe en V1. Données personnelles réduites au minimum. Le stockage exact exigé par la loi reste à confirmer par le juriste (paramètre du profil de législation).
- **Alternatives écartées.** Vérification en ligne dès la V1 (coût et intégration sans besoin immédiat). Pas d'identification (bloque les lieux permanents et les gros montants).
- **Références.** SPEC §6.3, §14 (S24).

## ADR-39 — Validation terrain NFC : téléphones disponibles, deux niveaux, dès maintenant

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N10).
- **Contexte.** La lecture des bracelets n'a été testée que sur un simulateur. Il faut vérifier la puce réelle, mesurer la vitesse et la fiabilité par téléphone, et mesurer la latence réseau pour choisir la région d'hébergement.
- **Décision.** Téléphones : ceux déjà disponibles chez le porteur du projet et ses premiers clients, classés selon les profils du protocole. Critères : deux niveaux, « recommandé » (p95 ≤ 300 ms, échecs au premier essai ≤ 2 %) et « toléré » (≤ 500 ms, ≤ 5 %). Calendrier : validation de la puce et campagne dès maintenant, par le porteur du projet, avant que l'agent ne code l'app terminal.
- **Conséquences.** Coût matériel nul ; mais la couverture des profils n'est pas garantie : les profils absents sont signalés dans le rapport. Les commerçants peuvent travailler avec un téléphone « toléré ». Le back-office tient la liste des modèles et leur niveau. Le code de lecture NFC de l'app terminal attend le résultat de la validation de la puce.
- **Alternatives écartées.** Achat d'un téléphone par profil (coût). Critère unique strict (exclurait beaucoup de téléphones d'entrée de gamme) ou assoupli (pas de liste de référence). Mesures seulement avant le pilote (une erreur sur la puce serait découverte trop tard).
- **Références.** SPEC §15 ; `tools/nfc-bench/PROTOCOLE_TERRAIN.md` §3.1 et §8.

## ADR-40 — Droit de place : mode par commerçant, déduction avec reste dû par défaut

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N14).
- **Contexte.** Le droit de place d'un commerçant externe est déduit de ses ventes à la clôture. Si ses ventes sont inférieures, il reste une dette que le pool ne peut pas prélever, et le grand livre ne peut pas se clôturer tant que le compte du commerçant est négatif.
- **Décision.** L'organisateur choisit un mode pour chaque participation : déduction avec reste dû (défaut), paiement d'avance hors système, ou déduction plafonnée aux ventes. Dans le mode par défaut, une écriture `MERCHANT_DEBT_TRANSFER` transfère la dette du commerçant à l'organisateur (compte `L-ORG-CREANCES`), qui la recouvre hors système ; le versement final de l'organisateur en est réduit d'autant.
- **Conséquences.** Nouveau type de transaction, nouveau compte, nouvelle colonne `pitch_fee_mode`. Le pool se clôture toujours à zéro. Le risque d'impayé reste à l'organisateur, qui peut l'éviter avec le paiement d'avance.
- **Alternatives écartées.** Une règle unique pour tous les commerçants (ne s'adapte pas à la confiance dans chaque relation).
- **Références.** SPEC §5.2, §5.3, §12.1.

## ADR-41 — Bracelets exclusivement cashless : abandon des bracelets-billets

- **Statut** : Acceptée, 30 septembre 2026. Remplace ADR-28 ; rend sans objet le point ouvert OP-N15.
- **Contexte.** Le modèle prévoyait des bracelets-billets portant à la fois le droit d'entrée et le portefeuille, avec contrôle d'accès et import depuis une billetterie. Cela ajoutait un cycle de vie, un type de lot, un mode d'activation, deux opérations d'API et une dépendance aux billetteries.
- **Décision.** Les bracelets servent exclusivement au paiement cashless. Pas de bracelet-billet, pas de contrôle d'accès, pas d'import de billets. Le type de lot `TICKET`, le mode d'activation `TICKET`, la table `ticket` et ses fonctions sont retirés du schéma ; les deux opérations de billets sont retirées du contrat d'API.
- **Conséquences.** Périmètre V1 plus simple ; aucune intégration de billetterie. Un organisateur qui veut contrôler les entrées utilise un système séparé. Les clés dédiées restent possibles pour les grands événements.
- **Alternatives écartées.** Garder les bracelets-billets (complexité sans demande confirmée).
- **Références.** SPEC §1.3, §7.7, §7.8.

## ADR-42 — App festivalier : compte par téléphone, perte avec relais QR, consultation anonyme par code

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N16). Modifiée par ADR-57 et ADR-64 (notes du 1er et du 2 octobre 2026).
- **Contexte.** L'app est la seule interface du festivalier. Il fallait fixer la connexion, la déclaration de perte et ce qu'un festivalier sans compte peut faire.
- **Décision.**
  - Compte uniquement par numéro de téléphone vérifié par code à usage unique.
  - Perte déclarée dans l'app : suspension immédiate, puis paiement par QR proposé en attendant le nouveau bracelet si l'événement l'autorise. *(Note du 1er octobre 2026 : le QR est toujours autorisé, sous réserve de réseau sur le téléphone — ADR-64.)*
  - Sans compte : consultation du solde en lecture seule par le code imprimé, tant que le bracelet n'est pas rattaché à un compte.
  - L'app festivalier ne lit jamais la puce : rattachement et consultation passent par le code imprimé, sur Android comme sur iPhone.
- **Conséquences.** Nouvelle opération publique `POST /public/balance-lookups`, limitée en débit. Le rattachement par lecture NFC dans l'app, prévu auparavant sur Android, est retiré : pour lire la puce, l'app aurait dû recevoir le mot de passe du bracelet à partir de son seul UID, ce qui aurait permis à n'importe qui de copier un bracelet approché. La création de compte dépend du fournisseur d'envoi des codes (OP-B2).
- **Alternatives écartées.** Connexion Google ou Apple (peu utile au Sénégal ; le numéro reste nécessaire pour les remboursements). Déclaration de perte au guichet seulement (le solde reste exposé pendant le trajet). Aucune fonction sans compte (file d'attente au guichet pour une simple consultation).
- **Références.** SPEC §7.8, §8.5 ; `openapi.yaml` (`lookupBalanceByClaimCode`, `claimMedia`).
- **Note du 2 octobre 2026 (revue 2).** Modifiée aussi par ADR-57 : le rattachement par code d'un bracelet dont le portefeuille a un solde n'est pas immédiat ; il crée une demande confirmée au guichet. La dépendance à OP-B2 est levée : les codes partent par WhatsApp puis SMS (ADR-66).

## ADR-43 — Caisses tierces reportées en V2

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N17 ; modifie ADR-30).
- **Contexte.** Le contrat d'API des caisses tierces (intentions de paiement, TPE associé, webhooks sortants) et le SDK de lecture visaient les cinémas, hôtels et supermarchés. Aucun partenaire pilote n'est identifié, et le premier marché est le festival, où les commerçants utilisent les terminaux du système.
- **Décision.** Les caisses tierces sont reportées après la V1 : pas d'intentions de paiement, pas de mode `PAIRED_TPE`, pas de webhooks sortants, pas de SDK. Le contrat d'API est conservé dans `openapi.yaml`, marqué `x-release: V2`, comme base pour le premier partenaire.
- **Conséquences.** V1 plus légère : 8 opérations d'API, 4 webhooks sortants et un composant en moins. L'enrôlement d'un terminal en mode `PAIRED_TPE` est refusé en V1. Le contrat V2 sera revu avec le premier partenaire.
- **Alternatives écartées.** Coder l'intégration sans client réel (risque de la refaire). Choisir un partenaire maintenant (aucun n'est identifié).
- **Références.** SPEC §1.3, §8.1, §8.4.

## ADR-44 — Audit de sécurité : revue de conception maintenant, test d'intrusion avant le pilote

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N18).
- **Contexte.** Les risques propres au système (copie de bracelets, double dépense hors ligne, fuite entre prestataires, gestion des clés) sont des risques de conception, qu'un test d'intrusion classique ne détecte pas toujours et qu'il coûte cher de corriger après le code.
- **Décision.** Audit externe en deux temps : revue de conception dès maintenant sur les documents, puis test d'intrusion du système complet avant le premier événement pilote. Pas d'outils de sécurité imposés dans la CI pour l'instant.
- **Conséquences.** La spécification peut évoluer après la revue de conception. Aucun argent réel n'est encaissé avant la correction des failles critiques ou élevées. Les outils de CI (dépendances, analyse statique, secrets) restent à décider ; le test de cloisonnement sur toutes les routes reste un critère d'acceptation.
- **Alternatives écartées.** Test d'intrusion seul (ne couvre pas la conception). Outils automatiques seuls (pas de regard expert). Audit après le pilote (argent réel exposé avant revue).
- **Références.** SPEC §13.6, §16.

## ADR-45 — Cible de charge V1 : festivals moyens à grands, démontrée à deux fois

- **Statut** : Acceptée, 30 septembre 2026 (tranche la première partie du point ouvert OP-N19).
- **Contexte.** La charge visée décide de l'architecture, du coût d'hébergement et du test de charge. Les chiffres initiaux étaient des hypothèses.
- **Décision.** Cible V1 : 200 terminaux par événement, 50 ventes par seconde sur le site, 20 par seconde sur un même stand, soit des festivals de 5 000 à 30 000 personnes. Le test de charge démontre deux fois cette cible pendant 30 minutes.
- **Conséquences.** Les comptes chauds et le verrouillage par compte suffisent à ce niveau. Au-delà (très grands festivals, plusieurs événements simultanés), une nouvelle mesure sera nécessaire. La taille réelle du plus grand événement visé reste à confirmer par le porteur du projet.
- **Alternatives écartées.** Cible réduite aux petits événements (limiterait le marché). Cible très grands festivals dès la V1 (coût et complexité sans besoin confirmé).
- **Références.** SPEC §15, §16.

## ADR-46 — Scellement périodique du journal plutôt que chaînage par transaction

- **Statut** : Acceptée, 30 septembre 2026 (tranche la seconde partie du point ouvert OP-N19).
- **Contexte.** Le journal est protégé par la base (ajout seul), mais un administrateur ou un attaquant ayant ses droits pourrait l'altérer. Il faut pouvoir prouver qu'il ne l'a pas été, sans ralentir les ventes.
- **Décision.** Toutes les 5 minutes, chaque grand livre actif est scellé : une empreinte des transactions de la période, chaînée à la précédente, est enregistrée et copiée hors de la base dans un stockage en écriture unique, sous un compte AWS distinct. Une vérification quotidienne compare les empreintes.
- **Conséquences.** Toute altération postérieure à un scellement est détectable. Aucun effet sur les performances. Une altération dans les 5 minutes précédant le scellement n'est pas couverte par ce mécanisme (elle reste bornée par les autres contrôles : ajout seul, rapprochements, invariants).
- **Alternatives écartées.** Chaînage à chaque transaction (sérialise les écritures d'un grand livre, incompatible avec la charge visée). Pas de chaînage (aucune preuve d'inaltérabilité à présenter).
- **Références.** SPEC §13.7, §14 (S25).

## ADR-47 — Éléments de schéma critiques écrits et testés avant la remise à l'agent

- **Statut** : Acceptée, 30 septembre 2026 (tranche le point ouvert OP-N20). Modifiée par ADR-54 (note du 2 octobre 2026).
- **Contexte.** La spécification listait 25 compléments de schéma à faire par l'agent. Certains portent directement les invariants de l'argent en situation dégradée : aucune opération perdue ni écrite deux fois, une seule autorité de débit, preuve d'inaltérabilité du journal. Une erreur subtile dans ces éléments (course, trou non détecté, bascule incomplète) passerait les tests ordinaires et se paierait en argent réel.
- **Décision.** Les éléments critiques sont écrits maintenant dans le schéma de référence (section 18), avec la RLS forcée, les gardes de cloisonnement et des tests pgTAP : registre des numéros de séquence et levée des trous à deux (S6), lots hors ligne et chaînage (S7), snapshots signés et clés (S8), contenu du snapshot par devise (S9), historique des politiques et configurations servies (S10), bascule vers la passerelle et reprise forcée (S12), registre de la passerelle (S13), scellement du journal (S25), et les colonnes associées du terminal (S4 en partie). Les éléments courants (utilisateurs, audit, PSP, catalogue, KYC, etc.) restent conçus par l'agent. Les nouveaux refus ont les SQLSTATE `CL010` à `CL017`. Chaque opération hors ligne porte le `config_id` de la configuration détenue.
- **Conséquences.** 99 assertions pgTAP de plus (245 au total pour la suite du schéma). L'agent appelle ces fonctions au lieu de les concevoir ; il ne doit pas appeler `set_debit_authority` directement. Le scellement impose une durée maximale de 60 s par transaction SQL et un délai de 5 minutes avant scellement. Ces éléments restent à valider par l'audit de conception (ADR-44).
- **Alternatives écartées.** Tout laisser à l'agent (risque sur les invariants les plus difficiles à tester après coup). Tout écrire maintenant (retarde la remise sans bénéfice pour les éléments courants, que l'agent conçoit bien).
- **Références.** SPEC §5.7, §9.5, §13.7, §14.1 ; sync_protocol « Éléments de schéma utilisés par ce protocole ».
- **Note du 2 octobre 2026 (revue 2).** Modifiée par ADR-54 : `kyc_verification` (S24) est écrite dans le schéma de référence, et non laissée à l'agent. Comptages à jour : la suite du schéma compte 361 assertions et le scénario de référence 64 (il va jusqu'à `CLOSED` et `LOCKED`). Codes ajoutés depuis : `CL018` et `CL019` (ADR-51), `CL020` à `CL022` (ADR-71). Fonctions ajoutées au schéma depuis : `set_event_status`, `ledger_unsettled`, `lock_settled_ledger`, `consume_tap`, `refund_cash_due`, `forfeit_batch_deposits`.

## ADR-48 — Régime visé : instrument à usage limité (réseau limité), sous réserve d'un avis juridique

- **Statut** : Acceptée sous condition, 30 septembre 2026 (tranche le point ouvert OP-N2). Condition : avis écrit d'un juriste avant le premier événement réel.
- **Contexte.** Selon le régime applicable, le projet doit soit obtenir un agrément (ou s'adosser à un établissement agréé), soit rester dans un périmètre d'usage limité. L'instruction BCEAO n° 001-01-2024 relative aux services de paiement, en vigueur depuis le 23 janvier 2024, abroge les dispositions contraires antérieures. La BCEAO a fixé la fin de la période transitoire au 31 janvier 2025 et exige que toute structure non agréée cesse d'offrir des services de paiement à partir du 1er mai 2025. Les sources consultées le 30 septembre 2026 ne mentionnent pas d'exclusion pour réseau limité : son existence dans le texte en vigueur n'est pas établie.
- **Décision.** Le système vise le régime de l'instrument à usage limité : crédits utilisables seulement dans le réseau d'un organisateur, sans transfert entre festivaliers, sans retrait autre que le remboursement du solde, sans rémunération (SPEC §6.5). Les plafonds restent paramétrables ; les valeurs de 2015 sont provisoires.
- **Conséquences.** Les règles de §6.5 deviennent des exigences du code. Le juriste doit confirmer l'exclusion et ses conditions. S'il conclut qu'elle ne s'applique pas, on bascule vers l'adossement à un établissement agréé (option A d'OP-N2), rendu possible par le choix du détenteur des fonds (ADR-11), sans refonte du grand livre.
- **Alternatives écartées.** Demander l'agrément dès maintenant (long et coûteux, sans certitude qu'il soit nécessaire). Ne rien décider (laisse le code sans règles de périmètre).
- **Références.** SPEC §4.4, §6.3, §6.5, §17 ; ADR-11, ADR-14.

## ADR-49 — Fin d'événement : synchronisations tardives, expiration et contestations en clôture, clôture avec soldes restants

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N21).
- **Contexte.** La revue de cohérence a montré trois blocages de la clôture : une vente hors ligne synchronisée tard était refusée sans règle (contraire à la garantie du commerçant) ; la restitution d'un bracelet avec des crédits offerts et les contestations carte étaient impossibles pendant la clôture ; la clôture exigeait des soldes nuls, impossibles si la casse est `NONE` ou `LEGAL_ACCOUNT`.
- **Décision.**
  1. Les synchronisations hors ligne et de la passerelle sont écrites automatiquement jusqu'à la fin de `RECONCILING` ; le passage à `SETTLING` attend la remontée des terminaux ou la date limite. Après, elles sont rejetées (`SYNC_DEADLINE_PASSED`), ouvrent une anomalie `LATE_OFFLINE_SYNC`, et le back-office écrit la vente par `ADJUSTMENT` validée à deux puis complète le versement (option C).
  2. `PROMO_EXPIRY` et `CHARGEBACK` sont acceptés dans tous les statuts de clôture, jusqu'à `CLOSED` (option A).
  3. Avec une casse `NONE` ou `LEGAL_ACCOUNT`, l'événement peut être clos en laissant ces soldes dus, listés dans un relevé ; le grand livre reste en `CLOSING` (seuls les remboursements et le versement au compte légal, en back-office), puis passe en `LOCKED` quand ils sont nuls. `PAYOUT_INITIATED` peut partir de `L-LEGAL-CASSE` (option A).
- **Conséquences.** Le commerçant reste garanti dans tous les cas ; les versements ne sont calculés qu'après les ventes tardives connues. Le scellement final n'intervient qu'au passage en `LOCKED`. Un nouveau type d'anomalie (`LATE_OFFLINE_SYNC`) et une nouvelle raison de rejet (`SYNC_DEADLINE_PASSED`).
- **Alternatives écartées.** Accepter les synchronisations jusqu'au verrouillage (versements à recalculer après coup) ; les refuser dès `CLOSING` (traitement manuel fréquent). Garder le refus de `PROMO_EXPIRY` et `CHARGEBACK` (restitutions et contestations bloquées). Transférer les soldes restants vers un grand livre durable (plus complexe, moins lisible).
- **Références.** SPEC §5.3, §12.1, §12.2 ; sync_protocol §7.2, §11 cas 17.

> Note du 2 octobre 2026 (revue 2) : le rejet après `SETTLING` ne vise que les ventes et leurs annulations. Une recharge ou une caution en espèces synchronisée tard est écrite avec l'anomalie `LATE_OFFLINE_SYNC`, car l'argent est déjà dans la caisse (SPEC §12.1, sync_protocol §7.5).

> Note du 2 octobre 2026 : la date limite de synchronisation est définie par ADR-73 (fin de l'événement + 72 h par défaut, contrôlée par la base au passage à `SETTLING`).

> Note du 2 octobre 2026 : les contestations reçues après le verrouillage sont écrites dans le grand livre verrouillé (ADR-77), et non plus réglées hors du grand livre.

## ADR-50 — Renvoi réseau d'une lecture de bracelet reconnu par le serveur, délai réglable

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N24).
- **Contexte.** Quand la réponse à `POST /taps` se perd, le terminal renvoie la même lecture, avec le même compteur. Le serveur y voyait une copie et mettait le bracelet d'un client honnête en liste noire, cas fréquent sur un réseau de festival.
- **Décision.** Le serveur reconnaît lui-même un renvoi : même terminal, même bracelet, même compteur, même UID, première lecture reçue depuis moins de `event.tap_replay_window_seconds` (défaut 120 s, réglable de 0 à 600 s, 0 désactive) → même résultat, sans anomalie (option B). Hors de ces conditions, le même compteur reste une copie suspectée.
- **Conséquences.** Rien à changer côté terminal. Un renvoi malveillant ne permet pas de payer deux fois (`tap_id` à usage unique). `media_tap.received_at` mesure le délai à l'heure du serveur, pas à celle du terminal.
- **Alternatives écartées.** Clé d'envoi fournie par le terminal (plus de travail côté terminal pour le même résultat). Relecture du bracelet avant tout renvoi (le client n'est plus forcément devant le terminal).
- **Précision du 1er octobre 2026.** Une opération de lot hors ligne peut citer la lecture déjà enregistrée en ligne (`online_tap_id`). Le serveur la réutilise si elle vient du même terminal, avec le même bracelet, compteur et UID, et n'a servi à aucune écriture, quel que soit le délai (option A). Sinon, le même compteur reste une copie suspectée.
- **Références.** SPEC §4.2, §7.6, §9.8 ; sync_protocol §11 cas 12, §12 ; openapi `POST /taps`.
- **Note du 2 octobre 2026 (revue 2).** Complétée par ADR-71 : une même lecture (même terminal, compteur et UID) qui n'a encore servi à aucune écriture est réutilisée **quel que soit le délai**, même sans `online_tap_id` ; le délai `tap_replay_window_seconds` ne vaut plus que pour une lecture déjà utilisée. Le `tap_id` est rendu par `register_tap` et consommé une seule fois par `consume_tap` (`CL022 TAP_UNUSABLE` sinon).

## ADR-51 — Une fonction SQL unique pour le statut de l'événement et de ses grands livres

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N26).
- **Contexte.** La base refuse les écritures selon le statut du grand livre, mais rien ne le faisait suivre le statut de l'événement : un événement pouvait passer en clôture avec un grand livre encore ouvert, et les refus prévus ne se déclenchaient jamais.
- **Décision.** `set_event_status` est le seul moyen de changer le statut d'un événement (un déclencheur refuse tout autre changement). Dans la même transaction, elle contrôle le passage, prend le verrou exclusif des grands livres de l'événement, vérifie les conditions de clôture calculables (compte d'attente, droits nets des commerçants, du prestataire et de la plateforme, versements en cours, soldes restants autorisés), met à jour le statut des grands livres, pose le scellement final au verrouillage et enregistre l'historique (option A). `lock_settled_ledger` verrouille plus tard un grand livre clos avec soldes restants, quand ils sont nuls. Codes `CL018` et `CL019`.
- **Conséquences.** Les conditions qui portent sur l'argent sont garanties par la base ; le back-office contrôle les autres avant l'appel. Les grands livres de portée `ORGANIZER` ne changent pas de statut avec un événement (§12.1).
- **Alternatives écartées.** Déclencheur qui met à jour le grand livre (logique cachée, sans contrôle des conditions). Double mise à jour par l'application (facile à oublier ou à faire à moitié).
- **Références.** SPEC §5.7, §12.1 ; schéma section 19.
- **Note du 2 octobre 2026 (revue 2).** Complétée par ADR-71 : à `CLOSED`, la condition « soldes restants autorisés » se contrôle par partie (droit net) et compte par compte pour les comptes sans titulaire (`ledger_unsettled`) ; à partir de `RECONCILING`, l'autorité de débit doit être `CENTRAL` ; `lock_settled_ledger` est idempotente et exige un événement `CLOSED` ; le garde du statut exige le rôle propriétaire de la table.

## ADR-52 — Passerelle intermédiaire : activation et caution en espèces servies pendant une coupure

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N27).
- **Contexte.** Le contrat d'API disait l'activation et la caution servies par la passerelle ; le protocole les disait indisponibles pendant `EDGE`.
- **Décision.** Pendant `EDGE`, la passerelle sert les ventes, annulations et recharges en espèces, et au guichet l'activation d'un bracelet sans frais prélevés sur le solde et la caution payée en espèces. Elle refuse tout prélèvement sur le solde autre qu'une vente (caution sur solde, frais d'activation sur solde), le remboursement et la restitution (option B). Les activations et cautions en espèces sont transmises au central dans la file `EDGE_SYNC` (types `ACTIVATION`, `DEPOSIT_CASH`), qui les rejoue par `activate_media` et `take_deposit`.
- **Conséquences.** Les entrées et les guichets fonctionnent pendant une coupure ; la logique reproduite sur la passerelle reste limitée (pas de calcul de frais ni de caution sur solde). La restitution attend le retour du central.
- **Alternatives écartées.** Passerelle limitée aux ventes (guichets bloqués pendant la coupure). Passerelle complète (toutes les règles de prélèvement à reproduire, risque d'écart avec le central).
- **Références.** SPEC §9.7 ; sync_protocol §9.5, §9.6 ; openapi `activateMedia`, `takeDeposit`, `OfflineOperationType`, `EdgeSyncOperation`.

## ADR-53 — Remboursements : canaux, espèces au guichet sous plafond, bracelets anonymes

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N22).
- **Contexte.** Le contrat d'API, la spécification et le scénario de référence ne donnaient pas les mêmes canaux ; exiger deux personnes pour chaque remboursement en espèces bloquait le guichet ; le sort des bracelets anonymes n'était pas dit.
- **Décision.**
  1. Canaux : Wave et Orange Money vers le numéro vérifié du titulaire, virement bancaire réservé au back-office, espèces au guichet ; pas de carte en V1 (option B).
  2. Espèces au guichet : une seule personne jusqu'à `event.cash_refund_single_max` (50 000 XOF par défaut, réglable par événement), une seconde personne au-delà (option B).
  3. Un bracelet anonyme peut être remboursé en espèces au guichet, sur présentation du bracelet lu par le terminal (option A).
- **Conséquences.** Le guichet reste fluide ; le risque est borné par le plafond et par le contrôle de la caisse à sa fermeture. Le remboursement par carte pourra être ajouté avec le choix du PSP carte (OP-B1). Le bracelet sert de preuve pour un anonyme : sa perte rend le solde irrécupérable au guichet.
- **Alternatives écartées.** Carte dès la V1 (dépend d'un PSP non choisi). Toujours deux personnes (bloque le guichet) ou toujours une (aucune limite au risque). Compte exigé pour les anonymes (exclut le cas le plus courant).
- **Références.** SPEC §4.2, §6.5, §8.5, §14 (S16) ; openapi `RefundRequestCreate`.

> Note du 2 octobre 2026 : un remboursement mobile vers un autre numéro que le numéro vérifié est permis aux conditions d'ADR-76.

## ADR-54 — Niveau d'identification porté par le client et calculé à chaque usage

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N23).
- **Contexte.** La spécification stockait le niveau sur le portefeuille tout en le disant porté par le client et limité par l'expiration de la pièce, que rien ne gérait. Ce niveau décide des plafonds réglementaires (ADR-14).
- **Décision.** Le niveau n'est plus stocké : `wallet_kyc_level` le calcule à partir des identifications du client (non révoquées, pièce non expirée à la date de l'opération) ; un portefeuille anonyme est `NONE`. La table `kyc_verification` (S24) est écrite dans le schéma de référence, en ajout seul (seule la révocation, avec auteur et motif), avec les 4 derniers caractères de la pièce seulement (option A).
- **Conséquences.** Les plafonds restent exacts sans tâche planifiée ; une révocation ou une expiration s'applique dès l'opération suivante, sur tous les portefeuilles du client. La règle « un agent n'identifie pas son propre portefeuille » reste contrôlée par l'API, faute de lien entre utilisateurs et clients dans le schéma (S1).
- **Alternatives écartées.** Niveau stocké par portefeuille ou par client et mis à jour par une tâche quotidienne (risque de décalage, plafonds faussés si la tâche échoue).
- **Références.** SPEC §6.3, §14.1 (S24) ; schéma section 16b.

## ADR-55 — PostgreSQL 17 pour borner la durée des transactions, avec surveillance en filet

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N25). Complète ADR-06 (version de PostgreSQL).
- **Contexte.** Le scellement du journal (ADR-46) suppose qu'aucune transaction SQL ne dure plus de 60 s. PostgreSQL 16 ne borne que chaque requête, pas la durée totale d'une transaction.
- **Décision.** La cible devient PostgreSQL 17 au minimum, avec `transaction_timeout = 60s`, `statement_timeout = 30s` et `idle_in_transaction_session_timeout = 10s` sur le rôle applicatif. Une tâche de surveillance coupe toutes les 10 s les transactions du rôle applicatif ouvertes depuis plus de 60 s et alerte (option A, avec le filet de l'option B). La CI passe à PostgreSQL 17.
- **Conséquences.** La garantie vient de la base. À vérifier : disponibilité de PostgreSQL 17 sur AWS RDS dans la région retenue (OP-N11). Le schéma et les tests sont écrits en SQL standard de PostgreSQL et n'utilisent rien de propre à la version 16 ; ils ont été exécutés sous 16 dans cet environnement, la CI les exécute sous 17.
- **Alternatives écartées.** Rester en version 16 avec une borne applicative seule (dépend d'une tâche qui peut tomber). Allonger le délai de scellement (pas de garantie, preuve moins fraîche).
- **Références.** SPEC §2, §13.7 ; schéma section 6 (réglages du rôle) ; CI `ledger-tests.yml`.

## ADR-56 — Code imprimé sur tous les lots publics, généré à la commande

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N28). Précise ADR-36.
- **Contexte.** Le code n'était imprimé que si l'événement autorisait le rattachement dans l'app, ce qui n'est pas le défaut : sans action de l'organisateur, aucun festivalier n'aurait eu accès à l'app (rattachement, consultation anonyme du solde). La spécification le disait aussi généré à la personnalisation, alors que le fournisseur imprime avant, d'après le fichier de commande.
- **Décision.** Tous les bracelets des lots `PUBLIC` portent le code imprimé (QR et code en clair), quels que soient les modes d'activation ; les lots `STAFF` et `VIP` n'en portent pas (option A). Le code est généré à la commande du lot, envoyé au fournisseur, puis seule son empreinte est conservée ; il est associé à la puce à la personnalisation par scan du QR, ou par le fichier de correspondance du fournisseur (option A).
- **Conséquences.** Tout festivalier peut utiliser l'app. Le surcoût d'impression d'un QR unique par bracelet s'applique à tous les bracelets publics (devis : action 4 des points ouverts). Le code étant visible sur le bracelet, le risque de rattachement par un tiers d'un bracelet anonyme déjà approvisionné est traité à part (point ouvert suivant).
- **Alternatives écartées.** Code lié au rattachement dans l'app (aucun code par défaut). Réglage par lot (plus de paramètres, peu de gain attendu). Génération à la personnalisation (imprimante sur chaque poste, incompatible avec une impression industrielle).
- **Références.** SPEC §7.8, §8.5, §14 (S19).

## ADR-57 — Rattachement d'un bracelet approvisionné confirmé au guichet

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N38).
- **Contexte.** Le code imprimé est visible sur le bracelet (ADR-56). Un tiers qui le photographie pouvait rattacher à son compte un bracelet anonyme déjà approvisionné, puis demander le remboursement vers son propre numéro ou bloquer la victime par une déclaration de perte.
- **Décision.** Un bracelet à solde nul se rattache librement dans l'app. Si le portefeuille anonyme a un solde disponible non nul, l'app crée une demande en attente (24 h, 3 au plus par bracelet, code de confirmation à 6 chiffres) ; elle est confirmée au guichet par la lecture du bracelet et la saisie du code (option A). Le code imprimé n'est consommé qu'à la confirmation. La consultation anonyme du solde par un tiers qui a vu le code est un risque accepté.
- **Conséquences.** Détourner l'argent d'un bracelet exige de l'avoir en main. Le parcours courant (rattachement juste après l'activation, solde nul) n'est pas ralenti ; un festivalier qui rattache après avoir rechargé passe une fois au guichet. Une demande en attente d'un tiers ne bloque pas le vrai titulaire (plusieurs demandes peuvent coexister, celle confirmée au guichet l'emporte). Nouvelle opération `confirmMediaClaim` (63 opérations).
- **Alternatives écartées.** Délai de sécurité après rattachement (le tiers peut encore bloquer la victime). Code masqué physiquement (surcoût, protection dépendante du festivalier, consultation moins pratique).
- **Références.** SPEC §7.8, §8.5, §14 (S19) ; openapi `claimMedia`, `confirmMediaClaim`.

## ADR-58 — Perte d'une opération non conforme portée par qui a fourni le terminal

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N29).
- **Contexte.** Une vente hors ligne rejetée pour non-conformité du terminal n'est pas garantie. La spécification désignait à la fois le prestataire (responsable du logiciel) et l'organisateur (responsable des terminaux de l'événement).
- **Décision.** La perte est portée selon `device.provided_by` (désormais obligatoire, `OPERATOR` par défaut) : terminal de la plateforme ou du prestataire → prestataire ; de l'organisateur → organisateur ; du commerçant → commerçant, sauf défaut du logiciel établi, alors prestataire (option B). L'indemnisation du commerçant passe par une écriture `ADJUSTMENT` validée à deux au débit du compte de pertes de la partie désignée.
- **Conséquences.** Chacun est incité à tenir à jour les terminaux qu'il fournit. Le prestataire garde la charge des défauts de son logiciel, ce qui suppose une enquête (journaux du terminal, version de l'app) avant d'imputer la perte à un commerçant.
- **Alternatives écartées.** Toujours le prestataire (paie pour des terminaux qu'il ne contrôle pas). Partie fixée par contrat (une règle de plus à négocier pour chaque événement). Toujours le commerçant (contraire à l'idée de garantie).
- **Références.** SPEC §8.2, §9.6 ; sync_protocol §7.2.

## ADR-59 — Signature d'originalité lue et contrôlée à chaque paiement

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N30).
- **Contexte.** Le chemin de paiement (SPEC §7.6) ne lisait pas la signature d'originalité NXP, contrôlée seulement à la personnalisation ; le banc de mesure lisait `GET_VERSION` et `READ_SIG` à chaque tap.
- **Décision.** `READ_SIG` est lu à chaque passage (option B). Le terminal vérifie la signature pour l'UID (clé publique NXP) et, hors ligne, compare son empreinte à celle du snapshot. Le serveur compare la signature reçue à celle enregistrée à la personnalisation (`media.originality_sig_sha256`) : différente → `SIGNATURE_MISMATCH`, liste noire, anomalie. `GET_VERSION` n'est pas utilisé au paiement. Les seuils d'ADR-39 s'appliquent à cette séquence de paiement.
- **Conséquences.** Les copies grossières (puces non NXP, puces NXP d'un autre UID) sont arrêtées à chaque passage, et une puce authentique différente qui reprendrait l'identité d'un bracelet est détectée. Un émulateur qui rejoue la signature d'origine reste arrêté par le mot de passe propre au bracelet et par le compteur. Coût : une commande NFC de plus par paiement (environ 5 à 15 ms), à mesurer par le banc.
- **Alternatives écartées.** Pas de `READ_SIG` au paiement (plus rapide, contrôle d'authenticité limité à la personnalisation). Lecture par sondage (logique plus complexe pour un gain partiel).
- **Références.** SPEC §7.5, §7.6, §12.2 ; sync_protocol §5.2 ; openapi `TapInput`, `TapResultCode`, `SnapshotEntry` ; banc NFC (`analyse_mesures.py`, PROTOCOLE_TERRAIN §1, §8).
- **Note du 2 octobre 2026 (revue 2).** Complétée par ADR-71 : une signature absente pour une puce qui en a une enregistrée donne, en ligne, `SIGNATURE_MISSING` (le terminal relit, sans liste noire) ; hors ligne, l'opération est gardée avec une anomalie `SIGNATURE_MISMATCH`.

## ADR-60 — Objectif de latence découpé en trois tranches

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N31).
- **Contexte.** Le contrat d'API, la spécification et le protocole de terrain donnaient trois objectifs différents, sans dire ce qui était mesuré. L'objectif sert au choix de la région, au dimensionnement et au test de charge.
- **Décision.** Du bracelet présenté au succès affiché : de bout en bout p95 ≤ 1,2 s et p99 ≤ 2 s ; dont NFC p95 ≤ 300 ms (ADR-39) ; réseau + serveur p95 ≤ 800 ms et p99 ≤ 1,5 s, en un seul aller-retour ; serveur seul p95 ≤ 200 ms et p99 ≤ 500 ms, y compris pendant le test de charge (option A).
- **Conséquences.** Le test de charge juge la tranche « serveur seul » ; la mesure terrain juge les tranches NFC et réseau, et le choix de région (OP-N11) retient une région dont l'aller-retour depuis Dakar tient dans le budget sur les trois opérateurs. Le parcours nominal en ligne embarque la lecture dans le paiement. Le chiffre de bout en bout sera confirmé par la mesure depuis Dakar.
- **Alternatives écartées.** Objectif plus exigeant (p95 ≤ 800 ms de bout en bout, difficile à tenir sur réseau mobile vers l'Europe). Objectif serveur seul (aucune garantie au stand).
- **Références.** SPEC §15 ; openapi `createPayment` ; PROTOCOLE_TERRAIN §11.

## ADR-61 — Réglages de fonctionnement des terminaux par événement, dans des bornes

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N32).
- **Contexte.** Le protocole disait « réglables » les délais, le battement de cœur, les synchronisations, la fenêtre d'annulation et la conservation locale, mais la configuration envoyée au terminal n'en portait aucun : ils auraient été figés dans l'application.
- **Décision.** Ces réglages sont des colonnes de `event`, bornées par la base (par exemple délai total 2 à 6 s, fenêtre d'annulation 0 à 60 min, conservation locale 7 à 30 jours), réglés par le prestataire pour chaque événement, sauf la fenêtre d'annulation (organisateur). Ils partent dans `DeviceConfig.terminal_settings` ; une modification produit une nouvelle configuration servie (option A).
- **Conséquences.** Les réglages s'adaptent au réseau de chaque site sans nouvelle version de l'application. Les bornes empêchent une valeur dangereuse (délai trop court qui bascule hors ligne sans raison, conservation trop courte pour l'audit).
- **Alternatives écartées.** Valeurs fixes (chaque ajustement exige une mise à jour de l'app). Réglage au seul niveau de la plateforme (pas d'adaptation par site).
- **Références.** SPEC §9.8 ; sync_protocol §12 ; openapi `DeviceConfig.terminal_settings` ; schéma `event`, `record_config_served`.

## ADR-62 — Comptes commerçants chauds par défaut

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N33).
- **Contexte.** Chaque vente touche le compte du commerçant. Tenu « froid » (solde en cache, ligne verrouillée), il fait attendre les ventes simultanées d'un même stand ; la spécification disait « chaud selon volume », sans critère. La cible est de 20 ventes par seconde sur un stand, 40 au test de charge.
- **Décision.** Tout compte `MERCHANT` est créé chaud (déclencheur `account_merchant_hot`) : pas de solde en cache ni de verrou, solde calculé à la lecture (option A). Un compte peut être repassé froid ensuite, par décision explicite.
- **Conséquences.** Aucune attente entre ventes d'un même stand. Rien n'est perdu en contrôle : un compte commerçant est déjà autorisé à passer en négatif (droit de place), donc le contrôle de côté ne s'appliquait pas. La lecture d'un solde commerçant additionne ses lignes (index sur `posting (account_id, id)`), ce qui reste rapide pour les relevés et la clôture.
- **Alternatives écartées.** Chaud au-delà d'un seuil de volume (estimation par stand à l'avance). Toujours froid (risque d'empilement en cas de ralentissement de la base).
- **Références.** SPEC §5.2 (plan de comptes), §15 ; schéma `account_merchant_hot`.

## ADR-63 — Recharge espèces hors ligne au-delà d'un plafond : marge au portefeuille, reste dû au client

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N34).
- **Contexte.** Une recharge en espèces acceptée hors ligne peut dépasser un plafond réglementaire. Rejetée à la synchronisation, elle laissait de l'argent en caisse sans écriture, et le festivalier payé sans être crédité.
- **Décision.** À la synchronisation, la recharge est écrite en deux parts : le portefeuille est crédité de la marge restante (`wallet_topup_headroom` : plafond de solde et plafond mensuel), le reste sur `L-ESP-A-RENDRE` (`CUSTOMER_CASH_DUE`), avec une anomalie `CASH_TOPUP_OVER_LIMIT` qui porte le bracelet et le montant dû (option B). Le reste est rendu en espèces au guichet sur présentation du bracelet (même règle de seconde personne qu'ADR-53) ; non réclamé, il suit la règle de la casse à la clôture.
- **Conséquences.** La caisse est juste à tout moment ; aucun plafond n'est dépassé ; le festivalier reçoit tout ce qui est permis. Un usage de compte, un type d'anomalie et une fonction de marge sont ajoutés ; à la clôture, le montant dû peut rester parmi les soldes restants si la casse est `NONE` (ADR-49).
- **Alternatives écartées.** Rejet et remboursement hors grand livre (caisse fausse jusqu'au passage du client). Acceptation au-delà du plafond (infraction réglementaire).
- **Références.** SPEC §5.2, §5.3, §8.5, §12.2 ; sync_protocol §5, §11 cas 22 ; schéma `wallet_topup_headroom`.
- **Note du 2 octobre 2026 (revue 2).** Complétée par ADR-71 : le rendu au guichet passe par `refund_cash_due`, en espèces seulement, pour le montant des anomalies ouvertes du bracelet ; l'anomalie doit porter `media_id` et `amount` ; la restitution du bracelet est refusée tant qu'une anomalie est ouverte ; `wallet_topup_headroom` verrouille le solde du portefeuille et exige la date de l'opération.

## ADR-64 — Paiement par QR : deux sens toujours autorisés, pas de jeton préchargé

- **Statut** : Acceptée, 1er octobre 2026 (tranche le point ouvert OP-N35).
- **Contexte.** La spécification laissait l'organisateur choisir les sens du paiement par QR sans prévoir de réglage, et permettait à l'app de précharger des jetons de QR client, inutiles avec une durée de vie de 60 s et assimilables à de l'argent au porteur.
- **Décision.** Les deux sens (QR commerçant, QR client) sont toujours autorisés, sans réglage (option C). L'app ne précharge aucun jeton : le QR client exige du réseau sur le téléphone et sur le terminal (option A). Le festivalier qui ne peut pas payer par l'app paie avec son bracelet.
- **Conséquences.** Aucun jeton au porteur ne circule hors ligne ; un réglage de moins. Le relais par QR après une perte (ADR-42) suppose que le téléphone ait du réseau ; sinon, le festivalier va au guichet pour un nouveau bracelet. Un organisateur ne peut pas désactiver un sens.
- **Alternatives écartées.** Réglage par événement des sens autorisés (complexité sans besoin exprimé). Jetons préchargés, encadrés ou non (risque de vol d'un jeton, logique supplémentaire dans l'app).
- **Références.** SPEC §8.3, §8.5 ; openapi `createCustomerQrToken` ; ADR-42.

## ADR-65 — Région d'hébergement provisoire : Paris (eu-west-3)

- **Statut** : Acceptée sous condition, 1er octobre 2026 (point ouvert OP-N11, décision provisoire). Conditions : mesure de latence depuis Dakar sur Orange, Free et Expresso (budget réseau d'ADR-60), avis écrit du juriste sur l'hébergement hors du Sénégal (loi 2008-12, CDP, exigences éventuelles de la BCEAO), disponibilité de PostgreSQL 17 sur RDS (ADR-55).
- **Contexte.** Le choix de la région conditionne la latence de chaque paiement en ligne, le cadre juridique des données et le coût. Les candidates étaient Paris, Irlande, Milan et Le Cap ; aucune mesure ni avis juridique n'est encore disponible.
- **Décision.** Le développement, les environnements de test et le pilote se préparent dans la région Paris (`eu-west-3`). La région reste un paramètre de déploiement par prestataire (SPEC §2) : le code ne suppose aucune région particulière.
- **Conséquences.** L'agent peut écrire l'infrastructure (scripts de déploiement, KMS, RDS, S3 Object Lock) pour une région concrète. Si la mesure ou le juriste écartent Paris, la région change par paramètre, avec une migration des données des environnements existants. La seconde région des sauvegardes et le compte AWS distinct des copies de scellement (ADR-46) restent à fixer.
- **Alternatives écartées pour l'instant.** Irlande, Milan, Le Cap : à réexaminer si Paris ne tient pas le budget réseau ou n'est pas admise par le juriste. Hébergement au Sénégal : seulement si le juriste l'impose.
- **Références.** SPEC §2, §13.5, §15, §17 ; POINTS_OUVERTS OP-N11.

## ADR-66 — Codes à usage unique : WhatsApp d'abord, SMS en repli avec deux fournisseurs

- **Statut** : Acceptée, 2 octobre 2026 (tranche le point ouvert OP-B2, options C et D combinées).
- **Contexte.** Les codes vérifient le numéro du festivalier (création de compte, nouveau téléphone, numéro de remboursement). Le volume est faible (un ou deux codes par festivalier) ; le critère principal est la fiabilité à l'entrée d'un festival, où l'Internet mobile est souvent saturé alors que les SMS passent encore.
- **Décision.** Chaîne d'envoi par défaut : WhatsApp (modèle d'authentification, fournisseur agréé par Meta) ; si la livraison n'est pas confirmée en 10 s ou si le numéro n'a pas WhatsApp, le même code part par SMS via un fournisseur principal local couvrant Orange, Free et Expresso ; si la livraison SMS n'est pas confirmée en 20 s, par un second fournisseur SMS. L'app propose toujours « Recevoir par SMS ». Délais réglables par la plateforme. Un seul code valide par défi.
- **Conséquences.** Coût minimal quand WhatsApp passe, et un SMS garanti quand le réseau de données est saturé ; aucune dépendance à un seul fournisseur. Trois intégrations (WhatsApp, deux SMS) derrière le port `OtpSender`, qui gère la chaîne et les accusés de livraison. À lancer sans attendre : validation du nom d'expéditeur SMS (5 à 10 jours, RCCM) et du modèle WhatsApp. Fournisseurs à choisir sur devis : SMS principal (API SMS d'Orange Sénégal si elle livre les trois opérateurs, sinon un agrégateur local), SMS de repli (fournisseur international), fournisseur WhatsApp. Les limites d'essais (S17) s'appliquent par défi, pas par canal.
- **Alternatives écartées.** SMS seul avec un fournisseur (dépendance unique). WhatsApp seul (inutilisable sans Internet).
- **Références.** SPEC §8.5, §17 ; openapi `channel` (`AUTO`, `SMS`, `WHATSAPP`) ; POINTS_OUVERTS §7.

## ADR-67 — Casse réversible pendant 5 ans

- **Statut** : Acceptée, 2 octobre 2026 (tranche la partie « casse » du point ouvert OP-N3, option C ; le reste d'OP-N3 attend l'expert-comptable).
- **Contexte.** La casse devenait définitive à la date limite de remboursement. Or l'acte uniforme OHADA sur le droit commercial général fixe une prescription de 5 ans pour les obligations entre commerçants et non-commerçants : la dette envers un festivalier pourrait exister au-delà de la date limite.
- **Décision.** La casse reste enregistrée et partagée à la date limite, mais un festivalier peut être remboursé pendant `late_claim_years` ans après le verrouillage (5 par défaut, réglable par profil de législation, 0 = casse définitive). Le grand livre verrouillé accepte alors, en back-office et à deux personnes, jusqu'à `ledger.late_claims_until` : `BREAKAGE_REVERSAL` (nouveau type), `ADJUSTMENT` et `WALLET_REFUND`. Les comptes de casse peuvent passer en négatif.
- **Conséquences.** L'argent de la casse n'est pas immobilisé ; le festivalier garde son droit si la prescription s'applique. Règle unique pour une réclamation tardive : `BREAKAGE_REVERSAL` débite chaque bénéficiaire de la casse en proportion de sa part de la casse initiale ; le détenteur des fonds paie le remboursement au festivalier (`WALLET_REFUND`) ; chaque bénéficiaire rapporte ensuite sa part (`ADJUSTMENT`). Si l'expert-comptable et le juriste confirment que la date limite suffit, `late_claim_years = 0` rend la casse définitive.
- **Alternatives écartées.** Casse définitive à la date limite (risque juridique). Casse seulement après 5 ans (argent immobilisé longtemps).
- **Références.** SPEC §4.2, §5.3, §5.7, §12.1 ; schéma `jurisdiction_profile.late_claim_years`, `ledger.late_claims_until`, `post_transaction`.
- **Note du 2 octobre 2026 (revue 2).** La fiche disait à la fois « débit des bénéficiaires » (Décision) et « le bénéficiaire avance le remboursement » (Conséquences). Ces deux phrases sont remplacées par la règle unique ci-dessus (ADR-71). Les bornes des réclamations tardives (comptes, montant, statut du grand livre) restent la question Q4 (revue 2).

> Note du 2 octobre 2026 : les bornes de ces écritures sont fixées par ADR-75 et contrôlées par la base (`check_late_claim`).

## ADR-68 — Assiette des frais du prestataire choisie dans chaque contrat

- **Statut** : Acceptée, 2 octobre 2026 (tranche le point ouvert OP-N6, option C).
- **Contexte.** Les frais du prestataire assis sur les recharges pouvaient porter sur les recharges brutes ou nettes des remboursements ; le net est plus juste pour l'organisateur quand beaucoup de festivaliers se font rembourser.
- **Décision.** Chaque contrat prestataire–organisateur choisit : `contract.operator_fee_basis` = `GROSS` (défaut, recharges payées) ou `NET_OF_REFUNDS` (recharges payées moins les `WALLET_REFUND` de la période).
- **Conséquences.** Le moteur de frais lit l'assiette du contrat en vigueur ; le scénario de référence reste en brut.
- **Références.** SPEC §5.5 ; schéma `contract.operator_fee_basis`.
- **Note du 2 octobre 2026 (revue 2).** Avec `NET_OF_REFUNDS`, les frais sont d'abord calculés au règlement (`SETTLING`) sur les remboursements connus. À la fin de la fenêtre de remboursement, avant `CLOSED`, une régularisation est écrite (`OPERATOR_FEE` de sens inverse) ; le contrôle par partie de `CLOSED` oblige à la solder. Le paramètre `topup_basis`, doublon de ce champ, est supprimé des textes. La règle est en SPEC §5.6 (et non §5.5).

## ADR-69 — Pas d'outil de gestion de flotte (MDM)

- **Statut** : Acceptée, 2 octobre 2026 (tranche le point ouvert OP-N7).
- **Décision.** Le système n'utilise pas de MDM. L'app s'installe depuis le magasin d'applications ou par distribution privée ; l'enrôlement se fait par un code à usage unique affiché en QR dans le back-office ; les terminaux dédiés sont verrouillés sur l'app par l'épinglage d'écran d'Android. Un téléphone personnel n'a jamais le hors ligne (`device.personal_phone`, déjà imposé par la base), ni recharge, ni remboursement, ni caution.
- **Conséquences.** Pas de coût ni d'intégration MDM. Sans effacement à distance, un terminal perdu ou volé est révoqué : sa clé n'est plus acceptée, il ne reçoit plus de snapshot ni de clé de contenu, et son stockage local est chiffré. Les mises à jour de l'app passent par le magasin ; la configuration vient du serveur (`DeviceConfig`). Le champ `mdm_device_id` est retiré.
- **Alternatives écartées.** Un MDM du marché (coût, intégration, dépendance), réservé à une version ultérieure si le parc de terminaux dédiés grandit.
- **Références.** SPEC §8.2 ; openapi enrôlement ; sync_protocol §8.

## ADR-70 — Paiements : comptes au détenteur des fonds, mobile money en direct, carte configurée par organisateur

- **Statut** : Acceptée, 2 octobre 2026 (tranche le point ouvert OP-B1).
- **Contexte.** Il fallait décider à qui appartiennent les comptes marchands, par quels prestataires passe le mobile money et comment encaisser la carte. Wave porterait environ 60 % des paiements mobiles au Sénégal avec des frais d'environ 1 % ; Orange Money environ 25 % ; les agrégateurs locaux agréés par la BCEAO (PayDunya, InTouch, CinetPay) couvrent carte et mobile money ; peu de festivaliers ont une carte internationale.
- **Décision.**
  1. Les comptes marchands appartiennent au détenteur des fonds de l'événement (option A) ; leurs identifiants sont rattachés à lui dans Secrets Manager.
  2. Wave et Orange Money sont intégrés en direct, sans agrégateur (option M3).
  3. La carte est configurée par le prestataire pour chaque organisateur : aucun PSP carte, un agrégateur local (adaptateur V1 : PayDunya) ou un PSP international (adaptateur V1 : Stripe). Configuration versionnée (`psp_configuration`, S26).
- **Conséquences.** Frais mobile money les plus bas ; quatre adaptateurs en V1 (Wave, Orange Money, PayDunya, Stripe) derrière le même port, d'autres s'ajoutent sans toucher au reste. Le détenteur des fonds doit ouvrir ses comptes Wave Business et Orange Money (la validation Orange Money prend plusieurs semaines). Avant d'activer un PSP carte, le prestataire vérifie qu'il peut servir un marchand établi au Sénégal (agrément BCEAO, ouverture de compte et versement en XOF pour un PSP international). Dès qu'un organisateur active la carte, les contestations de paiement (OP-N9) deviennent réelles.
- **Alternatives écartées.** Comptes toujours au prestataire (encaissement pour autrui, risqué face au réseau limité et à l'agrément BCEAO). Tout par un agrégateur (frais plus élevés sur Wave). Carte reportée à la V2 (exclut les visiteurs étrangers).
- **Références.** SPEC §4.4, §8.5, §11.1, §14.2 (S26), §17 ; openapi `PspProvider`, `receivePspWebhook`.

> Note du 2 octobre 2026 : le rattachement est précisé par ADR-72 (configurations de l'organisateur, choix par événement).

> Note du 2 octobre 2026 : la protection contre les contestations carte (3-D Secure, plafond par carte et par jour, alerte multi-cartes) est fixée par ADR-77.

## ADR-71 — Corrections de la revue de cohérence n° 2

- **Statut** : Acceptée, 2 octobre 2026. Complète ADR-50, ADR-51, ADR-59, ADR-63, ADR-67 et ADR-68. Ne tranche aucune des questions Q1 à Q6 de la revue (POINTS_OUVERTS §9).
- **Contexte.** La revue de cohérence n° 2 (`REVUE_COHERENCE_2.md`) a trouvé trois défauts bloquants dans la base. Le plus grave : aucun événement réel ne pouvait atteindre `CLOSED`, car la clôture exigeait que chaque compte soit à zéro, alors que les comptes d'une même partie se compensent (dans le scénario de référence, `L-ORG-COM` finit à −4 745 et `L-ORG-VERS` à +39 225). Les tests passaient parce qu'ils clôturaient des grands livres vides. Les deux autres : une caution perdue au remplacement d'un bracelet, et des numéros de séquence sans borne.
- **Décision.** Choix techniques appliqués au schéma (normatif) et aux documents :
  1. **Clôture par partie.** `CLOSED` exige des positions soldées : droit net nul pour chaque partie titulaire, solde nul compte par compte pour les comptes sans titulaire (attente, versements en cours, portefeuilles, espèces à rendre, compte légal). Fonction interne `ledger_unsettled`. Soldes tolérés : `LEGAL_BREAKAGE`, plus `WALLET_PAID` et `CUSTOMER_CASH_DUE` si la casse est `NONE`. `lock_settled_ledger` est idempotente, prend le verrou d'autorité, exige un grand livre `CLOSING` et un événement `CLOSED`. À partir de `RECONCILING`, l'autorité de débit doit être `CENTRAL`. Le garde du statut d'événement exige le rôle propriétaire de la table. Ordre de verrouillage unique : verrous consultatifs, puis lignes.
  2. **La caution suit le bracelet.** `replace_media` transfère une caution `HELD` ou `DUE` au nouveau bracelet, qui doit être neuf et, pour une caution `HELD`, venir d'un lot de même mode de caution. L'ancien doit être `ACTIVE` ou `SUSPENDED`. Refus : `CL020`.
  3. **Borne de séquence.** Un numéro ou un lot au-delà de `contiguous_acked_seq + max_seq_jump()` (10 000) est refusé (`CL021`), sans anomalie de masse. Un lot `PROCESSING` depuis plus de 15 min est abandonné à l'ouverture du suivant. `waive_seq_gap` est refusé si un lot en cours couvre le numéro.
  4. **Consommation unique des passages.** `register_tap` renvoie `tap_id` ; `consume_tap` rattache un passage à une seule écriture (`CL022` sinon, ou si une écriture en ligne arrive après `tap_replay_window_seconds`). Une même lecture jamais utilisée est réutilisée quel que soit le délai : un lot hors ligne en retard ne met plus le bracelet en liste noire. Signature absente : `SIGNATURE_MISSING` en ligne, anomalie hors ligne. Le terminal doit appartenir au même prestataire.
  5. **Rendu des espèces dues.** `refund_cash_due` rend au guichet, en espèces seulement, la somme des anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes du bracelet, jamais un montant libre ; seconde personne au-delà de `cash_refund_single_max`. `release_media` est refusée tant qu'une de ces anomalies est ouverte.
  6. **Autres.** Comptes de casse autorisés en négatif (annulation tardive, ADR-67) ; compte commerçant chaud et autorisé en négatif dès sa création ; changement chaud/froid qui recalcule ou supprime le cache. `wallet_topup_headroom` verrouille le solde et exige la date. Scellement étendu aux champs de `journal_transaction` (source, auteur, valideur, métadonnées…) et vue `ledgers_to_seal`, `LOCKED` compris. Préchargement et cautions acquises par tranches de 500. `request_hash` en SHA-256. Rejeu `EDGE_SYNC` avec `origin_key`, `origin_occurred_at`, `origin_mode`. Nouveau code `CL020` pour les états de bracelet, de lot et de caution.
  7. **Rédaction.** Règle unique d'ADR-67 (débit proportionnel des bénéficiaires, remboursement par le détenteur des fonds, puis apport de chaque bénéficiaire). Régularisation `NET_OF_REFUNDS` avant `CLOSED` (ADR-68) ; `topup_basis` supprimé. Instantané non requis pour un terminal sans droit au hors ligne.
- **Conséquences.** Le scénario de référence va maintenant jusqu'à `CLOSED` et `LOCKED` ; les tests passent à 434 assertions (370 pour le schéma, 64 pour le scénario). La SPEC passe en version 1.2. Trois nouveaux codes d'erreur (`CL020` à `CL022`). Restent ouverts : date limite de synchronisation (Q2), double validation par l'API (Q3), bornes des réclamations tardives (Q4), numéro de remboursement mobile (Q5), contestations carte (Q6, OP-N9).
- **Alternatives écartées.** Garder « chaque compte à zéro » en ajoutant des écritures de compensation entre comptes d'une même partie (écritures sans réalité économique). Laisser la caution sur l'ancien bracelet (elle ne pouvait plus être rendue ni acquise). Une anomalie `SEQ_GAP` par numéro sans borne (un seul message forgé pouvait bloquer la base).
- **Références.** SPEC §3.2, §5.2, §5.3, §5.6, §5.7, §7.6, §7.8, §8.5, §9.5, §12.1, §12.2, §13.7, §17 ; `REVUE_COHERENCE_2.md` (A1, A3) ; schéma `ledger_unsettled`, `lock_settled_ledger`, `set_event_status`, `replace_media`, `max_seq_jump`, `register_tap`, `consume_tap`, `refund_cash_due`, `release_media`, `ledgers_to_seal`.

> Note du 2 octobre 2026 : Q2 est tranchée par ADR-73 et Q3 (double validation par l'API) par ADR-74.

## ADR-72 — Configuration PSP : de l'organisateur, choisie par événement

- **Statut** : Acceptée, 2 octobre 2026 (tranche la question Q1 de la revue 2, option C).
- **Contexte.** ADR-70 fait configurer les PSP par le prestataire pour chaque organisateur. Le détenteur des fonds, lui, se choisit par événement (§4.4). Un organisateur qui détient les fonds d'un événement et laisse le prestataire les détenir pour un autre doit encaisser sur deux comptes différents ; une seule configuration par organisateur ne le permet pas.
- **Décision.** Les configurations PSP (S26) appartiennent à l'organisateur ; il peut en avoir plusieurs par moyen, dont une par défaut. Chaque événement retient, pour chaque moyen, l'une d'elles (S26b, `event_psp_selection`) ; sans choix, il prend la configuration par défaut. Le titulaire de la configuration retenue DOIT être le détenteur des fonds de l'événement : la base refuse sinon.
- **Conséquences.** Pas de ressaisie à chaque événement ; impossible d'encaisser sur le compte d'une autre partie. Une table de plus (S26b). Un changement en cours d'événement ne vaut que pour les recharges suivantes, chacune gardant sa configuration (`psp_topup`).
- **Alternatives écartées.** A : un seul détenteur des fonds pour tous les événements d'un organisateur (perte de souplesse). B : configuration par événement (ressaisie, risque d'erreur).
- **Références.** SPEC §11.1, §14.2 (S26, S26b) ; ADR-70 ; openapi `receivePspWebhook`.

## ADR-73 — Date limite de synchronisation : 72 h après la fin, contrôlée en base

- **Statut** : Acceptée, 2 octobre 2026 (tranche la question Q2 de la revue 2, option B).
- **Contexte.** Le passage au règlement (`SETTLING`) devait attendre la remontée des terminaux « ou la date limite de synchronisation », mais cette date n'était définie nulle part et la base ne contrôlait rien. Un terminal perdu ne doit pas bloquer la clôture ; un passage trop tôt fait rejeter des ventes qui auraient pu être écrites automatiquement.
- **Décision.** Chaque événement a `sync_deadline_hours` (72 par défaut, de 1 à 720, réglé par le prestataire). Date limite = fin de l'événement (`ends_at`, à défaut l'heure du passage en `CLOSING`) + ce délai. Avant cette date, `set_event_status(SETTLING)` exige que chaque terminal de l'événement soit à jour (`event_device_sync_status` : manifesté depuis `CLOSING`, sans trou, sans lot en cours, sans anomalie `SEQ_GAP` ouverte ; terminaux révoqués et téléphones personnels exclus), sinon `CL019`. Après, le passage est permis ; ce qui arrive ensuite suit les synchronisations tardives (ADR-49).
- **Conséquences.** Clôture rapide quand tout est remonté ; un terminal perdu bloque au plus 72 h. Les terminaux DOIVENT remonter leurs opérations et envoyer un signal de vie dès le passage en `CLOSING`. Nouvelle opération back-office `getEventDeviceSyncStatus`.
- **Alternatives écartées.** A : attendre tous les terminaux sans limite (un terminal perdu bloque la clôture). C : décision du back-office seule (risque de clôture trop tôt).
- **Références.** SPEC §4.2, §12.1, §17 ; sync_protocol §7.5 ; schéma `event.sync_deadline_hours`, `event_sync_deadline`, `event_device_sync_status`, `set_event_status`.

## ADR-74 — Validation à deux personnes : jeton sur place au guichet, demande et approbation au back-office

- **Statut** : Acceptée, 2 octobre 2026 (tranche la question Q3 de la revue 2, option C).
- **Contexte.** Les opérations « à deux personnes » recevaient la seconde personne dans le corps de la requête (`approved_by`). La base vérifiait seulement que ce champ était différent de l'auteur : une seule personne connectée pouvait donc envoyer l'identifiant d'un collègue et se valider elle-même (API-B1). Les deux lieux n'ont pas les mêmes besoins : au guichet, les deux personnes sont là et le festivalier attend ; au back-office, la seconde personne n'est souvent pas dans la même pièce.
- **Décision.** Le valideur vient toujours d'une authentification de la seconde personne, jamais du corps de la requête : l'API ignore tout `approved_by` reçu.
  1. **Au guichet (immédiat).** La seconde personne saisit son code personnel sur le même terminal. Le serveur d'identité (OIDC, authentification renforcée) délivre un jeton d'approbation de 5 min, à usage unique (`jti` mémorisé), lié à l'action précise : `sub` = valideur, `act` = nom de l'opération, `act_hash` = SHA-256 de la requête canonique (méthode, chemin, corps JCS sans le jeton). Il est envoyé dans l'en-tête `X-Approval-Token`. Le serveur vérifie la signature, l'expiration, le `jti`, `act` et `act_hash`, `sub` ≠ appelant et le rôle du valideur ; le valideur transmis à la base est le `sub` du jeton. Jeton absent quand il est requis : `403 APPROVAL_REQUIRED` ; jeton invalide, expiré, déjà utilisé, d'une autre action ou de la même personne : `403 APPROVAL_INVALID`. Concerne les remboursements en espèces au guichet au-delà de `cash_refund_single_max` (`refundCashDue`, `releaseMedia` avec solde rendu en espèces) et la sortie de liste noire faite sur place.
  2. **Au back-office (asynchrone).** L'appel d'une opération à deux personnes crée une demande (`approval_request` : action, objet visé, paramètres figés, auteur, expiration 24 h) et renvoie `202` avec la demande `PENDING`. Une seconde personne connectée, qui a le rôle exigé par l'action, l'approuve (`approveApprovalRequest`) ou la refuse (`rejectApprovalRequest`, note obligatoire). À l'approbation, le serveur appelle `decide_approval_request` avec l'identité de SA session, puis exécute l'action une seule fois avec ce valideur ; la demande passe `EXECUTED` (avec le résultat) ou `FAILED` (avec la raison). Demande expirée, déjà décidée ou décidée par son auteur : `CL023`, `409 APPROVAL_INVALID`. Actions : réclamation tardive, écriture manuelle (`ADJUSTMENT`, `ANOMALY_RESOLUTION`), levée d'un trou de séquence, reprise forcée de l'autorité de débit, sortie de liste noire, versement, import du journal d'un terminal révoqué, révocation d'une identification, configuration PSP et choix par événement, remboursement (`WALLET_REFUND`).
  3. La base garde ses contrôles : valideur ≠ auteur (contraintes existantes et `approval_request`).
- **Conséquences.** Plus de validation par soi-même. Règle des statuts : `403` quand la preuve jointe à la requête (le jeton) manque ou ne vaut rien, `409` quand une demande enregistrée n'est plus dans un état qui permet la décision. Les opérations back-office concernées répondent `202` au lieu de `200` ou `201`. Le terminal du guichet doit savoir obtenir un jeton d'approbation auprès du serveur d'identité. Nouvelle table `approval_request` (schéma, section 18h), nouvelle fonction `decide_approval_request`, nouveau code `CL023`, quatre nouvelles opérations (`/approval-requests`).
- **Alternatives écartées.** A seul (demande puis approbation partout, recommandation de la revue) : trop lent au guichet, où le festivalier attend pendant qu'une seconde personne valide depuis le back-office. B seul (jeton d'approbation sur place partout) : exige la présence physique de la seconde personne au back-office, au même moment que l'auteur.
- **Références.** SPEC §3.2, §5.7, §8.5, §14.1 ; openapi `ApprovalToken`, `ApprovalRequest`, `listApprovalRequests`, `getApprovalRequest`, `approveApprovalRequest`, `rejectApprovalRequest` ; schéma `approval_request`, `decide_approval_request` ; `REVUE_COHERENCE_2.md` (API-B1, Q3).

## ADR-75 — Bornes des réclamations tardives contrôlées par la base

- **Statut** : Acceptée, 2 octobre 2026 (tranche la question Q4 de la revue 2, option A).
- **Contexte.** Pendant 5 ans après le verrouillage (ADR-67), le grand livre accepte trois écritures de back-office. Seules la source et la double validation étaient contrôlées : un ajustement pouvait déplacer n'importe quel montant entre n'importe quels comptes, et l'annulation de casse était acceptée même pendant l'événement.
- **Décision.** `post_transaction` appelle `check_late_claim` (refus `CL024 LATE_CLAIM_INVALID`) :
  1. `BREAKAGE_REVERSAL`, dans tout statut : un seul portefeuille crédité, seulement des comptes de casse débités, une casse antérieure sur ce portefeuille, total annulé ≤ casse prise sur ce portefeuille, chaque compte de casse débité au prorata de la casse d'origine à 1 unité près ;
  2. `ADJUSTMENT` sur un grand livre verrouillé : seulement l'apport d'un bénéficiaire (débit d'un compte d'argent, crédit de son compte de casse), au plus ce qui a été annulé sur ce compte ;
  3. `WALLET_REFUND` sur un grand livre verrouillé : seulement d'un portefeuille vers un compte d'argent, dans la limite de son solde.
  La double validation passe par une demande d'approbation `LATE_CLAIM` (ADR-74).
- **Conséquences.** On rend au festivalier exactement ce qui lui a été pris, réparti comme la casse d'origine, et rien d'autre ne peut toucher un grand livre définitif. Le remboursement suppose que les bénéficiaires aient rapporté leur part, ou que le détenteur des fonds avance l'argent sur un compte d'argent approvisionné.
- **Alternatives écartées.** B : borne du montant seul (comptes libres). C : procédure écrite sans contrôle de la base.
- **Références.** SPEC §3.2, §5.3, §5.7, §12.1 ; openapi `postLateClaim` ; schéma `check_late_claim`, `post_transaction`.

## ADR-76 — Remboursement mobile vers un autre numéro que le numéro vérifié

- **Statut** : Acceptée, 2 octobre 2026 (tranche la question Q5 de la revue 2, option C).
- **Contexte.** Le remboursement Wave ou Orange Money ne partait que vers le numéro vérifié du titulaire. Puce changée, téléphone perdu, recharge faite avec le téléphone d'un ami ou bracelet anonyme laissaient le festivalier sans recours hors du guichet, et le solde finissait en casse.
- **Décision.** Un autre numéro est permis : (1) un code à usage unique envoyé au nouveau numéro est joint à la demande ; (2) si le titulaire a un numéro vérifié, un code lui est aussi envoyé : il confirme ou bloque ; sans réponse, la demande part en traitement après `event.refund_new_number_hold_hours` (48 h par défaut), délai pendant lequel il peut la bloquer ; un bracelet anonyme n'a que l'étape (1) ; (3) au-delà de `event.refund_new_number_max` (50 000 par défaut), une vérification d'identité au guichet ou par le back-office est exigée avant l'approbation. Le circuit habituel suit : approbation à deux, paiement, confirmation.
- **Conséquences.** Les cas courants sont réglés sans guichet. Le vol d'un bracelet suivi d'une demande vers un autre numéro est signalé au titulaire, qui dispose de 48 h pour bloquer. Nouveaux statuts de demande `AWAITING_HOLDER` et `BLOCKED`, opération `decideRefundRequestAsHolder`.
- **Alternatives écartées.** A : numéro vérifié seulement (soldes perdus). B : code au nouveau numéro seulement (aucune protection du titulaire).
- **Références.** SPEC §4.2, §8.5 ; ADR-53, ADR-66 (codes) ; openapi `createMyRefundRequest`, `decideRefundRequestAsHolder`, `RefundRequestStatus` ; schéma `event.refund_new_number_max`, `event.refund_new_number_hold_hours`.

## ADR-77 — Contestations carte : payeur fixé par contrat, contestation tardive dans le grand livre verrouillé

- **Statut** : Acceptée, 2 octobre 2026 (tranche OP-N9 = question Q6 de la revue 2 : partie 1 option C, partie 2 option B).
- **Contexte.** Un festivalier peut contester une recharge par carte après l'avoir dépensée ; le PSP reprend l'argent au détenteur des fonds, parfois jusqu'à 120 jours après le paiement, donc souvent après le verrouillage du grand livre.
- **Décision.**
  1. **Payeur** : chaque contrat prestataire–organisateur désigne la partie qui supporte la part non couverte par le solde du portefeuille (`contract.chargeback_bearer`, `ORGANIZER` par défaut, ou `OPERATOR`). L'écriture `CHARGEBACK` crédite le compte PSP, débite le portefeuille jusqu'à son solde (puis le bloque) et le compte de pertes de cette partie pour le reste.
  2. **Prévention** : 3-D Secure obligatoire ; plafond de recharge par carte et par jour (`event.card_topup_daily_max_per_card`, 100 000 par défaut) ; anomalie `CARD_VELOCITY` à partir de `event.card_alert_cards_per_wallet` cartes (3 par défaut) sur un même portefeuille.
  3. **Contestation tardive** : reçue après le verrouillage, elle ouvre une anomalie `LATE_CHARGEBACK` et une demande d'approbation (`LATE_CHARGEBACK`, ADR-74). Approuvée, elle est écrite dans le grand livre verrouillé jusqu'à `late_claims_until`. La partie qui la supporte rapporte l'argent par un `ADJUSTMENT`, au plus ce qui a été débité sur son compte de pertes depuis le verrouillage. Bornes contrôlées par la base (`check_late_claim`, `CL024`).
- **Conséquences.** Le grand livre reste complet : la sortie d'argent chez le PSP y figure et se rapproche sans écart. Le compte PSP peut devenir négatif tant que le payeur n'a pas rapporté l'argent (compte chaud, sans contrôle de sens).
- **Alternatives écartées.** Payeur fixe (organisateur seul ou prestataire seul) : pas assez souple. Part au commerçant : inapplicable, une recharge se dépense chez plusieurs. Règlement hors du grand livre : écart permanent sur le compte PSP.
- **Références.** SPEC §4.2, §4.3, §5.3, §11.1, §12.1, §12.2 ; openapi `receivePspWebhook` ; schéma `contract.chargeback_bearer`, `event.card_topup_daily_max_per_card`, `event.card_alert_cards_per_wallet`, `check_late_claim`, `post_transaction`.

## ADR-78 — Pile logicielle : l'existant prime sur le document du porteur

- **Statut** : Acceptée, 9 octobre 2026 (tranche OP-N39, décision du porteur : « priorise l'existant »).
- **Contexte.** Le porteur a transmis un document « Pile logicielle » (versions et choix d'implémentation). Confronté aux sources normatives et au code des missions 1 et 2, il divergeait sur dix-neuf points (D1-D19), dont six contredisaient la SPEC ou `openapi.yaml`.
- **Décision.** L'existant est retenu partout où il y avait divergence : PostgreSQL 17, erreurs RFC 9457, pagination par curseur, idempotence en base (clé du terminal = clé du grand livre), aucun ORM, Express, `jose` 6.2.12, TypeScript 5.9.3, clé SQLCipher enveloppée par l'Android Keystore. Le reste du document est repris comme cible : versions du back-office (Next.js 15, React 19, Tailwind 4) et des apps Flutter (3.32 / Dart 3.8), TLS, HSTS (posé devant l'application, sans Nginx), HTTP/2 public (webhooks PSP acceptés en HTTP/1.1), WAF et `@nestjs/throttler` avec `429` + `Retry-After`, observabilité (pino, OpenTelemetry, CloudWatch). Écartés : Redis, Prisma, Fastify, `@nestjs/jwt`, `@nestjs/passport`, limitation par clé API, Nginx. Référence : `docs/08-pile-logicielle.md`.
- **Conséquences.** Aucun changement du code livré ni du contrat. Les missions à venir introduisent les dépendances cibles à la version indiquée, après la vérification de provenance habituelle. Une seule couche SQLCipher à choisir au plan de la mission 12.
- **Alternatives écartées.** Adopter le document tel quel : réécriture du contrat (erreurs, pagination), du filtre d'erreurs, de l'idempotence et de l'accès aux données ; perte de `transaction_timeout` (PostgreSQL 16) ; journal hors ligne lié au PIN d'un vendeur.
- **Références.** `docs/08-pile-logicielle.md` ; SPEC §1.2, §2.2, §8.2, §13.7 ; ADR-55 ; `openapi.yaml` (conventions, `Problem`, `Cursor`, `IdempotencyKey`, `TooManyRequests`).

## ADR-79 — Clés d'idempotence conservées 30 jours

- **Statut** : Acceptée, 9 octobre 2026 (tranche OP-N40, décision du porteur : « garde les 30 jours »).
- **Contexte.** `openapi.yaml` (paramètre `IdempotencyKey`) annonce une conservation d'au moins 30 jours ; la mission 1 avait codé 24 h par défaut pour les clés applicatives. Contradiction relevée lors de l'examen de la pile logicielle (ADR-78, D19).
- **Décision.** Durée de vie par défaut d'une clé applicative : 30 jours (`IDEMPOTENCY_TTL_HOURS` = 720 par défaut, toujours paramétrable). Les clés des terminaux restent la clé du grand livre, conservées pour toujours. Le contrat est inchangé.
- **Conséquences.** Table `api_idempotency` plus volumineuse (une ligne par écriture du back-office et des apps sur 30 jours) ; la purge planifiée future supprimera les lignes expirées.
- **Références.** `openapi.yaml` (`IdempotencyKey`) ; `apps/api/src/idempotency/idempotency.repository.ts` ; mission 1 (spec, research R-05, `contracts/idempotency.md` : 24 h, remplacé).

## ADR-80 — Rôle de base distinct pour les écritures de plateforme

- **Statut** : Acceptée, 12 octobre 2026 (mission « Configuration, parties et événements » ; tranche la contradiction X-2 ; limite acceptée par le porteur le même jour).
- **Contexte.** SPEC §2.2 demande que les écritures de niveau plateforme (prestataires, profils de législation, contrat et redevances de plateforme, configuration de niveau plateforme) passent par un rôle de base distinct de celui de l'application. La mission 2 avait servi son seul besoin de plateforme (`create_platform_admin`) par une fonction `SECURITY DEFINER` appelée par le rôle applicatif.
- **Décision.**
  1. Un second rôle PostgreSQL, `cashless_platform` (connexion seule, ni superutilisateur ni `BYPASSRLS`), créé par `post-roles.sql`. L'API l'atteint par un second pool (`DATABASE_URL_PLATFORM`, obligatoire en production) et une transaction dédiée (`PlatformTx`) qui ne pose jamais `app.operator_id`. Un test d'architecture limite son usage aux services de plateforme.
  2. Ses droits sont accordés un à un, après une remise à zéro à chaque rejeu : lecture et insertion sur les tables de plateforme, modification de colonnes nommées seulement, aucun droit sur les événements, le grand livre et leurs objets. Par table, une politique permissive ouvre sa portée et une politique **restrictive** la borne, pour qu'il ne puisse pas l'élargir en posant lui-même un prestataire de session.
  3. Le rôle applicatif perd les écritures de plateforme : `INSERT`, `UPDATE` sur `jurisdiction_profile` et `currency_exponent` (contradiction X-3 : `roles.sql` les accordait), et, par politiques restrictives, le contrat `PLATFORM_OPERATOR`, les règles `PLATFORM_CONTRACT` et les versions de configuration `PLATFORM`, même rattachés à son propre prestataire.
  4. Idempotence et demandes d'approbation acceptent une ligne sans prestataire (niveau plateforme). La décision d'une demande de plateforme exige une session ouverte par `cashless_platform` (`platform_session()`, nom de rôle fixe : un réglage de session serait modifiable par le rôle applicatif).
  5. `create_platform_admin` (mission 2) reste une fonction `SECURITY DEFINER` appelée par le rôle applicatif : les deux méthodes coexistent ; sa migration vers le rôle de plateforme est hors périmètre.
- **Limite acceptée.** Le schéma de référence laisse `EXECUTE` à `PUBLIC` sur ses fonctions d'API (`post_transaction`, `set_event_status`…), et sa suite de tests l'exige (« fonctions de bascule exposées »). Un droit hérité de `PUBLIC` ne se retire pas à un seul rôle : `cashless_platform` peut donc appeler ces fonctions, bien qu'il n'ait aucun droit sur les tables du grand livre. Chacune commence par `assert_tenant`, et le pool de plateforme ne pose jamais de prestataire. Retirer `EXECUTE` à `PUBLIC` demanderait de modifier le générateur de la suite de référence : non retenu.
- **Conséquences.** Deux chaînes de connexion et deux mots de passe à gérer (`CASHLESS_PLATFORM_PASSWORD` en local et en CI). Une route de plateforme exige `PLATFORM_ADMIN` et une clé d'idempotence de portée `plt:`. Les routes `/approval-requests` servent les deux niveaux : une personne de la plateforme n'y voit et n'y décide que les demandes de plateforme.
- **Alternatives écartées.** Fonctions `SECURITY DEFINER` pour toutes les écritures de plateforme (contraire à la lettre de §2.2, surface de fonctions privilégiées en hausse) ; `BYPASSRLS` pour le rôle de plateforme (supprime tout cloisonnement).
- **Références.** SPEC §2.2 ; `packages/ledger-sql/post-roles.sql`, `migrations/0009_platform_scope.sql`, `tests/tests_platform_scope.sql` ; `apps/api/src/db/platform-tx.ts` ; mission 3 (research R-01, R-02, X-2, X-3 ; contrat `platform-access`).

## ADR-81 — Profils de législation gérés par la plateforme ; colonnes de configuration ajoutées au schéma

- **Statut** : Acceptée, 12 octobre 2026 (mission « Configuration, parties et événements » ; tranche les contradictions X-1, X-4 et X-5, décision du porteur pour X-1).
- **Contexte.** SPEC §3.2 confiait les profils de législation à l'`OPERATOR_ADMIN`, alors que §2.2 et le schéma (`jurisdiction_profile` sans `operator_id`) en font une donnée de plateforme (X-1). SPEC §4.2 fait de l'émetteur et du tiers détenteur des fonds des paramètres de l'événement, et §3.1 et §12.1 font porter le droit de place par la participation, sans colonne correspondante dans le schéma de référence (X-4, X-5).
- **Décision.**
  1. Les profils de législation sont écrits par le `PLATFORM_ADMIN` seul (rôle de base de la plateforme, ADR-80) et lus par les prestataires. Un profil ne se modifie jamais : chaque changement est une nouvelle version du même pays ; une version qui change un plafond réglementaire exige deux personnes (`JURISDICTION_LIMITS_CHANGE`).
  2. Les valeurs provisoires de SPEC §17.2 (plafonds du Sénégal, TVA 18 %, date limite de remboursement à fin + 30 jours, destination de la casse) sont codées, paramétrables et rendues avec la personne qui doit les confirmer (`provisional_fields`, `refund_deadline_source`). Aucune n'est présentée comme validée.
  3. La migration `0007` ajoute `event.issuer`, `event.funds_holder_party_id`, `merchant_participation.pitch_fee`, `merchant_participation.pitch_fee_reference` et la table `currency_exponent`. Le schéma de référence n'est pas modifié.
- **Conséquences.** Un prestataire qui a besoin d'un profil pour un nouveau pays le demande à la plateforme. Les contrats, versions de configuration et profils sont immuables en base, pour tout rôle.
- **Alternatives écartées.** Profils par prestataire (colonne `operator_id` : chaque prestataire fixerait ses propres bornes légales) ; émetteur et droit de place dans `config_version.settings` (les fonctions de la base lisent des colonnes).
- **Références.** SPEC §2.2, §3.1, §3.2, §4.1, §4.2, §12.1, §17.2 ; `migrations/0007_configuration.sql` ; `apps/api/src/configuration/jurisdiction.service.ts`, `provisional-defaults.ts` ; mission 3 (research X-1, X-4, X-5, R-07).

## ADR-82 — Configuration : rôle strict par réglage, règle de frais portée par les lignes, dates d'effet par défaut

- **Statut** : Acceptée, 12 octobre 2026 (décisions d'implémentation de la mission « Configuration, parties et événements », confirmées par le porteur).
- **Contexte.** Plusieurs points n'étaient pas tranchés par les sources, ou reposaient sur une hypothèse fausse du plan.
- **Décision.**
  1. **Qui règle quoi.** Un réglage n'est modifiable que par le rôle qui le règle (catalogue des réglages) ; un rôle englobant ne s'y substitue pas : un `OPERATOR_ADMIN` reçoit `403` sur un réglage de l'organisateur, et réciproquement. Une requête qui mêle des réglages de deux rôles est refusée (`422`).
  2. **Règle de frais sur les lignes.** Le moteur d'écritures ne transmettait pas `fee_rule_id` à la base. Une règle de frais porte désormais son identifiant, les constructeurs le reportent sur les lignes qu'elle produit et `post_transaction` l'enregistre. Exceptions : les lignes de crédit de `OPERATOR_FEE` (somme de plusieurs règles), les droits de place (montant de la participation, pas une règle) et les cautions (écrites par les fonctions de la base, sans version de configuration).
  3. **Frais d'un canal de paiement.** En attendant la mission « Recharges, caisses et PSP », ils sont une règle de portée `EVENT` dont le bénéficiaire est `PSP:<canal>`. Convention provisoire.
  4. **Dates d'effet.** Sans date demandée, une version de configuration ou une règle de remplacement prend effet « maintenant » à l'horloge de la base, jamais avant celle qu'elle suit. La perdante de deux écritures simultanées d'un même niveau reçoit `409 CONFLICT_STATE`. Une opération datée d'avant la première version de configuration d'un événement prend cette première version.
  5. **Après la mise en service.** Pendant `LIVE`, réglages, participations et règles de frais d'un événement passent par deux personnes ; au-delà de `LIVE`, ils ne se modifient plus (`409`). Deux demandes en attente sur le même événement : la seconde échoue une fois la première exécutée.
- **Conséquences.** Le rejeu du scénario de référence sur une configuration construite par l'API donne les lignes et les soldes de `scenario_reference.json`, chaque ligne de frais citant sa règle.
- **Références.** SPEC §4.1, §4.2, §5.6, §9.8, §12.1 ; `apps/api/src/configuration/settings-catalog.ts`, `sql-config-resolver.ts`, `cascade.service.ts` ; `apps/api/test/scenario/api-config-replay.spec.ts`.

## ADR-83 — Quatre processus à droits séparés sur les clés, et une commande d'administration

- **Statut** : Acceptée, 13 octobre 2026 (décisions du porteur, mission « Bracelets NFC »).
- **Contexte.** SPEC §3.2 sépare les droits sur le service de clés : l'API publique ne doit ni calculer un mot de passe de bracelet ni déchiffrer une clé de données. Un seul processus portant tous les droits rendrait cette séparation théorique.
- **Décision.** Un seul code, quatre processus, chacun avec son point d'entrée, ses seuls modules et ses seuls ports de clés : API publique (aucun port), clés de bracelet (`decrypt`), personnalisation (`mac`, `dataKey`), contrôle quotidien (`mac`, `decrypt`). La création et la désactivation d'une clé du KMS passent par une commande d'administration séparée (`keyAdmin`), lancée à la demande, hors des quatre processus. Chaque opération du contrat porte `x-process`.
- **Conséquences.** Une faille de l'API publique n'atteint aucune opération de clé : elle n'en charge aucun port (`test/unit/architecture.spec.ts`). L'aiguillage d'une route vers son processus relève de l'exploitation (OP-N45).
- **Complément du 16/10/2026 (ADR-102, constat SEC-1 de la revue post-fusion).** La séparation des
  ports ne suffisait pas : la connexion de l'API écrivait librement la file `tag_key_job`, que les
  processus des clés exécutaient sans relire la demande d'approbation. Depuis la migration 0020, un
  travail ne naît que d'une demande approuvée à deux concordante (base) et chaque exécutant la
  revérifie avant tout appel au KMS. La phrase « une faille de l'API publique n'atteint aucune
  opération de clé » vaut sous la limite d'OP-N56 : une session compromise peut encore faire décider
  une demande au nom d'un second administrateur réel.
- **Références.** SPEC §3.2, §7.3, §7.4 ; `apps/api/src/processes/` ;
  `apps/api/src/kms/kms.ports.ts` ; OP-N45 ; ADR-102.

## ADR-84 — Rôles de base distincts : seuls les processus des clés lisent les chiffrés

- **Statut** : Acceptée, 13 octobre 2026 (décision du porteur). Limite acceptée : voir n° 9 ci-dessous.
- **Contexte.** Les droits sur le KMS ne suffisent pas : une base lisible par l'API publique exposerait les mots de passe chiffrés et les clés de données chiffrées.
- **Décision.** Quatre rôles de base (`cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin`) reçoivent des droits colonne par colonne (`post-roles.sql`). `cashless_app` perd la lecture de `media.pwd_pack_enc`, `media.pwd_pack_dek_id` et `tag_data_key.encrypted_dek`. **Décision n° 9 (13/10/2026)** : ces rôles héritent de `PUBLIC` le droit d'exécuter les fonctions d'API du schéma de référence, comme `cashless_platform` (ADR-80), parce que la suite de référence l'exige.
- **Conséquences.** Deux barrières indépendantes (KMS et base) protègent les mots de passe. La limite d'exécution est une dette (OP-N44), levée quand le générateur de la suite de référence n'exigera plus `EXECUTE` pour `PUBLIC`.
- **Levée d'OP-N44 (21/10/2026, mission 5a, WP07).** `post-roles.sql` retire `EXECUTE` à `PUBLIC` et l'accorde rôle
  par rôle ; `gen_tests.py` ne l'exige plus pour `PUBLIC`. Test : `tests/tests_execute_grants.sql` (listes figées par
  rôle, refus à l'appel). Limite résiduelle : OP-N68 (ADR-111).
- **Références.** SPEC §3.2, §7.4 ; `packages/ledger-sql/post-roles.sql` ; `tests/tests_media_roles.sql` ; ADR-80 ; OP-N44.

## ADR-85 — Rôle `PERSONALIZER` dédié

- **Statut** : Acceptée, 13 octobre 2026 (décision du porteur).
- **Contexte.** La personnalisation fait calculer le mot de passe de chaque bracelet ; aucun rôle existant ne devait gagner ce droit.
- **Décision.** Nouveau rôle `PERSONALIZER`, de portée prestataire, sans aucun autre droit ; seul à appeler `registerPersonalizedMedia` et `associateClaimCode` (migration 0011).
- **Conséquences.** Toute personnalisation est tracée avec son auteur. La signature d'originalité NXP est vérifiée par le poste, pas par le serveur (OP-N46).
- **Références.** SPEC §3.2, §7.5 ; `migrations/0011_personalizer_role.sql` ; OP-N46.

## ADR-86 — Mot de passe de bracelet jamais en clair hors du processus qui le calcule

- **Statut** : Acceptée, 13 octobre 2026 (décisions du porteur).
- **Contexte.** Le poste de personnalisation et le terminal ont besoin du mot de passe d'une puce ; le transmettre en clair, ou le garder en mémoire, l'exposerait.
- **Décision.**
  1. **Transport** : le mot de passe est chiffré pour une clé publique à usage unique fournie par le poste (ECDH P-256), comme pour les terminaux ; il n'est jamais conservé par le registre d'idempotence.
  2. **Cache** : une clé de données déchiffrée reste en mémoire 5 minutes au plus (réglable), effacée à l'expiration et à l'arrêt.
  3. **Décision n° 7** : la personnalisation n'a pas le droit `decrypt` ; elle scelle les mots de passe sous une clé de données de session, générée par `GenerateDataKey` et valable tant que sa version est `ACTIVE`.
  4. Tout tampon en clair est mis à zéro après usage.
- **Conséquences.** Aucun secret au repos ni dans les journaux (`media-secrets.spec.ts`). Le contrôle quotidien recalcule un échantillon et compare en temps constant (`daily-check.service.ts`).
- **Références.** SPEC §7.3, §7.4, §7.5, §7.6 ; NFR-002, NFR-003 ; `apps/api/src/media/keys/dek-cache.ts`, `session-data-key.ts`, `src/kms/zeroize.ts`.

## ADR-87 — Codes imprimés : empreinte à clé, consultation anonyme par une fonction dédiée

- **Statut** : Acceptée, 13 octobre 2026 (plan de la mission ; décision du porteur n° 8 pour la consultation).
- **Contexte.** Un code imprimé fait 50 bits : une empreinte simple se retrouverait par essais si la base fuyait. La consultation anonyme se fait sans compte, donc sans prestataire de session.
- **Décision.** Empreinte `HMAC-SHA256(CLAIM_CODE_HMAC_KEY, …)` du code et du code de confirmation ; le secret vit hors de la base, obligatoire en production (32 octets au moins). **Décision n° 8** : `public_balance_lookup` est `SECURITY DEFINER`, retirée à `PUBLIC` et accordée au seul rôle de l'API ; elle contrôle elle-même ses limites.
- **Conséquences.** Changer le secret invalide toutes les empreintes : aucune procédure de rotation
  (OP-N47 ; mission de levée proposée le 16/10/2026 : mission 10, ADR-104, à confirmer par le
  porteur).
- **Références.** SPEC §7.8, §8.5 ; ADR-36, ADR-56 ; `apps/api/src/kms/claim-hash.ts` ; `migrations/0010_media_claims.sql` ; OP-N47.

## ADR-88 — Ports et faux pour le KMS, l'identité du terminal et celle du festivalier

- **Statut** : Acceptée, 13 octobre 2026 (décisions du porteur).
- **Contexte.** L'adaptateur AWS KMS dépend de la région et des comptes (OP-N11) ; l'enrôlement des terminaux vient en mission 5, les comptes festivaliers en mission 10.
- **Décision.** La mission livre les services derrière des ports (`MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, `DeviceIdentityPort`, `CustomerIdentityPort`) avec des faux pour les tests. Aucun faux en production : chacun refuse de se construire, et la garde de démarrage refuse un processus qui en porte un (`production-guard.spec.ts`). Le changement d'implémentation d'un port ne touche pas les contrôleurs : `media-port-swap.spec.ts` remplace l'identité du terminal (lecture `POST /v1/taps`) et celle du festivalier (rattachement `POST /v1/me/media`) par des jetons signés. La bibliothèque de format est livrée en TypeScript et en Dart, prouvée en CI.
- **Conséquences.** Trois dettes nommées par cette décision : OP-N41 (KMS), OP-N42 (terminal, mission 5), OP-N43 (festivalier, mission 10). Le prompt du lot 20 en annonçait quatre : la quatrième, OP-N44 (`EXECUTE` hérité de `PUBLIC` par les rôles de base des processus des clés), relève des rôles de base distincts et est rattachée à l'ADR-84, pas à celle-ci.
- **Levée d'OP-N42 par la mission 5a (21/10/2026).** `DeviceIdentityPort` a son implémentation réelle (jeton lié,
  mTLS et signature de chaque requête, ADR-107) ; le faux n'est câblé que sous `DEVICE_IDENTITY_FAKE=1` et refusé en
  production. Tests : `test/integration/end-to-end/device-auth-matrix.spec.ts`, `test/unit/production-guard.spec.ts`,
  `device-latency.spec.ts` (un test de garde par faux). OP-N41 et OP-N43 restent ouverts (missions 7 et 10). Les
  ports de l'autorité des terminaux et du signataire des jetons n'ont que des faux : OP-N73 (ADR-119).
- **Références.** SPEC §3.2, §7.3 ; NFR-010 ; `apps/api/src/kms/`, `device-identity/`, `customer-identity/` ; OP-N41 à OP-N43.

## ADR-89 — Pas de compte de caisse avant la mission des caisses

- **Statut** : Acceptée, 13 octobre 2026 (décision du porteur n° 10).
- **Contexte.** Une caution payée à part en espèces et le rendu des espèces dues s'écrivent sur le compte de caisse du terminal ; les caisses et leurs sessions viennent avec la mission « Recharges, caisses et PSP ».
- **Décision.** La mission des bracelets ne crée aucun compte de caisse. Sans caisse ouverte pour le terminal, ces opérations répondent `409`. `cash_session_id` est facultatif tant qu'aucune session n'est servie ; cité, il est refusé (`409`).
- **Conséquences.** Aucun argent liquide n'entre sans session de caisse. À la charge de la mission 6 : créer le compte à l'ouverture d'une session, ou adapter `counter-access.ts`.
- **Références.** SPEC §7.9, §11.1 ; OP-N49 ; `apps/api/src/media/lifecycle/deposit.service.ts`, `cash-due.service.ts`.

## ADR-90 — Rattachement par code : consultation réduite, lecture consommée par la demande, activation depuis l'app

- **Statut** : Acceptée, 14 octobre 2026 (décisions du porteur n° 11, 12, 13).
- **Contexte.** Trois points du lot « rattachement par code » n'étaient pas tenables tels quels : le contrat demandait plus que la base ne rend ; `consume_tap` exige une écriture comptable ; l'activation depuis l'app figurait au contrat mais dans aucune exigence.
- **Décision.**
  1. **n° 11** : `lookupBalanceByClaimCode` est réduite à ce que rend `public_balance_lookup` (devise, solde disponible, statut, et date, type, montant des 10 derniers mouvements) ; le contrat est corrigé.
  2. **n° 12** : migration 0016, `consume_tap_for_claim` : une lecture récente du bracelet de la demande, jamais consommée par une écriture, ne confirme qu'une demande.
  3. **n° 13** : un code valide d'un bracelet jamais activé l'active sur un portefeuille du festivalier si l'événement autorise `SELF_APP`, que le lot sert un seul événement et qu'il n'a pas de caution payée à part.
  4. Pas d'énumération : un code inconnu et un code utilisé suivent le même chemin et reçoivent la même réponse ; écart des médianes de 0,1 à 0,2 ms selon les passages sur 200 + 200 essais, seuil 20 ms (`claims-timing.spec.ts` ; 0,2 ms à la répétition de CI consignée dans `.github/CI.md`).
- **Conséquences.** Limite du n° 12 : `consume_tap` ignore le lien ; une lecture qui a confirmé une demande peut encore servir à une écriture du même bracelet pendant la fenêtre de l'événement (OP-N50, `tests_media_claim_tap.sql`).
- **Levée de la limite du n° 12 (OP-N50) par la mission 5a (21/10/2026, WP05).** Migrations 0024 et 0026 :
  `consume_tap` refuse une lecture liée à une demande de rattachement ; la lecture d'une demande ne s'écrit plus
  directement. Tests : `tests/tests_consume_tap_claim.sql`, `test/integration/media/tap-claim-race.spec.ts` (course à
  deux connexions, verrou `media-tap-use:`).
- **Références.** SPEC §7.8, §8.5 ; ADR-57 ; FR-030 à FR-033, NFR-007 ; `apps/api/src/media/claims/` ; `migrations/0016_media_claim_tap.sql` ; OP-N50.

## ADR-91 — Guichet de retour : enchaînement des étapes servi par la mission 9

- **Statut** : Acceptée, 15 octobre 2026, décision du porteur (proposée le 14 octobre 2026).
- **Contexte.** `openapi.yaml` (`releaseMedia`, `settle_balance`, `refund_deposit_by`) décrit un enchaînement complet par le serveur : rendu de la caution, expiration des crédits offerts, remboursement du solde payé, restitution. Le contrat de la mission (`contracts/media-lifecycle.md`) et la consigne du lot 16 renvoyaient les étapes 2 et 3 à la mission 9. `openapi.yaml` prime sur le plan (SPEC §0.3).
- **Décision.**
  1. **La mission 9 sert l'enchaînement** des étapes du guichet de retour. Le contrat `openapi.yaml` reste juste et n'est pas réduit.
  2. D'ici là, la mission des bracelets sert la restitution sans enchaînement : `settle_balance` et `refund_deposit_by` sont refusés (`422`, règle `release.no_chaining`). Ce refus est **provisoire** et disparaît avec la mission 9 ; les refus de `release_media` nomment ce qui reste à faire.
  3. Jeton d'approbation sur place : exigé seulement au-delà de `cash_refund_single_max` (option `optional` de la garde ; la base refuse de toute façon sans valideur distinct au-delà du seuil). C'est la règle de SPEC §3.2 et §8.5 et d'ADR-53 (une seule personne jusqu'au plafond, une seconde au-delà) : **ce n'est pas un écart**.
- **Conséquences.** OP-N51 est rattaché à la mission 9 (encore ouvert, non bloquant pour la mission des bracelets). Le report figure dans `PROMPTS-A-ENVOYER.md` et `PRD.md` pour la mission 9.
- **Références.** SPEC §3.2, §7.9, §8.5 ; ADR-53 ; `apps/api/src/media/lifecycle/release.service.ts` ; `apps/api/src/approval/onsite/onsite-approval.ts` ; OP-N51.

## ADR-92 — Contrôle quotidien des mots de passe : alerte d'audit, pas d'anomalie

- **Statut** : Acceptée, 13 octobre 2026 (choix proposé au porteur et consigné dans la spécification de la mission).
- **Contexte.** La liste des sortes d'anomalie est fermée (SPEC §12.2) ; aucune ne correspond à un écart entre le mot de passe stocké et son recalcul.
- **Décision.** Un écart donne un compte rendu `MISMATCH` et une ligne d'audit par bracelet (identifiant seulement) ; une panne du service de clés donne `ERROR` et un nouvel essai au passage suivant. Un passage par prestataire et par 24 h ; `--once` rend le code de sortie 2 sur écart, pour l'ordonnanceur.
- **Conséquences.** Aucune sorte d'anomalie n'est détournée. L'alerte passe par le journal d'audit et le code de sortie.
- **Références.** SPEC §7.4, §12.2 ; FR-010 ; `apps/api/src/media/daily-check/`.

## ADR-93 — Remise en stock d'un bracelet rendu : route `reassignPoolMedia` distincte de la restitution

- **Statut** : Acceptée, 15 octobre 2026 (consigne a posteriori, décision du porteur ; route ajoutée au lot 16, commit `f0715fe`).
- **Contexte.** `contracts/media-lifecycle.md` plaçait la remise en stock d'un bracelet d'un lot réattribuable (`reassign_pool_media`) dans `releaseMedia`. La remise en stock demande une nouvelle identité écrite dans la puce, que le guichet ne connaît qu'après la restitution ; `releaseMedia` n'a pas de champ pour son empreinte.
- **Décision.** Route à part `POST /media/{media_id}/reassignment` (`reassignPoolMedia`, `x-process: public`, `openapi.yaml`) : lot `POOL` et bracelet `RELEASED` seulement (`409` sinon) ; l'empreinte `new_token_hash` (32 octets) ne doit être ni celle d'un bracelet, ni une identité passée (`409`) ; `reassign_pool_media` range l'ancienne identité dans l'historique (toute lecture qui la présente ensuite est une copie). Droits : route de guichet, rôle `CASHIER` ou `SUPERVISOR` et terminal du guichet (`counter-access.ts`), clé d'idempotence obligatoire. Audit : `MEDIA_REASSIGNED` (avant `RELEASED`, après `ISSUED`), auteur et motif `REASSIGNED` dans l'historique des statuts.
- **Conséquences.** `contracts/media-lifecycle.md` est en retard sur `openapi.yaml` pour ce point ; `openapi.yaml` prime (SPEC §0.3). Aucun changement de code.
- **Références.** SPEC §7.8 ; `apps/api/src/media/lifecycle/release.controller.ts`, `release.service.ts` ; `openapi.yaml` (`reassignPoolMedia`).

## ADR-94 — Sortie de liste noire vérifiée par la base (demande approuvée concordante)

- **Statut** : Acceptée, 15 octobre 2026, décision du porteur (lève OP-N52).
- **Contexte.** `reinstate_media` croyait le valideur qu'on lui passait ; `check_media_transition` comparait deux réglages de session posés par l'appelant. Avec la connexion de l'API, une seule personne pouvait sortir un bracelet de liste noire en inventant un valideur.
- **Décision.** Migration `0017_media_reinstate_approval.sql` (aucun fichier généré modifié) : hors de la session du propriétaire du schéma, `BLACKLISTED → ACTIVE` n'a lieu que dans `reinstate_media`, avec une `approval_request` `REINSTATE_MEDIA` APPROVED du même prestataire, pour ce bracelet et l'épisode de liste noire en cours, dont l'auteur et le valideur sont ceux de l'appel, distincts, personnes actives du prestataire, le valideur avec une attribution `SUPERVISOR` non révoquée. Une demande d'approbation naît `PENDING`, sans décision. Le droit `UPDATE (status)` de `cashless_app` sur `media` est gardé (blocage, perte) : le déclencheur ferme ce chemin pour la sortie de liste noire.
- **Complément du 15/10/2026 (lot 20, cycle 4, relecture du cycle 3 ; renforcement, `post-roles.sql`).** La règle « demande liée à l'épisode en cours » se lit dans `media_status_history`, que `cashless_app` pouvait modifier (`GRANT INSERT, UPDATE ON ALL TABLES` de `roles.sql`) : en masquant la dernière mise en liste noire, une session de l'API rendait « concordante » la demande APPROVED d'un épisode passé. Et `media_transition`, sans RLS, lui était ouverte en écriture : ajouter `BLACKLISTED → ISSUED` puis passer `ISSUED → ACTIVE` sortait un bracelet de liste noire sans aucune demande, chez tous les prestataires. Retirés à `cashless_app` : `UPDATE` (et `DELETE`, `TRUNCATE`, déjà retirés par `roles.sql`, redits) sur `media_status_history`, `media_batch_status_history`, `media_identity_history` ; `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` sur les règles de passage `media_transition`, `media_batch_transition`, `event_status_transition`, `handover_transition` ; `UPDATE` sur `claim_code` et `media_claim` réduit aux colonnes que changent les fonctions de la migration 0010. `INSERT` retiré aussi sur `media_identity_history` (écrite par `reassign_pool_media`, SECURITY DEFINER, seule). `INSERT` sur `media_status_history` et `media_batch_status_history` était encore gardé à ce cycle : corrigé au cycle 5 (complément suivant). Aucun code de l'API ni aucune fonction à droits de l'appelant ne modifie ces tables. Tests : `tests/tests_media_reinstate.sql` (UPDATE et DELETE refusés, réutilisation d'une demande d'un épisode passé refusée après la tentative de masquer l'historique, détour par un autre état refusé, liste exacte des droits) ; contrôle du contrôle : le `GRANT` rétabli, la suite échoue (bracelet repassé `ACTIVE`).
- **Complément du 15/10/2026 (lot 20, cycle 5, relecture du cycle 4 ; option A retenue par l'orchestrateur ; renforcement).** L'`INSERT` gardé sur `media_status_history` rouvrait la réutilisation : une session de l'API plantait une fausse ligne `ACTIVE → BLACKLISTED` d'identifiant très grand (`bigserial`, valeur explicite acceptée) ; `media_reinstatement_approved` prenant le `max(id)` pour épisode en cours, la demande APPROVED calculée sur cette ligne restait concordante après une nouvelle mise en liste noire, et le bracelet ressortait sans nouvelle demande ni décision. Migration `0018_status_history_definer.sql` : `log_media_status` et `log_batch_status` passent en `SECURITY DEFINER SET search_path = public` (`ALTER FUNCTION`, aucun fichier généré modifié). `post-roles.sql` retire alors à `cashless_app` `INSERT` sur `media_status_history` et `media_batch_status_history`, et à `cashless_perso` `INSERT` sur `media_status_history` (et l'usage de sa séquence). Même défaut, même traitement, sur deux autres tables où la base lit « le dernier état » et où l'API pouvait écrire : `media_assignment` (écrite par `log_media_status` et des fonctions SECURITY DEFINER ; son nombre de lignes forme les clés d'idempotence `preload:`, `deposit:`, `deposit-refund:`, et sa ligne ouverte désigne le portefeuille débité par `media_wallet`) : `INSERT` et `UPDATE` retirés ; `device_config_served` (écrite par `record_config_served`, SECURITY DEFINER ; dernière ligne relue comme configuration en cours, plafonds lus par `policy_in_force`) : `INSERT` retiré. `migrate.ts` applique désormais `roles.sql`, `post-roles.sql` et les mots de passe dans une seule transaction : plus d'intervalle où `cashless_app` retrouve `INSERT` et `UPDATE` sur tout. Tests (`tests/tests_media_reinstate.sql`) : fonctions SECURITY DEFINER avec `search_path` ; `INSERT` direct dans les deux historiques refusé (42501) ; scénario de la relecture rejoué (ligne plantée refusée, demande de l'épisode 2 exécutée, nouvel épisode, réutilisation refusée, bracelet `BLACKLISTED`) ; passages normaux depuis `cashless_app` : historiques des bracelets et des lots toujours écrits ; `INSERT`/`UPDATE` sur `media_assignment` refusés ; liste exacte des droits d'écriture de tous les rôles de l'application sur ces quatre tables. Contrôle du contrôle : `INSERT` rendu sur `media_status_history`, la suite échoue (épisode figé à 9 000 000 000 000 000, bracelet repassé `ACTIVE`) ; idem avec `INSERT` sur `media_batch_status_history` ou `media_assignment`, `INSERT` sur `device_config_served`, ou `log_media_status` remise en SECURITY INVOKER. Relevés sans être modifiés, faiblesses du kit antérieures à la mission : `offline_snapshot` et `offline_policy_history`, consignés au cycle 6 en **OP-N57** et **OP-N58** (complément suivant).
- **Complément du 15/10/2026 (lot 20, cycle 6, relecture du cycle 5 ; décision de l'orchestrateur ; renforcement, `post-roles.sql`).** Constat 1 de la relecture : le passage de `log_media_status` en SECURITY DEFINER élargissait les droits de `cashless_perso`. Ce rôle gardait `INSERT` sur toutes les colonnes de `media`, `wallet_id` et `status` compris ; avant 0018, un bracelet inséré avec un portefeuille échouait (`permission denied for table media_assignment`) ; après 0018, le déclencheur ouvrait le rattachement avec les droits du propriétaire. Le processus de personnalisation pouvait donc créer un bracelet `ACTIVE`, d'identité choisie (`token_hash`, `nfc_uid`), rattaché au portefeuille existant d'un festivalier (d'un autre prestataire sur le poste local, où le propriétaire est superutilisateur), sans passer par `activate_media`. Cet élargissement n'avait été ni soumis ni consigné au cycle 5 (règle 1 de `CLAUDE.md`) : il est fermé ici. Correction : (1) `INSERT` de `cashless_perso` sur `media` réduit aux treize colonnes que fixe `register_personalized_media` (0013) : `id`, `operator_id`, `kind`, `token_hash`, `nfc_uid`, `key_index`, `signature_ok`, `originality_sig_sha256`, `batch_id`, `status`, `personalized_at`, `pwd_pack_enc`, `pwd_pack_dek_id` ; les autres prennent leur défaut (portefeuille absent, caution `NONE`, aucun code) ; (2) politique restrictive nommée `perso_media_insert` (`FOR INSERT TO cashless_perso`) : `status = 'PERSONALIZED'`, `wallet_id IS NULL`, `kind = 'NFC_TAG'`, `signature_ok IS TRUE`, lot, date de personnalisation et chiffré présents, et toutes les autres colonnes à leur valeur initiale. Le chemin légitime est inchangé. **Rectification du cycle 7** (relecture du cycle 6, constat 1) : cette borne ne portait que sur le statut et les valeurs initiales, **pas** sur le lot ni la clé de données ; l'`INSERT` direct restant contournait tous les contrôles de `register_personalized_media` (lot actif, lot ou clé de données d'un autre prestataire, lot plein). L'affirmation « la personnalisation n'insère que des bracelets neufs de son lot en préparation » était donc plus forte que la réalité jusqu'au cycle 7 ; voir le complément suivant. **Relevé des autres rôles** (catalogue, base de test après `reset-db`) : les deux déclencheurs passés en SECURITY DEFINER portent sur `media` (`AFTER INSERT OR UPDATE OF status`) et `media_batch` (même forme). Écrivains de ces tables : `cashless_app` a `UPDATE (status, claim_code_hash, claim_code_used_at, claim_attempts)` sur `media` (un `UPDATE` n'ouvre aucun rattachement, et il avait `INSERT` sur `media_status_history` avant 0018 : rien de nouveau) et `INSERT`, `UPDATE` sur `media_batch` (il avait `INSERT` sur `media_batch_status_history` avant 0018 : rien de nouveau) ; `cashless_tagkeys` a `UPDATE (pwd_pack_enc, pwd_pack_dek_id)` et `cashless_perso` `UPDATE (claim_code_hash)` sur `media`, qui ne déclenchent pas `UPDATE OF status` ; `cashless_tagcheck`, `cashless_keyadmin` et `cashless_platform` n'écrivent ni `media` ni `media_batch`. Seul `cashless_perso` tirait donc de 0018 une écriture qu'il n'avait pas. Les autres fonctions de déclencheur SECURITY DEFINER de la base l'étaient avant la mission ; leur liste est figée par un test. Tests : `tests/tests_definer_trigger_writers.sql`, joué depuis `cashless_perso` : scénario de la relecture (bracelet `ACTIVE` sur le portefeuille d'un autre prestataire) refusé, et de même `ACTIVE` ou `ISSUED` sur un portefeuille du même prestataire, bracelet en stock avec portefeuille, `ISSUED` sans portefeuille, signature invalide, caution posée ; aucune ligne `media` ni `media_assignment` créée ; `register_personalized_media` passe, avec son historique et sans rattachement ; forme exacte de la politique et des droits par colonne ; liste exacte des droits d'écriture des rôles `cashless_*` sur `media` et `media_batch` ; liste exacte des fonctions de déclencheur SECURITY DEFINER. Contrôle du contrôle : politique retirée → tests 5, 6, 9, 14, 15 en échec ; `INSERT` rendu sur toute la table → tests 16, 18 en échec ; les deux → 13 tests en échec, dont le scénario de la relecture (1) et l'absence de rattachement (10) ; `log_media_status` remise en SECURITY INVOKER → le chemin légitime échoue (8, 11, 12). Remarque 1 de la relecture (consignée sans changement de comportement, les tables appartenant à la mission 7) : **OP-N57** (`offline_snapshot`, version plantée, déni de service hors ligne) et **OP-N58** (`offline_policy_history`, trace falsifiable) ; même fichier de tests : droits d'écriture actuels des rôles `cashless_*` sur ces deux tables figés (`INSERT` et `UPDATE` de `cashless_app` seulement, aucune suppression) ; contrôle du contrôle : `INSERT` rendu à `cashless_perso` sur `offline_snapshot` → test 20 en échec ; `DELETE` rendu à `cashless_app` sur `offline_policy_history` → test 21 en échec. Remarque 2 : attribution de l'historique (`actor_id`, `approved_by`, `reason` lus dans des réglages de session fixés par l'appelant) ajoutée à OP-N56.
- **Complément du 15/10/2026 (lot 20, cycle 7, relecture du cycle 6 ; décision du porteur, option B ; renforcement, migration `0019_personalization_definer.sql`, `post-roles.sql`).** Constat 1 de la relecture : l'`INSERT` direct de `cashless_perso` dans `media`, même borné au cycle 6, ne vérifiait ni le lot ni la clé de données (variantes V1 à V4 : lot `ACTIVE`, lot d'un autre prestataire, clé de données d'un autre prestataire, lot plein, toutes acceptées en direct). Correction : `register_personalized_media` passe en SECURITY DEFINER ; tous ses contrôles nomment le prestataire de la session (`app.operator_id`) et aucun ne dépend de la RLS, qui ne s'applique pas dans la fonction avec un propriétaire superutilisateur : lot du prestataire, statut `ORDERED`/`PERSONALIZED`, verrouillé `FOR SHARE` jusqu'à la fin de la transaction (renforcement : un passage concurrent du lot attend), quantité comptée sur tous les bracelets du lot sous le verrou consultatif, clé du lot `ACTIVE`, clé de données du prestataire, même index, `ACTIVE`. `EXECUTE` retiré à `PUBLIC` et à `cashless_app` (que `roles.sql` réaccorde sur toutes les fonctions), accordé à `cashless_perso` seul ; `cashless_perso` perd tout droit d'écriture sur `media` ; la politique `perso_media_insert` et l'`INSERT` par colonne du cycle 6 sont retirés (plus de droit à borner). **Autres fonctions traitées** (même défaut, recherche demandée par le porteur) : `associate_claim_code` (0010) contrôlait l'association d'un code (code du prestataire, même lot que le bracelet, ni invalidé ni déjà associé, bracelet sans code) que `cashless_perso` (`UPDATE (claim_code_hash)` sur `media`, `UPDATE (media_id, associated_at)` sur `claim_code`) et `cashless_app` (mêmes colonnes) pouvaient faire en direct ; elle passe en SECURITY DEFINER, `EXECUTE` retiré à `PUBLIC` et accordé à ses deux appelants légitimes, `cashless_perso` (poste de personnalisation) et `cashless_app` (import du fichier de l'imprimeur, `claim-codes.service.ts`), et ces quatre droits par colonne sont retirés (`cashless_app` garde `UPDATE (invalidated_at)` pour `invalidate_unassociated_codes`). Le processus de personnalisation (`apps/api/src/media/personalization/**`) n'appelle que les deux fonctions, jamais d'`INSERT` ni d'`UPDATE` direct sur `media` ou `claim_code` ; sa lecture préalable du code perd son `FOR UPDATE` (qui exigeait un droit `UPDATE`) : la fonction verrouille et refait les contrôles, et un refus concurrent est rendu comme motif (point de sauvegarde, comme l'import de l'imprimeur). Fonctions examinées sans changement : `claim_tag_key_job`, `finish_tag_key_job`, `retry_tag_key_job` (un processus qui peut contourner leurs contrôles par `UPDATE` direct ne touche que les travaux de ses propres sortes, bornés par politique, qu'il exécute lui-même) ; écritures directes par conception des processus (`tag_data_key` par la personnalisation, rechiffrement par `cashless_tagkeys`, `tag_key` par la commande d'administration), sans fonction de contrôle. **Signalés au porteur, non corrigés** : OP-N59 (tables masquées par une table temporaire dans les fonctions SECURITY DEFINER) et OP-N60 (écritures directes de `cashless_app` sur `media_batch` et le statut de `media`). **Écart au texte de la décision, plus strict** : `search_path = public, pg_temp` au lieu de `public` (sans `pg_temp` en dernier, une table temporaire de l'appelant masquait `media_batch` ou `tag_data_key` et faisait passer tous les contrôles) ; appliqué aussi à `log_media_status` et `log_batch_status` (0018). Tests : `tests/tests_personalization_definer.sql` (depuis `cashless_perso` : V1 à V4 refusées en direct, 42501, et par la fonction, avec leur code d'erreur ; chemin légitime ; session sans prestataire ou d'un autre prestataire ; tables temporaires ignorées ; association : refus directs, chemin légitime, code déjà associé, invalidé, d'un autre lot ; depuis `cashless_app` : fonctions et écritures directes refusées ; forme exacte : SECURITY DEFINER, `search_path`, `EXECUTE` par rôle, aucun droit d'écriture de `cashless_perso`), `tests_definer_trigger_writers.sql`, `tests_media_api.sql`, `tests_media_claims.sql`, `tests_media_roles.sql`, `tests_media_reinstate.sql` mis à jour. Contrôle du contrôle (`tests_personalization_definer.sql`, base remise à zéro avant chaque essai) : droits directs rendus (`INSERT` sur `media`, `UPDATE` sur `claim_code` et `claim_code_hash`) → tests 3-5, 7, 16-19, 24-29, 33, 35 en échec ; `search_path = public` → 1, 2 (tables temporaires) et 31 ; contrôle du prestataire de la clé de données retiré → 2, 10, 28 ; contrôle du prestataire du lot retiré → 9, 13, 28 ; `EXECUTE` à `cashless_app` → 23, 28, 32 ; contrôle de quantité retiré → 11, 28 ; contrôle du statut du lot retiré → 1, 8, 28 ; fonction remise en SECURITY INVOKER → chemin légitime en échec (suite interrompue) ; base propre → `ok`.
- **Complément du 15/10/2026 (lot 20, cycle 8, relecture du cycle 7 ; correction d'un défaut du cycle 7, sans changement de droit).** Constat 1 : quand `associate_claim_code` refusait après un contrôle préalable passé (écriture concurrente, par exemple une invalidation à la clôture), le motif inscrit à l'audit était toujours `CLAIM_CODE_ALREADY_ASSOCIATED`. Après le retour au point de sauvegarde, le motif est désormais relu (`refusal()`, READ COMMITTED : la nouvelle lecture voit l'écriture validée), `CLAIM_CODE_ALREADY_ASSOCIATED` restant le dernier recours ; même correction dans l'import du fichier de l'imprimeur (`claim-codes.service.ts`, correspondance fixe héritée du WP12). Tests : `personalization.spec.ts` et `claim-code-order.spec.ts` (code invalidé dans une transaction concurrente validée pendant que la fonction attend son verrou : motif `CLAIM_CODE_INVALIDATED`) ; `tests_personalization_definer.sql` (code d'un autre prestataire : `CLAIM_CODE_UNKNOWN`, ce qui détecte le retrait du filtre de prestataire sur `claim_code`). OP-N59 et OP-N60 tranchés par le porteur : ADR-96 et ADR-97.
- **Conséquences.** La session du propriétaire garde la seule règle du schéma de référence (suites du kit inchangées ; l'API ne se connecte jamais sous ce rôle). Limite restante, consignée en **OP-N56** : la base n'authentifie pas une personne ; une session de l'API compromise peut encore faire décider une demande au nom d'un vrai superviseur du prestataire (`decide_approval_request` croit le valideur qu'on lui passe). Levée par la mission 11 avec le serveur d'identité réel (preuve de décision signée, vérifiée hors de la session de l'API). Tests : `tests/tests_media_reinstate.sql`, `blacklist.spec.ts`.
- **Références.** SPEC §7.8 ; FR-035 ; OP-N52 ; OP-N56 ; OP-N57 ; OP-N58 ; OP-N59 ; OP-N60 ; ADR-74 ; `apps/api/src/media/blacklist/blacklist-approval-actions.ts` ; `packages/ledger-sql/post-roles.sql`.

## ADR-95 — Adresse du client : `trust proxy` borné par `TRUST_PROXY_HOPS`, obligatoire en production

- **Statut** : Acceptée, 15 octobre 2026, décision du porteur (lève OP-N53).
- **Contexte.** La limite de la consultation anonyme (60 par adresse et par heure) et l'origine de l'audit reposent sur `req.ip`, sans réglage `trust proxy` : derrière un répartiteur, tous les clients ont la même adresse ; sans borne, `X-Forwarded-For` est falsifiable.
- **Décision.** `TRUST_PROXY_HOPS`, entier de 0 à 5, lu par `loadConfig` et posé par `applyTrustProxy` au démarrage de chaque processus HTTP (`trust proxy` = nombre de sauts ; 0 = aucun). En production, une valeur absente fait refuser le démarrage, sans défaut ; hors production, 0 par défaut.
- **Conséquences.** L'exploitation doit fixer la valeur exacte du déploiement (`.github/CI.md`). Tests : `claims-address-limit.spec.ts` (61ᵉ consultation → 429, deux adresses comptées à part, `X-Forwarded-For` falsifié sans effet), `config.spec.ts`, `processes.spec.ts` (refus de démarrer).
- **Références.** OP-N53 ; contrat `lookupBalanceByClaimCode` ; `apps/api/src/config/config.ts` ; `apps/api/src/processes/bootstrap.ts`.

## ADR-96 — Fonctions SECURITY DEFINER sans `pg_temp` : limite acceptée jusqu'à la mission 5 (OP-N59)

- **Statut** : Acceptée, 15 octobre 2026, décision du porteur (relecture du lot 20, cycle 7, constat 2). Dette nommée
  (règle 3 de `CLAUDE.md`) ; **bloque la production**.
- **Contexte.** 77 fonctions SECURITY DEFINER du schéma `public` (81 au total ; 4 corrigées par la migration 0019) fixent
  `search_path = public` sans `pg_temp`. PostgreSQL cherche alors d'abord dans le schéma temporaire de la session, et
  tous les rôles `cashless_*` peuvent créer des tables temporaires (droit `TEMP` de `PUBLIC`). Parmi elles,
  `tenant_of_ledger`, `tenant_of_media`, `tenant_of_wallet`, `tenant_of_batch`, `tenant_of_event`, `tenant_of_device` et
  `tenant_of_gateway` lisent une table pour trouver le prestataire d'un objet et alimentent `assert_tenant` (SECURITY
  INVOKER) dans les fonctions qui déplacent de l'argent ou changent un bracelet (`post_transaction` :
  `assert_tenant(tenant_of_ledger(p_ledger))`).
- **Risque.** Contournement probable du cloisonnement entre prestataires par une session compromise (table temporaire
  qui fait rendre le prestataire de la session pour l'objet d'un autre). Non démontré de bout en bout ; démontré pour
  l'historique des statuts avant 0019 (OP-N59).
- **Décision.** Limite consignée, non corrigée dans la mission 4 (antérieure à la mission, la correction touche le
  schéma de référence au-delà du lot 20). **Mission qui la lève : mission 5** (prochaine mission qui touche la base) :
  retirer `TEMPORARY` aux rôles applicatifs, ou passer toutes ces fonctions à `search_path = public, pg_temp`, ou les
  deux. **Condition de levée** : test pgTAP montrant qu'une table temporaire de l'appelant est sans effet sur un
  `tenant_of_*`, ou que la création de table temporaire est refusée à chaque rôle `cashless_*`.
- **Conséquences.** Test qui fige la limite : `tests/tests_definer_trigger_writers.sql`, section 4 (au plus 77
  fonctions SECURITY DEFINER sans `pg_temp` ; une nouvelle fonction fixe `search_path = public, pg_temp`). Contrôle du
  contrôle : une fonction SECURITY DEFINER de plus avec `search_path = public` fait échouer le test. Report dans
  `PROMPTS-A-ENVOYER.md` (mission 5) et `PRD.md` (héritages de la mission 4).
- **Levée par la mission 5a (21/10/2026, WP02 et WP07 ; options A et B).** Migration 0021 (`search_path = public,
  pg_temp` sur toute fonction SECURITY DEFINER du schéma `public`) et `TEMPORARY` retiré à `PUBLIC` et aux rôles
  `cashless_*`. Tests : `tests/tests_definer_search_path.sql`, `tests/tests_device_rights.sql` §5,
  `tests/tests_definer_trigger_writers.sql` §4 (égalité à 0). OP-N59 tranché.
- **Références.** OP-N59 ; ADR-94 (complément du cycle 7) ; `packages/ledger-sql/migrations/0019_personalization_definer.sql`.

## ADR-97 — Écritures directes de `cashless_app` sur `media_batch` : limite acceptée jusqu'à la mission 11 (OP-N60)

- **Statut** : Acceptée, 15 octobre 2026, décision du porteur (relecture du lot 20, cycle 7, constat 2). Dette nommée
  (règle 3 de `CLAUDE.md`) ; **bloque la production**.
- **Contexte.** `roles.sql` accorde `INSERT` et `UPDATE` sur toutes les tables à `cashless_app`, et `post-roles.sql` ne
  les borne pas sur `media_batch` (toutes les colonnes). L'API crée un lot par `INSERT` direct
  (`apps/api/src/media/batches/batches.service.ts:68`) et change son statut par `set_media_batch_status` et `close_batch`.
- **Risque.** Une session de l'API compromise peut insérer un lot directement au statut `ACTIVE` ou `CLOSED` (vérifié :
  `INSERT 0 1`), passer un lot à `CLOSED` sans `close_batch` (sans acquérir les cautions ni retirer les bracelets),
  changer sa quantité, son index de clé, son organisateur ou son événement, et changer le statut d'un bracelet sans
  motif (`UPDATE (status)` de `media`). La RLS borne tout cela au prestataire de la session.
- **Décision.** Limite consignée, non corrigée dans la mission 4 (la correction change la création des lots et des
  routes de l'API hors du lot 20 ; aucun droit de la base n'est changé dans ce cycle). **Mission qui la lève :
  mission 11** (back-office), qui reprend la gestion des lots. **Condition de levée** : création par une fonction qui
  impose `ORDERED` (ou politique restrictive), `UPDATE` de `media_batch` borné, `media_set_status` seul chemin du
  statut d'un bracelet ; test pgTAP depuis `cashless_app` : lot inséré en `ACTIVE` ou `CLOSED`, clôture directe,
  changement de quantité et statut de bracelet sans motif refusés.
- **Conséquences.** Test qui fige la limite : `tests/tests_definer_trigger_writers.sql`, section 4 (droits de
  `cashless_app` sur `media_batch` colonne par colonne : `INSERT`, `SELECT`, `UPDATE` ; aucune suppression). Contrôle
  du contrôle : un droit `DELETE`, ou une colonne ajoutée avec un droit, fait échouer le test. Report dans
  `PROMPTS-A-ENVOYER.md` (mission 11) et `PRD.md` (héritages de la mission 4).
- **Références.** OP-N60 ; ADR-94 (complément du cycle 7) ; `packages/ledger-sql/post-roles.sql`.

## ADR-98 — Traitements par tranches : preuve sur 5 000 bracelets reportée à la mission 13 (OP-N61)

- **Statut** : Acceptée, 15 octobre 2026, décision du porteur (vérification d'acceptation de la mission 4, NFR-008 en
  échec). Dette nommée (règle 3 de `CLAUDE.md`) ; **bloque la production**.
- **Contexte.** NFR-008 demande que la clôture d'un lot, le rattrapage du préchargement et le rechiffrement traitent au
  plus 500 bracelets par tranche, soient relançables sans double effet et aillent au bout sur un lot de 5 000
  bracelets. Prouvé : clôture sur 600 cautions avec deux relances (`batches.spec.ts`), rechiffrement de 1 200
  bracelets en 3 tranches avec reprise (`data-keys.spec.ts`). Non prouvé : le lot de 5 000, et le rattrapage du
  préchargement au-delà de 3 bracelets (`PRELOAD_SLICE` jamais atteint).
- **Risque.** Un traitement qui n'irait pas au bout sur un gros lot en exploitation (durée, `transaction_timeout`,
  verrous) : lot bloqué à mi-chemin, cautions non acquises, bracelets restés sous l'ancienne clé de données.
- **Décision.** Écart consigné, sans test supplémentaire dans la mission 4. **Mission qui le lève : mission 13**
  (recette V1), sur l'environnement de charge. **Condition de levée** : les trois traitements vont au bout sur un lot
  de 5 000 bracelets, le rattrapage du préchargement sur plus d'une tranche, avec au moins une relance sans double
  effet ; durées consignées dans le rapport de recette.
- **Conséquences.** Pas de test qui fige la limite : c'est un manque de preuve, pas un droit ni un contrôle qui
  pourrait s'élargir ; `batches.spec.ts` et `data-keys.spec.ts` échouent déjà si le découpage ou la reprise
  régressent. Report dans `PROMPTS-A-ENVOYER.md` (mission 13) et `PRD.md` (héritages de la mission 4).
- **Références.** OP-N61 ; NFR-008 (`kitty-specs/bracelets-nfc-01M4TD3W/spec.md`) ; `acceptance-matrix.json` ;
  `apps/api/src/media/batches/batches.service.ts` (`FORFEIT_SLICE`, `PRELOAD_SLICE`).

## ADR-99 — Empreinte de requête sans clé au registre d'idempotence : limite acceptée jusqu'à la mission 5 (OP-N54)

- **Statut** : Acceptée. Limite consignée le 14/10/2026 (constat des relectures indépendantes, sans
  changement de code) ; mission de levée (mission 5) **confirmée par le porteur le 15/10/2026**.
  Dette nommée.
- **Contexte.** Le registre d'idempotence (`api_idempotency`) garde `request_hash`, empreinte SHA-256 sans clé de la
  requête. Pour le rattachement par code, la requête contient le code imprimé (50 bits).
- **Risque.** Une fuite de la base permet de retrouver un code par essais hors ligne (calcul lourd mais faisable), puis
  de rattacher ou de consulter le bracelet correspondant.
- **En place.** Le code lui-même n'est jamais conservé ; les codes de confirmation ne sont plus conservés (route
  `transient`) ; l'empreinte des codes en base est à clé (ADR-87).
- **Décision.** Limite conservée dans la mission 4 (le registre est un mécanisme transverse de la mission 1).
  **Mission qui la lève : mission 5**, prochaine mission de paiement, qui ajoute des routes au registre.
  **Condition de levée** : `request_hash` à clé (HMAC, secret hors de la base), ou champs secrets exclus de
  l'empreinte des routes qui les portent ; test : l'empreinte ne se recalcule pas à partir du code seul.
- **Conséquences.** Test qui échoue si la limite s'élargit (code conservé en clair, en hexadécimal ou en base64) :
  `apps/api/test/integration/end-to-end/media-secrets.spec.ts`. Report dans `PROMPTS-A-ENVOYER.md` (mission 5) et
  `PRD.md` (héritages de la mission 4).
- **Levée par la mission 5a (21/10/2026, WP13 et WP18).** `request_hash` et l'empreinte de personnalisation sont des
  HMAC sous `IDEMPOTENCY_HMAC_KEY`. Tests : `test/unit/idempotency/request-hash.spec.ts`,
  `test/unit/media/personalization-hash.spec.ts`, `test/integration/media/personalization.spec.ts` (« registre
  d'idempotence : empreinte à clé… (OP-N54) »). Consigne de déploiement (décision du porteur du 21/10/2026) : purge
  des lignes `api_idempotency` antérieures par le propriétaire à T + `IDEMPOTENCY_TTL_HOURS` (720 h), compte nul
  vérifié ensuite (`POINTS_OUVERTS.md`, OP-N54). OP-N54 tranché.
- **Références.** OP-N54 ; ADR-79 ; ADR-87 ; `apps/api/src/idempotency/`.

## ADR-100 — Espèces dues d'un bracelet remplacé : limite acceptée jusqu'à la mission 9 (OP-N55)

- **Statut** : Acceptée, 15 octobre 2026 (limite consignée le 14/10/2026 ; mission 9 déjà nommée dans la fiche et
  reportée au checkout principal). Dette nommée.
- **Contexte.** `replace_media` fait suivre la caution au bracelet neuf, mais pas les espèces dues (anomalies
  `CASH_TOPUP_OVER_LIMIT`) de l'ancien ; le rendu des espèces dues est refusé sur un bracelet `REPLACED`.
- **Risque.** Un festivalier dont le bracelet a été remplacé ne peut plus se faire rendre ses espèces dues au guichet.
  Aucune perte comptable : la dette reste au grand livre (`L-ESP-A-RENDRE`).
- **Décision.** Limite conservée dans la mission 4. **Mission qui la lève : mission 9** (remboursements, guichet de
  retour). **Condition de levée** : anomalies reportées au bracelet neuf par `replace_media` (migration), ou rendu au
  back-office sur décision de deux personnes ; test : espèces dues d'un bracelet remplacé rendues une fois, et une
  seule.
- **Conséquences.** Aucun test ne fige ce manque : c'est une opération absente, pas un droit qui peut s'élargir ; la
  dette est tenue par le grand livre. Report dans `PROMPTS-A-ENVOYER.md` (mission 9) et `PRD.md` (héritages de la
  mission 4).
- **Références.** OP-N55 ; ADR-63 ; `apps/api/test/integration/media/cash-due.spec.ts`, `replace.spec.ts`.

## ADR-101 — Missions de levée d'OP-N41, OP-N44, OP-N45, OP-N46 et OP-N50

- **Statut** : Acceptée, 15 octobre 2026 : missions proposées par l'agent (lot 20, cycle 9), confirmées par le porteur le même jour.
- **Contexte.** Règle 3 de `CLAUDE.md` : chaque écart accepté nomme la mission du découpage qui le lève. Ces cinq
  points nommaient le porteur ou l'exploitation. Les décisions de fond restent celles d'ADR-83, ADR-84, ADR-85,
  ADR-88 et ADR-90 ; seule la mission de levée est fixée ici.
- **Décision** (proposée par l'agent, confirmée par le porteur le 15/10/2026).
  - OP-N41 (KMS factice, ADR-88) → **mission 7** : première mission qui a besoin d'un vrai KMS hors bracelets
    (signature des snapshots, OP-N13) ; adaptateur AWS des ports `MacPort`, `DataKeyPort`, `DecryptPort`,
    `KeyAdminPort` écrit avec celui de la signature, après OP-N11.
  - OP-N44 (`EXECUTE` hérité de `PUBLIC`, ADR-84) → **mission 5** : même correction de droits sur les fonctions du
    schéma de référence qu'OP-N59 (ADR-96), dans `post-roles.sql` et le générateur `gen_tests.py`.
  - OP-N45 (aiguillage des routes, ADR-83) → **mission 13** : relève du déploiement ; la recette V1 monte
    l'environnement proche de la production et y passe le cloisonnement sur toutes les routes.
  - OP-N46 (signature NXP vérifiée par le poste, ADR-85) → **mission 12** : lancée après la validation de la puce sur
    de vrais bracelets, qui fournit la clé publique NXP et des signatures réelles ; décision avec l'auditeur sécurité
    (ADR-44).
  - OP-N50 (lecture d'une demande encore utilisable par `consume_tap`, ADR-90) → **mission 5** : elle sert le
    paiement par `consume_tap`.
- **Conséquences.** Les conditions de levée et les tests qui bornent les limites restent ceux d'OP-N41 à OP-N50.
  Reports dans `PROMPTS-A-ENVOYER.md` (missions 5, 7, 12, 13) et `PRD.md` (héritages de la
  mission 4).
- **Suites (21/10/2026).** OP-N44 et OP-N50 levés par la mission 5a (ADR-84, ADR-90 ; `tests_execute_grants.sql`,
  `tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts`). OP-N41, OP-N45 et OP-N46 restent confiés aux missions 7,
  13 et 12.
- **Références.** OP-N41, OP-N44, OP-N45, OP-N46, OP-N50 ; ADR-83 à ADR-85, ADR-88, ADR-90, ADR-96.

## ADR-102 — Travaux de clé : demande approuvée à deux exigée par la base et par les exécutants

- **Statut** : Acceptée, 16 octobre 2026 (décision du porteur sur le constat SEC-1 de la revue
  post-fusion de la mission 4 : corriger à la fois dans la base et dans les programmes qui exécutent
  les travaux). Correctif post-fusion n° 1
  (`kitty-specs/bracelets-nfc-01M4TD3W/post-merge-fix-1.md`).
- **Contexte.** ADR-83 et SC-007 : aucune création, rotation ni aucun retrait de clé sans deux
  personnes. La règle n'était tenue que par l'API publique : `cashless_app` gardait `INSERT` sur
  `tag_key_job` (`post-roles.sql` ne bornait que `UPDATE`), `cashless_perso` y insérait librement,
  et ni `KeyAdminWorker` ni `DekWorker` ni `ReencryptWorker` ne relisaient la demande. La revue a
  démontré qu'un `DISABLE_KMS_KEY` inséré par `cashless_app` sur la clé partagée ACTIVE était pris
  par la commande d'administration. `retire_dedicated_key` (schéma de référence, SECURITY DEFINER)
  restait de plus exécutable par l'API (EXECUTE hérité de `PUBLIC`).
- **Cycle de vie vérifié** (code et SPEC §3.2). Une demande naît `PENDING` ;
  `decide_approval_request` la passe `APPROVED` (valideur ≠ auteur) ; l'API exécute l'action dans la
  même transaction, puis passe la demande `EXECUTED` avec son résultat (le travail, `job_id` et
  `key_index`), ou `FAILED`. Correspondance : `TAG_KEY_CREATE` → `CREATE_KEY`, `TAG_DEK_ROTATE` →
  `ROTATE_DEK`, `TAG_KEY_RETIRE` → `RETIRE_KEY`. Les travaux internes (`REENCRYPT` après
  `ROTATE_DEK`, `DISABLE_KMS_KEY` après `RETIRE_KEY`) sont inscrits par la personnalisation pendant
  l'exécution du travail parent, sous la même demande ; aucun autre travail n'existe (pas de travail
  sans demande dans le code).
- **Décision.**
  1. Base (migration `0020_tag_key_job_approval.sql`, `post-roles.sql`) : plus aucun `INSERT` direct
     sur `tag_key_job` pour un rôle applicatif ou un processus. `enqueue_tag_key_job(demande)` (API,
     demande `APPROVED`) et `enqueue_tag_key_child_job(parent, clé cible)` (personnalisation, parent
     `RUNNING`, demande `EXECUTED` dont le résultat désigne ce parent) fixent elles-mêmes la sorte,
     l'index, la charge utile, l'auteur et le valideur ; contrôles : prestataire de la session,
     action et objet concordants, auteur ≠ valideur, tous deux `OPERATOR_ADMIN` actifs du
     prestataire, demande jamais consommée (index uniques), désactivation d'une clé `RETIRED`
     seulement. SECURITY DEFINER, `search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`,
     `EXECUTE` aux seuls appelants légitimes, contrôles de prestataire explicites (aucun appui sur
     la RLS). `retire_dedicated_key` : `EXECUTE` retiré à `PUBLIC` et à l'API, accordé à la
     personnalisation.
  2. Programmes : les trois exécutants appellent `tag_key_job_refusal(travail)` (`TagKeyJobGate`)
     juste après la prise et avant tout appel au KMS : demande `EXECUTED` dont le résultat désigne
     ce travail (ou son parent), même action, même objet, mêmes paramètres et mêmes personnes,
     parent terminé, clé `RETIRED` pour une désactivation. Un travail refusé passe `FAILED` avec son
     motif, une ligne d'audit `TAG_KEY_JOB_REFUSED` est écrite, et le processus lève son code
     d'alerte (4). `disableKey` refuse aussi lui-même une clé qui n'est pas `RETIRED`.
- **Conséquences.** Une session de l'API compromise ne peut plus inscrire un travail sans demande,
  ni avec une demande d'une autre action, d'un autre objet, d'un autre prestataire, refusée ou déjà
  consommée, ni retirer une clé dédiée directement. Limites restantes : OP-N56 (la base
  n'authentifie pas qui décide une demande ; une session compromise peut faire décider au nom d'un
  second `OPERATOR_ADMIN` réel), OP-N62 (la personnalisation peut appeler `retire_dedicated_key`
  sans travail en cours). Tests : `tests/tests_tag_key_job_approval.sql` (pgTAP depuis
  `cashless_app` et `cashless_perso`), `keys.spec.ts` et `data-keys.spec.ts` (travaux plantés par le
  propriétaire : refusés, aucun appel au KMS). Les suites qui plantaient des travaux passent par une
  demande approuvée (`test/support/key-jobs.ts`). Fichiers à faire relire par une personne :
  migration 0020, `post-roles.sql`, `job-gate.ts` et les trois exécutants.
- **Autres files examinées.** `tag_key_job` est la seule file de travaux de la mission. Le contrôle
  quotidien ne lit que `tag_key` et `tag_key_check_run`, que l'API n'écrit pas. Entrées écrites par
  l'API et lues par un processus des clés : `media_batch` (OP-N60, mission 11), `claim_code`
  (association contrôlée par `associate_claim_code`, 0019), `device.agreement_public_key` (signalé :
  OP-N63).
- **Complément du 16/10/2026 (décision du porteur) : délai d'une demande approuvée.**
  `enqueue_tag_key_job` ne refuse pas une demande `APPROVED` dont `expires_at` est dépassé
  (`decide_approval_request` ne contrôle le délai qu'à la décision) : une demande approuvée mais
  jamais exécutée peut servir plus tard, une seule fois (index uniques sur la demande). Risque :
  une approbation ancienne reste une autorisation valable ; il faut une session de l'API et un
  second `OPERATOR_ADMIN` ayant déjà approuvé. Limite acceptée, rattachée à OP-N62, levée par la
  mission 5 : l'inscription refuse une demande `APPROVED` périmée (code `CL023`). Test qui
  documente le comportement actuel : `tests/tests_tag_key_job_approval.sql`, section 6, à inverser
  par la mission 5. Report dans `PROMPTS-A-ENVOYER.md` (mission 5).
- **Levée d'OP-N62 par la mission 5a (21/10/2026, WP06 puis WP07).** Migration 0025 : le retrait d'une clé dédiée
  exige le travail `RETIRE_KEY` `RUNNING` de la même clé ; une demande approuvée périmée est refusée (`CL023`). Test :
  `tests/tests_tag_key_retire_guard.sql`.
- **Références.** SPEC §3.2, §7.3, §7.4, §7.7 ; ADR-83, ADR-84, ADR-94 ; OP-N56, OP-N62, OP-N63 ;
  `contracts/key-services.md` ; `mission-review-report.md` (SEC-1).

## ADR-103 — `activateMedia` et `replaceMedia` : lecture du bracelet embarquée dans la requête

- **Statut** : Acceptée, 16 octobre 2026 (consignée après coup : constat DRIFT-2 de la revue
  post-fusion de la mission 4 ; le changement date du lot 15 et 16).
- **Contexte.** FR-036 : les routes déjà décrites au contrat sont servies telles quelles. Le contrat
  de départ faisait porter à `activateMedia` un `tap_id` et à `replaceMedia` un `new_media_tap_id`,
  identifiants d'une lecture enregistrée au préalable par `register_tap`. Or le schéma de référence,
  qui prime (SPEC §0.3), n'enregistre aucune lecture d'un bracelet jamais activé : `register_tap`
  répond `NOT_ACTIVATED` sans écrire de ligne. Un bracelet neuf n'a donc jamais de `tap_id` : les
  deux routes étaient inutilisables telles que décrites. Contradiction contrat / schéma, résolue
  sans être consignée.
- **Décision.** La lecture du bracelet est embarquée dans la requête : `tap` (`TapInput`)
  obligatoire pour `activateMedia`, `new_media_tap` obligatoire pour `replaceMedia`. Le serveur
  vérifie la lecture dans la transaction (UID et signature d'originalité comparés à ceux de la
  personnalisation). `tap_id` et `new_media_tap_id` restent au contrat, marqués `deprecated` ; une
  requête qui ne porte qu'eux est refusée (`422`). `replaceMedia` gagne aussi les réponses `403`,
  `422` et sa `security`.
- **Conséquences.** Rupture de contrat pour l'app terminal : **mission 12** envoie la lecture
  complète (`TapInput` : `nfc_uid`, `token_hash`, `counter`, `key_index`, `pack_verified`,
  signature, `occurred_at`) au lieu d'un identifiant de lecture, pour l'activation au guichet et
  pour le bracelet neuf d'un remplacement. Aucun client n'existait : pas de migration de clients. La
  sécurité n'est pas affaiblie (la lecture est vérifiée dans la transaction). Report dans
  `PROMPTS-A-ENVOYER.md` (mission 12).
- **Références.** SPEC §0.3, §7.6, §7.8 ; FR-036 ; `packages/contracts/openapi.yaml`
  (`activateMedia`, `replaceMedia`, `TapInput`) ; `activation.spec.ts`, `replace.spec.ts` ;
  `mission-review-report.md` (DRIFT-2).

## ADR-104 — Mission de levée d'OP-N47 (rotation de `CLAIM_CODE_HMAC_KEY`)

- **Statut** : **Proposée par l'agent le 16/10/2026, à confirmer par le porteur** (constat NOTE-1 de
  la revue post-fusion de la mission 4 : OP-N47 nommait « Exploitation », qui n'est pas une mission
  du découpage).
- **Contexte.** ADR-87 : les codes imprimés et les codes de confirmation sont conservés en empreinte
  `HMAC-SHA256(CLAIM_CODE_HMAC_KEY, …)`. Changer le secret invalide toutes les empreintes ; aucune
  procédure de rotation n'existe (OP-N47). Une fuite du secret ne se répare qu'en réimprimant les
  codes.
- **Décision proposée.** Mission de levée : **mission 10** (app festivalier). C'est la mission qui
  reprend les flux qui lisent ces empreintes (rattachement par code depuis l'app, demande en attente
  et code de confirmation, consultation anonyme par code) et leurs comptes ; la double empreinte
  d'une période de rotation se teste sur ces chemins. Alternative écartée : mission 7 (premier vrai
  KMS), qui stockera le secret mais ne touche pas aux flux des codes ; elle reste le lieu du
  stockage du secret si le porteur le préfère.
- **Condition de levée.** Une procédure de rotation est écrite et testée : nouveau secret actif,
  ancien accepté en lecture pendant une période bornée (double empreinte, avec la version du
  secret), recalcul ou extinction des anciennes empreintes, puis retrait de l'ancien secret ; test :
  un code émis sous l'ancien secret se rattache pendant la période et plus après, aucun code n'est
  conservé en clair.
- **Conséquences.** Reports dans `PROMPTS-A-ENVOYER.md` (mission 10) et `PRD.md` (héritages de la
  mission 4). Si le porteur choisit une autre mission, déplacer les reports. Pas de test qui fige la
  limite : c'est une procédure absente, pas un droit qui peut s'élargir (le secret reste obligatoire
  en production, `config.spec.ts`).
- **Références.** ADR-87 ; OP-N47 ; `apps/api/src/kms/claim-hash.ts` ; `mission-review-report.md`
  (NOTE-1).

## ADR-105 — Clé d'accord d'un terminal réécrivable par l'API : limite acceptée jusqu'à la mission 5

- **Statut** : Acceptée, 16 octobre 2026 (décision du porteur, OP-N63).
- **Contexte.** `roles.sql` (kit) accorde à `cashless_app` `UPDATE (agreement_public_key)` sur
  `device`. Le processus des clés de bracelet (`POST /media/auth-keys`) chiffre le mot de passe d'un
  bracelet pour cette clé (ECDH-ES P-256). Une session de l'API compromise peut y mettre sa propre
  clé et lire la réponse suivante pour ce terminal si elle l'intercepte. L'identité du terminal est
  aujourd'hui un faux qui croit des en-têtes (OP-N42).
- **Décision.** Limite acceptée, classée **bloque la production : oui**. Levée par la **mission 5**
  (enrôlement réel des terminaux). Aucun faux ne passe en production : OP-N42 reste bloquant.
- **Condition de levée.** La clé d'accord est écrite à l'enrôlement seulement, par une fonction qui
  vérifie le code d'enrôlement ; `UPDATE (agreement_public_key)` est retiré à `cashless_app`
  (`post-roles.sql`) ; test : réécriture directe refusée.
- **Conséquences.** Test pgTAP qui fige les droits de `cashless_app` sur `device`, colonne par
  colonne (`tests/tests_tag_key_job_approval.sql`, section 7) : il échoue si un droit s'élargit ;
  à mettre à jour à la levée. Reports dans `PROMPTS-A-ENVOYER.md` (mission 5) et `PRD.md`
  (héritages de la mission 4). Fichiers à faire relire par une personne : `post-roles.sql`.
- **Levée par la mission 5a (21/10/2026, WP03 et WP07).** Clé d'accord écrite à l'enrôlement seulement, par la
  fonction qui consomme le code ; `UPDATE (agreement_public_key)` et `INSERT` sur `device` retirés à `cashless_app`.
  Tests : `tests/tests_device_rights.sql` §1 et §2. OP-N63 tranché ; colonnes restantes : OP-N69 (ADR-112).
- **Limite restante (revue post-fusion de la mission 5a, SEC-2, 21/10/2026).** `enroll_device` accepte les clés,
  l'empreinte du certificat et le type d'attestation tels que l'API les donne, et croit l'auteur : la base ne prouve ni
  l'attestation ni l'auteur (même limite qu'OP-N56). La barrière est l'autorité des terminaux et le signataire des
  jetons, hors de la base (OP-N73). Renforcement décidé par le porteur : la lecture de
  `device_enrollment_code.code_hash` est retirée à `cashless_app` (correctif post-fusion de la mission 5a).
  **Fait le 22/10/2026** (`814710c`) : `SELECT` accordé colonne par colonne, sans `code_hash`, sur
  `device_enrollment_code` et aussi sur `device_enrollment_attempt` (renforcement en plus : un essai refusé d'un code
  valide en garde l'empreinte). L'API ne lisait la colonne nulle part ; test `tests/tests_device_rights.sql` §1 bis
  (liste exacte des colonnes lisibles, refus de `code_hash`). La limite sur l'auteur et les preuves reste (OP-N56).
- **Références.** ADR-102 ; OP-N42, OP-N63 ; `packages/ledger-sql/roles.sql`.

## ADR-106 — Terminal iOS : clé de signature non attestée, liée à l'instance App Attest

- **Statut** : Acceptée, 19 octobre 2026 (décision du porteur au plan de la mission 5a, OP-N64).
- **Contexte.** La mission 5a vérifie l'attestation à l'enrôlement sur Android (Key Attestation) et sur iOS (App
  Attest). Sur iOS, App Attest atteste sa propre clé (Secure Enclave) et l'intégrité de l'app, pas la clé de signature
  ECDSA P-256 que le terminal utilise pour ses requêtes, son CSR et son certificat mTLS. La spécification de la mission
  (FR-006) supposait la clé de signature prouvée dans la Secure Enclave.
- **Décision.** Limite acceptée, classée **bloque la production : non**. Le défi d'enrôlement couvre le code, le
  `serial` et les deux clés publiques : un tiers ne peut pas substituer ses clés à celles de l'instance attestée. La
  non-exportabilité de la clé de signature iOS n'est pas prouvée. Risque borné : un terminal iOS encaisse en QR
  seulement (`nfc_enabled = false`, contrainte de `device`) et ne reçoit jamais le mot de passe d'un bracelet.
- **Mission qui la réexamine.** Mission 12 (app terminal).
- **Condition de levée.** Requêtes iOS signées par assertion App Attest (ou preuve équivalente que la clé qui signe
  est dans la Secure Enclave).
- **Conséquences.** Test qui échoue si la borne s'élargit : `POST /media/auth-keys` refuse un terminal iOS. Reports
  dans `PROMPTS-A-ENVOYER.md` et `PRD.md` (mission 12).
- **Vérifiée contre le code livré (21/10/2026, WP18).** Bornes « borne iOS (OP-N64) » de
  `device-auth-matrix.spec.ts` et `media-port-swap.spec.ts`. Pour la mission 12 : `keyId` App Attest (credentialId)
  renvoyé par le port et stocké ; `iosClientDataHash` passé tel quel à `attestKey`.
- **Références.** `kitty-specs/identite-enrolement-terminaux-01M52R6H/research.md` R-06 ; décision
  `DM-01M59SD0YNWKK8R4EKT2T7THJK` ; OP-N64.

## ADR-107 — Terminaux : trois preuves exigées ensemble

- **Statut** : Acceptée, 19 octobre 2026 (décision du porteur au specify de la mission 5a).
- **Contexte.** SPECIFICATION §10.3 (« jeton d'appareil lié à la clé du Keystore, ou mTLS ») et `openapi.yaml` (« un
  terminal utilise l'un OU l'autre ») permettent une seule preuve. La condition de levée d'OP-N42 (ADR-88) exige le
  jeton, le mTLS et la signature de chaque requête. Contradiction signalée (§0.3).
- **Décision.** Les trois preuves sont exigées ensemble, liées au même terminal, sur toute route de terminal. Le mTLS
  est vérifié dans les processus Node, sans en-tête de répartiteur (décision du porteur au plan). Le contrat est mis
  à jour dans ce sens ; §10.3 est à aligner à la prochaine révision de la spécification.
- **Conséquences.** Renforcement de sécurité. Matrice de tests qui retire une preuve à la fois.
- **Vérifiée contre le code livré (21/10/2026, WP18).** `device-auth-matrix.spec.ts` : chaque route de terminal du
  contrat refusée pour chaque preuve absente, fausse, expirée, d'un autre terminal, rejouée ou d'une autre autorité.
- **Références.** OP-N42 ; ADR-88 ; décisions `DM-01M52R88ZPZEA0NXVSDY9PBXW5`, `DM-01M59SAEYDXFK29HMMFBTJ96KS`.

## ADR-108 — Rafraîchissement d'un jeton d'appareil : grâce de 60 s pour le même terminal

- **Statut** : Acceptée, 19 octobre 2026 (décision du porteur au plan de la mission 5a, OP-N65).
- **Contexte.** Le jeton de rafraîchissement est à usage unique ; une réutilisation révoque toute la famille (vol
  présumé). Sur un réseau de festival, une réponse de rafraîchissement perdue fait réessayer le terminal avec le jeton
  déjà consommé : en mode strict, il perd sa famille et doit être ré-enrôlé en plein événement.
- **Décision.** Limite acceptée, classée **bloque la production : non**. Une seule représentation du jeton consommé,
  dans les 60 s, par le même terminal (même certificat client, preuve de possession valide) donne une nouvelle paire et
  révoque la paire émise et jamais utilisée. Tout autre cas révoque la famille. Un voleur aurait besoin du jeton, de la
  clé de signature et du certificat du terminal. La paire remplacée est celle dont le jeton de rafraîchissement n'a
  jamais été échangé ; son jeton d'appareil, s'il a déjà servi, reste valable jusqu'à son expiration (15 min)
  (précision du porteur du 21/10/2026, relecture de WP15).
- **Mission qui la réexamine.** Mission 13 (recette V1), selon les pertes réseau observées.
- **Condition de levée.** Retour au mode strict si la recette montre que la grâce ne sert pas.
- **Conséquences.** Test de borne : seconde représentation, plus de 60 s ou autre certificat → famille révoquée.
- **Vérifiée contre le code livré (21/10/2026, WP18).** « borne d'OP-N65 » (trois tests) de
  `test/integration/devices/refresh.spec.ts` ; `tests/tests_device_tokens.sql` §2.
- **Références.** `research.md` R-07 de la mission 5a ; décision `DM-01M59WNZSSTN4YP1W38GPTHMMP` ; OP-N65.

## ADR-109 — `serial` d'un terminal unique par prestataire

- **Statut** : Acceptée, 19 octobre 2026 (décision du porteur au plan de la mission 5a).
- **Contexte.** L'index `device_serial_active (serial)` du schéma de référence rend le `serial` unique entre tous les
  prestataires. Le `serial` est déclaré par le terminal, non attesté : un prestataire apprend qu'un `serial` existe
  chez un autre (refus) et peut l'occuper pour bloquer l'enrôlement d'autrui ; le calcul de `next_seq` lirait le
  compteur d'un terminal d'un autre prestataire.
- **Décision.** La migration `0022` remplace l'index par `(operator_id, serial) WHERE status <> 'REVOKED'` ;
  `next_seq` est calculé dans le prestataire. Écart au schéma de référence signalé (§0.3) ; renforcement du
  cloisonnement. Le test de référence (même prestataire) reste vert.
- **Conséquences.** Test à deux prestataires (même `serial`, deux terminaux, aucune fuite). Les clés d'opération
  `<serial>:<seq>` restent rangées par prestataire (registre d'idempotence à `operator_id`).
- **Vérifiée contre le code livré (21/10/2026, WP18).** `device-isolation.spec.ts` (« même serial chez deux
  prestataires : deux terminaux, chacun chez lui », « next_seq calculé dans son prestataire ») ; ré-enrôlement du
  même `serial` après révocation : `device-journey.spec.ts` (étape 8).
- **Références.** `sync_protocol.md` §3.1 ; `research.md` R-11 de la mission 5a ; décision
  `DM-01M59WP3HZ99VBEM3SPTQDYJSQ`.

## ADR-110 — Attestation Android : `attestationApplicationId` lu dans la liste logicielle

- **Statut** : Acceptée, 19 octobre 2026 (décision du porteur pendant l'implémentation de WP10, mission 5a, OP-N67).
- **Contexte.** R-05 lisait tous les contrôles de Key Attestation dans la liste matérielle. Le service Keystore
  d'Android écrit `attestationApplicationId` dans `softwareEnforced` : la règle stricte rendait Android inutilisable.
- **Décision.** Écart qui affaiblit le plan, accepté et borné : seul `attestationApplicationId` est lu dans
  `softwareEnforced` (la valeur matérielle prime si elle existe, et doit concorder). Tous les autres contrôles restent
  lus dans la liste matérielle. Classé **bloque la production : non**.
- **Mission qui la réexamine.** Mission 13 (recette V1), sur les appareils cibles.
- **Condition de levée.** Champ présent dans la liste matérielle des appareils cibles, ou preuve d'intégrité de l'app
  complémentaire.
- **Conséquences.** Tests de borne dans `android.spec.ts` : analyse du source (aucun autre champ lu dans
  `softwareEnforced`) ; un autre contrôle lu seulement en logiciel → refus ; valeurs différentes entre les listes →
  refus ; champ absent des deux listes → refus ; paquet ou empreinte faux → refus.
- **Références.** `research.md` R-05 de la mission 5a ; OP-N67.

## ADR-111 — Fonctions nouvelles : droits rejoués dans la transaction des migrations, droit par défaut reporté

- **Statut** : Acceptée, 20 octobre 2026 (décision du porteur pendant l'implémentation de WP07, mission 5a, OP-N68).
- **Contexte.** Le plan de WP07 retirait à `PUBLIC` le droit par défaut d'exécuter les fonctions futures. La forme par
  schéma est sans effet dans PostgreSQL ; la forme globale casse les suites pgTAP (pgTAP et fonctions `pg_temp`).
- **Décision.** `migrate.ts` applique la série de migrations et le rejeu de `roles.sql` puis `post-roles.sql` dans une
  seule transaction ; un échec du rejeu annule toute la série. Le droit par défaut global est reporté. Écart au plan
  (contrôle non tenu) accepté et borné.
- **Mission qui la lève.** Mission 7 (hors ligne), qui revoit déjà les droits de la base (OP-N57, OP-N58).
- **Condition de levée.** Droit par défaut global posé pour le propriétaire, suites pgTAP adaptées.
- **Conséquences.** Une fonction créée à la main hors de `migrate.ts` reste exécutable par `PUBLIC` jusqu'au rejeu :
  règle d'exploitation « aucune fonction hors migration ». Tests de borne : `tests_execute_grants.sql` §4 et
  `migrate-rights.spec.ts`.
- **Références.** OP-N68 ; WP07 de la mission 5a (`kitty-specs/identite-enrolement-terminaux-01M52R6H/`).

## ADR-112 — Colonnes d'exploitation de `device` encore écrites par l'API : levée en mission 7

- **Statut** : Acceptée, 20 octobre 2026 (décision du porteur après la relecture de WP07, mission 5a, OP-N69).
- **Contexte.** WP07 retire à `cashless_app` l'insertion dans `device` et l'écriture du statut, des clés et de
  l'empreinte du certificat. Neuf colonnes restent modifiables, dont `next_seq_floor`, `last_seen_at`, `event_id` et
  `pos_id` : défaut antérieur à la mission, que le plan de WP07 ne couvrait pas.
- **Décision.** Limite consignée, sans changement dans la mission 5a ; liste exacte des colonnes figée par un test.
- **Mission qui la lève.** Mission 7 (hors ligne), qui revoit la numérotation des terminaux dont dépend
  `next_seq_floor`.
- **Condition de levée.** Écritures par des fonctions de la base qui contrôlent la transition ; `UPDATE` directs
  retirés.
- **Conséquences.** Test de borne : `tests_device_rights.sql` §1 (liste exacte des colonnes modifiables).
- **Références.** OP-N69 ; WP07 de la mission 5a.

## ADR-113 — Routes de guichet : jeton de la personne dans `X-Staff-Authorization`

- **Statut** : Acceptée, 20 octobre 2026 (décision du porteur pendant l'implémentation de WP12, mission 5a).
- **Contexte.** Une route de guichet exige le terminal ET la personne. Le contrat déclarait `deviceToken` et
  `humanBearer` comme deux jetons Bearer : tous deux dans `Authorization`, ce qu'une requête HTTP ne peut porter. Avec
  l'identité réelle, ces routes étaient toutes refusées (401, échec fermé).
- **Décision.** Sur les seules routes de guichet, le jeton de la personne passe dans l'en-tête dédié
  `X-Staff-Authorization: Bearer <JWT>`, avec les mêmes vérifications que `humanBearer` ; le jeton d'appareil reste dans
  `Authorization`, comme sur toutes les routes de terminal. Aucune preuve n'est retirée. Schéma `staffBearer` dans
  `openapi.yaml` sur les 9 routes `@CounterAuth()` ; l'en-tête est refusé (401) sur toute autre route. Il n'est pas
  couvert par la signature R-04 : le jeton de la personne reste rejouable par un tiers qui verrait la requête, comme
  tout Bearer des routes humaines (pas de régression).
- **Alternatives écartées.** Jeton d'appareil dans un en-tête dédié partout (toutes les routes de terminal changent) ;
  routes de guichet sans jeton d'appareil (une preuve retirée).
- **Renforcement de WP12 (20/10/2026), consigné le 21/10/2026.** `DEVICE_REQUEST_AUTHORITIES` : liste des autorités
  (`host[:port]`) auxquelles un terminal adresse une requête signée ; `@authority` est signé, une requête signée pour
  une autre autorité (passerelle locale, autre déploiement) est refusée. Obligatoire en production (démarrage refusé
  sinon), port joker `host:*` refusé en production. Tests : `test/unit/config-device-authorities.spec.ts`
  (« production : obligatoire… », « production : port joker refusé »). Valeur à fixer au déploiement (mission 13).
- **Levée d'OP-N70 (21/10/2026, WP18).** `device-auth-matrix.spec.ts` sert chaque route de terminal en HTTPS réel
  et échoue si une route de terminal n'a pas de cas.
- **Références.** WP01 et WP12 de la mission 5a ; ADR-107 (trois preuves).
- **Suites (même date).** OP-N70 : les suites de la mission 4 servies en clair restent sous le faux d'identité du
  terminal ; WP18 les étend à l'identité réelle (une route par contrôleur en HTTPS, test de couverture). Borne iOS de
  `POST /media/auth-keys` : `422 DEVICE_MODE_NOT_ALLOWED` (statut de `openapi.yaml`), `device-lifecycle.md` corrigé.

## ADR-114 — Purges des nonces et des essais d'enrôlement exécutées par l'API publique

- **Statut** : Acceptée, 20 octobre 2026 (décision du porteur après la relecture de WP12, mission 5a).
- **Contexte.** `purge_device_request_nonces` et `purge_device_enrollment_attempts` (SECURITY DEFINER) n'étaient
  accordées à aucun rôle après WP07. Le travailleur `device-purge` qui les planifie tourne dans l'API publique ; les
  relectures de WP03 et WP07 préféraient que `cashless_app` ne les exécute pas.
- **Décision.** `EXECUTE` accordé à `cashless_app` (`post-roles.sql`, section 4a). Droit plus large pour l'API,
  accepté : chaque purge ne retire que des lignes hors de leur fenêtre, à l'heure de la base (nonces expirés depuis plus
  de la tolérance de 300 s, essais de plus de 24 h pour une limite calculée sur 1 h). `cashless_tagkeys` est refusé.
- **Alternative écartée.** Rôle et connexion de maintenance dédiés (un rôle et un réglage de déploiement de plus).
- **Conséquences.** Test de borne confié à WP18 : il échoue si une purge peut retirer une ligne encore dans sa fenêtre
  (nonce non expiré, essai de moins de 24 h). Listes figées de `tests_execute_grants.sql`.
- **Test de borne (21/10/2026, WP18).** `tests/tests_device_purge_window.sql` : sous `cashless_app` et sans
  prestataire, aucune purge ne retire un nonce encore dans sa fenêtre ni un essai de moins de 24 h. Droit plus large
  accepté, listé dans la revue des écarts de sécurité.
- **Mission de levée (21/10/2026, décision du porteur après la revue post-fusion de la mission 5a, SEC-1).** Mission 7 :
  rôle et connexion de maintenance dédiés, `EXECUTE` retiré à `cashless_app` ; fiche OP-N75.
- **Références.** WP07 et WP12 de la mission 5a ; ADR-113.

## ADR-115 — Terminal révoqué : `403 DEVICE_REVOKED` à la requête suivante

- **Statut** : Acceptée, 20 octobre 2026 (décision du porteur pendant l'implémentation de WP16, mission 5a).
- **Contexte.** FR-016 et la story 5 attendent `403 DEVICE_REVOKED` à la requête suivante d'un terminal révoqué. La
  révocation révoque aussi ses familles de jetons, et `device-authentication.md` contrôlait la famille (étape 3, `401`)
  avant le statut (étape 8) : la garde de WP12 rendait `401 UNAUTHENTICATED`. Contradiction signalée par WP16.
- **Décision.** La spécification est gardée. Pour un terminal `REVOKED`, la famille n'est pas opposée à l'étape 3 ; si
  le certificat, le jeton et la signature sont valides (étapes 4 à 6), la garde rend `403 DEVICE_REVOKED` sans consommer
  de nonce ni rien écrire. Toute autre famille révoquée reste `401`.
- **Pourquoi.** L'app du terminal doit distinguer « révoqué, s'arrêter » d'une erreur d'authentification ; seul le
  détenteur des clés du terminal l'apprend. Le refus reste total dans les deux cas.
- **Conséquences.** `real-device-identity.ts` (WP12) modifié dans WP16, avec ses tests ; `media-port-swap.spec.ts`
  attend `403`. Contrat `device-authentication.md` mis à jour (étape 6 bis).
- **Références.** FR-016 ; WP12 et WP16 de la mission 5a ; ADR-107.

## ADR-116 — Idempotence : chemin concret et personne dans la clé

- **Statut** : Acceptée, 21 octobre 2026 (décision du porteur après la relecture de WP16, mission 5a). Mise en œuvre
  par WP18 de la mission 5a ; OP-N71 levé à sa fusion.
- **Contexte.** `contracts/idempotency.md` (mission 1, règle 3) calcule l'empreinte sur le **modèle** de route
  (`/v1/devices/:device_id/revoke`) et range la clé sous (prestataire, portée, clé). Même clé et même corps sur un autre
  `:id` rejouent la réponse de la première ressource : le second terminal n'est pas révoqué alors que le client croit
  l'avoir fait. Un collègue du même prestataire qui connaît la clé reçoit la réponse enregistrée, même hors de sa portée.
  Défaut antérieur à la mission 5a, présent sur toutes les routes `/:id` idempotentes ; SPECIFICATION §10.2 attend
  `IDEMPOTENCY_KEY_REUSED` pour « même clé, contenu différent ». Contradiction entre le contrat et SPECIFICATION
  signalée par la relecture de WP16.
- **Décision.** L'empreinte porte sur le chemin concret (paramètres de chemin compris, sans la chaîne de requête) au
  lieu du modèle de route : même clé sur un autre `:id` → `409 IDEMPOTENCY_KEY_REUSED` (statut de `openapi.yaml` et
  du code ; « 422 » corrigé, décision du porteur du 21/10/2026). La clé est liée à la personne
  authentifiée (ou au terminal, ou au processus) qui l'a créée : un autre appelant ne rejoue jamais une réponse qu'il
  n'a pas obtenue lui-même. La règle 3 du contrat est mise à jour dans le même lot.
- **Pourquoi.** Renforcement : supprime le rejeu sur une autre ressource et la fuite d'une réponse hors portée.
  SPECIFICATION §10.2 l'emporte sur le contrat (§0.3).
- **Conséquences.** Les lignes `api_idempotency` antérieures ne rejouent plus après le déploiement (empreinte
  différente : `IDEMPOTENCY_KEY_REUSED` sur un rejeu en vol) ; consigne de déploiement à écrire avec celle d'OP-N54.
  Tests : même clé sur deux `:id` → 409 ; même clé par deux personnes → aucune réponse de l'autre ; rejeu légitime
  inchangé.
- **Mise en œuvre (21/10/2026, WP18).** `request-hash.ts` et `idempotency.interceptor.ts` ; règle 3 du contrat de la
  mission 1 mise à jour. Tests : `admin.spec.ts` (deux tests « ADR-116 »), `transverse/idempotency.spec.ts` (chaîne de
  requête hors de l'empreinte), `unit/idempotency/request-hash.spec.ts`, `media/personalization.spec.ts`. Effet : sur
  une route de guichet, une autre personne qui reprend la même clé reçoit `409`. Consigne de déploiement commune avec
  ADR-99 (purge à T + 720 h). OP-N71 tranché.
- **Références.** SPECIFICATION §10.2 ; `contracts/idempotency.md` (mission 1) ; WP16 et WP18 de la mission 5a ;
  OP-N71 ; ADR-99 (OP-N54).

## ADR-117 — Enrôlement : audit de tous les refus, limites sans oracle

- **Statut** : Acceptée, 21 octobre 2026 (décisions du porteur après la relecture de WP14, mission 5a).
- **Contexte.** La relecture de WP14 a trouvé : (B1) l'audit `DEVICE_ENROLLMENT_REFUSED` n'était écrit qu'après un
  contrôle de code réussi, donc ni pour un code expiré, utilisé, de mauvais mode, ni pour une erreur de validation ou
  un `429` (contrat `enrollment.md` et FR-025) ; (B2) la limite par code ne valait que pour un code existant (essai
  d'un code inconnu enregistré sans empreinte) : le 11e essai rend `429` pour un code existant et `422` pour un code
  inconnu, ce qui révèle l'existence d'un code ; (N5) la limite par adresse comptait les réussites et bloquerait un
  parc de plus de 30 terminaux derrière une même adresse ; (N3) les écritures d'une route sans compte n'étaient pas
  bornées une fois la limite atteinte.
- **Décision.** (1) Un audit pour chaque refus : dans la chaîne du prestataire si le code est connu en base (même
  expiré ou utilisé), sinon dans la chaîne de la plateforme (`operator_id` NULL). (2) L'essai garde l'empreinte HMAC
  de tout code bien formé, connu ou non ; la limite de 10 par code et par heure vaut pour tous. (3) La limite de 30 par
  adresse et par heure ne compte que les refus. (4) Au-delà d'une limite, un seul essai et un seul audit
  `RATE_LIMITED` par adresse (ou par code) et par fenêtre ; les `429` suivants n'écrivent rien (décision de
  l'orchestrateur, qui borne l'amplification sans perdre la trace du franchissement).
- **Pourquoi.** (1), (2), (4) renforcent la sécurité ou la traçabilité. (3) ne l'affaiblit pas : un enrôlement réussi
  consomme un code valide émis par un administrateur ; les essais de codes restent bornés par les refus.
- **Conséquences.** Nouvelle migration (fonctions d'essai et d'audit, contrainte `known_code` retirée) avec
  `post-roles.sql` et `tests_execute_grants.sql` dans le même commit ; contrat `enrollment.md`, `data-model.md` et
  R-16 mis à jour. Tests : audit de chaque refus (connu, inconnu, validation, limite) ; 11e essai d'un code inconnu →
  `429` ; 31 enrôlements réussis depuis une adresse → aucun `429` ; une seule ligne au-delà de la limite.
- **Mise en œuvre (WP14, cycle 2).** Migration 0027 (`record_enrollment_refusal`). Limites lues avant l'étape 1 (un
  corps invalide au-delà de la limite n'écrit plus rien) ; les réussites ne comptent pas non plus dans la limite par
  code (sinon l'oracle de B2 renaîtrait). Limite non atomique (contrôle puis écriture dans deux transactions) : des
  requêtes simultanées passent toutes le contrôle ; sans effet pratique avec 60 bits d'entropie par code. Chaque refus
  d'un code inconnu prend le verrou de la chaîne d'audit de la plateforme : une limite en amont (répartiteur) reste
  utile. Non-atomicité, autre effet (relecture du cycle 2) : avec un code fuité, une rafale de K requêtes simultanées
  écrit K lignes dans la chaîne d'audit du prestataire avant que la limite ne se voie ; suite confiée à WP18.
  `cashless_app` écrit désormais dans la chaîne d'audit de la plateforme, par cette seule fonction
  (`DEVICE_ENROLLMENT_REFUSED`, sans acteur, champs bornés) : à connaître pour la vérification de cette chaîne.
- **Suites (21/10/2026, WP18, migration 0030).** (N-b) Verrous de l'adresse puis du code pris avant le contrôle,
  dans la même transaction : limites atomiques. Une rafale garde ses codes HTTP d'origine (décision du porteur) ; les
  écritures sont bornées à 10 refus et une trace, `429` dès la requête suivante. (N-c) Clé d'adresse agrégée par /64
  en IPv6 (IPv4 encapsulée ramenée à IPv4). (N-a) La trace `RATE_LIMITED` nomme la limite (`limit: code|address`).
  Tests : `tests/tests_enrollment_limits.sql`, `test/integration/devices/enrollment-limits.spec.ts` ; attentes de
  `tests_enrollment_refusal.sql` adaptées. Limite résiduelle (chaîne d'audit de la plateforme, absence de limite en
  amont) : OP-N72, mission 13 (confirmée par le porteur le 21/10/2026). Revue des écarts : `cashless_app` écrit dans la
  chaîne d'audit de la plateforme (migration 0027).
- **Références.** FR-025 ; R-16 ; WP03 et WP14 de la mission 5a ; ADR-114.

## ADR-118 — Relectures de WP15 et WP17 : configuration servie durcie en base, deux contradictions tranchées

- **Statut** : Acceptée, 21 octobre 2026 (décisions du porteur après les relectures de WP15 et WP17, mission 5a).
- **Contexte.** (1) WP17 accorde `EXECUTE` de `record_config_served(uuid, uuid)` à `cashless_app`. La fonction ne
  refuse pas un terminal `REVOKED` et ne vérifie pas que `p_config_version` appartient au prestataire du terminal
  (clé étrangère seule). Sans effet aujourd'hui (la route relit le statut sous verrou et ne passe pas ce paramètre),
  mais un `cashless_app` compromis pourrait enregistrer une configuration pour un terminal révoqué ou citer la
  `config_version` d'un autre prestataire. (2) Le DTO du rafraîchissement borne `nonce` (16-64, `[A-Za-z0-9+/=_-]`) et
  `refresh_token` (16-128, base64url) plus strictement que `openapi.yaml` (`minLength: 16` seul). (3) Le prompt T079
  et `contracts/device-lifecycle.md` (« ETag = `config_id` ») contredisent `openapi.yaml` (`config_id` = id de ligne de
  `device_config_served`).
- **Décision.** (1) Corrigé dans la mission, pas reporté : WP18 ajoute la migration `0029` (`record_config_served`
  refuse un terminal `REVOKED` et applique `assert_tenant` au prestataire de la `config_version`) et un test pgTAP
  hors de la suite de référence, `tests/tests_config_served_guard.sql` (décision du porteur du 21/10/2026 : la suite de
  `gen_tests.py` vérifie le schéma du kit seul) : terminal d'un autre prestataire, terminal révoqué, `config_version`
  d'un autre prestataire → refus, aucune ligne. (2) `openapi.yaml` s'aligne sur le DTO (`pattern`, `maxLength`) ; le code ne change pas.
  (3) `openapi.yaml` et le code font foi (§0.3) : `config_id` = `device_config_served.id` ; ETag = SHA-256 du contenu
  canonique (JCS) hors `server_time`, qui change avec le statut du terminal (un `304` ne masque pas une suspension).
  `device-lifecycle.md` est corrigé.
- **Pourquoi.** (1) et (2) renforcent la sécurité ; (3) garde le choix le plus sûr.
- **Conséquences.** Aucun point ouvert ni dette : la limite (1) est levée avant la fusion de la mission.
- **Mise en œuvre (21/10/2026, WP18).** Migration 0029 (`REVOKED` → `42501` ; `config_version` inconnue, d'un autre
  prestataire ou de niveau `PLATFORM` → `P0002` ; `FOR SHARE` ; signature inchangée). Une version `PLATFORM` est donc
  refusée : choix gardé par le porteur, à rouvrir si une mission doit servir une version plateforme. (2) fait dans
  `openapi.yaml` (avec `TAP_UNUSABLE`/`CL022` et `409 CONFLICT_STATE` déclaré pour la configuration et le battement,
  atteignable).
- **Références.** FR-018, FR-019 ; R-10, R-14 ; relectures WP15 et WP17 (cycle 1) de la mission 5a ; ADR-108, ADR-115.

## ADR-119 — Autorité des terminaux et signataire des jetons d'appareil : faux seulement jusqu'à la mission 7

- **Statut** : Acceptée, 21 octobre 2026 (décision du porteur après la relecture de WP18, mission 5a, OP-N73). Dette
  nommée (règle 3 de `CLAUDE.md`) ; **bloque la production**.
- **Contexte.** La mission 5a place l'autorité des terminaux (`DeviceCaPort`) et le signataire des jetons d'appareil
  (`TokenSignerPort`) derrière des ports, avec des faux refusés en production (contrainte C-004 : pas d'adaptateur AWS
  avant la région, OP-N11). La levée d'OP-N42 ne couvre que la vérification des trois preuves : les clés qui émettent
  certificats et jetons ne sont pas encore réelles.
- **Décision.** Dette consignée, levée par la **mission 7** (hors ligne), avec OP-N41 : premier vrai KMS, adaptateurs
  écrits ensemble une fois la région arrêtée.
- **Condition de levée.** Adaptateurs réels des deux ports, clés hors du code et de l'environnement (SPEC §13.2) ;
  garde de production levée pour ces deux ports seulement.
- **Conséquences.** Tests qui échouent si la limite s'élargit : `device-latency.spec.ts` (démarrage refusé avec le
  faux de l'autorité seul, puis du signataire seul), `production-guard.spec.ts`. Reports dans `PROMPTS-A-ENVOYER.md`
  et `PRD.md` (mission 7).
- **Références.** OP-N73 ; OP-N41, OP-N42 ; ADR-88, ADR-107 ; C-004 de la mission 5a.

## ADR-120 — Enrôlement sur un événement clos : écart consigné jusqu'à la mission 5b

- **Statut** : Acceptée, 21 octobre 2026 (décision du porteur après la revue post-fusion de la mission 5a, DRIFT-1,
  OP-N74). Dette nommée (règle 3 de `CLAUDE.md`).
- **Contexte.** La spécification de la mission 5a exige le refus d'un enrôlement dont le code vise un événement clos ou
  annulé, ou un point de vente supprimé depuis l'émission. Les fonctions de la migration 0022 ne lisent pas ces états ;
  aucun lot ni test ne portait ce cas.
- **Décision.** Écart consigné, non corrigé dans la mission 5a ; classé **bloque la production : non** (le terminal
  n'encaisse rien avant la mission 5b). **Mission qui le lève : mission 5b** (paiement en ligne), qui fixe aussi quels
  états de clôture bloquent l'enrôlement (`event_status` n'a pas d'état « annulé »).
- **Condition de levée.** Refus dans `create_device_enrollment_code` et `enroll_device` ; test pgTAP par refus, aucune
  ligne écrite.
- **Conséquences.** Aucun test ne fige ce manque (contrôle absent). Reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md`
  (mission 5b).
- **Références.** OP-N74 ; spécification de la mission 5a (cas limites) ; `packages/ledger-sql/migrations/0022_device_enrollment.sql`.

## ADR-121 — PIN des vendeurs : vérification dans l'API, limite acceptée jusqu'à la mission 11

- **Statut** : Acceptée, 22 octobre 2026 (décision du porteur au plan de la mission 5b,
  `DM-01M5HRNFEFWDG47YEGE5N3C3GN`, passe contradictoire A15). Dette nommée (règle 3 de `CLAUDE.md`).
- **Contexte.** S2 impose argon2id ; PostgreSQL ne le calcule pas. Le PIN est vérifié dans l'API (décision du porteur
  du 22/10/2026 : serveur, jamais le terminal), avec un secret hors base (`VENDOR_PIN_SECRET`).
- **Décision.** « Compter d'abord » : la base compte l'essai et rend l'empreinte (`begin_vendor_pin_check`), l'API
  vérifie, la base ouvre la session (`open_vendor_session`) en revérifiant l'éligibilité. La base croit l'API sur le
  résultat de la vérification. **Bloque la production : non** (même classe qu'OP-N56 : une connexion de l'API
  compromise écrit déjà des ventes). **Mission qui la lève : mission 11**, avec OP-N56.
- **Condition de levée.** Processus séparé, seul détenteur du secret et d'un rôle de base qui seul exécute ces deux
  fonctions ; ou preuve infalsifiable par l'API.
- **Conséquences.** Tests de borne : liste figée des droits, aucune session sans essai compté, audit de chaque
  ouverture. Reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md` (mission 11).
- **Références.** OP-N76, OP-N56 ; `kitty-specs/terminaux-paiement-en-ligne-01M52QB9/contracts/vendors.md`.

## ADR-122 — Annulation au back-office : `SALE_REVERSAL` demandable par un `SUPERVISOR` ou un `ORGANIZER_ADMIN`

- **Statut** : Acceptée, 22 octobre 2026 (décision du porteur aux tâches de la mission 5b, constat I6 de
  `analysis-report.md`). Écart à la spécification qui élargit un droit, accepté (règle 3 de `CLAUDE.md`).
- **Contexte.** FR-017 réserve l'annulation hors fenêtre, ou d'une vente d'un autre vendeur, au `SUPERVISOR` de
  l'événement. Le contrat (`openapi.yaml`, action `SALE_REVERSAL`) permet aussi à un `ORGANIZER_ADMIN` de la demander.
  Le contrat prime (SPECIFICATION §0.3), mais il donne un droit plus large que la spécification.
- **Décision.** On suit le contrat : la demande peut venir d'un `SUPERVISOR` ou d'un `ORGANIZER_ADMIN` de l'événement
  de la vente ; elle n'est exécutée qu'à l'approbation d'une seconde personne distincte (source `BACKOFFICE`).
  L'annulation au terminal par jeton sur place reste réservée au `SUPERVISOR`. **Bloque la production : non.**
- **Condition de bornage.** Test (WP12) qui échoue si un autre rôle peut demander `SALE_REVERSAL`, si la portée sort
  de l'événement de la vente, ou si une seule personne suffit.
- **Conséquences.** `requiredRole` du registre des actions devient une liste (retouche d'une ligne dans
  `approval.service.ts`). FR-017 est à compléter dans `spec.md` à la clôture de la mission.
- **Références.** FR-017 ; `kitty-specs/terminaux-paiement-en-ligne-01M52QB9/tasks/WP12-annulation.md`.

## ADR-123 — Codes de refus de l'annulation et du QR client : le contrat existant est gardé

- **Statut** : Acceptée, 23 octobre 2026 (décision du porteur pendant la mission 5b, contradictions §0.3 signalées par
  WP01). Sans effet de sécurité : le refus a lieu dans tous les cas.
- **Contexte.** Le contrat avait déjà `REVERSAL_NOT_ALLOWED` en 422, `REVERSAL_WINDOW_EXPIRED` en 409 et
  `QR_TOKEN_INVALID` en 422 pour le QR client. Le plan de la 5b (data-model, `contracts/payments.md`,
  `contracts/qr-payments.md`) disait `CL036` → 403 pour tout refus d'annulation, fenêtre comprise, et
  `409 PAYMENT_REQUEST_NOT_PENDING` pour un QR client refusé.
- **Décision.** Annulation : `CL036` → `422 REVERSAL_NOT_ALLOWED` (autre vendeur, autre terminal, vente non
  `PURCHASE`…) ; nouveau `CL040` → `409 REVERSAL_WINDOW_EXPIRED`, levé **seulement après** les contrôles du terminal et
  du vendeur, pour qu'un autre vendeur n'apprenne pas l'âge d'une vente. QR client présenté par `POST /payments` :
  tout refus de `lock_customer_qr_token` (`CL037` en base) est traduit en `422 QR_TOKEN_INVALID`, réponse unique pour
  inconnu, expiré, déjà utilisé, autre événement ou portefeuille non actif. Les demandes de QR commerçant gardent
  `409 PAYMENT_REQUEST_NOT_PENDING`.
- **Conditions de bornage.** Tests de WP04 (ordre : autre vendeur hors fenêtre → `CL036`, jamais `CL040`), WP12
  (statuts HTTP) et WP13 (réponse unique `422` du QR client, aucun corps différent selon la cause).
- **Références.** `kitty-specs/terminaux-paiement-en-ligne-01M52QB9/tasks/WP04-…`, `WP08-…`, `WP12-…`, `WP13-…`.

## ADR-124 — Idempotence : un refus non définitif (`DEBIT_AUTHORITY_*`) relâche la clé, sur toutes les routes

- **Statut** : Acceptée, 23 octobre 2026 (décision du porteur après la relecture de WP08 de la mission 5b, constat 1).
  Sans effet de sécurité : rien n'est écrit lors de ces refus.
- **Contexte.** La passe contradictoire du plan de la 5b (A14, `research.md`) a décidé de ne plus enregistrer les 409
  non définitifs. WP08 l'applique dans l'intercepteur commun : la décision vaut donc aussi pour les routes existantes
  (activation, caution, libération, confirmation au guichet), où SPECIFICATION §10.2 prévoyait jusque-là d'enregistrer
  le refus et de le rejouer à l'identique.
- **Décision.** `DEBIT_AUTHORITY_EDGE` et `DEBIT_AUTHORITY_MOVING` sont des refus transitoires : la clé est relâchée,
  rien n'est enregistré, et un nouvel essai avec la même clé s'exécute (il peut réussir quand l'autorité est revenue au
  central). Liste fermée. Tout autre refus 4xx reste enregistré et rejoué. SPECIFICATION §10.2 est mise à jour.
- **Conditions de bornage.** `apps/api/test/unit/device-route/device-key.spec.ts` (la liste `NON_FINAL_CODES` est
  exactement ces deux codes ; un ajout fait échouer le test). Ces refus sont levés dans la transaction métier, annulée.
- **Références.** `apps/api/src/idempotency/idempotency.interceptor.ts`, `device-key.ts` ;
  `kitty-specs/terminaux-paiement-en-ligne-01M52QB9/tasks/WP08-…/review-cycle-1.md`.

## ADR-125 — Secrets de l'API exigés par tous les processus : exposition acceptée jusqu'à la mission 13

- **Statut** : Acceptée, 23 octobre 2026 (décision du porteur après la relecture de WP08 de la mission 5b, constat 2 ;
  défaut antérieur à la mission). Affaiblissement résiduel consigné : OP-N77.
- **Contexte.** `loadConfig` est commun à tous les processus (`bootstrap.ts`). En production, `IDEMPOTENCY_HMAC_KEY`,
  `ENROLLMENT_CODE_HMAC_KEY` et, depuis WP08, `VENDOR_PIN_SECRET` sont obligatoires aussi dans l'environnement des
  processus des clés, d'administration des clés et de personnalisation, qui ne s'en servent pas.
- **Décision.** On garde ce schéma dans la mission 5b ; lecture des secrets par processus (chacun n'exige et ne reçoit
  que les siens) dans la mission 13 (recette V1), proposée par l'agent.
- **Conditions de bornage.** `apps/api/test/unit/config.spec.ts` (liste des secrets obligatoires en production, secrets
  distincts deux à deux, démarrage refusé sans eux) ; aucun nouveau secret ne s'ajoute à `loadConfig` sans entrée ici.
- **Secrets ajoutés depuis.** `VENDOR_PIN_IDEMPOTENCY_SECRET` (26/10/2026, ADR-126, WP09 cycle 3) : même schéma,
  même levée à la mission 13.
- **Références.** `apps/api/src/config/config.ts` ; OP-N77.

## ADR-126 — Idempotence : un PIN n'entre dans l'empreinte de la requête que sous un dérivé argon2

- **Statut** : Acceptée, 26 octobre 2026 (décision du porteur après la relecture de WP09 de la mission 5b, question 2).
  Renforcement : aucun point ouvert.
- **Contexte.** L'empreinte `api_idempotency.request_hash` (HMAC-SHA256 du corps, clé `IDEMPOTENCY_HMAC_KEY`) est
  gardée 30 jours. Les corps qui portent un PIN de vendeur (ouverture de session au terminal, création et changement
  de PIN au back-office) y entraient en clair : avec la base et la clé HMAC volées, un PIN à 6 chiffres se retrouve en
  10^6 calculs HMAC, contre 10^6 calculs argon2 pour `vendor.pin_hash`. Retirer le PIN de l'empreinte ne convient pas :
  la même clé avec un autre PIN rejouerait la réponse d'un succès.
- **Décision.** Avant le calcul de l'empreinte, le PIN est remplacé par un dérivé argon2 déterministe (même socle et
  mêmes paramètres que WP08, sel tiré de la clé d'idempotence et de la portée) : le rejeu reste lié au PIN, la force
  brute hors ligne redevient aussi coûteuse que sur `pin_hash`.
- **Conditions de bornage.** Test qui échoue si un corps portant un PIN produit une empreinte calculable sans argon2
  (empreinte différente du HMAC du corps en clair) ; test qu'une même clé avec un autre PIN est refusée (`409`), jamais
  rejouée.
- **Complément du 26/10/2026** (décision du porteur après la relecture de WP09 cycle 2, constats 1 à 3 ; renforcements) :
  - **Secret distinct.** Le dérivé se calcule sous un secret propre, `VENDOR_PIN_IDEMPOTENCY_SECRET` (mêmes règles
    que `VENDOR_PIN_SECRET` : 32 octets au moins, exigé en production, secret de test refusé, distinct de tous les
    autres secrets), et non sous `VENDOR_PIN_SECRET`. Sa rotation invalide seulement les empreintes d'idempotence en
    vol (une requête rejouée avec la même clé reçoit `409 IDEMPOTENCY_KEY_REUSED`) ; celle de `VENDOR_PIN_SECRET`
    n'y touche plus. Ajouté à la liste d'ADR-125 (OP-N77).
  - **Verrou avant le dérivé.** À l'ouverture de session, le verrou « un essai de PIN à la fois par terminal » est
    pris avant tout calcul argon2 (dérivé compris) et tenu jusqu'à la fin de la requête : un essai concurrent reçoit
    `429` sans payer d'argon2.
  - **Bornage ajouté.** Le test « empreinte ≠ HMAC du corps en clair » couvre les trois routes (création de vendeur
    comprise) et compare l'empreinte stockée au HMAC du corps dérivé (égalité) ; un test prouve qu'un essai refusé
    en `429` ne calcule aucun argon2 ; un test prouve que le dérivé ne dépend pas de `VENDOR_PIN_SECRET`.
- **Références.** WP09 cycles 2 et 3 (`apps/api/src/vendors/`, `apps/api/src/idempotency/`,
  `apps/api/src/vendor-pin/`, `apps/api/src/config/config.ts`) ; relectures WP09 cycles 1 et 2.

## ADR-127 — Mission 5b : purge des essais de PIN et clé de session de vendeur reportées

- **Statut** : Acceptée, 26 octobre 2026 (décisions du porteur sur deux questions de la relecture de WP07 de la
  mission 5b). Points ouverts : OP-N78, OP-N79.
- **Contexte.** La relecture des droits de la base (WP07) a relevé deux suites possibles : `vendor_pin_check` n'a pas
  de purge ; `vendor_id` pourrait entrer dans la clé composite de `vendor_session` pour qu'une vente ne puisse être
  attribuée qu'au vendeur de sa session.
- **Décision.** Purge : point ouvert, levée à la mission 13 (recette V1). Clé composite : durcissement reporté (point
  ouvert, levée proposée à la mission 11 avec OP-N76) ; la migration 0033 n'est pas retouchée dans la mission 5b.
- **Conditions de bornage.** OP-N79 : `tests_payment_rights.sql` (aucun `INSERT`/`UPDATE` de `cashless_app` sur
  `sale_attribution`), seule barrière d'ici la levée. OP-N78 : aucune donnée secrète dans `vendor_pin_check`.
- **Références.** `packages/ledger-sql/migrations/0031_vendors.sql`, `0033_payments.sql` ; relecture WP07
  (`docs/passation-5b/rapports/WP07-review-cycle-1.md`).

## ADR-128 — Paiement en ligne (mission 5b, WP11) : solde rendu, époque dans le refus, corps non rangé, empreinte du contenu

- **Statut** : Acceptée, 26 octobre 2026 (décisions du porteur sur les points soumis par l'implémenteur de WP11).
  Sans affaiblissement de sécurité ; aucun point ouvert.
- **Décisions.**
  - **Solde rendu au terminal pour un paiement par QR client** : le contrat est gardé (`wallet_id`, `balance_after`
    dans la réponse ; `available_balance` dans `INSUFFICIENT_FUNDS`). Le festivalier présente lui-même son QR et
    paie en présence du commerçant, comme avec un bracelet.
  - **`409 STALE_AUTHORITY_EPOCH`** : l'extension `authority_epoch` (époque courante, entier) est ajoutée au contrat
    (`openapi.yaml`, types régénérés), au lieu d'un champ hors contrat.
  - **Corps de paiement qui n'est pas un objet JSON** : `400`, rien au registre des numéros du terminal (aucun
    contenu calculable) ; le numéro reste un trou, vu par le contrôle des trous de la mission 7.
  - **`content_sha256` du registre des numéros** : SHA-256 de la forme canonique RFC 8785 de `{seq (nombre),
    type: "PURCHASE", occurred_at (chaîne reçue), amount, currency, tap (objet reçu), lines (tableau reçu)}`, champs
    absents omis ; jamais `tap_id`, `customer_qr_token`, `vendor_session_id` ni un champ d'état. Limite : un `seq`
    au-delà de 2^53 n'est pas exact en nombre JSON. Forme à reprendre telle quelle par la mission 7 (lots hors ligne).
- **Conditions de bornage.** Vecteurs fixes de `apps/api/test/unit/payments/device-seq-registry.spec.ts` (calculés
  hors du code) ; réponses contrôlées contre `openapi.yaml` (`contractViolations`).
- **Références.** WP11 (`apps/api/src/payments/`), compte rendu `docs/passation-5b/rapports/WP11-implementation.md`.


## ADR-129 — Annulation au back-office (mission 5b, WP12) : `reversePayment` d'une personne crée la demande `SALE_REVERSAL`

- **Statut** : Acceptée, 26 octobre 2026 (décision du porteur sur la contradiction signalée par l'implémenteur de
  WP12). Sans affaiblissement de sécurité (deux personnes distinctes restent exigées) ; aucun point ouvert.
- **Contexte.** L'arbitrage de l'orchestrateur du 22/10 (prompt WP12) voulait `403 APPROVAL_REQUIRED` pour un appelant
  personne sur `reversePayment`, le back-office passant par une route générique `createApprovalRequest` qui n'existe
  pas. Le contrat (`openapi.yaml`, prioritaire selon SPECIFICATION §0.3) annonce `202` avec création de la demande.
- **Décision.** Le contrat est suivi : un `SUPERVISOR` ou un `ORGANIZER_ADMIN` de l'événement de la vente (ADR-122)
  appelle `reversePayment` ; l'API crée la demande `SALE_REVERSAL` (source `BACKOFFICE`) et répond `202`, sans écriture
  au grand livre ; une seconde personne distincte l'approuve (`approveApprovalRequest`), ce qui exécute l'annulation.
  L'arbitrage du 22/10 (403) est retiré.
- **Conditions de bornage.** Tests de WP12 : aucun autre rôle, portée de l'événement de la vente, demandeur ≠
  approbateur, aucune ligne de grand livre avant l'approbation, réponse `202` conforme au contrat.
- **Références.** `apps/api/src/reversals/`, compte rendu `docs/passation-5b/rapports/WP12-implementation.md`.
