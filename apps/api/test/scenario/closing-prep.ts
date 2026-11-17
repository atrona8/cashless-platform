// Préparation de la clôture pour les rejeux du scénario par le moteur (`replay.spec.ts`, `api-config-replay.spec.ts`) :
// depuis la mission versements-rapprochements-cloture, les passages de statut exigent des conditions réelles (aucune
// session de caisse ouverte vers RECONCILING, comptes PSP rapprochés vers SETTLING, étapes de clôture faites vers
// REFUND_WINDOW et CLOSED, échéance de remboursement atteinte vers CLOSED). Le moteur écrit déjà les transactions
// de T30 à T32 et T43 à T45 : on enregistre l'étape correspondante par `record_closing_step` (la fonction de la base,
// aucune condition n'est contournée ni affaiblie), avec la transaction écrite.
import type { TenantTx } from '../../src/db/tenant-tx';
import type { EventStatus } from '../../src/ledger/status-matrix';
import { withOwner } from '../support/db';
import type { ScenarioFixture } from './fixture';

/** Étape de clôture enregistrée après la transaction n° du scénario. */
const STEP_AFTER: Record<number, string> = {
  30: 'PITCH_FEES',
  31: 'OPERATOR_FEE',
  32: 'PLATFORM_FEE',
  43: 'BREAKAGE',
  44: 'DEPOSIT_FORFEIT',
  45: 'PROMO_EXPIRY',
};

export function closingPrep(fx: ScenarioFixture, tx: TenantTx) {
  const operator = fx.parties.OPE;
  const record = (step: string, status: 'DONE' | 'NOT_APPLICABLE', txIds: string[]) =>
    tx.run(operator, (client) =>
      client.query('SELECT record_closing_step($1, $2, $3, $4::uuid[], $5::jsonb, $6)', [
        fx.eventId,
        step,
        status,
        txIds,
        '{}',
        fx.users.author,
      ]),
    );
  return {
    /** À appeler avant un passage de statut (mission 6 : sessions fermées ; relevés PSP en accord). */
    async beforeStatus(status: EventStatus): Promise<void> {
      if (status === 'RECONCILING')
        await withOwner(async (db) => {
          await db.query('ALTER TABLE cash_session DISABLE TRIGGER USER');
          try {
            await db.query(
              `UPDATE cash_session SET status = 'CLOSED', closed_at = now(), counted_amount = 0, expected_amount = 0,
                      closed_by = opened_by,
                      close_tx_id = (SELECT id FROM journal_transaction WHERE ledger_id = $1 AND type = 'CASH_CLOSE' LIMIT 1)
                WHERE event_id = $2`,
              [fx.ledgerId, fx.eventId],
            );
          } finally {
            await db.query('ALTER TABLE cash_session ENABLE TRIGGER USER');
          }
        });
      if (status === 'SETTLING')
        await withOwner((db) =>
          db.query(
            `INSERT INTO statement_import (operator_id, ledger_id, account_id, source, file_sha256, statement_date,
                                          closing_balance, currency, imported_by, lines_created, lines_existing, lines_matched)
             SELECT $1, $2, a.id, 'test', md5(a.id::text) || md5(a.code), current_date + 1,
                    (SELECT coalesce(sum(p.amount), 0) FROM posting p WHERE p.account_id = a.id), 'XOF', $3, 0, 0, 0
               FROM account a WHERE a.ledger_id = $2 AND a.code LIKE 'A-PSP-%'
                 AND EXISTS (SELECT 1 FROM posting p WHERE p.account_id = a.id)`,
            [operator, fx.ledgerId, fx.users.author],
          ),
        );
    },
    /** À appeler après l'écriture de la transaction n° `no` (T30 à T32 : étapes 1 à 3 ; T43 à T45 : étapes 5 à 7). */
    async afterStep(no: number, transactionId: string): Promise<void> {
      const step = STEP_AFTER[no];
      if (!step) return;
      if (no === 43) await record('OPERATOR_FEE_REGULARIZATION', 'NOT_APPLICABLE', []);
      await record(step, 'DONE', [transactionId]);
    },
    /** Avant CLOSED : échéance de remboursement atteinte. */
    async beforeClosed(): Promise<void> {
      await withOwner((db) =>
        db.query(
          `UPDATE event SET refund_deadline = clock_timestamp() - interval '1 minute' WHERE id = $1`,
          [fx.eventId],
        ),
      );
    },
  };
}
