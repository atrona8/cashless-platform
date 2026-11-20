// Intégration : demande et validation d'un lot de versements (mission 9b, lot WP08, T036 ; FR-009,
// FR-010, SC-002).
import { randomUUID } from 'node:crypto';
import { maskIban } from '../../../src/common/iban';
import { IbanVault } from '../../../src/common/iban-vault';
import { withOwner } from '../../support/db';
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
    // OP-N140 : la ligne en base ne porte que l'enveloppe (IBAN normalisé chiffré), jamais le clair ;
    // la demande non plus. L'export seul rouvre la valeur (payout-export.spec.ts).
    expect(rows.find((r) => r.iban)!.iban).toMatch(/^enc:v1:/);
    const clear = await ownerRows<{ n: number }>(
      `SELECT (SELECT count(*) FROM payout WHERE iban LIKE $1 AND approval_request_id = $2)::int
            + (SELECT count(*) FROM approval_request
                WHERE id = $2 AND (payload::text LIKE $1 OR result::text LIKE $1))::int
            + (SELECT count(*) FROM audit_log
                WHERE object_id::text = $2::text AND (before::text LIKE $1 OR after::text LIKE $1))::int AS n`,
      [`%${IBAN}%`, id],
    );
    expect(clear[0]!.n).toBe(0);
    const stored = await ownerRows<{
      payload: { lines: Array<{ iban?: string; iban_mask?: string }> };
    }>('SELECT payload FROM approval_request WHERE id = $1', [id]);
    const bank = stored[0]!.payload.lines.find((l) => l.iban)!;
    expect(bank.iban).toMatch(/^enc:v1:/);
    expect(bank.iban_mask).toBe(maskIban(IBAN));
    const shown = await p.bo('GET', `/approval-requests/${id}`, p.w.organizerAdminA);
    expect(shown.text).not.toContain(IBAN);
    expect(shown.text).not.toContain(String(bank.iban));
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
    // FR-016 amendé : exactement 409 APPROVAL_INVALID (CL023), demande encore PENDING.
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('APPROVAL_INVALID');
    const still = await p.bo(
      'GET',
      `/approval-requests/${asked.body.approval_request_id}`,
      p.w.organizerAdminA,
    );
    expect(still.body.status).toBe('PENDING');
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

  it('lot mixte : les deux rôles à la demande ; valideur du mauvais rôle : 403 avant la décision, demande PENDING (FR-013)', async () => {
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
    expect(wrong.status).toBe(403);
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
    const pending = await p.bo('GET', `/approval-requests/${asked.body.approval_request_id}`, both);
    expect(pending.body.status).toBe('PENDING');
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

  it('OP-N140 : un IBAN en clair dans la charge reçue à l’exécution est refusé ; la base refuse le clair', async () => {
    const m = await p.merchant(5_000);
    const asked = await p.request([
      p.line(m, 100, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
    ]);
    const id = String(asked.body.approval_request_id);
    // Charge forgée : le clair remplace l'enveloppe (écriture du propriétaire, hors API).
    await withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query("SET LOCAL session_replication_role = 'replica'");
      await db.query(
        `UPDATE approval_request
            SET payload = jsonb_set(payload, '{lines,0,iban}', to_jsonb($2::text)) WHERE id = $1`,
        [id, IBAN],
      );
      await db.query('COMMIT');
    });
    const res = await p.approve(id);
    // Refus 422 dès le crochet (charge relue avant la décision) : demande PENDING, rien écrit.
    expect(res.status).toBe(422);
    expect(await p.payoutsOf(id)).toHaveLength(0);
    // Borne de la base : `payout.iban` en clair viole payout_iban_sealed (23514), seule contrainte
    // touchée (toutes les autres colonnes sont copiées d'une ligne valide).
    const ok = await p.batch([
      p.line(m, 100, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
    ]);
    expect(ok.approved.body.status).toBe('EXECUTED');
    await expect(
      ownerRows(
        `INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, iban,
                             initiated_by, approved_by, initiated_tx_id, approval_request_id,
                             origin_account_id)
         SELECT operator_id, ledger_id, beneficiary_id, amount, method, status, $2,
                initiated_by, approved_by, initiated_tx_id, approval_request_id, origin_account_id
           FROM payout WHERE approval_request_id = $1`,
        [ok.id, IBAN],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'payout_iban_sealed' });
  });

  it('OP-N140 : enveloppe altérée ou scellée pour un autre prestataire, masque falsifié, forgés en base : FAILED, rien écrit, aucun fragment d’IBAN', async () => {
    // `guardDecision` ne relit que la forme (`validatePayload`) : la forge le franchit et atteint
    // `execute`, où seule l'ouverture de l'enveloppe pour CE prestataire (`checkSealed`) l'arrête.
    // Masque falsifié (revue post-fusion de la mission 11a, B-1) : l'enveloppe est authentique mais
    // le masque affiché au valideur n'est pas celui de l'IBAN payé.
    const vault = p.api.app.get(IbanVault);
    const forgeries: Array<[string, 'iban' | 'iban_mask', (genuine: string) => string]> = [
      [
        'altérée',
        'iban',
        (genuine) => {
          const at = genuine.length - 30;
          return `${genuine.slice(0, at)}${genuine[at] === 'A' ? 'B' : 'A'}${genuine.slice(at + 1)}`;
        },
      ],
      ['autre prestataire', 'iban', () => vault.seal(IBAN, p.w.ops.b)],
      ['masque falsifié', 'iban_mask', () => maskIban('FR7630006000011234567890189')],
    ];
    for (const [label, field, forge] of forgeries) {
      const m = await p.merchant(5_000);
      const asked = await p.request([
        p.line(m, 100, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
      ]);
      expect(asked.status).toBe(202);
      const id = String(asked.body.approval_request_id);
      const [stored] = await ownerRows<{ value: string }>(
        `SELECT payload->'lines'->0->>$2 AS value FROM approval_request WHERE id = $1`,
        [id, field],
      );
      const forged = forge(stored!.value);
      expect(forged).not.toBe(stored!.value);
      await withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query("SET LOCAL session_replication_role = 'replica'");
        await db.query(
          `UPDATE approval_request
              SET payload = jsonb_set(payload, ARRAY['lines', '0', $3], to_jsonb($2::text))
            WHERE id = $1`,
          [id, forged, field],
        );
        await db.query('COMMIT');
      });
      const txs = () =>
        ownerRows<{ n: number }>(
          'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1',
          [p.ledger],
        ).then((r) => r[0]!.n);
      const before = await txs();
      const res = await p.approve(id);
      // Passé le crochet, la décision est prise puis l'exécution refuse : FAILED (jamais EXECUTED).
      expect([label, res.body.status]).toEqual([label, 'FAILED']);
      expect(await p.payoutsOf(id)).toHaveLength(0);
      expect([label, await txs()]).toEqual([label, before]);
      // Un masque est fait pour être affiché : seule une enveloppe forgée est un fragment interdit.
      const fragments = [IBAN, IBAN.slice(0, 12), IBAN.slice(-8)];
      if (field === 'iban') fragments.push(forged);
      for (const fragment of fragments) {
        expect(res.text).not.toContain(fragment);
      }
    }
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
