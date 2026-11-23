// Intégration : en production, migrate.ts refuse la série si le mot de passe du rôle cashless_claimadmin manque
// (mission 10a, WP04, décision du porteur du 20/11/2026 ; modèle des rôles de la passerelle). Hors production, pas
// de refus. cashless_pin n'est pas concerné. Le refus annule la série entière (transaction).
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { migrate } from '../../../../../packages/ledger-sql/src/migrate';
import { OWNER_URL, connect, withOwner } from '../../support/db';

const DB = `cashless_migrate_${randomBytes(4).toString('hex')}`;
const dbUrl = (): string => {
  const url = new URL(OWNER_URL);
  url.pathname = `/${DB}`;
  return url.toString();
};
const GATEWAY = { CASHLESS_EDGE_PASSWORD: 'e', CASHLESS_EDGEADMIN_PASSWORD: 'ea' };

describe('migrate.ts : mot de passe de cashless_claimadmin', () => {
  let db: Client;

  beforeAll(async () => {
    await withOwner((owner) => owner.query(`CREATE DATABASE ${DB}`));
    db = await connect(dbUrl());
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await withOwner((owner) => owner.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
  });

  it('production sans CASHLESS_CLAIMADMIN_PASSWORD : refus, série annulée', async () => {
    await expect(
      migrate(db, undefined, undefined, { NODE_ENV: 'production', ...GATEWAY }),
    ).rejects.toThrow(/CASHLESS_CLAIMADMIN_PASSWORD manquant/);
    const { rows } = await db.query("SELECT to_regclass('public.party') AS t");
    expect(rows).toEqual([{ t: null }]);
  }, 60_000);

  it('hors production sans le mot de passe : pas de refus', async () => {
    const report = await migrate(db, undefined, undefined, { NODE_ENV: 'test' });
    expect(report.postRoles).toBe(true);
  }, 60_000);

  it('production avec le mot de passe : la série passe et le mot de passe est posé', async () => {
    const report = await migrate(db, undefined, undefined, {
      NODE_ENV: 'production',
      CASHLESS_CLAIMADMIN_PASSWORD: 'cashless_claimadmin_prod_test',
      ...GATEWAY,
    });
    expect(report.postRoles).toBe(true);
    const { rows } = await db.query(
      "SELECT rolpassword IS NOT NULL AS avec FROM pg_authid WHERE rolname = 'cashless_claimadmin'",
    );
    expect(rows).toEqual([{ avec: true }]);
  }, 60_000);
});
