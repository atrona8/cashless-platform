// T115 / NFR-004 : arrêt brutal de la passerelle à chacun des points d'arrêt
// (`EDGE_ALLOW_FAILPOINTS=1`, hors production seulement), puis redémarrage : aucune perte,
// numérotation continue, aucune réponse 2xx sans entrée de file, lot renvoyé à l'identique.
//   - `before-local-write`, `after-local-write-before-reply` : pendant une vente ;
//   - `during-drain-after-send-before-result`, `after-releasing-persisted` : pendant le rendu ;
//   - `kill-local-database` : le processus signale le point et attend ; le banc exécute
//     `docker kill` du conteneur PostgreSQL LOCAL (un conteneur jetable `cashless_m8_edge_pg_*`,
//     jamais le serveur partagé du poste), le relance, la passerelle repart.
// Contrôle de sensibilité : un point mal nommé n'arme rien (la vente passe, le test le voit).
// Réglages de durabilité de la base locale (A28) : `fsync`, `full_page_writes` et
// `synchronous_commit` sont actifs.
import { execFileSync } from 'node:child_process';
import { edgeSeqContinuity, chainsEqual } from '../support/sql-probes';
import { TwoProcessBench, freePort, until, sleep } from '../support/two-process-bench';
import type {
  PayMedia,
  PayTerminal,
} from '../../../api/test/integration/payments/payments-fixtures';
import { activateEdge } from '../support/load-support';
import type { Cluster } from '../support/disposable-databases';

const FAILPOINT_ENV = (point: string): Record<string, string> => ({
  EDGE_FAILPOINT: point,
  EDGE_ALLOW_FAILPOINTS: '1',
});

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const central = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.centralQuery<T>(sql, params);
const local = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.localQuery<T>(sql, params);

async function localContinuity(): Promise<{ n: number; min: number; max: number }> {
  const r = (
    await local<{ n: string; min: string; max: string }>(
      'SELECT count(*)::text AS n, coalesce(min(edge_seq),0)::text AS min, ' +
        'coalesce(max(edge_seq),0)::text AS max FROM edge_op',
    )
  )[0]!;
  return { n: Number(r.n), min: Number(r.min), max: Number(r.max) };
}

async function waitReleased(): Promise<void> {
  await until(
    'rendu terminé',
    async () =>
      (
        await central<{ status: string }>(
          `SELECT status FROM debit_authority_handover
            WHERE ledger_id = $1 AND direction = 'TO_CENTRAL' ORDER BY requested_at DESC LIMIT 1`,
          [bench.ledgerId],
        )
      )[0]?.status === 'COMPLETED',
    300_000,
    300,
  );
}

