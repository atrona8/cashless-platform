# Contrat interne — Chaîne d'envoi des codes (ADR-66)

Aucune route modifiée : `requestCustomerOtp` (`channel` : `AUTO`, `SMS`, `WHATSAPP`) inchangée.

## Port

`OtpSender.send(phone, code, channel, link?)` inchangé. Implémentation `ChainedOtpSender` composée de trois
fournisseurs `OtpProvider { name; send(phone, code): Promise<{ accepted: boolean; noWhatsApp?: boolean }>;
onDelivery(cb) }`.

## Ordre

| Canal demandé | Étapes |
|---|---|
| `AUTO` | WhatsApp ; si non confirmé à 10 s ou `noWhatsApp` : SMS principal ; si non confirmé à 20 s : SMS de repli |
| `WHATSAPP` | comme `AUTO` |
| `SMS` | SMS principal ; si non confirmé à 20 s : SMS de repli |

Délais réglables par la plateforme (`OTP_WHATSAPP_TIMEOUT_MS`, `OTP_SMS_PRIMARY_TIMEOUT_MS`).

## Garanties

- Le code n'existe qu'en mémoire du processus pendant la chaîne (30 s au plus), effacé à la confirmation, à la fin de la
  chaîne ou à l'arrêt ; jamais en base, dans un journal ou une réponse (hors `X-Test-Otp-Code` du faux, OP-N120).
- Un seul défi, un seul code ; les bascules n'ajoutent pas de défi et ne comptent pas dans les limites.
- Chaque essai noté dans `otp_channel_attempt` sans code ni empreinte.
- Redémarrage pendant la chaîne : bascule perdue ; le festivalier redemande (limites existantes) ou choisit `SMS`.
- Les trois faux refusent le démarrage en production (`FakeInProductionError`), recensés dans `production-refusals.spec.ts`.
