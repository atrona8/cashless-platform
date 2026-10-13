// Intégration : cœur de la configuration sur la base (FR-014, FR-015, C-004) — bornes du catalogue comparées aux
// CHECK de la table `event`, écriture versionnée (y compris concurrente), résolution à une date, isolation.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { AuditContext } from '../../../src/audit/audit.service';
import { CascadeService, type ConfigScope } from '../../../src/configuration/cascade.service';
import { ConfigurationCoreModule } from '../../../src/configuration/configuration-core.module';
import { eventColumnKeys, SETTINGS_CATALOG } from '../../../src/configuration/settings-catalog';
import { TenantTx, type TxClient } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('cœur de la configuration', () => {
  let app: INestApplication;
  let cascade: CascadeService;
  let tx: TenantTx;
  let ops: Operators;
  const ids = { platform: '', organizer: randomUUID(), organizerB: randomUUID(), jurisdiction: randomUUID(), event: randomUUID(), merchant: randomUUID(), participation: randomUUID() };
  const actor: AuditContext = { actorId: randomUUID(), actorRole: 'OPERATOR_ADMIN', origin: 'test', requestId: null };

  beforeAll(async () => {
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(`INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`);
      ids.platform = (await db.query<{ id: string }>(`SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1`)).rows[0]!.id;
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $4, 'Organisateur A', 'SN'), ($2, 'ORGANIZER', $5, 'Organisateur B', 'CI'), ($3, 'MERCHANT', $4, 'Commerçant A', 'SN')`,
        [ids.organizer, ids.organizerB, ids.merchant, ops.a, ops.b],
      );
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [ids.jurisdiction],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement de test', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [ids.event, ops.a, ids.organizer, ids.jurisdiction],
      );
      await db.query(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type) VALUES ($1, $2, $3, $4, 'EXTERNAL')`,
        [ids.participation, ops.a, ids.event, ids.merchant],
      );
    });
    app = await createTestApp({ imports: [ConfigurationCoreModule] });
    cascade = app.get(CascadeService);
    tx = app.get(TenantTx);
  });

  afterAll(async () => {
    await app.close();
  });

  const scope = (level: ConfigScope['level'], scopeId: string, operatorId: string | null = ops.a): ConfigScope => ({ level, scopeId, operatorId });
  const sqlState = async (sql: string, params: unknown[]): Promise<string | undefined> =>
    withOwner(async (db) => {
      try {
        await db.query('BEGIN');
        await db.query(sql, params);
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      } finally {
        await db.query('ROLLBACK');
      }
    });
  const setColumn = (column: string, value: unknown, extra = '') =>
    sqlState(`UPDATE event SET ${extra}"${column}" = $2 WHERE id = $1`, [ids.event, value]);

  describe('catalogue et schéma', () => {
    const ints = eventColumnKeys().filter((d) => d.type.kind === 'int');
    // Les deux délais en ligne sont liés par un CHECK : l'autre est écarté de la borne testée.
    const apart = (key: string) =>
      key === 'online_connect_timeout_ms' ? 'online_total_timeout_ms = 6000, ' : key === 'online_total_timeout_ms' ? 'online_connect_timeout_ms = 1000, ' : '';

    it.each(ints.map((d) => [d.key, d.type] as const))('%s : mêmes bornes que le CHECK de la colonne', async (key, type) => {
      if (type.kind !== 'int') return;
      expect(await setColumn(key, type.min, apart(key))).toBeUndefined();
      expect(await setColumn(key, type.max, apart(key))).toBeUndefined();
      expect(await setColumn(key, type.min - 1, apart(key))).toBe('23514');
      expect(await setColumn(key, type.max + 1, apart(key))).toBe('23514');
    });

    it('montants : zéro accepté, négatif refusé par la base comme par le catalogue', async () => {
      for (const definition of eventColumnKeys().filter((d) => d.type.kind === 'amount')) {
        expect([definition.key, await setColumn(definition.key, 0)]).toEqual([definition.key, undefined]);
        expect([definition.key, await setColumn(definition.key, -1)]).toEqual([definition.key, '23514']);
      }
    });

    it('énumérations : chaque valeur du catalogue acceptée, une autre refusée', async () => {
      for (const definition of eventColumnKeys()) {
        const { type, key } = definition;
        if (type.kind === 'enum') {
          // THIRD_PARTY exige une partie tierce désignée (autre contrainte) : hors de cette comparaison.
          for (const value of type.values.filter((v) => v !== 'THIRD_PARTY')) expect([key, value, await setColumn(key, value)]).toEqual([key, value, undefined]);
          expect([key, await setColumn(key, 'VALEUR_INCONNUE')]).toEqual([key, '23514']);
        }
        if (type.kind === 'enumSet') {
          expect(await setColumn(key, [...type.values])).toBeUndefined();
          expect(await setColumn(key, ['VALEUR_INCONNUE'])).toBe('23514');
          expect(await setColumn(key, [])).toBe('23514');
        }
      }
    });

    it('défauts du catalogue = défauts des colonnes', async () => {
      const defaults = await withOwner(async (db) =>
        (await db.query<{ column_name: string; column_default: string | null }>(
          `SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'event' AND table_schema = 'public'`,
        )).rows,
      );
      const byColumn = new Map(defaults.map((row) => [row.column_name, row.column_default]));
      const differences: string[] = [];
      for (const definition of eventColumnKeys()) {
        const raw = byColumn.get(definition.key);
        if (raw === undefined) differences.push(`${definition.key} : colonne absente`);
        if (definition.default === undefined || raw === null || raw === undefined) continue;
        const literal = raw.replace(/::[a-z_ [\]]+$/i, '').replace(/^'(.*)'$/, '$1');
        const expected = Array.isArray(definition.default) ? `{${definition.default.join(',')}}` : String(definition.default);
        if (literal !== expected) differences.push(`${definition.key} : catalogue ${expected}, colonne ${literal}`);
      }
      expect(differences).toEqual([]);
      // Les colonnes de réglage de `event` sont toutes au catalogue.
      const structural = ['id', 'operator_id', 'organizer_id', 'currency', 'timezone', 'status'];
      expect(defaults.map((row) => row.column_name).filter((c) => !structural.includes(c) && !SETTINGS_CATALOG.has(c))).toEqual([]);
    });
  });

  describe('écriture versionnée', () => {
    it('versions 1 puis 2, contenu complet, ligne d’audit avant / après', async () => {
      const target = scope('ORGANIZER', ids.organizer);
      const v1 = await tx.run(ops.a, (client) => cascade.writeVersion(client, target, { psp_fee_bearer: 'OPERATOR' }, actor));
      const v2 = await tx.run(ops.a, (client) => cascade.writeVersion(client, target, { psp_fee_bearer: 'CUSTOMER', spend_order: 'PAID_FIRST' }, actor));
      expect([v1.version, v2.version]).toEqual([1, 2]);
      expect(v2).toMatchObject({ operator_id: ops.a, scope_type: 'ORGANIZER', scope_id: ids.organizer, settings: { psp_fee_bearer: 'CUSTOMER', spend_order: 'PAID_FIRST' } });
      expect(await tx.run(ops.a, (client) => cascade.latest(client, target))).toEqual(v2);
      const audit = await withOwner(async (db) =>
        (await db.query(`SELECT operator_id, actor_id, action, before->>'version' AS before, after->>'version' AS after FROM audit_log WHERE object_id = $1`, [v2.config_version_id])).rows,
      );
      expect(audit).toEqual([{ operator_id: ops.a, actor_id: actor.actorId, action: 'CONFIG_VERSION_CREATED', before: '1', after: '2' }]);
    });

    it('deux écritures concurrentes parties de la même version : une seule réussit, l’autre reçoit 409 CONFLICT_STATE', async () => {
      // Chez le prestataire B : les résolutions de A, plus bas, ne voient pas ce niveau.
      const target = scope('OPERATOR', ops.b, ops.b);
      await tx.run(ops.b, (client) => cascade.writeVersion(client, target, { spend_order: 'PROMO_FIRST' }, actor));
      // Chaque transaction lit la version courante, puis attend que l'autre l'ait lue aussi avant d'écrire.
      let seen = 0;
      let open!: () => void;
      const bothRead = new Promise<void>((resolve) => (open = resolve));
      const gated = (client: TxClient): TxClient => ({
        query: (async (sql: string, params?: unknown[]) => {
          if (sql.includes('INSERT INTO config_version')) await bothRead;
          const result = await client.query(sql, params);
          if (sql.includes('ORDER BY version DESC LIMIT 1') && ++seen === 2) open();
          return result;
        }) as TxClient['query'],
      });
      const write = (order: string) => tx.run(ops.b, (client) => cascade.writeVersion(gated(client), target, { spend_order: order }, actor));
      const results = await Promise.allSettled([write('PAID_FIRST'), write('PROMO_FIRST')]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect([won.length, lost.length]).toEqual([1, 1]);
      expect(lost[0]!.reason).toBeInstanceOf(ProblemException);
      expect([(lost[0]!.reason as ProblemException).code, (lost[0]!.reason as ProblemException).status]).toEqual(['CONFLICT_STATE', 409]);
      const versions = await withOwner(async (db) =>
        (await db.query<{ version: number }>(`SELECT version FROM config_version WHERE scope_type = 'OPERATOR' AND scope_id = $1 ORDER BY version`, [ops.b])).rows.map((r) => r.version),
      );
      expect(versions).toEqual([1, 2]);
    });

    it('date d’effet antérieure à la version précédente : refusée par la base (CL001)', async () => {
      const target = scope('PARTICIPATION', ids.participation);
      await tx.run(ops.a, (client) => cascade.writeVersion(client, target, {}, actor, new Date('2026-05-01T00:00:00Z')));
      await expect(
        tx.run(ops.a, (client) => cascade.writeVersion(client, target, {}, actor, new Date('2026-04-01T00:00:00Z'))),
      ).rejects.toMatchObject({ code: 'CL001' });
    });

    it('un prestataire n’écrit ni chez un autre, ni au niveau plateforme', async () => {
      await expect(tx.run(ops.b, (client) => cascade.writeVersion(client, scope('ORGANIZER', ids.organizer, ops.a), {}, actor))).rejects.toMatchObject({ code: '42501' });
      await expect(tx.run(ops.a, (client) => cascade.writeVersion(client, scope('PLATFORM', ids.platform, null), {}, actor))).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('résolution à une date', () => {
    const eventOf = (operatorId: string, organizerId: string, name: string) => {
      const id = randomUUID();
      return withOwner(async (db) => {
        await db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, ends_at)
           VALUES ($1, $2, $3, $4, 'XOF', 'Africa/Dakar', $5, 'ORGANIZER', '2026-12-31T00:00:00Z')`,
          [id, operatorId, organizerId, name, ids.jurisdiction],
        );
        return id;
      });
    };

    it('niveau plateforme lisible par le rôle applicatif ; la valeur la plus précise l’emporte ; date antérieure', async () => {
      const organizer = randomUUID();
      await withOwner(async (db) => {
        await db.query(`INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur de la cascade')`, [organizer, ops.a]);
        // Le niveau plateforme est écrit par la plateforme (ici le propriétaire). Il est unique et d'autres suites y
        // écrivent en parallèle : une écriture devancée par une autre (date d'effet antérieure, CL001) est refaite.
        for (let attempt = 0; ; attempt += 1) {
          try {
            await db.query(
              `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
               VALUES (NULL, 'PLATFORM', $1, 0, clock_timestamp(), '{"spend_order":"PAID_FIRST"}')`,
              [ids.platform],
            );
            break;
          } catch (error) {
            if (attempt >= 9 || !['CL001', '23505'].includes((error as { code?: string }).code ?? '')) throw error;
          }
        }
      });
      const event = await eventOf(ops.a, organizer, 'Événement de la cascade');
      const hourAgo = new Date(Date.now() - 3_600_000);
      const snapshot = (client: TxClient) => client.query<Record<string, unknown>>('SELECT * FROM event WHERE id = $1', [event]).then((r) => r.rows[0]!);

      const before = await tx.run(ops.a, (client) => cascade.resolveForEvent(client, event));
      // Le niveau plateforme est unique et d'autres suites y écrivent en parallèle : seul le niveau d'origine est
      // garanti ici, pas la valeur de la dernière version.
      expect(before.spend_order).toMatchObject({ level: 'PLATFORM' });
      expect(['PAID_FIRST', 'PROMO_FIRST']).toContain(before.spend_order!.value);
      expect(before.sync_deadline_hours).toEqual({ value: 72, level: 'EVENT', version: null, config_version_id: null, provisional: false });
      expect(before.refund_deadline).toMatchObject({ value: '2027-01-30T00:00:00.000Z', provisional: true });

      // Version de l'organisateur datée d'il y a une heure, version de l'événement maintenant.
      const organizerVersion = await tx.run(ops.a, (client) =>
        cascade.writeVersion(client, scope('ORGANIZER', organizer), { spend_order: 'PROMO_FIRST', psp_fee_bearer: 'CUSTOMER' }, actor, hourAgo),
      );
      const eventVersion = await tx.run(ops.a, async (client) => {
        await client.query('UPDATE event SET sync_deadline_hours = 48 WHERE id = $1', [event]);
        const { eventSnapshot } = await import('../../../src/configuration/cascade.service');
        return cascade.writeVersion(client, scope('EVENT', event), { ...eventSnapshot(await snapshot(client)), psp_fee_bearer: 'OPERATOR' }, actor);
      });

      const now = await tx.run(ops.a, (client) => cascade.resolveForEvent(client, event));
      expect(now.spend_order).toEqual({ value: 'PROMO_FIRST', level: 'ORGANIZER', version: 1, config_version_id: organizerVersion.config_version_id, provisional: false });
      expect(now.psp_fee_bearer).toMatchObject({ value: 'OPERATOR', level: 'EVENT', version: 1, config_version_id: eventVersion.config_version_id });
      expect(now.sync_deadline_hours).toMatchObject({ value: 48, level: 'EVENT', version: 1 });

      // Trente minutes plus tôt : la version de l'organisateur vaut déjà, pas celle de l'événement.
      const earlier = await tx.run(ops.a, (client) => cascade.resolveForEvent(client, event, new Date(Date.now() - 1_800_000)));
      expect(earlier.psp_fee_bearer).toMatchObject({ value: 'CUSTOMER', level: 'ORGANIZER' });
      expect(earlier.sync_deadline_hours).toMatchObject({ value: 72, level: null });
      // Trois heures plus tôt : rien n'existait, défauts du catalogue.
      const longAgo = await tx.run(ops.a, (client) => cascade.resolveForEvent(client, event, new Date(Date.now() - 3 * 3_600_000)));
      expect(longAgo.psp_fee_bearer).toMatchObject({ value: 'ORGANIZER', level: null });
    });

    it('niveau participation ; participation d’un autre événement : 404', async () => {
      await tx.run(ops.a, (client) => cascade.writeVersion(client, scope('EVENT', ids.event), { spend_order: 'PAID_FIRST' }, actor));
      const view = await tx.run(ops.a, (client) => cascade.resolveForEvent(client, ids.event, undefined, ids.participation));
      expect(view.spend_order).toMatchObject({ value: 'PAID_FIRST', level: 'EVENT' });
      await expect(tx.run(ops.a, (client) => cascade.resolveForEvent(client, ids.event, undefined, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('isolation : l’événement et les versions de A sont invisibles de B', async () => {
      await expect(tx.run(ops.b, (client) => cascade.resolveForEvent(client, ids.event))).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const view = await tx.run(ops.b, (client) => cascade.resolve(client, { operatorId: ops.a, organizerId: ids.organizer }));
      expect(view.psp_fee_bearer).toMatchObject({ value: 'ORGANIZER', level: null });
      expect(await tx.run(ops.b, (client) => cascade.latest(client, { level: 'ORGANIZER', scopeId: ids.organizer }))).toBeNull();
    });
  });
});
