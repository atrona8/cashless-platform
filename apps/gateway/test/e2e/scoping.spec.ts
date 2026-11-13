// T116 / NFR-011 : cloisonnement de chaque route `/edge/*` du contrat (liste lue dans
// `openapi.yaml`, la suite échoue si une route n'est pas couverte) et de la lecture
// `getDebitAuthority` en `edgeMtls`.
// Appelants : la passerelle A (celle du banc, qui lit son grand livre), la passerelle B (autre
// événement du MÊME prestataire), une passerelle d'un AUTRE prestataire, une passerelle RÉVOQUÉE,
// un certificat de TERMINAL, aucun certificat. Un certificat valide d'un autre périmètre ne lit
// RIEN de A (ni grand livre, ni bascule, ni bracelets, ni soldes) ; un certificat révoqué, de
// terminal ou absent est refusé sans rien lire ; un certificat de passerelle sur une route de
// terminal est refusé. Isolation vérifiée aussi par l'état : rien n'est écrit pour A.
// Contrôle de sensibilité : A, lui, lit son grand livre (sinon un refus partout ne prouverait
// rien), et la lecture de A contient bien les identifiants cherchés chez les autres.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newEvent, addGateway, seedEdgeWorld } from '../../../api/test/support/edge-fixtures';
import { withOwner } from '../../../api/test/support/db';
import { issueGatewayCertificate, mtlsRequest, type MtlsReply } from '../support/mtls-client';
import { TwoProcessBench } from '../support/two-process-bench';

const OPENAPI = join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'openapi.yaml');

/** Routes `edgeMtls` du contrat : `/edge/*` et la lecture du débit en `edgeMtls`. */
function contractEdgeRoutes(): string[] {
  const lines = readFileSync(OPENAPI, 'utf8').split('\n');
  const routes: string[] = [];
  let path = '';
  let method = '';
  for (const line of lines) {
    const p = /^ {2}(\/[^ ]*):\s*$/.exec(line);
    if (p) {
      path = p[1]!;
      method = '';
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) method = m[1]!.toUpperCase();
    if (/^\s+- edgeMtls: \[\]/.test(line) && path && method) routes.push(`${method} ${path}`);
  }
  return [...new Set(routes)].sort();
}

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

interface Caller {
  name: string;
  /** `valid` : certificat accepté par la garde (périmètre propre). `refused` : 401 attendu. */
  kind: 'own' | 'valid-other' | 'refused';
  client: { certPem: string; keyPem: string } | null;
}

