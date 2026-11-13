// Isolation du processus `edge` (WP10, NFR-011) : une passerelle ne lit que le grand livre de son événement (404
// identique pour un identifiant étranger ou inconnu), `cashless_edge` n'a aucun droit de table, et le processus n'ouvre
// qu'un pool (plus l'écoute unique de `db/`).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Client } from 'pg';
import { connect, EDGE_URL, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  edgeGet,
  edgeTls,
  seedEdgeWorld,
  startEdge,
  type ClientCert,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';

const sameBody = (body: Record<string, unknown> | null): Record<string, unknown> => {
  const { instance: _instance, ...rest } = body ?? {};
  return rest;
};

describe('isolation du processus edge', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;
  let cert: ClientCert;
  let gatewayId: string;

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    const { edgeCa } = await edgeTls();
    cert = await edgeCa.issue('gw-isolation');
    gatewayId = await addGateway(owner, world, world.eventId, {
      sha256: cert.sha256,
      lanUrl: 'https://10.1.2.3:8443',
    });
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  const read = (ledger: string, client: ClientCert | null = cert) =>
    edgeGet(edge.port, `/ledgers/${ledger}/debit-authority`, client ? { client } : {});

  it('son propre grand livre : 200, autorité CENTRAL, aucune passerelle désignée', async () => {
    const reply = await read(world.ledgerId);
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({
      ledger_id: world.ledgerId,
      authority: 'CENTRAL',
      epoch: expect.any(Number),
      edge_gateway_id: null,
      edge_base_url: null,
      handover: null,
    });
  });

  it('grand livre sous EDGE : passerelle désignée et edge_base_url = lan_url', async () => {
    await owner.query(
      `UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = $2, authority_epoch = 5 WHERE id = $1`,
      [world.ledgerId, gatewayId],
    );
    const reply = await read(world.ledgerId);
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      authority: 'EDGE',
      epoch: 5,
      edge_gateway_id: gatewayId,
      edge_base_url: 'https://10.1.2.3:8443',
    });
  });

  it('autre événement du même prestataire, autre prestataire, inconnu, mal formé : même 404', async () => {
    const replies = await Promise.all([
      read(world.otherLedgerId),
      read(world.foreignLedgerId),
      read(randomUUID()),
      read('pas-un-uuid'),
    ]);
    for (const reply of replies) {
      expect(reply.status).toBe(404);
      expect(reply.json).toMatchObject({ code: 'NOT_FOUND' });
    }
    const [first, ...others] = replies.map((reply) => sameBody(reply.json));
    for (const other of others) expect(other).toEqual(first);
    // Rien du grand livre étranger ne fuit.
    for (const reply of replies) expect(reply.body).not.toContain(world.foreignLedgerId);
  });

  it('sans certificat : 401, même pour son propre grand livre', async () => {
    expect((await read(world.ledgerId, null)).status).toBe(401);
  });

  it('une passerelle d’un autre événement ne lit pas ce grand livre', async () => {
    const { edgeCa } = await edgeTls();
    const other = await edgeCa.issue('gw-autre-evenement');
    await addGateway(owner, world, world.otherEventId, { sha256: other.sha256 });
    expect((await read(world.ledgerId, other)).status).toBe(404);
    expect((await read(world.otherLedgerId, other)).status).toBe(200);
  });

  describe('cashless_edge : aucun droit direct', () => {
    let db: Client;
    beforeAll(async () => {
      db = await connect(EDGE_URL);
    });
    afterAll(async () => {
      await db?.end();
    });
    const sqlstate = async (promise: Promise<unknown>): Promise<string> => {
      try {
        await promise;
        return 'OK';
      } catch (error) {
        return (error as { code?: string }).code ?? 'ERR';
      }
    };

    it('la connexion du processus est bien cashless_edge', async () => {
      expect((await db.query(`SELECT session_user AS u`)).rows[0].u).toBe('cashless_edge');
    });

    it.each(['ledger', 'debit_authority_handover', 'edge_gateway', 'posting', 'account_balance'])(
      'SELECT direct sur %s : refusé (42501)',
      async (table) => {
        expect(await sqlstate(db.query(`SELECT 1 FROM ${table} LIMIT 1`))).toBe('42501');
      },
    );

    it('écritures directes refusées, et post_transaction non exécutable', async () => {
      expect(
        await sqlstate(
          db.query(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [world.ledgerId]),
        ),
      ).toBe('42501');
      expect(
        await sqlstate(
          db.query(`UPDATE edge_gateway SET status = 'ACTIVE' WHERE id = $1`, [gatewayId]),
        ),
      ).toBe('42501');
      // Fonctions du kit et du système comptable : jamais exécutables par le rôle du processus.
      const { rows } = await owner.query<{ name: string; allowed: boolean }>(
        `SELECT p.proname AS name, has_function_privilege('cashless_edge', p.oid, 'EXECUTE') AS allowed
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('set_debit_authority', 'post_transaction', 'grant_edge_authority',
                              'ack_edge_handover', 'complete_edge_release', 'record_edge_seq')`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(6);
      expect(rows.filter((row) => row.allowed)).toEqual([]);
    });

    it('contrôle positif : l’enveloppe nommée reste exécutable', async () => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
      expect(
        await sqlstate(db.query(`SELECT * FROM get_debit_authority($1)`, [world.ledgerId])),
      ).toBe('OK');
    });
  });
});

describe('un seul pool pour le processus edge (architecture)', () => {
  const SRC = join(__dirname, '../../../../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
  const code = (path: string): string =>
    readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const rel = (path: string): string => relative(SRC, path).split(sep).join('/');

  it('aucun pool ni client pg dans src/edge/** ; l’écoute unique vit dans db/', () => {
    const offenders = files(join(SRC, 'edge')).filter((path) =>
      /\bnew\s+(Pool|Client)\b|from\s+'pg'|pool\.token|PG_POOL|PG_PLATFORM_POOL/.test(code(path)),
    );
    expect(offenders.map(rel)).toEqual([]);
    const listener = code(join(SRC, 'db/notify-listener.ts'));
    expect(listener.match(/new\s+Client\(/g)).toHaveLength(1);
    expect(listener).not.toMatch(/new\s+Pool\b/);
  });

  it('le module racine ouvre le pool de son rôle seul, ni DbModule ni PlatformTx ni service de clés', () => {
    const root = code(join(SRC, 'processes/edge.module.ts'));
    expect(root).toContain("ProcessDbModule.forProcess('edge')");
    expect(root).not.toMatch(
      /\bDbModule\b(?!\.)|PlatformTx|KmsModule|DeviceIdentityModule|DeviceCaModule/,
    );
    const processDb = code(join(SRC, 'db/process-db.module.ts'));
    expect((processDb.match(/new Pool\(/g) ?? []).length).toBe(1);
  });

  it('aucune route du processus n’échappe à @EdgeAuth() (liste fermée, garde par défaut)', () => {
    for (const path of files(join(SRC, 'edge/control')).filter((p) =>
      p.endsWith('.controller.ts'),
    )) {
      const text = code(path);
      const routes = (text.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? []).length;
      expect((text.match(/@EdgeAuth\(\)/g) ?? []).length).toBe(routes);
    }
  });
});
