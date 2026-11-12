// Port d'écoute du processus `edge` : `EDGE_LISTEN_PORT` (interfaces.md § 8, pas `EDGE_PORT`), sans valeur par défaut.
import { loadConfig } from '../config/config';

export function requireEdgeListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const port = loadConfig(env).edgeListenPort;
  if (port === null)
    throw new Error('EDGE_LISTEN_PORT manquant : port d’écoute du processus edge obligatoire');
  return port;
}
