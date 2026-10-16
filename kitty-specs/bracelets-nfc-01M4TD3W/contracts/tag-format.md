# Contrat — bibliothèque de format (`@cashless/tag-format`, `cashless_tag_format`)

Mêmes fonctions, mêmes noms (à la casse du langage près), mêmes erreurs, dans les deux langages. Entrées et sorties en
octets ; aucune fonction ne journalise ni ne garde un secret.

| Fonction | Entrée | Sortie | Refus |
|---|---|---|---|
| `encodeFormatB` | index de clé (0-65535), identité (16 o), mineur = 0 | 28 octets | index ou identité hors bornes |
| `decodeFormatB` | 28 octets | majeur, mineur, index, identité, drapeaux | longueur ≠ 28, majeur ≠ 1 (`UNKNOWN_MAJOR`), CRC faux (`BAD_CRC`) ; mineur > 0 accepté |
| `crc32IsoHdlc` | octets | 4 octets big-endian | — (contrôle : « 123456789 » → `CBF43926`) |
| `tokenHash` | identité (16 o) | SHA-256 (32 o) | — |
| `derivationMessage` | prestataire (16 o), index, UID (7 o) | message de `GenerateMac` | longueurs fausses |
| `splitPwdPack` | 32 octets de MAC | `PWD` (4 o), `PACK` (2 o) | — |
| `pwdPackAad` | bracelet (16 o), prestataire, index, UID | AAD | — |
| `sealPwdPack` / `openPwdPack` | clé de données (32 o), nonce (12 o), `PWD‖PACK`, AAD | 34 octets / 6 octets | longueur ≠ 34, étiquette fausse (`AUTH_FAILED`) |
| `generateClaimCode` | source d'aléa | 10 caractères de `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` | — |
| `normalizeClaimCode` | saisie | 10 caractères | caractère hors alphabet, longueur ≠ 10 après retrait des tirets et espaces |
| `formatClaimCode` | 10 caractères | `XXXX-XXXXXX` | — |

TypeScript seulement (serveur) : `sealForDevice` (ECDH-ES P-256, HKDF-SHA256, AES-256-GCM, AAD
`"CASHLESS/PWDPACK/DEV/v1" || device_id || nfc_uid`) et `sealForStation` (même construction, AAD
`"CASHLESS/PWDPACK/PERSO/v1" || media_id || nfc_uid`). Leur ouverture en Dart vient avec l'app terminal (mission 12).

**Vecteurs** : `vectors/vectors.json` est la sortie du script du kit mise en JSON, plus des cas de refus (majeur 2,
CRC faux, AAD modifiée, code avec `0`, `1`, `I`, `O`). Les deux suites le lisent. Un test supplémentaire compare les
deux implémentations sur 1 000 entrées tirées au hasard (SC-001) : la suite TypeScript écrit ses sorties, la suite Dart
les recalcule.

**Tirage du code** : par rejet sur des octets aléatoires (5 bits par caractère, sans biais).
