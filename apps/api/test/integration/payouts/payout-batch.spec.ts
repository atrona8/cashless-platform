// Intégration : demande et validation d'un lot de versements (mission 9b, lot WP08, T036 ; FR-009,
// FR-010, SC-002).
import { randomUUID } from 'node:crypto';
import { ownerRows } from '../../support/media-fixtures';
import { IBAN, PayoutWorld } from './payout-fixtures';

jest.setTimeout(120_000);

describe('lot de versements', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 240_000);
  afterAll(async () => {
    await p.close();
  });
  afterEach(async () => {
    expect(await p.unbalanced()).toBe(0);
  });

  it('FR-009, SC-002 : 40 000 pour un droit net de 39 225 : 409 PAYOUT_EXCEEDS_ENTITLEMENT, rien demandé', async () => {
    const m = await p.merchant(39_225);
    const res = await p.request([p.line(m, 40_000)]);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYOUT_EXCEEDS_ENTITLEMENT');
    const ok = await p.request([p.line(m, 39_225)]);
    expect(ok.status).toBe(202);
    expect(ok.body).toMatchObject({ action: 'PAYOUT', status: 'PENDING', target_id: p.ledger });
  });

  it('FR-010 : un lot écrit une transaction PAYOUT_INITIATED et une ligne par bénéficiaire, charge sans IBAN', async () => {
    const m1 = await p.merchant(10_000);
    const m2 = await p.merchant(8_000);
    const before = await p.txCount('PAYOUT_INITIATED');
    const { id, asked, approved } = await p.batch([
      p.line(m1, 6_000),
      p.line(m2, 8_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN.toLowerCase() }),
    ]);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('EXECUTED');
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before + 1);
    const rows = await p.payoutsOf(id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(['INITIATED', 'INITIATED']);
    // La ligne en base garde la destination complète (IBAN normalisé) ; aucune réponse
    // d'approbation ne la porte.
    expect(rows.find((r) => r.iban)!.iban).toBe(IBAN);
    for (const text of [asked.text, approved.text]) {
      expect(text).not.toContain(IBAN);
      expect(text).not.toContain('770000001');
    }
    const [row] = await ownerRows<{ initiated_by: string; approved_by: string }>(
      'SELECT initiated_by, approved_by FROM payout WHERE approval_request_id = $1 LIMIT 1',
      [id],
    );
    expect(row).toEqual({
      initiated_by: p.w.organizerAdminA.userId,
      approved_by: p.organizerAdmin2.userId,
    });
    expect(await p.net(m1.partyId)).toBe(4_000);
  });

  it('FR-010 : auteur = valideur refusé, aucune écriture ; SUPERVISOR et CASHIER : 403', async () => {
    const m = await p.merchant(5_000);
    const before = await p.txCount('PAYOUT_INITIATED');
    const asked = await p.request([p.line(m, 1_000)]);
    const self = await p.approve(asked.body.approval_request_id, p.w.organizerAdminA);
    expect([403, 409]).toContain(self.status);
    expect(self.body.status).not.toBe('EXECUTED');
    for (const who of [p.w.supervisorA, p.w.cashierA]) {
      expect((await p.request([p.line(m, 1_000)], who)).status).toBe(403);
      expect((await p.approve(asked.body.approval_request_id, who)).status).toBe(403);
    }
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
    expect(await p.payoutsOf(String(asked.body.approval_request_id))).toHaveLength(0);
  });

  it('rôle selon le bénéficiaire : ORGANIZER_ADMIN ne prépare pas un versement du prestataire, et inversement', async () => {
    await p.fund('L-OPE-CASSE', 4_000);
    const m = await p.merchant(5_000);
    const operator = {
      beneficiary_party_id: p.w.ops.a,
      amount: 1_000,
      currency: 'XOF',
      method: 'WAVE',
      msisdn: '+221770000009',
    };
    expect((await p.request([operator], p.w.organizerAdminA)).status).toBe(403);
    expect((await p.request([p.line(m, 1_000)], p.w.operatorAdminA)).status).toBe(403);
    // Lot du prestataire par le prestataire : accepté, validé par un autre OPERATOR_ADMIN.
    const ok = await p.batch([operator], p.w.operatorAdminA, p.operatorAdmin2);
    expect(ok.approved.body.status).toBe('EXECUTED');
  });

  it('lot mixte : les deux rôles à la demande ; valideur du mauvais rôle : demande FAILED, rien écrit', async () => {
    await p.fund('L-OPE-CASSE', 4_000);
    const m = await p.merchant(5_000);
    const operator = {
      beneficiary_party_id: p.w.ops.a,
      amount: 1_000,
      currency: 'XOF',
      method: 'WAVE',
      msisdn: '+221770000009',
    };
    const mixed = [p.line(m, 1_000), operator];
    // Un seul rôle chez l'auteur : refusé.
    expect((await p.request(mixed, p.w.organizerAdminA)).status).toBe(403);
    expect((await p.request(mixed, p.w.operatorAdminA)).status).toBe(403);
    // Une personne qui tient les deux rôles demande ; un valideur qui n'en tient qu'un échoue à
    // l'exécution.
    const both = await p.holdingBoth();
    const asked = await p.request(mixed, both);
    expect(asked.status).toBe(202);
    const before = await p.txCount('PAYOUT_INITIATED');
    const wrong = await p.approve(asked.body.approval_request_id, p.organizerAdmin2);
    expect(wrong.body.status).toBe('FAILED');
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
    const again = await p.request(mixed, both);
    const right = await p.approve(again.body.approval_request_id, await p.holdingBoth());
    expect(right.body.status).toBe('EXECUTED');
  });

  it('bénéficiaire LEGAL, client ou inconnu : 422', async () => {
    const [legal] = await ownerRows<{ id: string }>(
      `SELECT id FROM party WHERE kind::text NOT IN ('MERCHANT', 'ORGANIZER', 'OPERATOR', 'PLATFORM') LIMIT 1`,
    );
    const m = await p.merchant(1_000);
    for (const id of [legal?.id ?? randomUUID(), randomUUID()]) {
      const res = await p.request([{ ...p.line(m, 100), beneficiary_party_id: id }]);
      expect(res.status).toBe(422);
    }
  });

  it('FR-009 : droit baissé entre la demande et la validation : demande FAILED PAYOUT_EXCEEDS_ENTITLEMENT, rien écrit', async () => {
    const m = await p.merchant(10_000);
    const asked = await p.request([p.line(m, 9_000)]);
    const other = await p.batch([p.line(m, 5_000)]);
    expect(other.approved.body.status).toBe('EXECUTED');
    const before = await p.txCount('PAYOUT_INITIATED');
    const late = await p.approve(asked.body.approval_request_id);
    expect(late.body).toMatchObject({
      status: 'FAILED',
      failure_code: 'PAYOUT_EXCEEDS_ENTITLEMENT',
    });
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
    expect(await p.payoutsOf(String(asked.body.approval_request_id))).toHaveLength(0);
  });

  it('FR-009 : deux lots de 30 000 pour 39 225 approuvés en parallèle : un seul passe', async () => {
    const m = await p.merchant(39_225);
    const a = await p.request([p.line(m, 30_000)]);
    const b = await p.request([p.line(m, 30_000)]);
    const [ra, rb] = await Promise.all([
      p.approve(a.body.approval_request_id, p.organizerAdmin2),
      p.approve(b.body.approval_request_id, p.organizerAdmin2),
    ]);
    expect([ra.body.status, rb.body.status].sort()).toEqual(['EXECUTED', 'FAILED']);
    expect(await p.net(m.partyId)).toBe(9_225);
  });

  it('entrée refusée : montant nul, négatif, décimal, énorme, IBAN faux, doublon, champ étranger, CASH', async () => {
    const m = await p.merchant(1_000);
    for (const amount of [0, -1, 1.5, 2 ** 53])
      expect((await p.request([p.line(m, amount)])).status).toBe(422);
    const bad = { method: 'BANK_TRANSFER', msisdn: undefined };
    expect(
      (await p.request([p.line(m, 10, { ...bad, iban: 'SN08SN0100152000048500003036' })])).status,
    ).toBe(422);
    expect((await p.request([p.line(m, 10), p.line(m, 10)])).status).toBe(422);
    expect((await p.request([p.line(m, 10, { extra: 1 })])).status).toBe(422);
    expect((await p.request([p.line(m, 10, { method: 'CASH', msisdn: undefined })])).status).toBe(
      422,
    );
  });

  it('grand livre LOCKED : refusé, rien écrit ; grand livre d’un autre prestataire : 404', async () => {
    const m = await p.merchant(1_000);
    await ownerRows(
      `UPDATE ledger SET status = 'LOCKED', locked_until = clock_timestamp() - interval '1 hour' WHERE id = $1`,
      [p.ledger],
    );
    try {
      expect((await p.request([p.line(m, 100)])).status).toBe(409);
    } finally {
      await ownerRows(`UPDATE ledger SET status = 'OPEN', locked_until = NULL WHERE id = $1`, [
        p.ledger,
      ]);
    }
    expect((await p.request([p.line(m, 100)], p.operatorAdminB)).status).toBe(404);
  });

  it('NFR-001 : 50 rejeux de la clé de demande : une seule demande', async () => {
    const m = await p.merchant(5_000);
    const key = randomUUID();
    const lines = [p.line(m, 100)];
    const all = await Promise.all(
      Array.from({ length: 50 }, () => p.request(lines, p.w.organizerAdminA, key)),
    );
    const accepted = all.filter((r) => r.status === 202 || r.status === 200);
    expect(accepted.length).toBeGreaterThan(0);
    expect(new Set(accepted.map((r) => String(r.body.approval_request_id))).size).toBe(1);
    expect(all.every((r) => [200, 202, 409].includes(r.status))).toBe(true);
    const rows = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval_request WHERE action = 'PAYOUT' AND payload @> $1::jsonb`,
      [JSON.stringify({ lines: [{ beneficiary_party_id: m.partyId }] })],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
