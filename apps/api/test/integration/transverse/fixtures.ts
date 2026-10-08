// Prestataires de test : identifiants aléatoires par fichier (les suites tournent en parallèle sur la même base).
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';

export interface Operators {
  a: string;
  b: string;
}

export async function createOperators(): Promise<Operators> {
  const operators = { a: randomUUID(), b: randomUUID() };
  await withOwner((client) =>
    client.query(
      `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Prestataire A (test)', 'SN'),
                                                                    ($2, 'OPERATOR', 'Prestataire B (test)', 'CI')`,
      [operators.a, operators.b],
    ),
  );
  return operators;
}

export interface BackofficeFixture {
  ledgerId: string;
  debitAccountId: string;
  creditAccountId: string;
}

/** Grand livre minimal du prestataire : organisateur, deux comptes de droits (forme des suites pgTAP). */
export async function createLedger(operatorId: string): Promise<BackofficeFixture> {
  const organizer = randomUUID();
  const fixture = { ledgerId: randomUUID(), debitAccountId: randomUUID(), creditAccountId: randomUUID() };
  await withOwner(async (client) => {
    await client.query(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur (test)', 'SN')`,
      [organizer, operatorId],
    );
    await client.query(
      `INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
       VALUES ($1, $2, 'EVENT', gen_random_uuid(), 'XOF', $3, $3)`,
      [fixture.ledgerId, operatorId, organizer],
    );
    await client.query(
      `INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative)
       VALUES ($1, $3, $4, 'L-MCH-TEST', 'CLAIM', 'MERCHANT', $5, 'C', true),
              ($2, $3, $4, 'L-ORG-COM', 'CLAIM', 'ORG_COM', $5, 'C', false)`,
      [fixture.debitAccountId, fixture.creditAccountId, operatorId, fixture.ledgerId, organizer],
    );
  });
  return fixture;
}
