// WP14 (relecture de WP13, cycle décision 15) : la catégorie « Ventes internes » du relevé de l'organisateur filtre les
// mouvements du compte du commerçant interne sur `fee_rule_id IS NULL` ; aucun cas du scénario (commission du bar à 0 %)
// n'exerce ce filtre avec une commission. Ici : le bar interne vend avec une commission de 10 %, le relevé compte la
// vente portée par le compte du commerçant, jamais la commission prélevée sur ce compte (ligne de frais,
// `fee_rule_id` posé) ; la commission reste dans sa catégorie.
import { TenantTx } from '../../../src/db/tenant-tx';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { STEPS } from '../../scenario/commands';
import { createStatementsWorld, type StatementsWorld } from '../statements/statements-world';

jest.setTimeout(600_000);

interface Line {
  transaction_id: string;
  type: string;
  label: string;
  amount: number;
}

describe('ventes internes avec commission (relevé de l’organisateur)', () => {
  let w: StatementsWorld;
  beforeAll(async () => {
    w = await createStatementsWorld();
    await w.replayTo(23);
  });
  afterAll(async () => w.close());

  const statement = async () => {
    const lines: Line[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const res = await w.get(
        w.eventPath(
          `/statements/ORGANIZER?party_id=${w.fx.parties.ORG}&limit=50${cursor ? `&cursor=${cursor}` : ''}`,
        ),
      );
      expect(res.status).toBe(200);
      lines.push(...(res.body.data as Line[]));
      cursor = res.body.next_cursor as string | null;
      if (!res.body.has_more) return lines;
    }
    throw new Error('pagination sans fin');
  };
  const category = (lines: Line[], name: string) =>
    lines.filter((l) => l.label.split(' — ')[0] === name);

  it('vente de 1 000 au bar interne à 10 % : +1 000 en « Ventes internes », la commission n’y est pas', async () => {
    const before = await statement();
    const salesBefore = category(before, 'Ventes internes').reduce((s, l) => s + l.amount, 0);
    // Une règle ne se modifie pas : l'ancienne est fermée, une nouvelle version à 10 % la remplace.
    await w.owner(`UPDATE fee_rule SET valid_to = '2026-01-02T00:00:00Z' WHERE id = $1`, [
      w.fx.commissionRules.BAR,
    ]);
    await w.owner(
      `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps,
                             trigger, valid_from, version)
       SELECT operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, 1000, trigger,
              '2026-01-02T00:00:00Z', version + 1 FROM fee_rule WHERE id = $1`,
      [w.fx.commissionRules.BAR],
    );
    const engine = w.app.get(LedgerEngineService);
    const tx = w.app.get(TenantTx);
    const step = STEPS.find((s) => s.no === 11)!;
    const command = await step.command(w.fx, async () => {
      throw new Error('inutile');
    });
    command.idempotencyKey = 'WP14:bar-commission:1';
    command.payload = { ...(command.payload as object), amount: 1000n };
    const result = await tx.run(w.fx.parties.OPE, (client) => engine.execute(client, command));
    expect(result.transactionId).toBeTruthy();
    const lines = await w.owner<{ code: string; amount: string; fee: boolean }>(
      `SELECT a.code, p.amount::text AS amount, (p.fee_rule_id IS NOT NULL) AS fee
         FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = $1 ORDER BY p.line_no`,
      [result.transactionId],
    );
    // Compte du commerçant interne : la vente (sans règle de frais) et la commission prélevée (ligne de frais).
    const bar = lines.filter((l) => l.code === `L-MCH-${w.fx.participations.BAR}`);
    expect(bar.map((l) => [l.amount, l.fee])).toEqual([
      ['-1000', false],
      ['100', true],
    ]);

    const after = await statement();
    const added = after.filter((l) => l.transaction_id === result.transactionId);
    const internal = added.filter((l) => l.label.split(' — ')[0] === 'Ventes internes');
    // Seule la vente est une « vente interne » : la commission du même compte est écartée par le filtre.
    expect(internal.map((l) => l.amount)).toEqual([1000]);
    expect(category(after, 'Ventes internes').reduce((s, l) => s + l.amount, 0)).toBe(
      salesBefore + 1000,
    );
    // La commission reste dans sa catégorie de l'organisateur (85 + 15 de taxe), pas dans les ventes internes.
    expect(added.map((l) => l.label.split(' — ')[0]).sort()).toEqual([
      'Commissions',
      'Taxe collectée',
      'Ventes internes',
    ]);
  });
});
