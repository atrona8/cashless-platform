// FR-022 : relevé CSV du portefeuille du festivalier (route 17), sur le festival de référence rejoué en entier.
import request from 'supertest';
import { Csv, type CsvColumn } from '../../../src/common/csv';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { scenario } from '../../unit/builders/support/scenario-lines';
import { createStatementsWorld, expected, type StatementsWorld } from './statements-world';

jest.setTimeout(600_000);

const COLUMNS: CsvColumn[] = [
  { key: 'occurred_at', header: 'occurred_at', kind: 'text' },
  { key: 'type', header: 'type', kind: 'text' },
  { key: 'label', header: 'label', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'balance', header: 'balance', kind: 'number' },
];
const transactions = scenario.transactions as unknown as {
  no: number;
  type: string;
  lines: { account: string; amount: number }[];
}[];

describe('relevé CSV du portefeuille du festivalier', () => {
  let w: StatementsWorld;
  let awa: TestCustomer;
  let moussa: TestCustomer;
  const statement = (walletId: string, who: TestCustomer | null) => {
    const r = request(w.app.getHttpServer()).get(`/v1/me/wallets/${walletId}/statement`);
    return (who ? r.set(who.headers) : r).buffer(true);
  };

  beforeAll(async () => {
    w = await createStatementsWorld();
    await w.replayTo(expected.after_closing.after_tx);
    await withOwner(async (db) => {
      awa = await createTestCustomer(db, w.fx.parties.OPE);
      moussa = await createTestCustomer(db, w.fx.parties.OPE);
      await db.query('ALTER TABLE wallet DISABLE TRIGGER USER');
      try {
        await db.query('UPDATE wallet SET customer_id = $2 WHERE id = $1', [
          w.fx.wallets.W01,
          awa.customerId,
        ]);
        await db.query('UPDATE wallet SET customer_id = $2 WHERE id = $1', [
          w.fx.wallets.W02,
          moussa.customerId,
        ]);
      } finally {
        await db.query('ALTER TABLE wallet ENABLE TRIGGER USER');
      }
    });
  });
  afterAll(async () => w.close());

  it('un mouvement par transaction, montants signés, solde courant égal au scénario ; sans écriture', async () => {
    const before = await w.counts();
    const res = await statement(w.fx.wallets.W01, awa);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="statement-/);
    expect(res.text.split('\r\n')[0]).toBe('occurred_at,type,label,amount,balance');
    const rows = Csv.parse(res.text, COLUMNS);
    // Attendu : le mouvement net des comptes « payé » de W01 dans chaque transaction du scénario (crédit positif).
    const want = transactions
      .map((tx) => ({
        type: tx.type,
        amount: -tx.lines
          .filter((l) => l.account === 'L-WAL-W01-P')
          .reduce((sum, l) => sum + l.amount, 0),
      }))
      .filter((m) => m.amount !== 0);
    // L'étape de casse est datée de son exécution (route), pas de la date du scénario : on compare sans l'ordre.
    const key = (type: unknown, amount: unknown) => `${String(type)}:${String(amount)}`;
    expect(rows.map((r) => key(r.type, r.amount)).sort()).toEqual(
      want.map((m) => key(m.type, m.amount)).sort(),
    );
    expect(rows[rows.length - 1]!.balance).toBe(0); // W01 vide après la casse
    expect(rows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(0);
    const labels = new Map(rows.map((r) => [r.type, r.label]));
    expect(labels.get('TOPUP')).toBe('Recharge en ligne');
    expect(labels.get('BREAKAGE')).toBe('Solde non réclamé');
    // Achat : le libellé est le nom du commerçant.
    expect(rows.filter((r) => r.type === 'PURCHASE').map((r) => r.label)).toEqual([
      'Food truck',
      "Bar de l'organisateur",
    ]);
    expect(await w.counts()).toEqual(before);
  });

  it('mêmes mouvements que la route JSON existante, qui reste inchangée', async () => {
    const json = await request(w.app.getHttpServer())
      .get(`/v1/me/wallets/${w.fx.wallets.W01}/transactions?limit=200`)
      .set(awa.headers);
    expect(json.status).toBe(200);
    const csv = Csv.parse((await statement(w.fx.wallets.W01, awa)).text, COLUMNS);
    const amounts = (json.body.data as { amount: number }[]).map((m) => m.amount).reverse();
    expect(csv.map((r) => r.amount)).toEqual(amounts);
  });

  it('libellé de tiers : guillemets, virgule, saut de ligne ; formule neutralisée', async () => {
    const original = (
      await w.owner<{ legal_name: string }>(`SELECT legal_name FROM party WHERE id = $1`, [
        w.fx.parties.FOOD,
      ])
    )[0]!.legal_name;
    const set = (name: string) =>
      w.owner(`UPDATE party SET legal_name = $2 WHERE id = $1`, [w.fx.parties.FOOD, name]);
    try {
      await set('=HYPERLINK("http://exemple.test","x")');
      let res = await statement(w.fx.wallets.W01, awa);
      const cells = Csv.parse(res.text, COLUMNS).map((r) => String(r.label));
      expect(cells).toContain(`'=HYPERLINK("http://exemple.test","x")`);
      expect(cells.filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([]);
      await set('Chez "Mamy", café\nbar');
      res = await statement(w.fx.wallets.W01, awa);
      expect(res.text).toContain('"Chez ""Mamy"", café\nbar"');
      expect(Csv.parse(res.text, COLUMNS).map((r) => r.label)).toContain('Chez "Mamy", café\nbar');
    } finally {
      await set(original);
    }
  });

  it('portefeuille d’un autre festivalier, inconnu ou mal formé : 404 identique ; sans jeton : 401', async () => {
    const other = await statement(w.fx.wallets.W02, awa);
    const unknown = await statement('00000000-0000-4000-8000-000000000999', awa);
    const malformed = await statement('pas-un-uuid', awa);
    const anonymous = await statement(w.fx.wallets.W01, null);
    expect([other.status, unknown.status, malformed.status]).toEqual([404, 404, 404]);
    const { instance: _a, ...otherBody } = other.body as Record<string, unknown>;
    const { instance: _b, ...unknownBody } = unknown.body as Record<string, unknown>;
    expect(otherBody).toEqual(unknownBody);
    expect(other.headers['content-type']).toMatch(/problem\+json/);
    expect(other.headers['content-disposition']).toBeUndefined();
    expect(anonymous.status).toBe(401);
    // Et dans l'autre sens : Moussa lit le sien, pas celui d'Awa.
    expect((await statement(w.fx.wallets.W02, moussa)).status).toBe(200);
    expect((await statement(w.fx.wallets.W01, moussa)).status).toBe(404);
  });

  it('un festivalier d’un autre prestataire ne voit rien : 404', async () => {
    const stranger = await withOwner((db) => createTestCustomer(db, w.people.foreignOperatorId));
    expect((await statement(w.fx.wallets.W01, stranger)).status).toBe(404);
  });
});
