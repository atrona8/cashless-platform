// Corps de `reversePayment` et traduction des refus (mission 5b, lot WP12, T059 ; A8, A19) : validation avant toute
// écriture, contenu du registre des numéros, seconde annulation traduite par le NOM de la contrainte.
import { resolveProblem } from '../../../src/errors/problem.filter';
import { ProblemException } from '../../../src/errors/problem';
import { mapSqlState } from '../../../src/errors/sqlstate-map';
import {
  COMMENT_MAX,
  parseReversal,
  reversalContent,
  REVERSAL_REASONS,
} from '../../../src/reversals/reversal.dto';
import { contentSha256 } from '../../../src/payments/device-seq-registry';

const SESSION = '2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b';
const ok = {
  reason: 'INPUT_ERROR',
  occurred_at: '2026-12-12T19:03:00Z',
  vendor_session_id: SESSION,
};

const refusal = (body: unknown): ProblemException => {
  try {
    parseReversal(body);
  } catch (error) {
    return error as ProblemException;
  }
  throw new Error('corps accepté');
};

describe('parseReversal', () => {
  it('corps valide ; commentaire facultatif ; session facultative (refusée plus loin par la garde de session)', () => {
    expect(parseReversal({ ...ok, comment: 'Erreur de saisie' })).toMatchObject({
      reason: 'INPUT_ERROR',
      comment: 'Erreur de saisie',
      vendorSessionId: SESSION,
    });
    expect(parseReversal({ reason: 'OTHER', occurred_at: ok.occurred_at })).toMatchObject({
      comment: null,
      vendorSessionId: null,
    });
  });

  it.each(REVERSAL_REASONS)('raison %s admise', (reason) => {
    expect(parseReversal({ ...ok, reason }).reason).toBe(reason);
  });

  it('A8 : supervisor_pin_proof, quelle que soit sa valeur → 422 VALIDATION_FAILED', () => {
    for (const value of ['123456', '', null, 0, {}]) {
      const error = refusal({ ...ok, supervisor_pin_proof: value });
      expect([error.status, error.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
  });

  it('raison hors liste ou absente, commentaire trop long, session non uuid, heure absente → 422', () => {
    for (const body of [
      { ...ok, reason: 'AUTRE' },
      { occurred_at: ok.occurred_at },
      { ...ok, comment: 'x'.repeat(COMMENT_MAX + 1) },
      { ...ok, vendor_session_id: 'pas-un-uuid' },
      { reason: 'OTHER' },
      null,
      [],
      'texte',
    ]) {
      const error = refusal(body);
      expect([error.status, error.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
  });
});

describe('reversalContent (registre des numéros)', () => {
  const tx = '7d0b3d5e-1c6a-4b8e-9f2a-0a1b2c3d4e5f';
  it('champs chaînés seulement : ni la session, ni la raison, ni le commentaire', () => {
    const a = reversalContent(4n, tx, ok)!;
    const b = reversalContent(4n, tx, {
      ...ok,
      reason: 'OTHER',
      comment: 'x',
      vendor_session_id: null,
    })!;
    expect(a.equals(b)).toBe(true);
    expect(
      a.equals(
        contentSha256({
          seq: 4,
          type: 'REVERSAL',
          occurred_at: ok.occurred_at,
          reverses_transaction_id: tx,
        }),
      ),
    ).toBe(true);
  });
  it('change avec le numéro, la vente ou l’heure ; null si le corps n’est pas un objet', () => {
    const a = reversalContent(4n, tx, ok)!;
    expect(reversalContent(5n, tx, ok)!.equals(a)).toBe(false);
    expect(reversalContent(4n, 'autre', ok)!.equals(a)).toBe(false);
    expect(reversalContent(4n, tx, { ...ok, occurred_at: '2026-12-12T19:04:00Z' })!.equals(a)).toBe(
      false,
    );
    expect(reversalContent(4n, tx, null)).toBeNull();
    expect(reversalContent(4n, tx, [])).toBeNull();
  });
});

describe('A19 : seconde annulation traduite par le nom de la contrainte', () => {
  it('journal_transaction_reverses_once et CL035 → 409 ALREADY_REVERSED', () => {
    expect(mapSqlState('23505', 'journal_transaction_reverses_once')).toMatchObject({
      code: 'ALREADY_REVERSED',
      status: 409,
    });
    expect(mapSqlState('CL035')).toMatchObject({ code: 'ALREADY_REVERSED', status: 409 });
  });
  it('un autre 23505 n’est JAMAIS traduit en ALREADY_REVERSED', () => {
    for (const constraint of ['journal_transaction_ledger_id_idempotency_key_key', undefined]) {
      const problem = resolveProblem({ code: '23505', constraint });
      expect(problem.code).not.toBe('ALREADY_REVERSED');
    }
  });
  it('CL036 → 422 REVERSAL_NOT_ALLOWED ; CL040 → 409 REVERSAL_WINDOW_EXPIRED (ADR-123)', () => {
    expect(mapSqlState('CL036')).toMatchObject({ code: 'REVERSAL_NOT_ALLOWED', status: 422 });
    expect(mapSqlState('CL040')).toMatchObject({ code: 'REVERSAL_WINDOW_EXPIRED', status: 409 });
  });
});
