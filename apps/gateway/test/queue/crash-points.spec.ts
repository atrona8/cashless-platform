// Points d'arrêt (R-26, A28) : la passerelle est tuée (SIGKILL) à chaque point, puis relancée sur
// la même base. Doit échouer si `append` commite seul ou si le lot est reconstruit autrement.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptAll,
  auditKinds,
  batches,
  head,
  makeQueueHarness,
  ops,
  verifyBatchSignature,
  type QueueHarness,
} from './_support/queue-harness';
import { selfSigned } from '../authority/_support/central';
import { tempDir } from '../startup/_support/fixture';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import type { Loose } from '../support/loose';

const CHILD = join(__dirname, '_support', 'queue-child.ts');
const GATEWAY = join(__dirname, '..', '..');
const TSX = require.resolve('tsx/cjs');

interface Run {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

function launch(env: Record<string, string>): {
  child: ChildProcess;
  result: Promise<Run>;
  output(): string;
} {
  const child = spawn(process.execPath, ['--require', TSX, CHILD], {
    cwd: GATEWAY,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr!.on('data', (c: Buffer) => (stderr += c.toString()));
  const result = new Promise<Run>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, result, output: () => stdout };
}

let h: QueueHarness;
let env: Record<string, string>;
beforeEach(async () => {
  h = await makeQueueHarness();
  const dir = tempDir();
  const cert = await selfSigned('gateway-client-child');
  writeFileSync(join(dir, 'client.crt'), cert.certPem);
  writeFileSync(join(dir, 'client.key'), cert.keyPem, { mode: 0o600 });
  env = {
    CHILD_DATABASE_URL: h.db.url,
    CLIENT_CERT: join(dir, 'client.crt'),
    CLIENT_KEY: join(dir, 'client.key'),
    GATEWAY_DEV_KEY_FILE: join(dir, 'keys.json'),
  };
});
afterEach(async () => {
  await h.close();
});

const failpointEnv = (name: string): Record<string, string> => ({
  EDGE_FAILPOINT: name,
  EDGE_ALLOW_FAILPOINTS: '1',
});

describe('before-local-write', () => {
  it('rien d’écrit pour l’opération tuée ; au redémarrage la numérotation continue sans trou', async () => {
    const killed = await launch({
      ...env,
      MODE: 'append',
      N: '5',
      ...failpointEnv('before-local-write:3'),
    }).result;
    expect(killed.signal).toBe('SIGKILL');
    expect((await ops(h.db)).map((o) => Number(o.edge_seq))).toEqual([1, 2]);
    expect(Number((await head(h.db)).last_edge_seq)).toBe(2);
    const again = await launch({ ...env, MODE: 'append', N: '3', FROM: '3' }).result;
    expect(again.code).toBe(0);
    expect((await ops(h.db)).map((o) => Number(o.edge_seq))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('after-local-write-before-reply', () => {
  it('l’entrée existe (commitée) bien que la réponse n’ait pas été envoyée ; aucun trou ensuite', async () => {
    const killed = await launch({
      ...env,
      MODE: 'append',
      N: '4',
      ...failpointEnv('after-local-write-before-reply:2'),
    }).result;
    expect(killed.signal).toBe('SIGKILL');
    expect(killed.stdout).toContain('COMMITTED 1');
    expect(killed.stdout).not.toContain('COMMITTED 2'); // pas de réponse pour la 2e…
    expect((await ops(h.db)).map((o) => Number(o.edge_seq))).toEqual([1, 2]); // …mais elle existe
    // Le terminal rejoue sa 2e opération (même clé d'origine) : l'idempotence locale de l'appelant
    // la reconnaît ; la file refuse une seconde entrée pour la même clé.
    await expect(
      h.addOp({ ...(await import('./_support/queue-harness')).purchase(2) }),
    ).rejects.toMatchObject({ code: 'ORIGIN_KEY_EXISTS' });
    const again = await launch({ ...env, MODE: 'append', N: '2', FROM: '3' }).result;
    expect(again.code).toBe(0);
    expect((await ops(h.db)).map((o) => Number(o.edge_seq))).toEqual([1, 2, 3, 4]);
  });
});

describe('kill-local-database', () => {
  it('le processus attend sans valider : rien de visible, la transaction n’est pas commitée', async () => {
    const run = launch({ ...env, MODE: 'append', N: '1', ...failpointEnv('kill-local-database') });
    const deadline = Date.now() + 30_000;
    while (!run.output().includes('FAILPOINT kill-local-database reached')) {
      if (Date.now() > deadline) throw new Error('point non atteint');
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 500));
    expect((await ops(h.db)).length).toBe(0);
    expect(Number((await head(h.db)).last_edge_seq)).toBe(0);
    expect(run.output()).not.toContain('COMMITTED');
    run.child.kill('SIGKILL');
    await run.result;
    expect((await ops(h.db)).length).toBe(0);
  });
});

describe('during-drain-after-send-before-result', () => {
  it('au redémarrage le MÊME lot est renvoyé ; le central répond DUPLICATE ; état final cohérent', async () => {
    await h.add(3);
    const seen: Array<Record<string, Loose>> = [];
    h.central.script = (request) => {
      seen.push(request.body as Loose);
      return seen.length === 1
        ? acceptAll(request)
        : acceptAll(
            request,
            Object.fromEntries(
              [1, 2, 3].map((n) => [
                `TPE-BAR-01:${n}`,
                (r: Record<string, unknown>) => ({ ...r, status: 'DUPLICATE' }),
              ]),
            ),
          );
    };
    const killed = await launch({
      ...env,
      MODE: 'drain',
      ...failpointEnv('during-drain-after-send-before-result'),
    }).result;
    expect(killed.signal).toBe('SIGKILL');
    expect(seen).toHaveLength(1);
    // Le central a reçu le lot ; la passerelle n'a rien appris.
    expect((await ops(h.db)).map((o) => o.central_status)).toEqual(['SENT', 'SENT', 'SENT']);
    expect((await batches(h.db)).map((b) => b.status)).toEqual(['SENT']);
    expect(Number((await head(h.db)).acked_edge_seq)).toBe(0);

    const again = await launch({ ...env, MODE: 'drain' }).result;
    expect(again.code).toBe(0);
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1])).toBe(JSON.stringify(seen[0]));
    // La signature vient du fichier de clés partagé entre les deux processus : vérifiable ici.
    const keystore = new FakeHardwareKeystore({ keyFile: env.GATEWAY_DEV_KEY_FILE! });
    expect(verifyBatchSignature(seen[1]!, await keystore.publicKey('batch'))).toBe(true);
    expect((await ops(h.db)).map((o) => o.central_status)).toEqual(Array(3).fill('DUPLICATE'));
    expect((await batches(h.db)).map((b) => [b.status, b.done_reason])).toEqual([
      ['DONE', 'RESULTS'],
    ]);
    const state = await head(h.db);
    expect([state.acked_edge_seq, state.last_edge_seq]).toEqual(['3', '3']);
    expect(await auditKinds(h.db)).not.toContain('DRAIN_RESULT_CONFLICT');
  });
});
