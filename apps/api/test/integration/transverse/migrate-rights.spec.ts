// Intégration : la série de migrations et le rejeu des droits forment une seule transaction (OP-N44 ;
// mission 5a, lot WP07, décision du porteur du 20/10/2026, option c). Base jetable créée pour la suite :
// migrate.ts y applique toutes les migrations du dépôt plus une migration de test qui crée une fonction.
// Échoue si post-roles.sql cesse de retirer EXECUTE à PUBLIC, ou si le rejeu des droits sort de la
// transaction de la série (une fonction serait alors validée avec l'EXECUTE de PUBLIC).
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import {
  loadMigrations,
  loadRoleFiles,
  migrate,
  sha256,
  type Migration,
} from '../../../../../packages/ledger-sql/src/migrate';
import { OWNER_URL, connect, withOwner } from '../../support/db';

const DB = `cashless_migrate_${randomBytes(4).toString('hex')}`;
const dbUrl = (): string => {
  const url = new URL(OWNER_URL);
  url.pathname = `/${DB}`;
  return url.toString();
};
const testMigration = (version: string, fn: string): Migration => {
  const sql = `CREATE FUNCTION public.${fn}() RETURNS int LANGUAGE sql AS 'SELECT 1'`;
  return { version, sql, checksum: sha256(sql) };
};
// Fonctions de public (hors extensions) exécutables par PUBLIC.
const PUBLIC_EXECUTABLE = `SELECT p.oid::regprocedure::text AS fn FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass
                      AND e.objid = p.oid AND e.deptype = 'e')
    AND has_function_privilege('public', p.oid, 'EXECUTE')`;

describe('migrate.ts : série et droits dans une même transaction', () => {
  let db: Client;

  beforeAll(async () => {
    await withOwner((owner) => owner.query(`CREATE DATABASE ${DB}`));
    db = await connect(dbUrl());
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await withOwner((owner) => owner.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
  });

  it('après la série, aucune fonction de public n’est exécutable par PUBLIC, même ajoutée', async () => {
    const report = await migrate(db, [
      ...loadMigrations(),
      testMigration('9990_test_fonction', 'wp07_migrate_probe'),
    ]);
    expect(report.applied).toContain('9990_test_fonction');
    expect(report.postRoles).toBe(true);
    const { rows: probe } = await db.query(
      "SELECT to_regprocedure('public.wp07_migrate_probe()') IS NOT NULL AS present",
    );
    expect(probe).toEqual([{ present: true }]);
    expect((await db.query(PUBLIC_EXECUTABLE)).rows).toEqual([]);
  }, 60_000);

  it('rejeu des droits en échec : la série entière est annulée, la fonction n’existe pas', async () => {
    const files = loadRoleFiles();
    await expect(
      migrate(
        db,
        [...loadMigrations(), testMigration('9991_test_fonction', 'wp07_migrate_probe2')],
        {
          ...files,
          postRoles: `${files.postRoles ?? ''}\nSELECT 1 / 0;`,
        },
      ),
    ).rejects.toThrow(/droits des rôles/);
    const { rows } = await db.query(
      `SELECT to_regprocedure('public.wp07_migrate_probe2()') IS NULL AS absent,
              NOT EXISTS (SELECT 1 FROM ops.schema_migrations WHERE version = '9991_test_fonction')
                AS not_recorded`,
    );
    expect(rows).toEqual([{ absent: true, not_recorded: true }]);
    expect((await db.query(PUBLIC_EXECUTABLE)).rows).toEqual([]);
  }, 60_000);
});
