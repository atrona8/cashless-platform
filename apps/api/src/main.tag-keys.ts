// Point d'entrée du processus « clés de bracelet » : POST /media/auth-keys et rechiffrement (SPECIFICATION §3.2, §7.4).
import 'reflect-metadata';
import { serve } from './processes/bootstrap';
import { TagKeysProcessModule } from './processes/tag-keys.module';

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)
    throw new Error(`${name} : port invalide (reçu « ${raw} »)`);
  return parsed;
}

void serve(TagKeysProcessModule, port('TAG_KEYS_PORT', 3001));
