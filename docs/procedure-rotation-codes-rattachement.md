# Procédure de rotation du secret des codes de rattachement

Cette procédure s'adresse à l'exploitant du central. Elle change le secret qui sert à calculer l'empreinte des codes
de rattachement imprimés sur les bracelets, puis réémet des codes pour les bracelets concernés. Chaque étape se
vérifie. En cas de doute, ne rien forcer et s'arrêter.

## Limites à connaître avant de commencer

- **La rotation est immédiate.** Dès le redémarrage avec la nouvelle version, aucun ancien code ne vaut plus rien :
  rattachement, confirmation au guichet et consultation anonyme le traitent comme un code inconnu. Il n'y a pas de
  période de recouvrement.
- Les compteurs de consultation anonyme par adresse repartent à zéro (la référence d'adresse dépend du secret). Les
  demandes de confirmation au guichet en attente sont perdues : le festivalier refait son rattachement.
- La réémission porte sur les bracelets **non utilisés** (sans code, ou au code d'une ancienne version jamais servi).
  Un bracelet dont le code a déjà servi n'est pas touché. Les lots clos sont réémis comme les autres. Seuls les lots
  `PUBLIC` portent un code.
- **Un fichier de codes est un secret.** Il contient des codes en clair : jamais par courriel ni messagerie, jamais
  dans un dépôt, détruit après remise à l'imprimeur. La commande le crée en mode `0600` et refuse d'en écraser un.
- **Fichier orphelin.** La commande écrit le fichier avant la base. Si elle est tuée entre les deux, un fichier de
  codes reste, sans valeur (la base n'a rien enregistré) : le détruire, puis relancer la commande avec un nouveau nom.
  La commande supprime elle-même son fichier quand la base refuse. Si la validation de la base est d'issue incertaine,
  le fichier est conservé : relancer la commande sans l'avoir vérifié est interdit (voir « Vérifications »).

## Quand

- Le secret a fuité, ou on le soupçonne.
- Une personne qui le connaissait quitte l'exploitation.

## Avant de commencer

1. Accord écrit du porteur.
2. Choisir une fenêtre sans bracelets en cours d'attache (festival fermé, caisses arrêtées).
3. Copier l'ancienne valeur de `CLAIM_CODE_HMAC_KEY` et sa version dans le coffre. **Jamais dans un dépôt.**
4. Disposer du rôle d'exploitation : `DATABASE_URL_CLAIMADMIN` (rôle `cashless_claimadmin`, qui n'exécute que les
   trois fonctions de la commande). Jamais `DATABASE_URL_APP`, jamais le propriétaire de la base.

## Étapes

1. **Générer un secret** de 32 octets au moins : `openssl rand -hex 32`. Le noter dans le coffre, nulle part ailleurs.
2. **Poser** `CLAIM_CODE_HMAC_KEY` (nouvelle valeur) et `CLAIM_CODE_HMAC_KEY_VERSION` (**ancienne version + 1**) pour
   tous les processus qui lisent l'empreinte : API publique, personnalisation. Une version inférieure à la plus haute
   connue de la base fait refuser le démarrage de l'API : c'est voulu, une rotation ne se défait pas.
3. **Redémarrer** ces processus. À partir de là, les anciens codes sont refusés.
4. **Réémettre**, pour chaque lot `PUBLIC` concerné, avec les mêmes `CLAIM_CODE_HMAC_KEY` et
   `CLAIM_CODE_HMAC_KEY_VERSION` que l'API, et `CLAIM_CODE_DOMAIN` (domaine des liens imprimés) :

   ```
   DATABASE_URL_CLAIMADMIN=... CLAIM_CODE_HMAC_KEY=... CLAIM_CODE_HMAC_KEY_VERSION=... CLAIM_CODE_DOMAIN=... \
   node --require tsx/cjs apps/api/dist/cli/reissue-claim-codes.js \
     --operator <identifiant du prestataire> --batch <identifiant du lot> --out <fichier.csv>
   ```

   La sortie standard est le nombre de codes réémis, rien d'autre. Le fichier `<fichier.csv>` (cinq colonnes
   `rank,code,url,uid,printed_number`, mode `0600`) ne doit pas exister. La commande refuse une version inférieure à celle de la base (« rotation à
   l'envers »), sans rien écrire.

5. **Remettre le fichier à l'imprimeur** comme nouveau fichier de commande, par un canal sûr. Chaque ligne
   (`rank,code,url,uid,printed_number`) nomme son bracelet : `uid` est l'UID NFC en hexadécimal, `printed_number` le
   numéro imprimé (vide s'il n'y en a pas). Poser l'étiquette ou le QR de la ligne sur le bracelet de cet UID (ou de ce
   numéro). Un lot dont un bracelet n'a pas d'UID n'est pas réémis (code `1`) : voir l'exploitation.
6. **Aucun import** : la réémission lie elle-même chaque code à son bracelet en base. Ne pas importer de fichier de
   correspondance de l'imprimeur pour ce lot : l'import refuserait les codes déjà liés
   (`CLAIM_CODE_ALREADY_ASSOCIATED`).
7. **Détruire le fichier** de codes (et toute copie) dès que l'imprimeur l'a reçu.
8. **Vérifier** (section suivante).

## Vérifications

- Un ancien code est refusé comme un code inconnu (rattachement : `422 MEDIA_CLAIM_INVALID`).
- Un code du nouveau fichier rattache le bracelet de sa ligne (même UID).
- La sortie standard de la commande est le nombre attendu de bracelets du lot.
- Avant toute relance après une issue incertaine : vérifier en base que les bracelets du lot portent ou non la
  nouvelle version (`media.claim_key_version`) ; si oui, le fichier conservé est le seul exemplaire des codes.

## Codes de sortie

| Code | Sens                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Succès ; la sortie standard donne le nombre de codes réémis.                                                                                                                                                                                                                                                    |
| `1`  | Autre erreur : argument invalide ou manquant, `DATABASE_URL_CLAIMADMIN` absente, rôle refusé en production, version inférieure à la base, un bracelet du lot sans UID, fichier déjà présent ou impossible à écrire, refus de la base (la commande a supprimé son fichier), issue incertaine (fichier conservé). |
| `2`  | Lot introuvable, d'un autre prestataire, ou non `PUBLIC`.                                                                                                                                                                                                                                                       |
| `3`  | Aucun bracelet à réémettre dans ce lot.                                                                                                                                                                                                                                                                         |

Les messages d'erreur ne contiennent jamais un code ni une empreinte.

## Ce qu'il ne faut jamais faire

- Accorder un droit à `cashless_app`, ou lancer la commande avec `DATABASE_URL_APP` ou le propriétaire.
- Relancer la commande sans avoir détruit le fichier précédent (elle le refuse), ni le garder après remise.
- Réutiliser un ancien secret ou une ancienne version.
- Envoyer le fichier de codes par courriel ou le déposer dans un dépôt ou un partage.

## Renvois

- Contrat : `contracts/claim-code-rotation.md` (mission serveur-app-festivalier).
- OP-N47 (levé par WP11) ; décision : ADR-87.
