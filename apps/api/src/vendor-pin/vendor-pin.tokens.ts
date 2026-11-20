// Jetons d'injection du processus `vendor-pin` (mission 11a, lot WP06). Valeurs lues UNE fois, au
// démarrage, par `vendorPinSettings` (config.ts) : un secret ou une clé absents en production
// refusent le démarrage, sans valeur de repli.
import type { vendorPinSettings } from '../config/config';

export type VendorPinSettings = ReturnType<typeof vendorPinSettings>;

/** Réglages du processus (secret des PIN, clé d'appel, chaîne de base, port). */
export const VENDOR_PIN_SETTINGS = Symbol('VENDOR_PIN_SETTINGS');
/** Clé HMAC de l'appel interne (`VENDOR_PIN_CALL_KEY`). */
export const VENDOR_PIN_CALL_KEY = Symbol('VENDOR_PIN_CALL_KEY');