describe('NFR-004 : points d’arrêt de la passerelle', () => {
  let till: PayTerminal;
  let media: PayMedia[];
  const acknowledged = new Set<string>();

  /** Même clé, même corps : le renvoi d'une vente interrompue rejoue la MÊME requête. */
  const bodies = new Map<string, unknown>();
  const sale = async (key = till.t.seqKey(), amount = 1) => {
    const w = bench.world;
    if (!bodies.has(key))
      bodies.set(key, w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, amount]]));
    return { key, res: await bench.gwPay(till, bodies.get(key), { key }) };
  };

  it('durabilité de la base locale : fsync, full_page_writes, commit synchrone (A28)', async () => {
    bench = await TwoProcessBench.start({ startGateway: false });
    const w = bench.world;
    till = await w.terminal();
    media = await w.media(2, 10_000_000);
    const rows = await local<{ name: string; setting: string }>(
      `SELECT name, setting FROM pg_settings
        WHERE name IN ('fsync', 'full_page_writes', 'synchronous_commit')`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.setting]));
    expect(byName.fsync).toBe('on');
    expect(byName.full_page_writes).toBe('on');
    expect(['on', 'remote_write', 'remote_apply', 'local']).toContain(byName.synchronous_commit);
    await bench.startGateway();
    await activateEdge(bench, [media[0]!.walletId]);
  }, 600_000);

  it('sensibilité : un point mal nommé est refusé au démarrage', async () => {
    await bench.gateway!.kill('SIGKILL');
    await expect(bench.startGateway(FAILPOINT_ENV('nom-inconnu'))).rejects.toThrow(
      /EDGE_FAILPOINT|arrêtée/,
    );
    await bench.startGateway();
  }, 300_000);

  it('before-local-write : rien d’écrit, le renvoi de la même clé passe', async () => {
    await bench.gateway!.kill('SIGKILL');
    const proc = await bench.startGateway(FAILPOINT_ENV('before-local-write'));
    const before = await localContinuity();
    const key = till.t.seqKey();
    await expect(sale(key)).rejects.toBeTruthy();
    await proc.closed;
    expect(proc.exit?.signal).toBe('SIGKILL');
    expect(await localContinuity()).toEqual(before);
    await bench.startGateway();
    const again = await sale(key);
    expect(again.res.status).toBe(201);
    acknowledged.add(key);
    expect((await localContinuity()).n).toBe(before.n + 1);
  }, 300_000);

  it('after-local-write-before-reply : écrit sans réponse, le renvoi sans doublon', async () => {
    await bench.gateway!.kill('SIGKILL');
    const proc = await bench.startGateway(FAILPOINT_ENV('after-local-write-before-reply'));
    const before = await localContinuity();
    const key = till.t.seqKey();
    await expect(sale(key)).rejects.toBeTruthy();
    await proc.closed;
    expect(proc.exit?.signal).toBe('SIGKILL');
    expect((await localContinuity()).n).toBe(before.n + 1); // validé avant la réponse
    await bench.startGateway();
    const again = await sale(key);
    expect(again.res.status).toBeLessThan(300);
    acknowledged.add(key);
    expect((await localContinuity()).n).toBe(before.n + 1); // pas de seconde écriture
  }, 300_000);

  it('during-drain-after-send-before-result : lot identique, 0 perte, 0 doublon', async () => {
    const before = await localContinuity();
    await bench.gateway!.kill('SIGKILL');
    const proc = await bench.startGateway(FAILPOINT_ENV('during-drain-after-send-before-result'));
    await bench.releaseToCentral();
    await proc.closed;
    expect(proc.exit?.signal).toBe('SIGKILL');
    const inFlight = await local<{ batch_id: string; body_sha256: Buffer; status: string }>(
      'SELECT batch_id, body_sha256, status FROM edge_outgoing_batch WHERE status <> $1',
      ['DONE'],
    );
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]!.status).toBe('SENT');
    await bench.startGateway();
    await waitReleased();
    const after = await local<{ batch_id: string; body_sha256: Buffer }>(
      'SELECT batch_id, body_sha256 FROM edge_outgoing_batch WHERE batch_id = $1',
      [inFlight[0]!.batch_id],
    );
    expect(after).toHaveLength(1);
    expect(Buffer.from(after[0]!.body_sha256).equals(Buffer.from(inFlight[0]!.body_sha256))).toBe(
      true,
    );
    const batches = await central<{ n: string }>(
      'SELECT count(*)::text AS n FROM edge_sync_batch WHERE batch_id = $1',
      [inFlight[0]!.batch_id],
    );
    expect(batches[0]!.n).toBe('1');
    const cont = await edgeSeqContinuity(central, bench.gatewayId);
    expect(cont).toMatchObject({ gaps: [], duplicates: 0, count: before.n });
    expect((await chainsEqual(central, local, bench.gatewayId)).equal).toBe(true);
  }, 600_000);

  it('after-releasing-persisted : RELEASING durable, le redémarrage vide et rend', async () => {
    await bench.refreshEpoch();
    await activateEdge(bench, [media[0]!.walletId]);
    for (let i = 0; i < 3; i += 1) {
      const s = await sale();
      expect(s.res.status).toBe(201);
      acknowledged.add(s.key);
    }
    const total = (await localContinuity()).max;
    await bench.gateway!.kill('SIGKILL');
    const proc = await bench.startGateway(FAILPOINT_ENV('after-releasing-persisted'));
    await bench.releaseToCentral();
    await proc.closed;
    expect(proc.exit?.signal).toBe('SIGKILL');
    expect((await bench.localAuthority())?.state).toBe('RELEASING');
    await bench.startGateway();
    await waitReleased();
    const cont = await edgeSeqContinuity(central, bench.gatewayId);
    expect(cont).toMatchObject({ gaps: [], duplicates: 0, count: total, max: total });
    expect((await chainsEqual(central, local, bench.gatewayId)).equal).toBe(true);
    // Aucune réponse 2xx sans entrée de file : chaque clé acquittée est dans la file locale.
    const keys = (await local<{ origin_key: string }>('SELECT origin_key FROM edge_op')).map(
      (r) => r.origin_key,
    );
    for (const key of acknowledged) expect(keys).toContain(key);
  }, 900_000);
});

