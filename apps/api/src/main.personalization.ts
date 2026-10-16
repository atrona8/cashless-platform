// Point d'entrée du processus « personnalisation » : enregistrement des bracelets personnalisés (SPECIFICATION §7.5).
import 'reflect-metadata';
import { serve } from './processes/bootstrap';
import { PersonalizationProcessModule } from './processes/personalization.module';

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) throw new Error(`${name} : port invalide (reçu « ${raw} »)`);
  return parsed;
}

void serve(PersonalizationProcessModule, port('PERSONALIZATION_PORT', 3002));
