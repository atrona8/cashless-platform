// Intégration : borne OP-N160 (b), mission durcissements-serveur (11a). `canSee` montre un lot
// mixte (bénéficiaires prestataire et opérateur) à un détenteur d'UNE SEULE classe, en lecture
// seule : il ne peut ni l'approuver, ni le refuser, ni voir une destination (IBAN, numéro), ni
// l'exporter. Le test échoue si ce détenteur obtient une décision ou une destination. `canSee`
// n'est pas modifié ici.
import { ownerRows } from '../../support/media-fixtures';
import { IBAN, PayoutWorld } from './payout-fixtures';

jest.setTimeout(120_000);

describe('lot mixte vu par un détenteur d’une seule classe (OP-N160 b)', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 240_000);
  afterAll(async () => {
    await p.close();
  });

  const OPERATOR_MSISDN = '+221770000009';

  it('lecture seule : visible, mais ni décision, ni destination, ni export', async () => {
    await p.fund('L-OPE-CASSE', 4_000);
    const m = await p.merchant(5_000);
    const both = await p.holdingBoth();
    const asked = await p.request(
      [
        p.line(m, 1_000, { method: 'BANK_TRANSFER', msisdn: undefined, iban: IBAN }),
        {
          beneficiary_party_id: p.w.ops.a,
          amount: 1_000,
          currency: 'XOF',
          method: 'WAVE',
          msisdn: OPERATOR_MSISDN,
        },
      ],
      both,
    );
    expect(asked.status).toBe(202);
    const id = String(asked.body.approval_request_id);
    const before = await p.txCount('PAYOUT_INITIATED');

    for (const one of [p.organizerAdmin2, p.operatorAdmin2]) {
      // Comportement actuel figé : le lot est VISIBLE (lecture) pour une seule classe.
      const read = await p.bo('GET', `/approval-requests/${id}`, one);
      expect(read.status).toBe(200);
      expect(read.body.status).toBe('PENDING');
      const list = await p.bo('GET', '/approval-requests?limit=200', one);
      expect(list.status).toBe(200);
      expect(list.text).toContain(id);
      // ... mais sans aucune destination, ni la valeur ni l'enveloppe.
      for (const text of [read.text, list.text]) {
        expect(text).not.toContain(IBAN);
        expect(text).not.toContain(OPERATOR_MSISDN);
        expect(text).not.toContain('770000009');
        expect(text).not.toContain('enc:v1:');
      }
      // ... et sans décision possible : approuver et refuser rendent 403, la demande reste PENDING.
      expect((await p.approve(id, one)).status).toBe(403);
      const rejected = await p.bo('POST', `/approval-requests/${id}/reject`, one, {
        note: 'Non conforme',
      });
      expect(rejected.status).toBe(403);
      const exported = await p.bo('GET', `/ledgers/${p.ledger}/payout-batches/${id}/export`, one);
      expect(exported.status).not.toBe(200);
      expect(exported.text).not.toContain(IBAN);
      expect(exported.text).not.toContain(OPERATOR_MSISDN);
    }

    const state = await p.bo('GET', `/approval-requests/${id}`, both);
    expect(state.body.status).toBe('PENDING');
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
    expect(await p.payoutsOf(id)).toHaveLength(0);
    const decisions = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE object_id = $1 AND action IN ('APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_FAILED')`,
      [id],
    );
    expect(decisions[0]!.n).toBe(0);
  });
});
