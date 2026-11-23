# Notes d'architecture : mission serveur-app-festivalier-01M7WB69

> État : **relue le 23/11/2026 (11 lots sur 11 approuvés), non fusionnée**, recalée sur la lane `k`. Pas de
> diagramme dans ce fichier (routage `.docmeta/diagram-style-routing.md`). Dettes et décisions consignées par WP11 :
> OP-N47 levé, OP-N163 à OP-N169 (`docs/POINTS_OUVERTS.md`), ADR-225 à ADR-231 (`docs/DECISIONS_ADR.md`) ;
> preuves : `docs/passation-10a/preuves.md`.

## Composant(s) introduit(s) ou modifié(s) par cette mission
**Aucun conteneur nouveau.**
- **Module `kyc/` de l'API** : routes `createKycVerification` et `revokeKycVerification` (déclarées
  au contrat depuis la 5b), action d'approbation `KYC_REVOCATION` ; écriture par les fonctions
  `SECURITY DEFINER` `create_kyc_verification` et `revoke_kyc_verification` (migration `0096`, codes `CL060` à
  `CL063`) ; `kyc.controller.ts`, `kyc-revocation.controller.ts`, `kyc-revocation-action.ts`. Réponse `422` de la
  révocation déclarée au contrat (ADR-225).
- **Version du secret des codes de rattachement** (`0097`) : `CLAIM_CODE_HMAC_KEY_VERSION`, colonnes
  `claim_key_version` / `key_version` ; toute recherche d'empreinte filtre la version courante.
- **Commande d'exploitation** `apps/api/src/cli/reissue-claim-codes.ts` et fonction
  `reissue_claim_codes` (`0097`), exécutable par le **rôle nouveau `cashless_claimadmin`** (section 14 de
  `post-roles.sql`) ; `cashless_app` n'a aucun droit dessus. Fichier de sortie `rank,code,url,uid,printed_number`
  (écart au plan : trois colonnes prévues). `migrate.ts` refuse de démarrer en production sans
  `CASHLESS_CLAIMADMIN_PASSWORD` (renforcement, règle 1 de `CLAUDE.md`).
- **`/me`** : `media.printed_number` (`0097`, et non `0098`), fonction `wallet_pending_offline_notice` (`0098`,
  par terminal et grand livre du portefeuille, `STABLE`, sous RLS).
- **Chaîne d'envoi des codes** : expéditeur composite `otp-chain.ts` (WhatsApp, SMS principal, SMS de
  repli), table `otp_channel_attempt` (`0099`, sans code ; ajoute `UNIQUE (id, operator_id)` à `otp_challenge`), trois faux
  refusés en production. Code en mémoire **35 s au plus** (`OTP_CODE_HARD_CAP_MS`, et non 30 s : la fiche
  commune a été corrigée avant l'implémentation) ; au plafond, la chaîne s'arrête sans repli (OP-N166).
- Migrations `0096` à `0099` ; aucune dépendance nouvelle ; contrat : un seul ajout rétrocompatible
  (colonne facultative du fichier de l'imprimeur, validé par le porteur le 20/11/2026).

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Identification écrite par fonctions `DEFINER` seules | Une API compromise ne contourne pas les règles de compte et d'agent | Contrôles dans l'API seulement |
| Agent titulaire : égalité du numéro vérifié et de `app_user.phone` (décision du 20/11) | Pas de table de lien ; limite consignée (C-005) | Table de lien agent et compte |
| Rotation immédiate, version du secret sur chaque empreinte (décision du 20/11) | Pas d'opération de masse ; ancienne version = absente | Purge manuelle ; double empreinte bornée |
| Réémission par commande d'exploitation et rôle dédié (décision du 20/11) | Contrat inchangé ; renforcement de sécurité | Route d'API ouverte à `cashless_app` |
| Code d'envoi gardé en mémoire du processus, 35 s au plus (décision du 20/11) | Aucun code en base ni journal ; bascule perdue au redémarrage | Code chiffré en base |
| Fichier de réémission à cinq colonnes (décision du porteur, soir du 20/11) | Chaque code nomme son bracelet : plus d'import, pas d'erreur d'appariement | Trois colonnes puis import |
| `422` déclaré sur `revokeKycVerification`, deux motifs de ligne au contrat (ADR-225) | Contrat fidèle au comportement ; ajouts rétrocompatibles | Laisser le `422` non déclaré |
| `SPECIFICATION.md` §6.3 point 5 amendé le 23/11/2026 (deux personnes) | Lève la contradiction avec le contrat (OP-N164) | Garder « un administrateur peut » |
| `printed_number` : troisième colonne facultative du fichier de l'imprimeur | Aucune autre source de ce numéro | Champ saisi à la main |

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » (rôle `cashless_claimadmin`,
commande d'exploitation, version du secret, chaîne d'envoi). Aucun conteneur ajouté à la vue C4 (vérifié à la
review : aucun nouveau processus).

## Nécessaire pour cette mission ? Oui : un rôle de base, une commande d'exploitation et des droits changent ; réponse proposée par l'Agent, en attente du porteur (reconduite le 23/11/2026).
## Complet ? Oui, recalé à la review (noms de fichiers réels, cinq écarts au plan consignés ci-dessus et dans `06-docs-status.md`). Réponse proposée par l'Agent, en attente du porteur.
## Validé par : en attente du porteur.
