---
affected_files: []
cycle_number: 2
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-26T15:14:30Z'
reviewer_agent: claude
wp_id: WP12
---

# WP12 — cycle 2 : décision du porteur du 26/11/2026 (après approbation du cycle 1)

1. **Android, certificats d'usine expirés (décision : exception limitée).** Accepter, pour la SEULE racine Google
   `f92009e853b6b045` (empreinte exacte à figer dans le code, comparée sur la clé publique de la racine), les certificats
   intermédiaires et d'usine dont la validité est échue, comme le demande la documentation de Google pour les appareils
   d'avant 2021. Tout le reste inchangé : chaîne vérifiée cryptographiquement jusqu'à cette racine, liste de révocation
   appliquée, certificat feuille (la clé attestée) toujours dans sa validité, toute autre racine sans exception.
   Assouplissement décidé par le porteur : le dire dans la note de lane ; WP13 le consignera (OP, ADR).
   **Test de borne (règle 3)** : un certificat expiré sous une AUTRE racine reste refusé ; une feuille expirée reste
   refusée ; un certificat révoqué sous la racine d'exception reste refusé. Mutation : élargir l'exception à toute racine
   → test rouge.
2. **Apple (décision : mission 12, vecteur réel).** Aucun code ; mettre à jour `attestations-comparaison.md` (décision et
   renvoi à la mission 12).
