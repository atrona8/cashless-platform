// Services externes que la mission 12b-1 branche au réel (interfaces.md §7). Les noms sont ceux de la liste
// `PRODUCTION_ENABLED_SERVICES` et des comptes rendus d'essai `docs/essais/<service>.json`.
export const EXTERNAL_SERVICES = [
  'psp.wave',
  'psp.paydunya',
  'psp.stripe',
  'psp.secrets',
  'kms',
  'seal-copy',
] as const;
export type ExternalService = (typeof EXTERNAL_SERVICES)[number];

/** Services hors périmètre de la mission : jamais listables en production (D1 pour Orange Money). */
export const OUT_OF_SCOPE = [
  'psp.orange-money',
  'otp.whatsapp',
  'otp.sms',
  'otp.sms-fallback',
  'oidc',
  'edge.hardware-keystore',
  'bank',
] as const;
