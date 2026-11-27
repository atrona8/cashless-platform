# Quickstart — passer un service réel en production (porteur)

1. **Poser les identifiants** (rien à coder) :
   - Wave : clé d'API (`wave_sn_prod_…`), secret de webhook (`wave_sn_WHS_…`), facultatif secret de signature des
     requêtes ; déclarer chez Wave l'URL `https://<api>/v1/webhooks/wave/<psp_config_id>`.
   - PayDunya : clé maître, clé privée, jeton ; URL de notification transmise à chaque facture (rien à déclarer).
   - Stripe : clé secrète (`sk_…`), secret de webhook (`whsec_…`) ; déclarer l'URL
     `https://<api>/v1/webhooks/stripe/<psp_config_id>` pour `checkout.session.*` et `charge.dispute.created`.
   - Rangement : AWS Secrets Manager, secret JSON `psp/<holder_party_id>/<nom>` (forme : `data-model.md`).
   - AWS : rôle IAM par processus, clés KMS créées par `key-admin`, compartiment S3 Object Lock (compte distinct),
     `AWS_REGION`, `SEAL_COPY_BUCKET`.
2. **Essayer** hors production : `PSP_ADAPTERS=real PSP_SECRET_STORE=real npm run essai -w @cashless/api -- psp.wave
   --sandbox` (de même `psp.paydunya`, `psp.stripe`, `psp.secrets`, `kms`, `seal-copy`). Garder le compte rendu.
3. **Autoriser** : PR qui ajoute le service à `apps/api/src/external-services/production-enabled.ts`, compte rendu
   joint, relue par une personne.
4. **Déployer** avec `PSP_ADAPTERS=real` (et réglages équivalents) : un service hors liste refuse de démarrer ou reste
   indisponible.

Liste complète et à jour : `docs/SERVICES-EXTERNES.md` (mise à jour par la mission).
