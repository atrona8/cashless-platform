# Banc de mesure NFC — bracelets MIFARE Ultralight EV1 (MF0UL11)

Prototype de banc pour chronométrer et fiabiliser le tap de paiement sur terminaux Android,
plus le protocole de campagne terrain (`PROTOCOLE_TERRAIN.md`).

Critères (ADR-39, règle unique en `PROTOCOLE_TERRAIN.md` §8) : chaque téléphone disponible reçoit
un niveau — **« recommandé »** (p95 ≤ 300 ms, p99 ≤ 500 ms, échecs au premier essai ≤ 2 %),
**« toléré »** (p95 ≤ 500 ms, p99 ≤ 800 ms, échecs ≤ 5 %), sinon **« refusé »**.
`reference/analyse_mesures.py` calcule p95, p99 et taux d'échec, et donne le verdict par
téléphone × condition puis le niveau de chaque téléphone.

> **⚠ Code Android / Flutter NON TESTÉ SUR APPAREIL.** Aucun SDK Flutter, SDK Android ni
> téléphone n'était disponible. Seule la logique pure est testée (voir ci-dessous).

## Contenu

```
nfc_bench/
├── README.md, PROTOCOLE_TERRAIN.md
├── reference/                         Python, stdlib (+ « cryptography » optionnel)
│   ├── ev1_format.py                  format B, CRC-32/ISO-HDLC, trames EV1, READ_CNT, ACCESS/CFG0, plan de personnalisation, KDF/AES-GCM de test
│   ├── test_ev1_format.py             22 tests sur les vecteurs de `packages/tag-format/vecteurs_test_bracelet.py`
│   ├── analyse_mesures.py             analyse des CSV terrain (p50/p95/p99, échec 1er essai + IC Wilson, verdict recommandé / toléré / refusé)
│   └── test_analyse_mesures.py        9 tests
├── android/
│   ├── run_jvm_tests.sh               compile core/ + tests avec kotlinc et lance JUnit 4 (sans Gradle ni Android)
│   └── app/src/
│       ├── main/kotlin/sn/cashless/nfcbench/
│       │   ├── core/                  ← logique pure, testée sur JVM
│       │   │   ├── Ev1Protocol.kt     constantes, trames, CRC, FormatB, Header, pages de config
│       │   │   ├── Ev1Reader.kt       commandes EV1 sur une interface Transceiver, classement des erreurs (TagLost / IO / NAK / réponse invalide)
│       │   │   ├── PwdPackProvider.kt table de test, dérivation KDF de test, blobs AES-GCM (chemin prod)
│       │   │   ├── TapBenchmark.kt    séquence du tap + chronométrage par étape + gestes/tentatives + registre des compteurs
│       │   │   └── Personalizer.kt    personnalisation / déprotection des bracelets de test
│       │   ├── NfcATransceiver.kt     adaptateur android.nfc.tech.NfcA (non testé)
│       │   ├── NfcBenchChannel.kt     MethodChannel « cashless/nfc_bench » + EventChannel « …/events », reader mode (non testé)
│       │   └── MainActivity.kt        branchement du canal (non testé)
│       └── test/kotlin/sn/cashless/nfcbench/core/
│           ├── FakeUltralightEv1.kt   simulateur de puce (notre lecture de la datasheet)
│           ├── Ev1ProtocolTest.kt     mêmes vecteurs que Python
│           └── TapBenchmarkTest.kt    séquence complète, erreurs, clone, personnalisation
└── flutter/
    ├── pubspec.yaml
    └── lib/ main.dart (écran du banc), nfc_bench.dart (wrapper du canal + CSV)
```

## Ce qui est testé ici

