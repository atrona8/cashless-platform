# Protocole de mesure terrain — lecture NFC des bracelets (MIFARE Ultralight EV1)

Version 1.0 — 30 septembre 2026. Campagne à mener **dès maintenant, par le porteur du projet,
avant le codage de l'app terminal** (ADR-39). L'application du banc n'a **jamais tourné
sur un téléphone** au moment de la rédaction : la première demi-journée sert de validation
du banc et de la puce (§5.0).

---

## 1. Objet et décisions attendues

Mesurer, sur **chacun des téléphones Android disponibles** (ADR-39, §3.1), la durée et la
fiabilité d'un tap de paiement dans des conditions proches d'un événement à Dakar. Deux
séquences sont mesurées ; le paiement lit la signature d'originalité à chaque passage (ADR-59) :

- **séquence complète** du banc : GET_VERSION → page 4 → PWD_AUTH → pages 5–10 + CRC → INCR_CNT →
  READ_CNT → READ_SIG ;
- **séquence de paiement** (SPEC §7.6, ADR-59 : READ_SIG compris, sans GET_VERSION) : déduite des
  mêmes taps par les temps d'étape (`total_ms − t_get_version_ms`), sans série supplémentaire. Les
  échecs survenus à l'étape GET_VERSION sont signalés à part dans le rapport.

Décisions à la fin de la campagne :

1. **Niveau de chaque téléphone testé** : « recommandé », « toléré » ou « refusé » (avec motif),
   selon la règle du §8 (ADR-39) ; le back-office tient cette liste.
2. **Réglages lecteur** : `EXTRA_READER_PRESENCE_CHECK_DELAY`, délai `NfcA.setTimeout`.
3. **Budget de latence NFC** (p95) à soustraire du budget total d'un paiement en ligne, qui
   alimente la décision « région AWS » (§11).
4. Confirmation (ou non) des hypothèses sur les commandes EV1 listées dans le README
   (READ débordant en zone protégée, NAK remonté ou non par la pile, compteurs protégés ou non).

## 2. Ce que le banc mesure — et ce qu'il ne mesure pas

| Mesuré par l'application (`System.nanoTime`) | Non mesuré par l'application |
|---|---|
| Chaque étape, de l'entrée dans `onTagDiscovered` au résultat (`t_*_ms`, `total_ms`) | Découverte du tag (bracelet entre dans le champ → callback) : dépend du contrôleur NFC et de la cadence de sondage, invisible depuis Android |
| Issue de chaque tap, type d'erreur, NAK, présence du tag après erreur | Délai d'affichage / retour haptique |
| Temps de présence du bracelet après le résultat (`dwell_ms`, option) | Réseau (mesuré à part, §11) |

La **latence perçue** (bracelet posé → retour haptique) se mesure sur un sous-échantillon par
vidéo au ralenti (§5.3) ; `perçue − total_ms` donne l'ordre de grandeur de la découverte.

## 3. Matériel

### 3.1 Téléphones (profils)

**Décision du 30 septembre 2026 (ADR-39)** : la campagne utilise les téléphones **déjà disponibles** (ceux du porteur du projet et des premiers clients), et non un parc acheté selon les profils ci-dessous. Les profils servent à **classer** chaque téléphone testé et à repérer les profils non couverts, à signaler dans le rapport. Il est conseillé d'avoir au moins un Samsung dans la campagne, sa pile NFC ayant un comportement particulier.

