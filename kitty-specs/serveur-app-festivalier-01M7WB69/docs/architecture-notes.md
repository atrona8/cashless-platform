# Notes d'architecture : mission serveur-app-festivalier-01M7WB69

> État : **plan finalisé le 20/11/2026, non implémentée**. Pas de diagramme dans ce fichier (routage
> `.docmeta/diagram-style-routing.md`). Dettes et décisions à consigner à l'implémentation :
> `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md` (non touchés par cet addendum).

## Composant(s) introduit(s) ou modifié(s) par cette mission
**Aucun conteneur nouveau.**
- **Module `kyc/` de l'API** : routes `createKycVerification` et `revokeKycVerification` (déclarées
  au contrat depuis la 5b), action d'approbation `KYC_REVOCATION` ; écriture par les fonctions
  `SECURITY DEFINER` `create_kyc_verification` et `revoke_kyc_verification` (migration `0096`).
- **Version du secret des codes de rattachement** (`0097`) : `CLAIM_CODE_HMAC_KEY_VERSION`, colonnes
  `claim_key_version` / `key_version` ; toute recherche d'empreinte filtre la version courante.
- **Commande d'exploitation** `apps/api/src/cli/reissue-claim-codes.ts` et fonction
  `reissue_claim_codes`, exécutable par le **rôle nouveau `cashless_claimadmin`** (section 14 de
  `post-roles.sql`) ; `cashless_app` n'a aucun droit dessus.
- **`/me`** : `media.printed_number` (`0098`), fonction `wallet_pending_offline_notice`.
- **Chaîne d'envoi des codes** : expéditeur composite `otp-chain.ts` (WhatsApp, SMS principal, SMS de
  repli), table `otp_channel_attempt` (`0099`, sans code), trois faux refusés en production.
- Migrations `0096` à `0099` ; aucune dépendance nouvelle ; contrat : un seul ajout rétrocompatible
  (colonne facultative du fichier de l'imprimeur, validé par le porteur le 20/11/2026).

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Identification écrite par fonctions `DEFINER` seules | Une API compromise ne contourne pas les règles de compte et d'agent | Contrôles dans l'API seulement |
| Agent titulaire : égalité du numéro vérifié et de `app_user.phone` (décision du 20/11) | Pas de table de lien ; limite consignée (C-005) | Table de lien agent et compte |
| Rotation immédiate, version du secret sur chaque empreinte (décision du 20/11) | Pas d'opération de masse ; ancienne version = absente | Purge manuelle ; double empreinte bornée |
| Réémission par commande d'exploitation et rôle dédié (décision du 20/11) | Contrat inchangé ; renforcement de sécurité | Route d'API ouverte à `cashless_app` |
| Code d'envoi gardé en mémoire du processus, 30 s au plus (décision du 20/11) | Aucun code en base ni journal ; bascule perdue au redémarrage | Code chiffré en base |
| `printed_number` : troisième colonne facultative du fichier de l'imprimeur | Aucune autre source de ce numéro | Champ saisi à la main |

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » (rôle `cashless_claimadmin`,
commande d'exploitation, version du secret, chaîne d'envoi). Aucun conteneur ajouté à la vue C4.

## Nécessaire pour cette mission ? Oui : un rôle de base, une commande d'exploitation et des droits changent ; réponse proposée par l'Agent, à confirmer par le porteur.
## Complet ? Oui pour le plan ; à recaler à l'implémentation (noms de fichiers, écarts). Réponse proposée par l'Agent.
## Validé par : en attente du porteur.
