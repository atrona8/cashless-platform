// T116 / tests de borne des écarts de sécurité acceptés (règle 3 du porteur : un test qui échoue si
// la limite s'élargit).
//   - OP-N111 (ADR-166, décision 19) : base locale à rôle unique `edge_app`. Borne : `TRUNCATE`
//     refusé sur `edge_authority`, `edge_op`, `edge_audit` (et `edge_chain_head`), et liste FIGÉE
//     des rôles qui disposent de droits DDL sur la base locale. Un autre rôle qui reçoit un droit
//     de création, de propriété ou le statut de superutilisateur fait échouer le test.
//   - OP-N112 (ADR-167, décision 27) : ordres à deux personnes. Borne : l'outil d'enrôlement refuse
//     deux titulaires identiques (casse et espaces ignorés) et deux clés identiques, sans rien
//     inscrire ; la base locale n'a que deux clés de site, de titulaires et de clés distincts.
//     La limite écrite : une MÊME personne qui détient les deux clés reste indétectable.
import 'reflect-metadata';
import { join } from 'node:path';
import { Client } from 'pg';
import { main as edgeAdminMain, realDeps } from '../../../../tools/edge-admin/src/main';
import { cluster } from '../support/disposable-databases';
import { TwoProcessBench } from '../support/two-process-bench';

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const GUARDED = ['edge_authority', 'edge_op', 'edge_audit', 'edge_chain_head'];

describe('OP-N111 : base locale à rôle unique, bornes', () => {
  it('TRUNCATE est refusé sur les tables d’autorité, de file et d’audit', async () => {
    bench = await TwoProcessBench.start({ startGateway: false });
    for (const table of GUARDED) {
      const error = await bench.edgeDb.pool.query(`TRUNCATE ${table}`).then(
        () => null,
        (e: unknown) => e as { code?: string; message?: string },
      );
      expect({ table, refused: error !== null }).toEqual({ table, refused: true });
      expect(String(error?.message ?? '')).toMatch(/TRUNCATE|truncate|jamais|interdit|refus/i);
    }
    // Sensibilité : une table de service, elle, se vide (le refus ne vient pas d'ailleurs).
    await expect(bench.edgeDb.pool.query('TRUNCATE edge_device_nonce')).resolves.toBeDefined();
  }, 600_000);

  const ddlRoles = async (): Promise<string[]> =>
    (
      await bench.localQuery<{ rolname: string }>(
        `SELECT r.rolname FROM pg_roles r
          WHERE r.rolname !~ '^pg_'
            AND (r.rolsuper
                 OR has_schema_privilege(r.oid, 'public', 'CREATE')
                 OR has_database_privilege(r.oid, current_database(), 'CREATE')
                 OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relowner = r.oid))
          ORDER BY 1`,
      )
    ).map((r) => r.rolname);

  it('liste figée des rôles à droits DDL de la base locale', async () => {
    // Droits DDL : superutilisateur, CREATE sur le schéma public ou sur la base, propriété d'une
    // table. Le propriétaire (`edge_app`) et l'administrateur du poste sont les seuls attendus.
    const names = await ddlRoles();
    expect(names).toContain('edge_app'); // sensibilité : le propriétaire est bien vu
    const admin = process.env.PGUSER ?? 'postgres';
    expect(names.filter((n) => n !== admin)).toEqual(['edge_app']);
    // Aucune fonction du schéma public n'appartient à un autre rôle que `edge_app`.
    const owners = await bench.localQuery<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
    );
    expect(owners.map((o) => o.owner)).toEqual(['edge_app']);
  });

  it('sensibilité : un rôle qui reçoit CREATE sur le schéma entre dans la liste', async () => {
    const c = cluster();
    const url = `postgres://${c.user}@${c.host}:${c.port}/${bench.edgeDb.name}`;
    const admin = new Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query('DROP ROLE IF EXISTS cashless_m8_probe');
      await admin.query('CREATE ROLE cashless_m8_probe NOLOGIN');
      await admin.query('GRANT CREATE ON SCHEMA public TO cashless_m8_probe');
      expect(await ddlRoles()).toContain('cashless_m8_probe');
    } finally {
      await admin.query('DROP OWNED BY cashless_m8_probe').catch(() => undefined);
      await admin.query('DROP ROLE IF EXISTS cashless_m8_probe').catch(() => undefined);
      await admin.end();
    }
    expect(await ddlRoles()).not.toContain('cashless_m8_probe');
  });
});

