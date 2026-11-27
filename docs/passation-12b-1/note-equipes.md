# Note aux équipes et au porteur : adaptateurs des fournisseurs choisis (mission 12b-1)

Version du 27 novembre 2026. Ce document dit ce qui change pour les équipes clientes et ce qu'il reste à faire au porteur. Le
contrat (`packages/contracts/openapi.yaml`) fait foi. Décisions : ADR-237 à ADR-240 ; limites : `docs/POINTS_OUVERTS.md` §16.
**Aucun service n'est encore essayé contre le vrai service et aucun n'est autorisé en production** : tant que la liste
`PRODUCTION_ENABLED_SERVICES` est vide, aucune recharge en ligne n'est servie en production.

## 1. Équipes clientes (back-office, app terminal, app festivalier)

- **Aucune route nouvelle, aucun code d'erreur nouveau.** Seul ajout au contrat (rétrocompatible, D9) : `receivePspWebhook`
  accepte aussi un corps `application/x-www-form-urlencoded`, réservé à `paydunya`, et décrit la preuve d'origine de chaque
  fournisseur. Les équipes qui n'appellent pas cette route (elle est réservée aux PSP) n'ont rien à changer.
- **Recharge PayDunya par carte** : la recharge est reçue mais non créditée (pas de preuve 3-D Secure, OP-N200) ; une anomalie est
  ouverte. Ne pas afficher « créditée » : relire l'état de la recharge. Le remboursement au payeur se fait hors plateforme (OP-N82).
- **Recharge Stripe par carte** : seul un 3-D Secure authentifié vaut un succès ; sinon la recharge est reçue, non créditée.
- **Mission 12 (app terminal)** : contrôle des extensions d'App Attest et test de la chaîne RKP Android (OP-N202, OP-N203).

## 2. Déclarations chez les fournisseurs (porteur)

| Fournisseur | À déclarer |
|---|---|
| Wave | l'adresse `https://<api>/v1/webhooks/wave/<psp_config_id>` ; adresses de retour `WAVE_DEFAULT_SUCCESS_URL` et `WAVE_DEFAULT_ERROR_URL` |
| PayDunya | rien : l'adresse de notification est transmise à chaque facture |
| Stripe | l'adresse `https://<api>/v1/webhooks/stripe/<psp_config_id>` pour `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` et `charge.dispute.created` |

PayDunya envoie sa notification en formulaire (`data[hash]`, `data[status]`, `data[invoice][token]`) : le contrat le décrit.

## 3. Étapes du porteur (`quickstart.md` de la mission, `docs/SERVICES-EXTERNES.md` §5)

1. Poser identifiants et clés (forme des secrets : `docs/SERVICES-EXTERNES.md` §2.4) ; un rôle IAM par processus ; compartiment S3
   Object Lock sous un compte distinct.
2. Lancer `npm run essai -w @cashless/api -- <service> …` hors production, pour `psp.wave`, `psp.paydunya`, `psp.stripe`,
   `psp.secrets`, `kms`, `seal-copy` ; garder le compte rendu sous `docs/essais/<service>.json`.
   Attention : sans `--retention-days`, l'objet S3 de test est verrouillé 3 650 jours, irrévocable (OP-N210) ; les clés KMS de test
   restent désactivées, jamais supprimées.
3. Confirmer les points « à confirmer à l'essai » (OP-N206), vérifier pour Stripe l'éligibilité XOF et Sénégal.
4. PR relue qui ajoute le service à `PRODUCTION_ENABLED_SERVICES` et met à jour `production-enabled.spec.ts`.
5. **En attente du porteur** : OP-N202 (« bloque la production : Non » est une proposition de l'Agent, non tranchée) ;
   durcissement de la garde réseau des tests (OP-N207, proposé : refuser `options.lookup` ou contrôler l'adresse résolue ; la
   mission 13 est décidée, pas la forme) ; réexamen des écarts PayDunya (OP-N199 à OP-N201) à l'essai ; décision sur un état
   partagé en base pour OP-N205, après la mesure à la recette avec plusieurs instances (aucune mission affectée).
   **Décidé le 27/11/2026** : OP-N203 ne bloque pas la production (écart ouvert jusqu'à la mission 12) ; OP-N207, OP-N208 et
   OP-N211 sont levés par la mission 13.
6. Faire relire par une personne les fichiers listés au §16 de `docs/POINTS_OUVERTS.md` (clés, cryptographie, garde).