Pour chaque téléphone disponible, noter son profil et **vérifier la présence de NFC sur la
variante en main** (beaucoup de modèles d'entrée de gamme existent en version sans NFC). Aucun
modèle précis n'est exigé : les exemples ci-dessous servent seulement au classement.

| Code | Profil | Exemples indicatifs (à confirmer) | Intérêt |
|---|---|---|---|
| P1 | Entrée de gamme ~100 € | Xiaomi Redmi 13C / Redmi A-series NFC, Tecno Spark (variante NFC), Samsung Galaxy A0x/A1x NFC | Ce que les marchands achèteront ; antenne et contrôleur bas de gamme |
| P2 | Milieu de gamme Samsung | Galaxy A35 / A55 | Parc le plus répandu ; pile NFC Samsung (NAK parfois convertis en IOException) |
| P3 | Google Pixel | Pixel 7a / 8a | Référence AOSP |
| P4 | Durci **ou** TPE Android | Samsung Galaxy XCover, Ulefone/Blackview Armor ; TPE Sunmi (V2s, P2) / PAX (A920) | Terrain poussiéreux, chaleur ; TPE = option marchand pro |

**Attention TPE** : sur certains TPE (PAX notamment), le lecteur sans contact est piloté par le
SDK du fabricant et **n'est pas exposé via `android.nfc.NfcAdapter`**. Vérifier avant usage
que `NfcAdapter.getDefaultAdapter()` est non nul et que le reader mode détecte un bracelet ; sinon
le banc ne s'applique pas sans adaptation au SDK constructeur.

Pour chaque téléphone, relever : fabricant, modèle, version Android, patch sécurité, contrôleur
NFC (`adb shell dumpsys nfc | head -40`, ou `getprop | grep -i nfc`), position de l'antenne
(logo NFC ou essai), présence/type de coque.

### 3.2 Bracelets et cartes

- ≥ 100 bracelets MIFARE Ultralight EV1 **MF0UL11** du même fournisseur que la production
  (même antenne / même taille de boucle que les bracelets de l'événement).
- 5 étiquettes NTAG213 et, si possible, 5 MF0UL21 (rejet par GET_VERSION).
- Si possible 4 cartes « magiques » compatibles UL EV1 (UID réinscriptible) pour les clones.
- Étiquettes numérotées indélébiles sur chaque bracelet (n° de lot + n° de bracelet).

### 3.3 Instrumentation

- Thermomètre infrarouge (surface téléphone et bracelet) ; `adb shell dumpsys battery`
  (température batterie, en dixièmes de °C).
- Source de chaleur contrôlée : sac isotherme + chaufferette ou étuve de labo, ou exposition au
  soleil (relever la T° réelle).
- Solution saline 0,9 % (ou sueur artificielle ISO 3160-2) en pulvérisateur.
- Cales non métalliques 0,5 / 1 / 2 / 3 cm (carton, mousse) pour la distance.
- Smartphone de tournage 240 fps + trépied (sous-échantillon §5.3).
- 2–3 téléphones « perturbateurs » avec NFC actif (lecture de carte bancaire / reader mode) pour C8.
- Métronome (appli) pour le rythme des taps.
- Batterie externe, câbles, coques (fine TPU, épaisse « antichoc », porte-cartes à clapet).

## 4. Préparation des bracelets (mode « Personnaliser » du banc)

> **⚠ AVERTISSEMENT.** Le mode Personnaliser écrit AUTH0 = 5, PROT = 1. Ensuite, sans le PWD,
> le bracelet est **irrécupérable pour le banc**. Exporter le CSV après chaque lot (il contient
> UID, PWD, PACK de TEST) et le conserver en deux exemplaires. Tenir le bracelet immobile pendant
> l'écriture. Ne jamais utiliser ce mode sur des bracelets de production. Le banc refuse
> AUTHLIM ≠ 0 et ne pose jamais CFGLCK.

Clé de test : dérivation SP 800-108 avec la clé maître **de test** (octets 00..1F) et
l'opérateur `00000000-0000-0000-0000-000000000002` (cf. `packages/tag-format/vecteurs_test_bracelet.py`) ; le banc peut
aussi charger une table UID → PWD/PACK ou des blobs chiffrés.

| Lot | Qté | Préparation | Attendu au banc |
|---|---|---|---|
| **V1** valides | 20 | Format B 1.0, key_index 1, protégés | `OK` |
| **V2** valides (réserve / 2e opérateur) | 20 | idem | `OK` |
| **X1** CRC faux | 4 | option « CRC volontairement faux » | `CRC_MISMATCH` |
| **X2** version inconnue | 4 | major = 2 | `UNSUPPORTED_FORMAT` |
| **X3** vierges | 4 | non personnalisés (usine) | `UNSUPPORTED_FORMAT` (major 0) |
| **X4** mauvais PWD | 4 | personnalisés avec un autre key_index que celui de la page 4, **ou** table du banc sans ces UID | `AUTH_FAILED` ou `UNKNOWN_KEY` |
| **X5** autre puce | 4 | NTAG213 / MF0UL21 | `NOT_MF0UL11` |
| **K1** clones | 4 | Cartes magiques : copie UID + pages 4–10 + PWD/PACK d'un bracelet V1 déjà utilisé, compteur ≤ dernier vu | `COUNTER_REPLAY` (ou `NOT_MF0UL11` / `PACK_MISMATCH` si la carte magique répond différemment — à noter) |

Sans cartes magiques : simuler le clone par `seedCounter(uid, valeur)` (compteur « déjà vu »
pré-chargé) — cela teste la chaîne logicielle mais pas le comportement radio d'un clone.

Après personnalisation : relire chaque bracelet une fois en mode Mesure (doit donner `OK`, ou
l'issue attendue du lot).

## 5. Déroulé

### 5.0 Validation du banc et de la puce (½ journée, sur deux des téléphones disponibles, de marques différentes — un Samsung si possible)

1. Installer, vérifier `isAvailable`, personnaliser 2 bracelets, les relire.
2. Vérifier sur un bracelet V1 : trames et issues conformes ; `READ_4` en en-tête → attendu NAK
   (hypothèse datasheet) ; mauvais PWD → noter si la pile renvoie un NAK (`error_kind = NAK`) ou
   une IOException (`IO` + `tag_present_after_error = true`).
3. **Protection du compteur 2** (si la configuration de la puce le permet) : sur un bracelet V1
   personnalisé, après une nouvelle sélection et **sans** PWD_AUTH, envoyer `INCR_CNT` sur le
   compteur 2 (trame brute `A5 02 01 00 00 00`, via une appli d'envoi de trames brutes), puis lire
   le compteur après authentification. **Attendu** : `INCR_CNT` refusé (NAK ou IOException) et
   `READ_CNT` inchangé. Si la puce n'offre pas cette protection (hypothèse du README, point 5),
   constater que l'incrément est accepté (compteur + 1) et le consigner comme écart : un tiers peut
   « brûler » des valeurs du compteur sans affaiblir la détection de clone.
4. Tester `unprotect` sur un bracelet et la re-personnalisation avec PWD actuel.
5. Consigner toute divergence dans le rapport (§10) avant de lancer les séries.

### 5.1 Règles communes

- Application au premier plan, écran allumé (désactiver la mise en veille), optimisation de
  batterie désactivée pour l'appli, mode avion **non** requis (le réseau n'intervient pas).
- Un **geste** = présenter le poignet, attendre le retour haptique, retirer. En cas d'échec,
  re-présenter immédiatement : le banc compte `attempt = 2, 3…` dans le même `gesture_id`
  (fenêtre 4 s).
- Rythme : un geste toutes les ~3 s (métronome), bracelets V1/V2 utilisés en rotation (300 gestes
  sur 40 bracelets : ≈ 7,5 gestes par bracelet et par série).
- **3 opérateurs** (poignets et gestes différents), répartis à parts égales dans chaque série.
- Chaque série : saisir téléphone, condition, lot, note (T°, batterie %, coque), puis « Nouvelle
  session » ; exporter le CSV à la fin de chaque série (nom de fichier = téléphone + session).
- Ordre des conditions tiré au hasard par téléphone (éviter qu'un effet de fatigue ou de chauffe
  ne se confonde avec une condition).

### 5.2 Conditions

| Code | Condition | Mode opératoire | Gestes |
|---|---|---|---|
| C0 | Référence table | Bracelet posé à plat au centre de l'antenne, téléphone sur table, sans coque | 300 |
| C1 | Poignet nominal | Bracelet au poignet, geste de paiement naturel, téléphone tenu par le marchand | 300 |
| C2 | Poignet rapide | Effleurement sans marquer d'arrêt (≈ foule pressée) | 300 |
| C3 | Distance / orientation | 100 gestes à 1 cm (cale), 100 bracelet sur la tranche (90°), 100 décalé de 2 cm du centre de l'antenne | 300 |
| C4 | Coque | Coque épaisse antichoc ou porte-cartes (la plus défavorable disponible) | 300 |
| C5 | Batterie basse | Batterie ≤ 15 %, économiseur d'énergie activé | 300 |
| C6 | Chaleur | Téléphone et bracelets ≥ 40 °C en surface (relever T° IR + T° batterie toutes les 50 taps) | 300 |
| C7 | Sueur | Bracelet et poignet humidifiés (solution saline) avant chaque bloc de 20 gestes | 300 |
| C8 | Foule / interférences | 2–3 téléphones NFC actifs à < 50 cm, autre terminal du banc à 1 m, lieu bruyant | 300 |
| C9 | Deux bracelets dans le champ | Bracelet cible (lot V1) + bracelet perturbateur (lot V2) sur l'autre poignet / main à < 3 cm. Noter l'UID cible dans « note » | 300 |
| C10 | Lots spéciaux | Chaque bracelet X1–X5, K1 présenté 10 fois | ≈ 240 |
| C11 | Presence-check | C1 répété avec `presenceCheckDelay` = 50, 125, 250, 500 ms | 4 × 150 |

C11 est **informative** (hors règle du §8) : 150 gestes par valeur suffisent car il s'agit de **comparer** des réglages (même téléphone,
mêmes opérateurs), pas de valider un seuil absolu ; allonger à 300 si deux valeurs sont proches.

Option « temps jusqu'au retrait » (`measureDwell`) : l'activer sur **100 gestes de C1 et C2**
seulement (le sondage retarde la détection du retrait par la plate-forme).

Charge **par téléphone** : C0–C9 (10 × 300) + C10 (≈ 240) + C11 (600) ≈ 3 850 gestes, soit
≈ 3 h 15 de taps à 3 s/geste ; avec les réglages, la chauffe (C6), la décharge (C5) et les pauses,
compter environ une journée par téléphone. Durée de la campagne ≈ nombre de téléphones disponibles
× une journée, divisée par le nombre de téléphones testés en parallèle (selon les opérateurs
présents), plus la demi-journée du §5.0 et la préparation des bracelets.

### 5.3 Sous-échantillon vidéo (latence perçue)

Mesure **informative** (hors règle du §8).

Sur C1, 30 gestes par téléphone filmés à 240 fps (image du poignet + écran) : mesurer
l'intervalle « bracelet à ~1 cm de la coque » → « mise à jour de l'écran / vibration ».
Comparer à `total_ms` du même tap (apparier par ordre et horodatage `wall_ms`).

## 6. Métriques

Toutes calculées par `reference/analyse_mesures.py`, par téléphone × condition puis par téléphone.

| Métrique | Définition |
|---|---|
| Latence par étape | p50 / p95 / p99 de chaque `t_*_ms` sur les taps `OK` |
| Latence totale | p50 / p95 / p99 de `total_ms` (callback → résultat, réseau exclu) sur les taps `OK` des lots V |
| Échec au premier essai | gestes dont `attempt = 1` n'est pas `OK` / gestes (lots V), avec IC 95 % de Wilson |
| Taux de TagLost | taps `TAG_LOST` / taps (lots V) — indique un geste trop court ou une séquence trop longue |
| Faux rejets CRC | taps `CRC_MISMATCH` sur les lots V (doit être **0** : sinon arrachement pendant écriture, lecture corrompue ou bogue) |
| Rejets attendus | lots X/K : taps rejetés / taps (doit être **100 %**) |
| Doubles lectures | deux `OK` du même UID à < 1,5 s dans une session (risque de double débit) |
| Temps jusqu'au retrait | `dwell_ms` : p5 = marge dont on dispose au-delà du résultat |
| Latence perçue | §5.3 |
| C9 | proportion de lectures de l'UID perturbateur au lieu de la cible |

Latence totale **par tentative** et **par geste** : un geste réussi en 2 tentatives coûte
typiquement 1 à 2 s à l'usager ; c'est pour cela que le critère principal porte sur l'échec au
premier essai plutôt que sur le taux de réussite final.

## 7. Taille d'échantillon (≥ 300 gestes par téléphone et condition)

- **Échec au premier essai, critère 2 %.** Avec n = 300 et la règle « ≤ 6 échecs » (≤ 2 %
  observé) : un téléphone dont le vrai taux est 4 % n'a que 4 % de chances de passer, un
  téléphone à 5 % moins de 1 %. En revanche un téléphone à exactement 2 % passe environ 6 fois
  sur 10 : pour un résultat dans la zone grise (4 à 8 échecs), **prolonger à 600**.
  Pour mémoire, IC 95 % de Wilson : 0/300 → [0 ; 1,3 %] ; 3/300 → [0,3 ; 2,9 %] ;
  6/300 → [0,9 ; 4,3 %]. En dessous de 150 gestes, 0 échec ne prouve même pas un taux < 2,5 %.
- **Échec au premier essai, critère 5 % (« toléré »).** Avec n = 300 et la règle « ≤ 15 échecs »
  (≤ 5 % observé) : un téléphone dont le vrai taux est 8 % n'a qu'environ 3 % de chances de passer,
  un téléphone à 10 % moins de 0,2 % ; un téléphone à exactement 5 % passe un peu plus d'une fois
  sur deux (≈ 57 %). Zone grise : **10 à 20 échecs sur 300 → prolonger à 600**. IC 95 % de
  Wilson : 10/300 → [1,8 ; 6,0 %] ; 15/300 → [3,1 ; 8,1 %] ; 20/300 → [4,4 ; 10,1 %].
- **p95.** Avec 300 valeurs, l'IC 95 % du p95 s'étend des rangs ≈ 278 à 292 : estimation
  stable. Le **p99** repose sur 3 valeurs seulement : il n'est qu'indicatif par condition ; le
  calculer sur l'ensemble des conditions d'un téléphone (≈ 3 000 taps, ~30 valeurs au-delà).
- **Effets opérateur / bracelet.** 3 opérateurs × 40 bracelets par série évitent qu'un seul
  poignet ou un bracelet défectueux ne domine le résultat ; vérifier dans le rapport que les
  échecs ne se concentrent pas sur un bracelet (sinon l'écarter et le signaler au fournisseur).

## 8. Critères de réussite (décidés le 30 septembre 2026, ADR-39)

Deux niveaux, appliqués à chaque téléphone :

| Critère | « Recommandé » | « Toléré » |
|---|---|---|
| p95 `total_ms` (réseau non compté), par condition | ≤ 300 ms | ≤ 500 ms |
| p99 `total_ms`, sur l'ensemble des conditions exigées | ≤ 500 ms | ≤ 800 ms |
| Échec au premier essai, par condition | ≤ 2 % (≤ 6 / 300) — zone grise 4 à 8 → 600 gestes | ≤ 5 % (≤ 15 / 300) — zone grise 10 à 20 → 600 gestes |

Critères communs aux deux niveaux (un écart → « refusé ») :

| Critère | Seuil |
|---|---|
| TagLost | ≤ 1 % |
| Faux rejets CRC | 0 |
| Doubles lectures | 0 |
| Lots X/K (C10) | 100 % rejetés, avec l'issue attendue |
| C9 | 0 lecture silencieuse du mauvais bracelet **ou** procédure d'exploitation (afficher les 4 derniers chiffres de l'UID/nom) jugée acceptable |

**Règle unique.** Les conditions exigées sont **C0 à C10** ; seules les mesures marquées
informatives (C11, sous-échantillon vidéo du §5.3) n'entrent pas dans la règle. Le niveau d'un
téléphone est le **plus bas** obtenu : « recommandé » s'il satisfait le niveau recommandé dans
toutes les conditions exigées, « toléré » s'il satisfait au moins le niveau toléré dans toutes,
« refusé » sinon (motif et conditions limitantes indiqués). `analyse_mesures.py` applique cette
règle (tableau « Niveau (ADR-39, §8) »).

Le niveau se calcule sur la **séquence de paiement** (§1, ADR-59) ; le rapport donne aussi les
p95/p99 de la séquence complète mesurée.

## 9. Format CSV des mesures

Un fichier par série, UTF-8, séparateur virgule, en-tête obligatoire (ordre = `kCsvColumns` dans
`flutter/lib/nfc_bench.dart`). Durées en ms avec 3 décimales. Cellules vides = non applicable.

| Colonne | Contenu |
|---|---|
| `session_id` | horodatage UTC de début de session |
| `phone_label`, `manufacturer`, `model`, `sdk` | code saisi (ex. `P2-A35`) + `Build.*` |
| `condition`, `lot`, `note` | saisis ; lot préfixé V / X / K |
| `type` | `tap`, `personalize`, `unprotect`, `error` |
| `seq`, `wall_ms` | n° d'ordre, heure murale (ms epoch) |
| `uid`, `atqa`, `sak`, `techs` | identification radio |
| `presence_delay_ms`, `transceive_timeout_ms` | réglages actifs |
| `outcome` | `OK`, `TAG_LOST`, `IO_ERROR`, `NAK`, `BAD_RESPONSE`, `NOT_MF0UL11`, `UNSUPPORTED_FORMAT`, `UNKNOWN_KEY`, `AUTH_FAILED`, `PACK_MISMATCH`, `CRC_MISMATCH`, `COUNTER_REPLAY`, `INTERNAL_ERROR` |
| `failed_step`, `error_kind`, `nak_code`, `tag_present_after_error` | diagnostic |
| `gesture_id`, `attempt` | regroupement des réessais |
| `major`, `minor`, `key_index`, `counter`, `token_hash` | contenu lu |
| `total_ms`, `t_connect_ms` … `t_hash_ms`, `dwell_ms` | chronométrages |
| `ok`, `pages_4_10`, `pwd`, `pack`, `version`, `error` | personnalisation / erreurs |

Les CSV de personnalisation contiennent des PWD **de test** : les stocker avec le registre des
lots, pas dans un dépôt public.

## 10. Gabarit de rapport

```
# Rapport banc NFC — <date> — <lieu>
## 1. Contexte
Opérateurs : … | T° ambiante : … | Version appli banc : … | Lots utilisés : …
## 2. Téléphones
| Code | Modèle | Android | Contrôleur NFC | Coque | Prix constaté |
## 3. Validation du banc (§5.0)
Écarts constatés vs hypothèses du README (READ_4, NAK/IOException, compteurs…) :
## 4. Résultats par téléphone × condition
(tableau produit par analyse_mesures.py)
## 5. Détail des latences par étape (p50/p95) — téléphone le plus lent et le plus rapide
## 6. Échecs : répartition par issue, par étape, par bracelet, par opérateur
## 7. Presence-check (C11) : tableau réglage → échec 1er essai / doubles lectures / TagLost
## 8. Latence perçue (vidéo) vs total_ms
## 9. Décisions
- Téléphones recommandés : …   tolérés : …   refusés : … (motif, conditions limitantes)
- Profils du §3.1 non couverts par les téléphones disponibles : …
- presenceCheckDelay retenu : … ms ; NfcA timeout : … ms
- Séquence de paiement (avec READ_SIG, sans GET_VERSION) et séquence complète : p95/p99 de chacune
- Protection d'INCR_CNT sans PWD_AUTH (§5.0) : refusé / accepté
- Budget NFC p95 retenu pour le calcul de bout en bout : … ms
## 10. Points ouverts / anomalies (joindre CSV bruts)
```

## 11. Articulation avec le point ouvert « région AWS »

Le banc ne mesure **pas** le réseau : il fournit le terme NFC du budget d'un paiement en ligne.

```
latence perçue en ligne ≈ découverte + total_NFC + aller-retour réseau(s) + traitement serveur
```

La latence réseau se mesure **séparément**, depuis Dakar, sur 4G **Orange, Free et Expresso** :

1. Déployer dans **eu-west-3 (Paris)**, **eu-west-1 (Irlande)**, **eu-south-1 (Milan)** et
   **af-south-1 (Le Cap)** un
   point de terminaison HTTPS identique et minimal (API Gateway ou Lambda Function URL qui
   renvoie 204, ou ALB/EC2 si c'est l'architecture cible), afin de mesurer TLS + HTTP réels plutôt
   qu'un ICMP souvent filtré. (Les points `https://dynamodb.<région>.amazonaws.com/ping` utilisés
   par des sites comme cloudping peuvent servir de premier ordre de grandeur, à vérifier.)
2. Depuis un téléphone de chaque opérateur (appli de test ou Termux + `curl`), toutes les 5 min
   sur 3 jours dont un soir d'affluence et un jour d'événement si possible, sur 3 lieux (centre,
   banlieue, site de l'événement) :
   `curl -o /dev/null -s -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\n' <url>`
   en connexion neuve **et** en connexion réutilisée (keep-alive, cas réel d'un terminal).
3. Indicateurs : p50/p95/p99 de l'aller-retour HTTP réutilisé, taux d'échec/timeout, variance
   par heure et par opérateur.

Ce que la mesure NFC permet alors de décider :

- **Budget restant** : l'objectif de bout en bout est p95 ≤ 1,2 s (ADR-60, SPEC §15), dont NFC
  p95 ≤ 300 ms et réseau + serveur p95 ≤ 800 ms. Le budget réseau réel vaut
  `1 200 − p95_NFC − découverte − p95_serveur (≤ 200)`. Le banc fixe les deux premiers termes.
- **Choix de région** : la région retenue est celle dont le p95 HTTP réutilisé tient dans ce
  budget sur **les trois** opérateurs, puis arbitrage sur les autres critères (disponibilité des
  services dans la région — af-south-1 est une région « opt-in » avec un catalogue plus restreint —,
  coût, exigences de localisation des données). L'itinéraire réel Dakar → Le Cap passe souvent par
  l'Europe : l'hypothèse « Le Cap est plus proche » **doit être vérifiée** par la mesure, pas
  supposée.
- **Nombre d'allers-retours tolérables** : si aucun p95 ne tient dans le budget avec deux appels
  (obtention PWD/PACK + validation du compteur), il faut imposer le **cache local** de PWD/PACK
  (étape 4 sans réseau, dont le banc mesure le coût réel via le fournisseur « blob ») et un seul
  appel synchrone. Une validation différée du compteur est **hors périmètre** : le paiement est
  en ligne d'abord (chaque vente en ligne est autorisée par le serveur, SPEC §7.6 et §9.1).
- **Mode dégradé** : le taux d'échec/timeout réseau par opérateur dimensionne le mode hors ligne
  (plafond par transaction, synchronisation différée).