describe('NFR-004 : kill-local-database (conteneur PostgreSQL local jetable)', () => {
  const name = `cashless_m8_edge_pg_${process.pid}`;
  let cluster: Cluster;

  afterAll(async () => {
    await bench?.close();
    try {
      docker('rm', '-f', name);
    } catch {
      /* déjà supprimé */
    }
  });

  async function waitServer(): Promise<void> {
    await until(
      'conteneur local prêt',
      async () => {
        try {
          docker('exec', name, 'pg_isready', '-U', 'postgres');
          docker('exec', name, 'psql', '-U', 'postgres', '-c', 'select 1');
          return true;
        } catch {
          return null;
        }
      },
      90_000,
      500,
    );
  }

  it('base locale tuée (docker kill) puis relancée : 0 perte, numéros continus', async () => {
    const port = await freePort();
    docker(
      'run',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '-p',
      `127.0.0.1:${port}:5432`,
      'postgres:17',
    );
    cluster = { host: '127.0.0.1', port: String(port), user: 'postgres' };
    await waitServer();
    await sleep(2_000); // l'image redémarre une fois à l'initialisation
    await waitServer();
    await bench.close(); // même identifiant de bases : la première est détruite d'abord
    bench = await TwoProcessBench.start({ startGateway: false, edgeCluster: cluster });
    const w = bench.world;
    const till = await w.terminal();
    const media = await w.media(1, 10_000_000);
    await bench.startGateway();
    await activateEdge(bench, [media[0]!.walletId]);
    const body = () => w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]);
    const acked: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const key = till.t.seqKey();
      expect((await bench.gwPay(till, body(), { key })).status).toBe(201);
      acked.push(key);
    }
    await bench.gateway!.kill('SIGKILL');
    const proc = await bench.startGateway(FAILPOINT_ENV('kill-local-database'));
    const key = till.t.seqKey();
    const pending = bench.gwPay(till, body(), { key }).then(
      (r) => ({ status: r.status }),
      () => ({ status: 0 }),
    );
    await until(
      'point atteint',
      () => (proc.stdout.includes('FAILPOINT kill-local-database reached') ? true : null),
      60_000,
      50,
    );
    docker('kill', name);
    docker('start', name);
    await waitServer();
    await proc.kill('SIGKILL');
    expect((await pending).status).not.toBe(201); // jamais de 2xx : rien n'a été validé
    await bench.startGateway();
    // La vente interrompue n'a laissé aucune entrée ; son renvoi réussit sous le numéro suivant.
    const rows = await local<{ origin_key: string; edge_seq: string }>(
      'SELECT origin_key, edge_seq::text FROM edge_op ORDER BY edge_seq',
    );
    expect(rows.map((r) => r.edge_seq)).toEqual(['1', '2']);
    const again = await bench.gwPay(till, body(), { key });
    expect(again.status).toBe(201);
    acked.push(key);
    const after = await local<{ origin_key: string; edge_seq: string }>(
      'SELECT origin_key, edge_seq::text FROM edge_op ORDER BY edge_seq',
    );
    expect(after.map((r) => r.edge_seq)).toEqual(['1', '2', '3']);
    for (const k of acked) expect(after.map((r) => r.origin_key)).toContain(k);
    await bench.releaseToCentral();
    await waitReleased();
    expect(await edgeSeqContinuity(central, bench.gatewayId)).toMatchObject({
      gaps: [],
      duplicates: 0,
      count: 3,
    });
  }, 900_000);
});