describe('NFR-011 : cloisonnement des routes edge', () => {
  const callers: Caller[] = [];
  let hid = '';
  let ledgerA = '';
  let ledgerB = '';
  let ledgerX = '';
  let secretsOfA: string[] = [];
  let url: (path: string) => string;

  const call = (c: Caller, route: string): Promise<MtlsReply> => {
    const [method, template] = route.split(' ') as ['GET' | 'POST', string];
    const target = (id: string): string =>
      template.replace('{handover_id}', hid).replace('{ledger_id}', id);
    const opts = { ca: bench.serverCa, client: c.client };
    switch (route) {
      case 'GET /edge/handovers/current':
        return mtlsRequest(url(target(ledgerA)), method, opts);
      case 'POST /edge/handovers/{handover_id}/ack':
        return mtlsRequest(url(target(ledgerA)), method, {
          ...opts,
          body: { epoch: 1, replicated_posting_id: 0 },
        });
      case 'POST /edge/handovers/{handover_id}/release':
        return mtlsRequest(url(target(ledgerA)), method, {
          ...opts,
          body: {
            epoch: 1,
            final_edge_seq: 0,
            last_chain_hash: '00'.repeat(32),
            operations_count: 0,
          },
        });
      case 'GET /edge/replication-feed':
        return mtlsRequest(
          url(`${template}?after_posting_id=0&after_change_seq=0&limit=200`),
          method,
          opts,
        );
      case 'POST /edge/sync-batches':
        return mtlsRequest(url(target(ledgerA)), method, {
          ...opts,
          headers: { 'idempotency-key': '4f4d0c52-0a53-4d84-9c45-7b9b9d3b3c11' },
          body: {
            batch_id: '4f4d0c52-0a53-4d84-9c45-7b9b9d3b3c11',
            edge_gateway_id: bench.gatewayId,
            ledger_id: ledgerA,
            epoch: 1,
            edge_seq_from: 1,
            edge_seq_to: 0,
            prev_chain_hash: '00'.repeat(32),
            last_chain_hash: '00'.repeat(32),
            operations: [],
            signature: 'AAAA',
          },
        });
      case 'GET /ledgers/{ledger_id}/debit-authority':
        return mtlsRequest(url(target(ledgerA)), method, opts);
      default:
        throw new Error(`route non couverte par le cloisonnement : ${route}`);
    }
  };

  it('chaque route edgeMtls du contrat a son cas (la liste vient du contrat)', () => {
    const routes = contractEdgeRoutes();
    expect(routes).toEqual(
      [
        'GET /edge/handovers/current',
        'POST /edge/handovers/{handover_id}/ack',
        'POST /edge/handovers/{handover_id}/release',
        'GET /edge/replication-feed',
        'POST /edge/sync-batches',
        'GET /ledgers/{ledger_id}/debit-authority',
      ].sort(),
    );
  });

  it('mise en place : passerelles A, B, autre prestataire, révoquée', async () => {
    bench = await TwoProcessBench.start({ startGateway: false });
    const w = bench.world;
    ledgerA = bench.ledgerId;
    url = (path) => `https://127.0.0.1:${bench.edge.port}/v1${path}`;
    const op = { operatorId: bench.operatorId };
    const certB = await issueGatewayCertificate(bench.edgeCa, `GW-B-${bench.id}`);
    const certX = await issueGatewayCertificate(bench.edgeCa, `GW-X-${bench.id}`);
    const certR = await issueGatewayCertificate(bench.edgeCa, `GW-R-${bench.id}`);
    await withOwner(async (db) => {
      const other = await newEvent(db, op);
      ledgerB = other.ledgerId;
      await addGateway(db, op, other.eventId, { sha256: certB.sha256 });
      const world = await seedEdgeWorld(db);
      ledgerX = world.ledgerId;
      await addGateway(db, { operatorId: world.operatorId }, world.eventId, {
        sha256: certX.sha256,
      });
      await addGateway(db, op, bench.eventId, {
        sha256: certR.sha256,
        role: 'STANDBY',
        status: 'REVOKED',
      });
    });
    // Une bascule vers A est en cours (aucun processus ne l'accuse) : un handover à lire.
    await bench.switchToEdge();
    hid = (
      await bench.centralQuery<{ id: string }>(
        `SELECT id FROM debit_authority_handover WHERE ledger_id = $1
          ORDER BY requested_at DESC LIMIT 1`,
        [ledgerA],
      )
    )[0]!.id;
    const media = await w.media(2, 50_000);
    const till = await w.terminal();
    const own = {
      certPem: readFileSync(join(bench.dir, 'client.crt'), 'utf8'),
      keyPem: readFileSync(join(bench.dir, 'client.key'), 'utf8'),
    };
    callers.push(
      { name: 'passerelle A (propre)', kind: 'own', client: own },
      { name: 'passerelle B (autre événement)', kind: 'valid-other', client: certB },
      { name: 'passerelle d’un autre prestataire', kind: 'valid-other', client: certX },
      { name: 'passerelle révoquée', kind: 'refused', client: certR },
      {
        name: 'certificat de terminal',
        kind: 'refused',
        client: { certPem: till.t.certificatePem, keyPem: till.t.signingPrivatePem },
      },
      { name: 'aucun certificat', kind: 'refused', client: null },
    );
    secretsOfA = [hid, ledgerA, bench.eventId, bench.gatewayId, ...media.map((m) => m.walletId)];
    expect(new Set([ledgerA, ledgerB, ledgerX]).size).toBe(3);
  }, 600_000);

  it('sensibilité : A lit SON grand livre, son handover et ses bracelets', async () => {
    const a = callers[0]!;
    const current = await call(a, 'GET /edge/handovers/current');
    expect(current.status).toBe(200);
    expect(current.json).toMatchObject({ ledger_id: ledgerA });
    expect(current.text).toContain(hid);
    const feed = await call(a, 'GET /edge/replication-feed');
    expect(feed.status).toBe(200);
    expect(feed.json).toMatchObject({ ledger_id: ledgerA });
    expect(feed.text).toContain(secretsOfA[4]!); // un portefeuille de A est dans SON flux
    const debit = await call(a, 'GET /ledgers/{ledger_id}/debit-authority');
    expect(debit.status).toBe(200);
  });

  it('révoqué, de terminal ou absent : 401 ou coupure, rien n’est lu, chaque route', async () => {
    for (const caller of callers.filter((c) => c.kind === 'refused'))
      for (const route of contractEdgeRoutes()) {
        const res = await call(caller, route);
        expect({ caller: caller.name, route, status: [0, 401].includes(res.status) }).toEqual({
          caller: caller.name,
          route,
          status: true,
        });
        for (const secret of secretsOfA) expect(res.text).not.toContain(secret);
      }
  }, 300_000);

  it('passerelle valide d’un autre périmètre : ne lit rien de A, sur chaque route', async () => {
    for (const caller of callers.filter((c) => c.kind === 'valid-other'))
      for (const route of contractEdgeRoutes()) {
        const res = await call(caller, route);
        const label = `${caller.name} ${route} -> ${res.status}`;
        // Jamais un succès sur le grand livre ou le handover de A, jamais un identifiant de A.
        if (route.includes('/ack') || route.includes('/release') || route.includes('sync-batches'))
          expect({ label, ok: res.status >= 400 && res.status < 500 }).toEqual({ label, ok: true });
        if (route.includes('debit-authority'))
          expect({ label, status: res.status }).toEqual({ label, status: 404 });
        for (const secret of secretsOfA)
          expect({ label, leak: res.text.includes(secret) }).toEqual({ label, leak: false });
        if (route === 'GET /edge/handovers/current' || route === 'GET /edge/replication-feed') {
          expect(res.status).toBe(200);
          const own = caller.name.includes('autre événement') ? ledgerB : ledgerX;
          expect(res.json).toMatchObject({ ledger_id: own });
        }
      }
  }, 300_000);

  it('les refus d’autres périmètres ne changent rien pour A (état identique)', async () => {
    const rows = await bench.centralQuery<{ n: string }>(
      `SELECT (SELECT count(*) FROM edge_sync_batch WHERE gateway_id = $1)::text AS n`,
      [bench.gatewayId],
    );
    expect(rows[0]!.n).toBe('0');
    const handover = await bench.centralQuery<{ status: string }>(
      'SELECT status FROM debit_authority_handover WHERE id = $1',
      [hid],
    );
    expect(handover[0]!.status).not.toBe('ACTIVE');
    const writes = await bench.centralQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM journal_transaction
        WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [ledgerA],
    );
    expect(writes[0]!.n).toBe('0');
  });

  it('un certificat de passerelle sur une route de terminal est refusé', async () => {
    const own = callers[0]!;
    const base = bench.centralBaseUrl;
    for (const [method, path] of [
      ['POST', '/payments'],
      ['POST', '/offline-batches'],
      ['GET', '/offline-snapshots/current'],
    ] as const) {
      const res = await mtlsRequest(`${base}${path}`, method, {
        ca: bench.serverCa,
        client: own.client,
        body: method === 'POST' ? {} : undefined,
      });
      expect({ path, refused: [0, 401, 403].includes(res.status) }).toEqual({
        path,
        refused: true,
      });
    }
  }, 120_000);
});
