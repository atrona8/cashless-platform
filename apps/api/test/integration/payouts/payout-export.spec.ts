// Intégration : export CSV d'un lot (route 8) et absence de destination ailleurs (mission 9b, lot
// WP08, T037 ;
// FR-011).
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
    // La ligne de la base garde la valeur complète pour l'export.
    expect((await p.payoutsOf(id))[0]!.iban).toBe(iban);
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
});
