// Intégration : export CSV d'un lot (route 8) et absence de destination ailleurs (mission 9b, lot
// WP08, T037 ;
// FR-011).
import { IbanVault } from '../../../src/common/iban-vault';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { IBAN, MSISDN, PayoutWorld } from './payout-fixtures';

jest.setTimeout(120_000);

describe('export du lot', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 240_000);
  afterAll(async () => {
    await p.close();
  });

  const exportOf = (id: string, who = p.w.organizerAdminA, ledger = p.ledger) =>
    p.bo('GET', `/ledgers/${ledger}/payout-batches/${id}/export`, who);

  it('FR-011 : CSV complet, IBAN et numéro en clair seulement ici, nom « = » neutralisé, export audité', async () => {
    const m1 = await p.merchant(10_000, '=SOMME(A1:A9)');
    const m2 = await p.merchant(10_000, 'Stand Bissap');
    const m3 = await p.merchant(10_000, '+Stand');
    const { id } = await p.batch([
      p.line(m1, 4_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
      p.line(m2, 6_000),
      p.line(m3, 100),
    ]);
    const res = await exportOf(id);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('beneficiary,method,destination,amount,currency,reference');
    expect(lines).toHaveLength(4);
    expect(res.text).toContain("'+Stand");
    expect(res.text).toContain(IBAN);
    // Décision 9 : numéro en chiffres seuls, sans « + » ni apostrophe.
    expect(res.text).toContain(`,WAVE,${MSISDN.slice(1)},`);
    expect(res.text).not.toContain(MSISDN);
    expect(res.text).not.toContain(`'${MSISDN.slice(1)}`);
    expect(res.text).toContain("'=SOMME(A1:A9)");
    expect(lines.some((l) => l.startsWith('=') || l.includes(',=SOMME'))).toBe(false);
    expect(lines.find((l) => l.includes('Stand Bissap'))).toContain(',WAVE,');
    expect(lines.find((l) => l.includes('Stand Bissap'))).toContain(',6000,XOF,');

    // Audité : nombre de lignes, jamais la destination ; chaque export a sa ligne (pas rejoué).
    await exportOf(id);
    const audits = await ownerRows<{ after: unknown }>(
      `SELECT after FROM audit_log WHERE action = 'PAYOUT_BATCH_EXPORTED' AND object_id = $1`,
      [id],
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits[0]!.after)).toContain('"lines":3');
  });

  it('FR-011 : IBAN et numéro absents de la liste, des approbations, de tout audit_log et de la charge exposée', async () => {
    const m = await p.merchant(10_000);
    const iban = 'FR1420041010050500013M02606';
    const { id } = await p.batch([
      p.line(m, 1_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban }),
    ]);
    const approval = await p.bo('GET', `/approval-requests/${id}`, p.w.organizerAdminA);
    const approvals = await p.bo('GET', '/approval-requests?limit=200', p.w.organizerAdminA);
    const list = await p.bo('GET', `/ledgers/${p.ledger}/payouts`, p.w.organizerAdminA);
    for (const text of [approval.text, approvals.text, list.text]) expect(text).not.toContain(iban);
    expect(approval.status).toBe(200);
    expect(approval.text).not.toContain(MSISDN);
    const leaks = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE (before::text LIKE $1 OR after::text LIKE $1 OR before::text LIKE $2 OR after::text LIKE $2)
          AND (after->>'target_id' = $3 OR before->>'target_id' = $3 OR object_id = $4)`,
      [`%${iban}%`, `%${MSISDN}%`, p.ledger, id],
    );
    expect(leaks[0]!.n).toBe(0);
    // La ligne de la base ne garde que l'enveloppe ; l'export seul rouvre la valeur.
    const stored = (await p.payoutsOf(id))[0]!.iban!;
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain(iban);
    expect((await exportOf(id)).text).toContain(iban);
    expect(approvals.text).not.toContain(stored);
  });

  it('lot inconnu ou non validé : 404 ; autre prestataire : 404 ; sans le rôle du lot : 403 ; jamais le CSV', async () => {
    const m = await p.merchant(5_000);
    const asked = await p.request([p.line(m, 1_000)]);
    const pending = String(asked.body.approval_request_id);
    expect((await exportOf(pending)).status).toBe(404);
    expect((await exportOf('00000000-0000-4000-8000-000000000001')).status).toBe(404);
    expect((await exportOf('pas-un-uuid')).status).toBe(404);
    const { id } = await p.batch([p.line(m, 1_000)]);
    expect((await exportOf(id, p.operatorAdminB)).status).toBe(404);
    const other = await exportOf(id, p.operatorAdmin2);
    expect(other.status).toBe(403);
    expect(other.text).not.toContain(MSISDN);
    expect((await exportOf(id, p.w.supervisorA)).status).toBe(403);
    expect((await exportOf(id, p.w.cashierA)).status).toBe(403);
    expect((await exportOf(id, p.organizerAdmin2)).status).toBe(200);
  });

  it('OP-N140 : enveloppe altérée, d’un autre prestataire ou ancienne ligne en clair : erreur sans valeur, pas de CSV', async () => {
    const m = await p.merchant(5_000);
    const { id } = await p.batch([
      p.line(m, 1_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
    ]);
    expect((await exportOf(id)).text).toContain(IBAN);
    const [row] = await p.payoutsOf(id);
    const sealed = row!.iban!;
    const other = new IbanVault(new Map([['k1', Buffer.alloc(32, 0x08)]]), 'k1');
    const flipped = `${sealed.slice(0, -3)}${sealed.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    // Écriture du propriétaire hors garde de transition (triggers coupés le temps de la requête).
    const set = (value: string) =>
      withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query("SET LOCAL session_replication_role = 'replica'");
        // Ligne ancienne en clair : la contrainte (NOT VALID) est levée le temps de l'écriture.
        await db.query('ALTER TABLE payout DROP CONSTRAINT payout_iban_sealed');
        await db.query('UPDATE payout SET iban = $1 WHERE id = $2', [value, row!.id]);
        await db.query(
          `ALTER TABLE payout ADD CONSTRAINT payout_iban_sealed
             CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID`,
        );
        await db.query('COMMIT');
      });
    try {
      const foreign = other.seal(IBAN, p.w.ops.b);
      for (const bad of [flipped, foreign, IBAN]) {
        await set(bad);
        const res = await exportOf(id);
        expect(res.status).toBe(500);
        expect(res.text).not.toContain(IBAN);
        expect(res.text).not.toContain('Stand');
        expect(res.text).not.toContain('beneficiary,method');
      }
    } finally {
      await set(sealed);
    }
    expect((await exportOf(id)).status).toBe(200);
  });

  it('OP-N160 (a) : une ligne illisible sur plusieurs : 500, aucun CSV partiel, aucune autre ligne', async () => {
    const [m, m2, m3] = [await p.merchant(9_000), await p.merchant(9_000), await p.merchant(9_000)];
    const ibanB = 'FR1420041010050500013M02606';
    const { id } = await p.batch([
      p.line(m, 1_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
      p.line(m2, 1_100, { method: 'BANK_TRANSFER', msisdn: undefined, iban: ibanB }),
      p.line(m3, 1_200),
    ]);
    const full = await exportOf(id);
    expect(full.status).toBe(200);
    expect(full.text.trim().split('\r\n')).toHaveLength(4);
    const rows = (await p.payoutsOf(id)).filter((r) => r.iban);
    expect(rows).toHaveLength(2);
    const ownerSet = (rowId: string, value: string) =>
      withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query("SET LOCAL session_replication_role = 'replica'");
        await db.query('UPDATE payout SET iban = $1 WHERE id = $2', [value, rowId]);
        await db.query('COMMIT');
      });
    // Chaque ligne tour à tour : l'autre IBAN, le numéro et l'en-tête ne sortent jamais.
    for (const bad of rows) {
      const flipped = `${bad.iban!.slice(0, -3)}${bad.iban!.endsWith('AAA') ? 'BBB' : 'AAA'}`;
      await ownerSet(bad.id, flipped);
      try {
        const res = await exportOf(id);
        expect(res.status).toBe(500);
        expect(res.headers['content-type'] ?? '').not.toMatch(/csv/);
        for (const secret of [IBAN, ibanB, MSISDN, 'Stand', 'beneficiary,method'])
          expect(res.text).not.toContain(secret);
        expect(res.text.split('\n').length).toBeLessThan(4);
      } finally {
        await ownerSet(bad.id, bad.iban!);
      }
    }
    expect((await exportOf(id)).text).toBe(full.text);
  });

  it('NFR-002 : export de 500 lignes chiffrées en moins de 2 s, déchiffrement compris', async () => {
    const m = await p.merchant(5_000);
    const { id } = await p.batch([
      p.line(m, 1_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
    ]);
    await withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query("SET LOCAL session_replication_role = 'replica'");
      await db.query(
        `WITH np AS (
           INSERT INTO party (id, kind, operator_id, legal_name)
           SELECT gen_random_uuid(), 'MERCHANT', $2, 'Stand ' || g FROM generate_series(1, 499) g
           RETURNING id)
         INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, iban,
                             initiated_by, approved_by, initiated_tx_id, approval_request_id,
                             origin_account_id)
         SELECT po.operator_id, po.ledger_id, np.id, po.amount, po.method, po.status, po.iban,
                po.initiated_by, po.approved_by, po.initiated_tx_id, po.approval_request_id,
                po.origin_account_id
           FROM payout po, np WHERE po.approval_request_id = $1`,
        [id, p.w.ops.a],
      );
      await db.query('COMMIT');
    });
    expect(await p.payoutsOf(id)).toHaveLength(500);
    const started = process.hrtime.bigint();
    const res = await exportOf(id);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`NFR-002 export 500 lignes : ${ms.toFixed(0)} ms`);
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')).toHaveLength(501);
    if (!process.env.SKIP_LATENCY) expect(ms).toBeLessThan(2_000);
  });
});
