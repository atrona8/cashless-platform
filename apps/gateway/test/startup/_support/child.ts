// Démarrages réels dans un processus enfant (aucune simulation) : code de sortie, sortie d'erreur,
// port ouvert.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

const GATEWAY = join(__dirname, '..', '..', '..');
const TSX = require.resolve('tsx/cjs');

export interface ChildResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  listening: boolean;
  port: number | null;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Lance `entry` (par défaut `src/main.ts`). Attend la fin du processus, ou la ligne « GATEWAY
 * listening » puis
 * l'arrête par SIGTERM. `env` est TOUT l'environnement de l'enfant (rien d'hérité sauf PATH).
 */
export function runGateway(
  env: Record<string, string>,
  options: { entry?: string; args?: string[]; timeoutMs?: number } = {},
): Promise<ChildResult> {
  const entry = options.entry ?? join(GATEWAY, 'src', 'main.ts');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', TSX, entry, ...(options.args ?? [])], {
      cwd: GATEWAY,
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let stdout = '';
    let stderr = '';
    let listening = false;
    let port: number | null = null;
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /GATEWAY listening \w+ port=(\d+)/.exec(stdout);
      if (match && !listening) {
        listening = true;
        port = Number(match[1]);
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, listening, port });
    });
  });
}

export const CHILD_MAIN = join(__dirname, 'child-main.ts');
