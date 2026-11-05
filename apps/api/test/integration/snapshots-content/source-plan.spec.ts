// WP21 parties G et I (NFR-005) : `offline_snapshot_source_rows` ne doit jamais matérialiser la vue entière du grand
// livre. 0053 retirait la matérialisation de `live` ; 0054 part des médias candidats trouvés par index (`cand`, seul
// CTE matérialisé avec `changed_wallets`) et ne lit la vue que pour eux. Ce test échoue si 0054 est perdue (0053 seule)
// ou si `live` est matérialisée. Les droits restent ceux de 0044 / WP08.
import { withOwner } from '../../support/db';

describe('offline_snapshot_source_rows (migrations 0053 à 0057)', () => {
  it('lit `live` sans la matérialiser, fonction toujours SECURITY DEFINER à chemin fixé', async () => {
    const { rows } = await withOwner((db) =>
      db.query<{ def: string }>(
        `SELECT pg_get_functiondef('offline_snapshot_source_rows(uuid, timestamptz)'::regprocedure) AS def`,
      ),
    );
    const def = rows[0]!.def;
    expect(def).toMatch(/live AS \(/);
    expect(def).not.toMatch(/live AS (NOT )?MATERIALIZED/);
    expect(def).toMatch(/cand AS MATERIALIZED \(/);
    expect(def).toMatch(/CROSS JOIN LATERAL/); // 0057 : `live` pilotée par les candidats
    expect(def).toMatch(/OFFSET 0/);
    expect(def).toMatch(/SECURITY DEFINER/);
    expect(def).toMatch(/search_path/);
    expect(def.indexOf('assert_tenant')).toBeGreaterThan(-1);
    expect(def.indexOf('assert_tenant')).toBeLessThan(def.indexOf('RETURN QUERY'));
  });

  it('reste inaccessible hors des fonctions enveloppes (aucun EXECUTE pour PUBLIC)', async () => {
    const { rows } = await withOwner((db) =>
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.routine_privileges
          WHERE routine_name = 'offline_snapshot_source_rows' AND grantee = 'PUBLIC'`,
      ),
    );
    expect(rows[0]!.n).toBe(0);
  });
});
