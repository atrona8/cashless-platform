// FR-023, FR-024, C-007 : correspondance comptable versionnée (route 18) et export comptable (route 19).
// Les comptes légaux des tests (521, 4191, 571, 706 …) sont INDICATIFS (exemple de SPECIFICATION §12.3, OP-N3) : ils
// n'existent que dans ces tests, jamais dans le code livré.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Csv, type CsvColumn } from '../../../src/common/csv';
import { APP_URL, connect, withOwner } from '../../support/db';
import { createStatementsWorld, expected, type StatementsWorld } from './statements-world';

jest.setTimeout(600_000);

const COLUMNS: CsvColumn[] = [
  { key: 'ligne', header: 'ligne', kind: 'text' },
  { key: 'date', header: 'date', kind: 'text' },
  { key: 'transaction_id', header: 'transaction_id', kind: 'text' },
  { key: 'transaction_type', header: 'transaction_type', kind: 'text' },
  { key: 'purpose', header: 'purpose', kind: 'text' },
  { key: 'sens', header: 'sens', kind: 'text' },
  { key: 'debit_account', header: 'debit_account', kind: 'text' },
  { key: 'credit_account', header: 'credit_account', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'currency', header: 'currency', kind: 'text' },
];
const PERIOD = 'from=2026-01-01&to=2027-12-31';

