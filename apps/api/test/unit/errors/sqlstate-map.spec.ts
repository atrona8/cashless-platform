// Table SQLSTATE → ProblemCode (contracts/problem-mapping.md), statuts comparés au contrat (FR-022).
import { PROBLEM_CODES, PROBLEM_STATUSES, type ProblemCode } from '@cashless/contracts';
import { ProblemException } from '../../../src/errors/problem';
import { DOUBLE_VALIDATION_CONSTRAINTS, isSqlError, mapSqlState, SQLSTATE_MAP } from '../../../src/errors/sqlstate-map';
import { MESSAGES, pickLanguage } from '../../../src/http/language';
import { UnauthenticatedTenantContext } from '../../../src/tenancy/tenant-context';

/** Recopié de contracts/problem-mapping.md. */
const TABLE: [string, ProblemCode, number][] = [
  ['CL001', 'VALIDATION_FAILED', 422], ['CL002', 'IDEMPOTENCY_KEY_REUSED', 409], ['CL003', 'LEDGER_LOCKED', 409],
  ['CL004', 'EVENT_CLOSING', 409], ['CL005', 'PERIOD_CLOSED', 409], ['CL006', 'DEBIT_AUTHORITY_EDGE', 409],
  ['CL007', 'INSUFFICIENT_FUNDS', 422], ['CL008', 'WALLET_LIMIT_EXCEEDED', 422], ['CL009', 'MONTHLY_TOPUP_LIMIT_EXCEEDED', 422],
  ['CL010', 'BATCH_IN_PROGRESS', 409], ['CL011', 'BATCH_TOO_LARGE', 413], ['CL012', 'SEQ_GAP_NOT_FOUND', 409],
  ['CL013', 'HANDOVER_INVALID_STATE', 409], ['CL014', 'EDGE_NOT_CAUGHT_UP', 409], ['CL015', 'STALE_AUTHORITY_EPOCH', 409],
  ['CL016', 'SEQ_OUT_OF_ORDER', 409], ['CL017', 'CHAIN_BROKEN', 409], ['CL018', 'EVENT_TRANSITION_INVALID', 409],
  ['CL019', 'CLOSING_CONDITION_NOT_MET', 409], ['CL020', 'MEDIA_STATE_INVALID', 409], ['CL021', 'SEQ_OUT_OF_RANGE', 409],
  ['CL022', 'TAP_UNUSABLE', 409], ['CL023', 'APPROVAL_INVALID', 409], ['CL024', 'LATE_CLAIM_INVALID', 409],
  ['P0002', 'NOT_FOUND', 404], ['42501', 'DEVICE_REVOKED', 403], ['P0001', 'INTERNAL_ERROR', 500],
];

describe('SQLSTATE → ProblemCode', () => {
  it.each(TABLE)('%s → %s (%i)', (sqlstate, code, status) => {
    expect(mapSqlState(sqlstate)).toEqual({ code, status });
  });

  it('la table ne contient que les lignes du contrat', () => {
    expect(Object.keys(SQLSTATE_MAP).sort()).toEqual(TABLE.map(([s]) => s).sort());
  });

  it.each(TABLE)('%s : statut %#  conforme à la description de ProblemCode', (_s, code, status) => {
    expect(PROBLEM_STATUSES[code]).toContain(status);
  });

  it('23514 : FORBIDDEN pour une contrainte de double validation, VALIDATION_FAILED sinon', () => {
    for (const constraint of Object.keys(DOUBLE_VALIDATION_CONSTRAINTS)) {
      expect(mapSqlState('23514', constraint)).toEqual({ code: 'FORBIDDEN', status: 403 });
    }
    expect(mapSqlState('23514', 'api_idempotency_hash_hex')).toEqual({ code: 'VALIDATION_FAILED', status: 422 });
    expect(mapSqlState('23514')).toEqual({ code: 'VALIDATION_FAILED', status: 422 });
    expect(PROBLEM_STATUSES.FORBIDDEN).toContain(403);
  });

  it('SQLSTATE inconnu → INTERNAL_ERROR 500', () => {
    expect(mapSqlState('XX000')).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    expect(mapSqlState('23505')).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
  });

  it('reconnaît une erreur pg à son SQLSTATE de 5 caractères', () => {
    expect(isSqlError({ code: 'CL007', message: 'secret' })).toBe(true);
    expect(isSqlError({ code: 'ECONNREFUSED' })).toBe(false);
    expect(isSqlError(new Error('x'))).toBe(false);
  });
});

describe('ProblemException', () => {
  it('statut par défaut tiré du contrat', () => {
    expect(new ProblemException('INSUFFICIENT_FUNDS').status).toBe(422);
    expect(new ProblemException('VALIDATION_FAILED').status).toBe(400);
    expect(new ProblemException('VALIDATION_FAILED', { status: 422 }).status).toBe(422);
  });

  it('contexte de prestataire de production : refus 401 tant que l’authentification n’existe pas', () => {
    expect(() => new UnauthenticatedTenantContext().current({} as never)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }),
    );
  });
});

describe('messages', () => {
  it.each(['fr', 'en'] as const)('catalogue %s : un titre et un détail pour chacun des codes du contrat', (language) => {
    const catalog = MESSAGES[language];
    expect(Object.keys(catalog).sort()).toEqual([...PROBLEM_CODES].sort());
    for (const code of PROBLEM_CODES) {
      expect(catalog[code].title.length).toBeGreaterThan(0);
      expect(catalog[code].detail.length).toBeGreaterThan(0);
    }
  });

  it.each([
    [undefined, 'fr'],
    ['', 'fr'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['fr-FR,en;q=0.8', 'fr'],
    ['de, en;q=0.5, fr;q=0.4', 'en'],
    ['fr;q=0.2, en;q=0.9', 'en'],
    ['en;q=0, fr', 'fr'],
    ['es', 'fr'],
  ])('Accept-Language %p → %s', (header, expected) => {
    expect(pickLanguage(header)).toBe(expected);
  });
});
