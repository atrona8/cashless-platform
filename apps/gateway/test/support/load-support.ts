// Aides des preuves de charge (T114, NFR-001, NFR-002, NFR-005, NFR-006, NFR-007, NFR-008).
//   - `LONG` : les essais longs (20 bascules, 10 000 opérations) sont derrière `M8_E2E_LONG=1` ;
//     sans elle, la même suite tourne avec des volumes réduits (dits dans la sortie). Les
// chiffres de
//     la recette sont ceux du mode long.
//   - `report` : une ligne JSON par mesure, sur la sortie et, si `M8_E2E_REPORT` est posée, dans ce
//     fichier (ajout).
//   - `KeepAliveClient` : un terminal qui parle à la passerelle sur UNE connexion TLS 1.3
// persistante
//     (comme la tablette), la signature et le jeton étant préparés HORS de la mesure : ce qui est
//     chronométré est « requête partie, réponse reçue », donc le serveur seul (R-28), sans la
// poignée
//     de main ni la signature du client.
import { appendFileSync } from 'node:fs';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import type { PayTerminal } from '../../../api/test/integration/payments/payments-fixtures';
import type { PreparedRequest } from '../../../api/test/support/test-terminal';
import { sleep, until, type TwoProcessBench } from './two-process-bench';

export const LONG = process.env.M8_E2E_LONG === '1';

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export const round = (x: number, digits = 1): number => Number(x.toFixed(digits));

/** Résume des durées en ms : n, min, p50, p95, p99, max. */
export function summarize(xs: number[]): Record<string, number> {
  return {
    n: xs.length,
    min: round(Math.min(...xs)),
    p50: round(percentile(xs, 50)),
    p95: round(percentile(xs, 95)),
    p99: round(percentile(xs, 99)),
    max: round(Math.max(...xs)),
  };
}

export function report(name: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({ name, long: LONG, at: new Date().toISOString(), ...data });
  process.stderr.write(`M8-MESURE ${line}\n`);
  const file = process.env.M8_E2E_REPORT;
  if (file) appendFileSync(file, `${line}\n`);
}

/** Bascule vers la passerelle, attend `ACTIVE` et la réplication des bracelets donnés. */
export async function activateEdge(
  bench: TwoProcessBench,
  walletIds: string[] = [],
  reason?: string,
): Promise<number> {
  const started = performance.now();
  await bench.switchToEdge(reason);
  await bench.waitLocalState('ACTIVE', 60_000);
  await bench.refreshEpoch();
  if (walletIds.length > 0)
    await until(
      'portefeuilles répliqués',
      async () =>
        Number(
          (
            await bench.localQuery<{ n: string }>(
              'SELECT count(*)::text AS n FROM edge_wallet WHERE wallet_id = ANY($1::uuid[])',
              [walletIds],
            )
          )[0]!.n,
        ) >= walletIds.length,
      120_000,
      200,
    );
  return performance.now() - started;
}

function sendOn(
  agent: https.Agent,
  prepared: PreparedRequest,
  ca: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: prepared.url.hostname,
        port: prepared.url.port,
        path: `${prepared.url.pathname}${prepared.url.search}`,
        method: prepared.method,
        headers: { ...prepared.headers, 'content-length': Buffer.byteLength(prepared.body) },
        ca,
        servername: prepared.url.hostname,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(prepared.body);
  });
}

export class KeepAliveClient {
  private readonly agent: https.Agent;
  constructor(
    private readonly bench: TwoProcessBench,
    readonly term: PayTerminal,
  ) {
    this.agent = new https.Agent({
      keepAlive: true,
      maxSockets: 1,
      ca: bench.serverCa,
      cert: term.t.certificatePem,
      key: term.t.signingPrivatePem,
      minVersion: 'TLSv1.3',
    });
  }

  /** Paiement sur la passerelle : `ms` = envoi à réponse complète (signature et jeton exclus). */
  async pay(
    body: unknown,
    epoch = this.bench.epoch,
  ): Promise<{ status: number; ms: number; text: string }> {
    const token = await this.bench.gatewayToken(this.term);
    const prepared = this.term.t.prepare(
      this.bench.gwBaseUrl,
      { method: 'POST', path: '/payments', body, idempotencyKey: this.term.t.seqKey() },
      { token, headers: { 'x-authority-epoch': String(epoch) } },
    );
    const t0 = performance.now();
    const res = await sendOn(this.agent, prepared, this.bench.serverCa);
    return { ...res, ms: performance.now() - t0 };
  }

  /** Paiement au CENTRAL (jeton du central du terminal), même connexion persistante. */
  async payCentral(
    body: unknown,
    key: string,
    epoch: number,
  ): Promise<{ status: number; ms: number; text: string }> {
    const prepared = this.term.t.prepare(
      this.bench.centralBaseUrl,
      { method: 'POST', path: '/payments', body, idempotencyKey: key },
      { headers: { 'x-authority-epoch': String(epoch) } },
    );
    const t0 = performance.now();
    const res = await sendOn(this.agent, prepared, this.bench.serverCa);
    return { ...res, ms: performance.now() - t0 };
  }

  close(): void {
    this.agent.destroy();
  }
}

/**
 * Boucle à cadence fixe : `fn` part toutes les `periodMs` (sans rattrapage), jusqu'à `stop()`.
 * Une erreur de `fn` ne tue pas la boucle (sinon `stop()` rejetterait et le nettoyage du test
 * resterait bloqué) : elle est gardée dans `failures()` et jugée par le test.
 */
export function paced(
  periodMs: number,
  fn: () => Promise<void>,
): { stop: () => Promise<void>; started: () => number; failures: () => unknown[] } {
  let running = true;
  let launched = 0;
  const failures: unknown[] = [];
  const loop = (async () => {
    let next = performance.now();
    while (running) {
      try {
        await fn();
      } catch (error) {
        failures.push(error);
      }
      launched += 1;
      next += periodMs;
      const wait = next - performance.now();
      if (wait > 0) await sleep(wait);
      else next = performance.now();
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
    },
    started: () => launched,
    failures: () => failures,
  };
}
