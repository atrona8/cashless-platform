# Contrat — service de clés, processus et rôles

## Ports (un par droit)

| Port | Opération | Processus qui le reçoivent |
|---|---|---|
| `MacPort` | `generateMac(kmsKeyRef, message) → 32 o` | personnalisation, contrôle quotidien |
| `DataKeyPort` | `generateDataKey(wrappingKeyRef) → { plaintext 32 o, encrypted }` | personnalisation |
| `DecryptPort` | `decrypt(wrappingKeyRef, encrypted) → 32 o` | clés de bracelet, contrôle quotidien |
| `KeyAdminPort` | `createKey(kind)`, `disableKey(ref)` | commande d'administration seulement (`main.key-admin.ts`) |

L'API publique n'en reçoit aucun. Un test d'architecture parcourt le graphe des modules de chaque point d'entrée et
échoue si un port apparaît hors de sa liste (NFR-005).

Toute valeur en clair rendue par un port est un tampon que l'appelant met à zéro dans un `finally`. Le faux KMS compte
ses appels par opération ; les tests s'en servent pour NFR-003.

## Garde de production (NFR-010)

Au démarrage de chaque processus, si `NODE_ENV=production` et qu'un faux est le fournisseur d'un port (KMS, identité du
terminal, identité du festivalier), le démarrage échoue avec un message qui nomme le faux. Un test par faux. Aucun
réglage d'exécution ne permet de contourner la garde.

## Travaux de clé (`tag_key_job`)

| Sorte | Créé par | Exécuté par | Effet |
|---|---|---|---|
| `CREATE_KEY` | approbation `TAG_KEY_CREATE` | commande d'administration | crée la clé de dérivation et désigne la clé d'emballage ; `tag_key` nouvel index ; l'ancienne clé active partagée passe en `DECRYPT_ONLY` ; la clé est utilisable aussitôt |
| `ROTATE_DEK` | approbation `TAG_DEK_ROTATE` | personnalisation | nouvelle version `ACTIVE`, toutes les autres `DECRYPT_ONLY` ; crée `REENCRYPT` |
| `REENCRYPT` | `ROTATE_DEK` | clés de bracelet | par tranches de 500 ; chaque ancienne version passe `RETIRED` quand plus aucun bracelet ne la référence |
| `RETIRE_KEY` | approbation `TAG_KEY_RETIRE` | personnalisation | `retire_dedicated_key` ; crée `DISABLE_KMS_KEY` |
| `DISABLE_KMS_KEY` | `RETIRE_KEY` | commande d'administration | désactive la clé, renseigne `kms_disabled_at` ; rejoué tant qu'il échoue |

Un travail est repris après interruption sans double effet (NFR-008). Son avancement est lisible par l'API publique.

## Commande d'administration des clés

`main.key-admin.ts` : sans serveur HTTP ; exécute les travaux `CREATE_KEY` et `DISABLE_KMS_KEY` en attente puis
s'arrête (`--once`), ou les liste (`--list`). Lancée par l'exploitant, avec le rôle de base `cashless_keyadmin` et le
seul `KeyAdminPort`. Un travail en attente de la commande est visible dans `listTagKeyJobs`, pour que l'administrateur
sache qu'une intervention est requise.

## Cache de la clé de données (processus des clés de bracelet)

Une entrée par (prestataire, index, version), durée `TAG_DEK_CACHE_SECONDS` (0 à 300, défaut 300 ; 0 = aucun cache).
Tampon mis à zéro à l'expiration, à l'éviction et à l'arrêt. Seul autre endroit où une clé de données en clair
survit à une requête : la clé de session de la personnalisation (ci-dessous).

## Clé de données de session (processus de personnalisation)

La personnalisation n'a pas `DecryptPort`. `SessionDataKeyProvider.get(prestataire, index)` : au premier appel ou après
expiration, `generateDataKey`, nouvelle version `ACTIVE` (la précédente en `DECRYPT_ONLY`), clair gardé en mémoire.
Effacement : après `TAG_DEK_CACHE_SECONDS` sans utilisation, à l'arrêt, et dès que la version n'est plus active en base.
La rotation ramène ensuite tous les bracelets d'un index sous une seule version.

## Contrôle quotidien

`runOnce(prestataire)` : tire au plus 100 bracelets personnalisés non retirés, recalcule `PWD‖PACK` par `MacPort`,
déchiffre la valeur stockée (un `decrypt` par clé de données), compare, écrit `tag_key_check_run`. Un écart écrit une
ligne d'audit nommant le bracelet ; aucune anomalie n'est ouverte (liste fermée de §12.2). Le processus `main.tag-check.ts` l'appelle une fois (`--once`) ou en boucle.
