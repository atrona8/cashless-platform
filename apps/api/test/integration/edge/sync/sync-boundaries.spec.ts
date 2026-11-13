// Frontières de la réception EDGE_SYNC (WP13) : aucune écriture directe, aucun appel à
// `post_transaction`, aucun
// import du service de clés dans `edge/sync/` ; sans adaptateur central configuré, la route refuse
// (`503`, fermé) et
// n'écrit rien ; la route est sous la garde `edgeMtls`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import {
  seedEdgeWorld,
  startEdge,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';
import { edgePost, makeBatch, openOwner, purchases, seedSite } from './sync-support';

const SRC = join(__dirname, '../../../../src/edge/sync');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
const code = (file: string): string =>
  readFileSync(join(SRC, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('frontières de edge/sync', () => {
  it.each(files)(
    '%s : ni INSERT, UPDATE, DELETE direct, ni post_transaction brute, ni KMS',
    (file) => {
      const text = code(file);
      expect(text).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
      expect(text).not.toMatch(/\bpost_transaction\s*\(/);
      expect(text).not.toMatch(/\brecord_edge_seq\s*\(/);
      expect(text).not.toMatch(/kms|KmsModule|HARDWARE_KEYSTORE/i);
    },
  );

  it('seules les enveloppes edge_* sont appelées', () => {
    const fields = new Set([
      'edge_seq',
      'edge_seq_from',
      'edge_seq_to',
      'edge_decision',
      'edge_guichet',
      'edge_gateway_id',
      'edge_alert',
    ]);
    const names = new Set<string>();
    for (const file of files)
      for (const m of code(file).matchAll(/\bedge_[a-z_]+\b/g))
        if (!fields.has(m[0])) names.add(m[0]);
    expect([...names].sort()).toEqual(
      [
        'edge_activate_media',
        'edge_fee_config',
        'edge_post_transaction',
        'edge_record_seq',
        'edge_record_staff_token_audit',
        'edge_sync_audit',
        'edge_sync_batch_begin',
        'edge_sync_batch_finish',
        'edge_sync_batch_result',
        'edge_sync_cursor',
        'edge_sync_device_key',
        'edge_sync_results',
        'edge_take_deposit',
        'edge_tap_proof',
        'edge_topup_cash',
      ].sort(),
    );
  });
});

describe('adaptateurs de production (fonctions SQL étroites, plus de 503)', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  it('la route écrit sous cashless_edge : plus de 503', async () => {
    const site = await seedSite(owner, world);
    const reply = await edgePost(edge.port, site.cert, makeBatch(site, purchases(site, 1)));
    expect(reply.status).toBe(200);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [site.ledgerId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('sans certificat de passerelle : 401', async () => {
    const reply = await edgePost(
      edge.port,
      { certPem: '', keyPem: '', sha256: Buffer.alloc(0) },
      { batch_id: '00000000-0000-4000-8000-000000000000' },
    );
    expect(reply.status).toBe(401);
  });
});
