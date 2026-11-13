import { appendAckedOps } from '../authority/_support/harness';
import { closeEvent, makePurgeRig, seedCanary, type PurgeRig } from './_support/harness';

// Test de borne (décision 49, OP-N118, ADR-186) : liste FIGÉE des tables de la base locale que la
// purge ne vide PAS. Une table de plus qui échappe à la purge fait échouer ce test : il faut alors
// soit la vider, soit l'ajouter ici avec une décision du porteur.
const NOT_WIPED = [
  'edge_audit',
  'edge_authority',
  'edge_authority_transition',
  'edge_chain_head',
  'edge_clock',
  'edge_device_batch',
  'edge_meta',
  'edge_op',
  'edge_outgoing_batch',
  'edge_replication_cursor',
  'edge_schema_migration',
  'edge_site_order_key',
];

let rig: PurgeRig;
afterEach(async () => rig?.close());

it(
  'tables non vidées par la purge : liste figée, toute autre table est vide après ' + 'purge',
  async () => {
    rig = await makePurgeRig();
    await seedCanary(rig);
    await closeEvent(rig);
    await appendAckedOps(rig.h.db, 1, true);
    await rig.trigger.tick();
    const { rows } = await rig.h.db.pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const survivors: string[] = [];
    for (const { tablename } of rows) {
      const n = Number(
        (await rig.h.db.pool.query(`SELECT count(*) AS n FROM "${tablename}"`)).rows[0].n,
      );
      if (n > 0) survivors.push(tablename);
    }
    // Toute table encore remplie doit figurer dans la liste figée.
    expect(survivors.filter((t) => !NOT_WIPED.includes(t))).toEqual([]);
    // Et la liste que la purge déclare ne pas vider est exactement la liste figée.
    const wiped = await rig.service.wipedTables();
    const declared = rows.map((r) => r.tablename).filter((t) => !wiped.includes(t));
    expect(declared.sort()).toEqual([...NOT_WIPED].sort());
  },
);
