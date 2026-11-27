# Comptes rendus d'essai des services externes

Ce dossier contient, pour chaque service externe de la mission 12b-1, le compte rendu de son **essai contre le vrai
service** : `docs/essais/<service>.json`. Il est vide tant qu'aucun essai n'a réussi.

## À quoi il sert

En production, un adaptateur réel ne tourne que si son service figure dans `PRODUCTION_ENABLED_SERVICES`
(`apps/api/src/external-services/production-enabled.ts`). Cette liste est dans le code, vide aujourd'hui, et aucun
réglage ne la modifie (décisions du porteur D3 et D6, 26/11/2026). Le test
`apps/api/test/unit/external-services/production-enabled.spec.ts` exige, pour chaque service listé, un compte rendu
réussi dans ce dossier.

Services : `psp.wave`, `psp.paydunya`, `psp.stripe`, `psp.secrets`, `kms`, `seal-copy`. Hors périmètre, jamais listables :
`psp.orange-money` (D1), `otp.whatsapp`, `otp.sms`, `otp.sms-fallback`, `oidc`, `edge.hardware-keystore`, `bank`.

## Forme d'un compte rendu

```json
{
  "service": "psp.wave",
  "startedAt": "2026-12-01T10:00:00Z",
  "steps": [
    { "name": "creation-session", "ok": true, "httpStatus": 200, "durationMs": 412 },
    { "name": "relecture-statut", "ok": true, "httpStatus": 200, "durationMs": 187 }
  ],
  "ok": true
}
```

`service` porte le nom du fichier ; `ok` est vrai seulement si toutes les étapes le sont ; `httpStatus` est facultatif.

## Jamais de secret

Un compte rendu ne contient **ni clé, ni jeton, ni secret de notification, ni corps complet de réponse, ni référence de
secret, ni nom de compartiment**. Le test refuse tout fichier qui ressemble à un secret (`sk_`, `whsec_`, `wave_sn_`, `AKIA`,
chaîne de 30 caractères ou plus). La commande d'essai (`npm run essai -w @cashless/api -- <service> [--sandbox]`,
mission 12b-1, lot WP11) produit un compte rendu qui respecte déjà cette règle.

## Procédure pour activer un service en production (D6)

1. Lancer la commande d'essai contre le vrai service, hors production (elle refuse `NODE_ENV=production`).
2. Vérifier le compte rendu, sans secret, puis le commiter ici sous `<service>.json`.
3. Ajouter le nom du service à `PRODUCTION_ENABLED_SERVICES`, et mettre à jour dans la même PR le test
   `production-enabled.spec.ts` (la liste attendue n'est plus vide).
4. Faire relire la PR par une personne : l'agent qui écrit le code ne vaut pas relecture indépendante.
5. Les points « à confirmer à l'essai » du service (constantes commentées dans son adaptateur) sont levés ou consignés
   dans `docs/POINTS_OUVERTS.md` avant la fusion.
