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