describe('correspondance comptable et export comptable', () => {
  let w: StatementsWorld;
  let op: string;
  let org: string;
  beforeAll(async () => {
    w = await createStatementsWorld();
    op = w.fx.parties.OPE;
    org = w.fx.parties.ORG;
    await w.replayTo(expected.after_closing.after_tx);
  });
  afterAll(async () => w.close());

  const mappingsPath = () => `/v1/operators/${op}/account-mappings`;
  const exportPath = (entity: string, query = PERIOD) =>
    `/v1/operators/${op}/accounting-exports?entity=${entity}&${query}`;
  const csv = async (entity: string, token?: string, query?: string) => {
    const res = await w.get(exportPath(entity, query), token).buffer(true);
    return { res, rows: res.status === 200 ? Csv.parse(res.text, COLUMNS) : [] };
  };
  /** Écritures (valeur absolue) des comptes de l'entité sur toute la période, depuis la base. */
  const entityPostings = (entity: string) =>
    w.owner<{ n: number; total: string; couples: number }>(
      `SELECT count(*)::int AS n, coalesce(sum(abs(p.amount)), 0)::text AS total,
              (SELECT count(*)::int FROM (SELECT DISTINCT a2.purpose, t2.type FROM posting p2
                 JOIN account a2 ON a2.id = p2.account_id JOIN ledger l2 ON l2.id = p2.ledger_id
                 JOIN journal_transaction t2 ON t2.id = p2.transaction_id
                WHERE a2.owner_party_id = $1 OR (a2.owner_party_id IS NULL AND l2.funds_holder_id = $1)) d) AS couples
         FROM posting p JOIN account a ON a.id = p.account_id JOIN ledger l ON l.id = p.ledger_id
        WHERE a.owner_party_id = $1 OR (a.owner_party_id IS NULL AND l.funds_holder_id = $1)`,
      [entity],
    );

  it('aucun jeu de comptes livré : la liste est vide, l’export signale tous les couples', async () => {
    const list = await w.get(mappingsPath());
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ data: [], has_more: false });
    const { res, rows } = await csv(org);
    expect(res.status).toBe(200);
    const [stats] = await entityPostings(org);
    const heads = rows.filter((r) => r.ligne === 'NON_MAPPE');
    const entries = rows.filter((r) => r.ligne === 'ECRITURE');
    expect(heads.length).toBeGreaterThan(0);
    expect(heads).toHaveLength(stats!.couples);
    expect(res.headers['x-unmapped-count']).toBe(String(heads.length));
    expect(entries).toHaveLength(stats!.n);
    expect(entries.every((r) => r.debit_account === '' && r.credit_account === '')).toBe(true);
    expect(entries.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(Number(stats!.total));
  });

  describe('versions de correspondance', () => {
    const v1 = {
      entity_party_id: '',
      valid_from: '2026-01-01',
      mappings: [
        // Exemple indicatif de SPECIFICATION §12.3 (à valider, OP-N3) : jamais livré par le code.
        { purpose: 'PSP', transaction_type: 'TOPUP', debit_account: '521', credit_account: '4191' },
        {
          purpose: 'CASH_DESK',
          transaction_type: 'TOPUP_CASH',
          debit_account: '571',
          credit_account: '4191',
        },
        {
          purpose: 'ORG_COM',
          transaction_type: null,
          debit_account: '4191',
          credit_account: '706',
        },
      ],
    };

    it('création : 201, version 1 attribuée par le serveur, audit sans montant ; une nouvelle version, jamais une modification', async () => {
      const res = await w.post(mappingsPath()).send({ ...v1, entity_party_id: org });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        entity_party_id: org,
        version: 1,
        valid_from: '2026-01-01',
        created_by: w.fx.people.operatorAdmin.userId,
      });
      expect(res.body.mappings).toHaveLength(3);
      const second = await w.post(mappingsPath()).send({
        ...v1,
        entity_party_id: org,
        valid_from: '2026-12-11',
        // Une version est COMPLÈTE : elle reprend les lignes inchangées et ne change que PSP / TOPUP.
        mappings: [
          {
            purpose: 'PSP',
            transaction_type: 'TOPUP',
            debit_account: '5211',
            credit_account: '4192',
          },
          ...v1.mappings.slice(1),
        ],
      });
      expect(second.status).toBe(201);
      expect(second.body.version).toBe(2);
      const list = await w.get(`${mappingsPath()}?entity_party_id=${org}`);
      expect(list.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(list.body.data[1].mappings).toEqual(res.body.mappings);
      const audits = await w.owner<{ action: string; after: Record<string, unknown> }>(
        `SELECT action, after FROM audit_log WHERE action = 'ACCOUNT_MAPPING_VERSION_CREATED' AND object_id = $1 ORDER BY id`,
        [org],
      );
      expect(audits.map((a) => a.after)).toEqual([
        { version: 1, valid_from: '2026-01-01', lines: 3 },
        { version: 2, valid_from: '2026-12-11', lines: 3 },
      ]);
    });

    it('une version est ajoutée, jamais modifiée ni supprimée : routes, rôle applicatif et propriétaire', async () => {
      const http = (method: 'put' | 'patch' | 'delete') =>
        request(w.app.getHttpServer())
          [method](`${mappingsPath()}/1`)
          .set('Authorization', `Bearer ${w.fx.people.operatorAdmin.token}`);
      for (const method of ['put', 'patch', 'delete'] as const)
        expect([404, 405]).toContain((await http(method)).status);
      const app = await connect(APP_URL);
      try {
        for (const sql of [
          `UPDATE account_mapping SET debit_account = 'X'`,
          `DELETE FROM account_mapping`,
          `INSERT INTO account_mapping (operator_id, entity_party_id, version, valid_from, purpose, debit_account, credit_account, created_by)
           VALUES ('${op}', '${org}', 9, now(), 'X', 'a', 'b', '${randomUUID()}')`,
        ])
          await expect(app.query(sql)).rejects.toMatchObject({ code: '42501' });
      } finally {
        await app.end();
      }
      await withOwner(async (db) => {
        await expect(db.query(`UPDATE account_mapping SET debit_account = 'X'`)).rejects.toThrow(
          /ajout seul/,
        );
        await expect(db.query(`DELETE FROM account_mapping`)).rejects.toThrow(/ajout seul/);
        await expect(db.query(`TRUNCATE account_mapping`)).rejects.toThrow(/ajout seul/);
      });
    });

    it('validation stricte : champ inconnu, type inconnu, doublon, compte vide, date : 400 ; entité étrangère : 404 ; date non postérieure : 422', async () => {
      const post = (body: object) => w.post(mappingsPath()).send(body);
      const base = { entity_party_id: org, valid_from: '2027-01-01', mappings: v1.mappings };
      expect((await post({ ...base, extra: 1 })).status).toBe(400);
      expect((await post({ ...base, mappings: [{ ...v1.mappings[0], note: 'x' }] })).status).toBe(
        400,
      );
      expect(
        (await post({ ...base, mappings: [{ ...v1.mappings[0], transaction_type: 'NOPE' }] }))
          .status,
      ).toBe(400);
      expect((await post({ ...base, mappings: [v1.mappings[0], v1.mappings[0]] })).status).toBe(
        400,
      );
      expect(
        (await post({ ...base, mappings: [{ ...v1.mappings[0], debit_account: ' ' }] })).status,
      ).toBe(400);
      expect((await post({ ...base, mappings: [] })).status).toBe(400);
      expect((await post({ ...base, valid_from: '2027-02-30' })).status).toBe(400);
      expect((await post({ ...base, entity_party_id: 'x' })).status).toBe(400);
      expect((await post({ ...base, entity_party_id: randomUUID() })).status).toBe(404);
      expect((await post({ ...base, entity_party_id: w.fx.parties.FOOD })).status).toBe(404);
      expect((await post({ ...base, valid_from: '2026-12-11' })).status).toBe(422);
    });

    it('rôles : écriture OPERATOR_ADMIN seul ; lecture ORGANIZER_ADMIN limitée à son entité ; autres rôles et prestataires refusés', async () => {
      const body = { entity_party_id: org, valid_from: '2028-01-01', mappings: [v1.mappings[0]] };
      const orgAdmin = w.fx.people.organizerAdmin.token;
      expect((await w.post(mappingsPath(), orgAdmin).send(body)).status).toBe(403);
      for (const person of [w.people.supervisor, w.people.cashier, w.people.merchantFood])
        expect((await w.get(mappingsPath(), person.token)).status).toBe(403);
      const own = await w.get(mappingsPath(), orgAdmin);
      expect(own.status).toBe(200);
      expect(own.body.data.length).toBe(2);
      const stranger = await w.get(mappingsPath(), w.people.foreignOrganizer.token);
      expect(stranger.body.data).toEqual([]);
      expect((await w.get(mappingsPath(), w.people.foreignOperator.token)).status).toBe(404);
      expect((await w.post(mappingsPath(), w.people.foreignOperator.token).send(body)).status).toBe(
        404,
      );
      expect((await w.get(`${mappingsPath()}?entity_party_id=zz`)).status).toBe(400);
    });

    it('rejeu avec la même clé : même réponse, aucune seconde version', async () => {
      const key = randomUUID();
      const send = () =>
        request(w.app.getHttpServer())
          .post(mappingsPath())
          .set('Authorization', `Bearer ${w.fx.people.operatorAdmin.token}`)
          .set('Idempotency-Key', key)
          .send({
            entity_party_id: w.fx.parties.OPE,
            valid_from: '2026-01-01',
            mappings: [
              {
                purpose: 'OPE_FRAIS',
                transaction_type: null,
                debit_account: '=cmd',
                credit_account: '706',
              },
            ],
          });
      const first = await send();
      const again = await send();
      expect([first.status, again.status]).toEqual([201, 201]);
      expect(again.body).toEqual(first.body);
      expect(again.headers['idempotency-replayed']).toBe('true');
    });
  });

  describe('export', () => {
    it('FR-023 : couples non mappés listés en tête, comptés dans X-Unmapped-Count, rien d’omis, équilibre par transaction et par sens', async () => {
      const before = await w.counts();
      const { res, rows } = await csv(org);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.text.split('\r\n')[0]).toBe(COLUMNS.map((c) => c.header).join(','));
      const heads = rows.filter((r) => r.ligne === 'NON_MAPPE');
      const entries = rows.filter((r) => r.ligne === 'ECRITURE');
      // Les NON_MAPPE sont tous avant la première ECRITURE.
      expect(rows.slice(0, heads.length).every((r) => r.ligne === 'NON_MAPPE')).toBe(true);
      expect(res.headers['x-unmapped-count']).toBe(String(heads.length));
      expect(heads.length).toBeGreaterThan(0);
      // Rien d'omis : autant d'écritures et le même total que les écritures de l'entité en base.
      const [stats] = await entityPostings(org);
      expect(entries).toHaveLength(stats!.n);
      expect(entries.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(Number(stats!.total));
      // Couples listés : exactement ceux des écritures sans comptes légaux.
      const unmappedPairs = new Set(
        entries
          .filter((r) => r.debit_account === '')
          .map((r) => `${r.purpose}|${r.transaction_type}`),
      );
      expect(new Set(heads.map((r) => `${r.purpose}|${r.transaction_type}`))).toEqual(
        unmappedPairs,
      );
      expect(heads).toHaveLength(unmappedPairs.size);
      // Les couples mappés ne sont pas listés comme non mappés ; ORG_COM l'est pour tous les types.
      expect(unmappedPairs.has('PSP|TOPUP')).toBe(false);
      expect(unmappedPairs.has('ORG_COM|PURCHASE')).toBe(false);
      // Équilibre réel : par transaction et par sens (D/C), la somme exportée égale celle des écritures de
      // l'entité au grand livre ; une écriture omise, ou un sens inversé, change au moins une somme.
      const ledgerSums = await w.owner<{ k: string; total: string }>(
        `SELECT p.transaction_id || '|' || CASE WHEN p.amount > 0 THEN 'D' ELSE 'C' END AS k,
                sum(abs(p.amount))::text AS total
           FROM posting p JOIN account a ON a.id = p.account_id JOIN ledger l ON l.id = p.ledger_id
          WHERE a.owner_party_id = $1 OR (a.owner_party_id IS NULL AND l.funds_holder_id = $1)
          GROUP BY 1`,
        [org],
      );
      const want = new Map(ledgerSums.map((r) => [r.k, Number(r.total)]));
      const bySide = (list: typeof entries) => {
        const sums = new Map<string, number>();
        for (const r of list) {
          const k = `${r.transaction_id}|${r.sens}`;
          sums.set(k, (sums.get(k) ?? 0) + Number(r.amount));
        }
        return sums;
      };
      expect(want.size).toBeGreaterThan(10);
      expect(bySide(entries)).toEqual(want);
      // Le contrôle discrimine : sans une écriture, il échoue.
      expect(bySide(entries.slice(1))).not.toEqual(want);
      // Chaque écriture mappée porte ses deux comptes légaux.
      const mapped = entries.filter((r) => r.debit_account !== '');
      expect(mapped.length).toBeGreaterThan(0);
      expect(mapped.every((r) => r.credit_account !== '')).toBe(true);
      expect(await w.counts()).toEqual(before);
    });

    it('FR-023 : chaque écriture reçoit les comptes de la version en vigueur à sa date ; les anciennes gardent l’ancienne', async () => {
      const { rows } = await csv(org);
      const topups = rows.filter(
        (r) => r.ligne === 'ECRITURE' && r.transaction_type === 'TOPUP' && r.purpose === 'PSP',
      );
      // T1 le 2026-12-01 (version 1) ; T2 et T3 le 2026-12-11 (version 2, valide dès ce jour). Chaque recharge
      // compte deux écritures sur le compte du canal (montant et frais) : mêmes comptes légaux.
      const byDate = new Map<string, Set<string>>();
      for (const r of topups)
        byDate.set(
          String(r.date),
          (byDate.get(String(r.date)) ?? new Set()).add(`${r.debit_account}/${r.credit_account}`),
        );
      expect([...byDate.entries()].map(([d, pairs]) => [d, [...pairs]])).toEqual([
        ['2026-12-01', ['521/4191']],
        ['2026-12-11', ['5211/4192']],
      ]);
      expect(topups).toHaveLength(6);
      const cash = rows.filter(
        (r) =>
          r.ligne === 'ECRITURE' &&
          r.purpose === 'CASH_DESK' &&
          r.transaction_type === 'TOPUP_CASH',
      );
      expect(cash.length).toBeGreaterThan(0);
      expect(cash.every((r) => r.debit_account === '571' && r.credit_account === '4191')).toBe(
        true,
      );
      // Période limitée : une écriture hors période n'apparaît pas.
      const early = await csv(org, undefined, 'from=2026-12-01&to=2026-12-01');
      expect(
        early.rows.filter((r) => r.ligne === 'ECRITURE').every((r) => r.date === '2026-12-01'),
      ).toBe(true);
      const none = await csv(org, undefined, 'from=2025-01-01&to=2025-01-02');
      expect(none.rows).toEqual([]);
      expect(none.res.headers['x-unmapped-count']).toBe('0');
    });

    it('un compte légal commençant par une formule est neutralisé dans le CSV', async () => {
      const res = await w.get(exportPath(w.fx.parties.OPE)).buffer(true);
      expect(res.status).toBe(200);
      expect(res.text).toContain(`'=cmd`);
      for (const row of Csv.parse(res.text, COLUMNS))
        for (const cell of [row.debit_account, row.credit_account, row.purpose])
          expect(String(cell ?? '')).not.toMatch(/^[=+\-@\t\r]/);
    });

    it('périmètre : ORGANIZER_ADMIN son entité seulement (404 sinon), autres rôles 403, autre prestataire 404, entrées invalides 400', async () => {
      const orgAdmin = w.fx.people.organizerAdmin.token;
      expect((await csv(org, orgAdmin)).res.status).toBe(200);
      expect((await csv(op, orgAdmin)).res.status).toBe(404);
      expect((await csv(org, w.people.foreignOrganizer.token)).res.status).toBe(404);
      for (const person of [w.people.supervisor, w.people.cashier, w.people.merchantFood])
        expect((await csv(org, person.token)).res.status).toBe(403);
      expect((await csv(org, w.people.foreignOperator.token)).res.status).toBe(404);
      expect((await csv(randomUUID())).res.status).toBe(404);
      expect((await csv(w.fx.parties.FOOD)).res.status).toBe(404);
      expect((await csv('x')).res.status).toBe(400);
      expect((await csv(org, undefined, 'from=2026-12-31&to=2026-12-01')).res.status).toBe(400);
      expect((await csv(org, undefined, 'from=2026-13-01&to=2026-12-01')).res.status).toBe(400);
      expect((await csv(org, undefined, 'from=2026-01-01')).res.status).toBe(400);
    });

    it('FR-024 : chaque export est tracé (auteur, entité, période, nombres), sans montant', async () => {
      const rows = await w.owner<{ actor_id: string; after: Record<string, unknown> }>(
        `SELECT actor_id, after FROM audit_log WHERE action = 'ACCOUNTING_EXPORTED' AND object_id = $1 ORDER BY id`,
        [org],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows)
        expect(Object.keys(row.after).sort()).toEqual(['from', 'lines', 'to', 'unmapped']);
      expect(rows[0]!.actor_id).toBe(w.fx.people.operatorAdmin.userId);
    });
  });
});
