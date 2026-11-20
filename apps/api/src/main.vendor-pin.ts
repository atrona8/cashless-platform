// Point d'entrée du processus `vendor-pin` (mission 11a, lot WP06) : routes internes
// `/v1/internal/vendor-pin/{open,hash}`, appelées par l'API seule. Écoute locale (127.0.0.1) par défaut :
// `VENDOR_PIN_HOST` la remplace pour un déploiement où l'API est sur une autre machine (TLS 1.3 alors
// obligatoire en production, comme pour les autres processus).
import 'reflect-metadata';
import { serve } from './processes/bootstrap';
import { VendorPinProcessModule } from './processes/vendor-pin.module';

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)
    throw new Error(`${name} : port invalide (reçu « ${raw} »)`);
  return parsed;
}

void serve(VendorPinProcessModule, port('VENDOR_PIN_PORT', 3003), {
  host: process.env.VENDOR_PIN_HOST || '127.0.0.1',
});