| Élément | Comment | Résultat |
|---|---|---|
| Référence Python | `cd reference && python3 test_analyse_mesures.py && python3 test_ev1_format.py` | 31 tests OK (9 + 22) |
| Logique Kotlin `core/` (JVM) | `KOTLINC_HOME=… android/run_jvm_tests.sh` (kotlinc 2.0.21, JUnit 4.13.2) | 34 tests OK |
| Couche Android (`NfcATransceiver`, `NfcBenchChannel`, `MainActivity`) | compilée par kotlinc contre des **bouchons écrits à la main** des API Android/Flutter | compile ; ne prouve que la cohérence du code avec *nos* signatures |

Vecteurs vérifiés dans les deux langages : CRC `672f4329`, page 4 = `01 00 00 01`, pages 4–10
complètes, message KDF, PWD `283e8c48`, PACK `428c`, déchiffrement du blob AES-GCM (et refus si
l'UID change), SHA-256 de l'identité, trames exactes (`3a0404`, `1b283e8c48`, `3a050a`,
`a50201000000`, `3902`, `3c00`), plan d'écriture de personnalisation (AUTH0 écrit en dernier).

Les tests JVM passent aussi toute la séquence du tap et la personnalisation contre un simulateur
de MF0UL11 : ils ont révélé un vrai défaut (après écriture d'AUTH0 = 5 sur un bracelet vierge,
la relecture de vérification était refusée faute d'authentification — corrigé). Le simulateur
encode **notre** compréhension de la datasheet ; il ne remplace pas une puce réelle.

## Ce qui n'est PAS testé

- Tout le code Android réel (reader mode, `NfcA`, gestion des `TagLostException`, re-sélection
  après NAK, threads, cycle de vie de l'activité) et le code Dart/Flutter (ni compilé ni
  analysé : pas de SDK Dart ; versions de `share_plus`/`path_provider` indicatives).
- Tout comportement radio : latences, NAK réellement remontés, cartes magiques.
- La vérification de la signature READ_SIG (lue et chronométrée seulement).

## Construire l'application

```bash
flutter create --org sn.cashless --platforms android nfcbench
cd nfcbench
cp ../nfc_bench/flutter/pubspec.yaml .
cp ../nfc_bench/flutter/lib/*.dart lib/
rm -f test/widget_test.dart                      # test généré, inutile ici
# Remplace le MainActivity généré et ajoute le code natif :
cp -r ../nfc_bench/android/app/src/main/kotlin/sn/cashless/nfcbench/* \
      android/app/src/main/kotlin/sn/cashless/nfcbench/
cp -r ../nfc_bench/android/app/src/test android/app/src/
flutter pub get
```

`android/app/src/main/AndroidManifest.xml` (dans `<manifest>`, hors `<application>`) :

```xml
<uses-permission android:name="android.permission.NFC" />
<uses-feature android:name="android.hardware.nfc" android:required="true" />
```

Et, dans l'`<activity>` principale, `android:screenOrientation="portrait"` est conseillé.

`android/app/build.gradle(.kts)` :

- `minSdk` ≥ 21 (le reader mode existe depuis l'API 19 ; Flutter impose de toute façon ≥ 21) :
  `minSdk = maxOf(21, flutter.minSdkVersion)` ;
- tests unitaires : `testImplementation("junit:junit:4.13.2")` puis
  `cd android && ./gradlew :app:testDebugUnitTest`.

Puis `flutter run --release` sur le téléphone (le mode debug fausse les chronométrages côté
Dart, pas côté Kotlin ; utiliser **release** ou **profile** pour les campagnes).

## Points techniques à vérifier sur puce réelle

Sources : datasheet NXP **MF0ULX1** « MIFARE Ultralight EV1 – Contactless ticket IC » (rév. 3.x),
citée **de mémoire** — chaque point est à confirmer dans le document et sur puce (§5.0 du protocole).

1. **GET_VERSION** : attendu `00 04 03 01 01 00 0B 03` pour MF0UL11 (sous-type `02` pour la variante
   50 pF, taille `0E` pour MF0UL21). Le banc accepte les sous-types 01 et 02.
2. **READ 4 avec AUTH0 = 5 et PROT = 1** : READ renvoie 4 pages (4–7) ; nous supposons un **NAK**
   quand la plage touche la zone protégée sans authentification. D'où `FAST_READ 04 04` par
   défaut (4 octets, page 4 seule). L'option `READ_4` du banc permet de le vérifier.
3. **NAK = retour en IDLE** : après un NAK la puce n'accepte plus de commande sans nouvelle
   sélection, et l'authentification est perdue. Un mauvais PWD termine donc le tap ; le banc
   tente `close()`/`connect()` pour savoir si le tag était encore là. Que `NfcA.connect()` après
   `close()` re-sélectionne vraiment la puce dépend de la pile NFC du téléphone : à vérifier.
4. **NAK remonté ou non** : selon les piles NFC (comportement signalé par des développeurs,
   non vérifié ici), un NAK 4 bits donne soit un octet `0x00`–`0x05`, soit une `IOException`
   « Transceive failed ». Le banc gère les deux (`error_kind` = NAK ou IO) ; le ACK arrive
   normalement comme un octet `0x0A`.
5. **Compteurs et protection** : sur UL EV1, READ_CNT/INCR_CNT ne dépendent pas, à notre
   connaissance, de PWD/AUTH0 (à la différence de NTAG21x et de son bit NFC_CNT_PWD_PROT). Le
   banc s'authentifie avant de les utiliser, donc il fonctionne dans les deux cas ; en revanche, si
   les compteurs sont bien libres, n'importe qui peut incrémenter le compteur 2 sans PWD (on ne peut
   jamais le décrémenter), ce qui n'affaiblit pas la détection de clone mais permet de « brûler »
   des valeurs (essai prévu en §5.0 du protocole). INCR_CNT au-delà de 0xFFFFFF → NAK. Les compteurs sont protégés contre l'arrachement ;
   la commande CHECK_TEARING_EVENT (0x3E) n'est pas utilisée ici.
6. **INCR_CNT** : 4 octets d'argument, les 3 premiers (LSB d'abord) forment l'incrément, le 4e est
   ignoré ; réponse ACK. **READ_CNT** : 3 octets LSB d'abord.
7. **PWD_AUTH** : le PWD passe **en clair** dans le champ RF ; il peut être capturé par un renifleur.
   Le PACK n'authentifie que faiblement la puce. Associé à une carte magique (UID réinscriptible),
   un clone complet est possible ; seule la règle serveur « compteur déjà vu » le détecte, et
   **seulement si l'original et le clone sont tous deux utilisés** (un clone dont le compteur est
   réglé au-dessus du dernier vu passera jusqu'au prochain passage de l'original).
