# cashless_tag_format (Dart)

Version Dart de `@cashless/tag-format` : format B 1.0, message de dérivation du mot de passe, stockage chiffré de
`PWD‖PACK`, code de rattachement. Mêmes fonctions et mêmes codes de refus que la version TypeScript.

```bash
dart pub get --enforce-lockfile
dart analyze
dart test
```

Les tests lisent les vecteurs du paquet parent : `../vectors/vectors.json` (produit par le script du kit,
`vecteurs_test_bracelet.py`) et `../vectors/cross-impl.json` (1 000 entrées écrites par la suite TypeScript). Ils se
lancent donc depuis ce dossier.

L'enveloppe d'un mot de passe pour un terminal (ECDH-ES) n'est pas portée ici : elle vient avec l'app terminal.