describe('OP-N112 : ordres à deux personnes, bornes de l’outil d’enrôlement', () => {
  const registerArgs = (overrides: Record<string, string>): string[] => {
    const serial = `GW-${bench.id}`;
    const base: Record<string, string> = {
      request: join(bench.dir, 'request.json'),
      operator: bench.operatorId,
      event: bench.eventId,
      ledger: bench.ledgerId,
      serial,
      role: 'PRIMARY',
      'lan-url': `https://127.0.0.1:${bench.gwPort}`,
      by: 'Awa Diop',
      out: join(bench.dir, 'enrolment-bounds.json'),
      'central-url': `https://127.0.0.1:${bench.relay.port}/v1`,
      'central-ca-file': join(bench.dir, 'central-ca.crt'),
      'device-ca-file': join(bench.dir, 'central-ca.crt'),
      'site-key-a': bench.siteKeys![0].publicSpkiB64,
      'site-holder-a': bench.siteKeys![0].holder,
      'site-key-b': bench.siteKeys![1].publicSpkiB64,
      'site-holder-b': bench.siteKeys![1].holder,
      ...overrides,
    };
    return ['register', ...Object.entries(base).flatMap(([k, v]) => [`--${k}`, v])];
  };

  async function run(overrides: Record<string, string>) {
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    const code = await edgeAdminMain(
      registerArgs(overrides),
      {
        NODE_ENV: 'test',
        EDGE_CA: 'fake',
        DATABASE_URL_EDGEADMIN: bench.centralDb.urls.edgeadmin,
      },
      io,
      (env, i) => ({ ...realDeps(env, i), ca: async () => bench.edgeCa }),
    );
    return { code, text: [...out, ...err].join('\n') };
  }
  const gateways = async (): Promise<number> =>
    Number(
      (await bench.centralQuery<{ n: string }>('SELECT count(*)::text AS n FROM edge_gateway'))[0]!
        .n,
    );

  it('deux titulaires identiques (casse et espaces ignorés) : refus, rien d’inscrit', async () => {
    const before = await gateways();
    const holderA = bench.siteKeys![0].holder;
    const same = await run({ 'site-holder-b': `  ${holderA.toUpperCase()} ` });
    expect(same.code).toBe(1);
    expect(same.text).toMatch(/titulaires nominatifs distincts/);
    expect(await gateways()).toBe(before);
  });

  it('deux clés de site identiques : refus, rien d’inscrit', async () => {
    const before = await gateways();
    const same = await run({ 'site-key-b': bench.siteKeys![0].publicSpkiB64 });
    expect(same.code).toBe(1);
    expect(same.text).toMatch(/clés de site distinctes/);
    expect(await gateways()).toBe(before);
  });

  it('la base locale n’a que deux clés de site, de titulaires et de clés distincts', async () => {
    const keys = await bench.localQuery<{ holder: string; public_key: string }>(
      'SELECT holder, public_key FROM edge_site_order_key ORDER BY holder',
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((k) => k.holder.trim().toLowerCase())).size).toBe(2);
    expect(new Set(keys.map((k) => k.public_key)).size).toBe(2);
    // Troisième clé refusée : la borne « deux » est tenue par la base, pas seulement par l'outil.
    const third = await bench.edgeDb.pool
      .query(`INSERT INTO edge_site_order_key (holder, public_key) VALUES ('Tiers', 'AAAA')`)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(third).not.toBeNull();
  });
});