8. **READ_SIG** : signature ECC NXP (32 o, secp128r1 d'après nos souvenirs) de l'UID seul. Elle est
   statique et copiable avec l'UID sur une carte magique : elle détecte des puces non NXP, pas un
   clone d'une puce NXP. La vérifier exige la clé publique NXP (datasheet / note AN11350) — non
   implémenté.
9. **Config** : valeurs usine supposées CFG0 = `00 00 00 FF` (AUTH0 = 0xFF), CFG1 = `00 05 00 00`
   (ACCESS = 0, VCTID = 05), PWD = `FF FF FF FF`, PACK = `00 00` ; PWD et PACK sont relus à 0. ACCESS :
   bit 7 PROT, bit 6 CFGLCK (définitif), bits 2–0 AUTHLIM (0 = pas de limite). Le banc préserve MOD
   et les bits réservés, refuse CFGLCK et AUTHLIM ≠ 0.
10. **Presence-check** : délai par défaut de la plate-forme supposé ≈ 125 ms (à vérifier par version
    d'Android) ; valeurs comparées en C11.
11. **Délai `NfcA.setTimeout`** : laissé à la valeur par défaut sauf réglage ; il doit couvrir
    l'écriture EEPROM de WRITE et INCR_CNT (quelques ms selon la datasheet).
