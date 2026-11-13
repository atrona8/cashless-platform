// Cas de refus des chemins de débit (mission passerelle-locale, lot WP11, T049 et T050), partagés par
// `debit-paths-refused.spec.ts` (refus et absence d'écriture) et `edge-conflict-body.spec.ts` (corps complet du 409).
// Un cas par `operationId` de `DEBIT_PATHS` ; un chemin sans cas fait échouer les deux suites.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import {
  createBatch,
  ownerRows,
  seedPersonalizedMedia,
  tapBody,
  type SeededMedia,
} from '../../support/media-fixtures';
import type { TerminalResponse } from '../../support/test-terminal';
import type { PayMedia, PayTerminal } from '../payments/payments-fixtures';
import { ReversalWorld } from '../reversals/reversal-fixtures';
import { DebitWorld } from './debit-authority-world';

export interface CaseOutcome {
  res: TerminalResponse;
}

/** Ce que la suite prépare AVANT la bascule (états qui n'existent plus sous EDGE) et lance PENDANT. */
export interface PreparedCase {
  /** Appel lancé pendant que le grand livre est `EDGE`. */
  run: (epoch: number) => Promise<TerminalResponse>;
}

export class DebitCases {
  bar!: PayTerminal;
  keypad!: PayTerminal;
  desk!: PayTerminal;
  fromBalanceBatch = '';
  private reversal!: ReversalWorld;

  constructor(readonly dw: DebitWorld) {}

  async init(): Promise<void> {
    const { pw } = this.dw;
    this.bar = await pw.terminal({ mode: 'CATALOG_POS' });
    this.keypad = await pw.terminal({ mode: 'KEYPAD_TPE' });
    this.desk = await pw.terminal({ mode: 'TOPUP_DESK' });
    this.reversal = new ReversalWorld(pw);
    this.fromBalanceBatch = await withOwner((db) =>
      createBatch(db, {
        operatorId: pw.w.ops.a,
        organizerId: pw.w.ids.organizerA,
        eventId: pw.w.ids.eventA,
        status: 'ACTIVE',
        depositAmount: 2000,
        depositMode: 'FROM_BALANCE',
      }),
    );
  }

  /** Requête du terminal de guichet avec la personne du personnel (`cashierA`). */
  private desked(
    method: 'POST',
    path: string,
    body: unknown,
    epoch?: number,
  ): Promise<TerminalResponse> {
    const { pw } = this.dw;
    return this.desk.t.request(
      pw.api.baseUrl,
      pw.api.tls.serverCaPem,
      { method, path, body, idempotencyKey: randomUUID() },
      {
        headers: {
          'x-staff-authorization': `Bearer ${pw.w.cashierA.token}`,
          ...(epoch !== undefined ? { 'x-authority-epoch': String(epoch) } : {}),
        },
      },
    );
  }

  private async freshMedia(batch: string): Promise<SeededMedia> {
    const { pw } = this.dw;
    return withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId: pw.w.ops.a,
            batchId: batch,
            kmsKeyRef: pw.w.keyRef.a,
            count: 1,
          })
        )[0]!,
    );
  }

  private activation(media: SeededMedia, epoch?: number): Promise<TerminalResponse> {
    return this.desked(
      'POST',
      '/media/activations',
      {
        tap: tapBody(media, 1),
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
      },
      epoch,
    );
  }

  /** Prépare le cas `operationId` (avant la bascule) ; rend l'appel à lancer sous EDGE. */
  async prepare(operationId: string): Promise<PreparedCase> {
    const { pw, qr } = this.dw;
    switch (operationId) {
      case 'createPayment': {
        const [m] = (await pw.media(1)) as [PayMedia];
        return {
          run: (epoch) =>
            pw.pay(this.keypad, pw.keypadBody(this.keypad, { tap: pw.tap(m) }, 1000), {
              epoch: String(epoch),
            }),
        };
      }
      case 'payPaymentRequest': {
        const customer = await qr.customer(20_000);
        const created = await qr.create(this.keypad);
        if (created.status !== 201) throw new Error(`QR refusé : ${created.status}`);
        return { run: () => qr.pay(customer, created.id, created.token) };
      }
      case 'takeDeposit': {
        const media = await this.freshMedia(this.fromBalanceBatch);
        const activated = await this.activation(media);
        if (activated.status !== 201) throw new Error(`activation refusée : ${activated.text}`);
        return { run: () => this.desked('POST', `/media/${media.id}/deposit`, {}) };
      }
      case 'activateMedia': {
        const media = await this.freshMedia(this.fromBalanceBatch);
        return { run: () => this.activation(media) };
      }
      case 'releaseMedia': {
        const [m] = (await pw.media(1, 0)) as [PayMedia];
        return { run: () => this.desked('POST', `/media/${m.media.id}/release`, {}) };
      }
      default:
        throw new Error(`Aucun cas HTTP pour ${operationId}`);
    }
  }

  /** Vente faite AVANT la bascule (à l'époque courante), puis annulée SOUS EDGE : le crédit est accepté. */
  async prepareReversal(): Promise<PreparedCase> {
    const { pw } = this.dw;
    const [m] = (await pw.media(1)) as [PayMedia];
    const now = (await this.dw.authority()).authority_epoch;
    const sold = await pw.pay(this.keypad, pw.keypadBody(this.keypad, { tap: pw.tap(m) }, 3000), {
      epoch: String(now),
    });
    if (sold.status !== 201) throw new Error(`vente refusée : ${sold.status} ${sold.text}`);
    const id = String(sold.body.transaction_id);
    return {
      run: (epoch) => this.reversal.reverse(this.keypad, id, { epoch: String(epoch) }),
    };
  }

  /** Lecture de bracelet (NEUTRAL) sous EDGE. */
  async prepareTap(): Promise<PreparedCase> {
    const [m] = (await this.dw.pw.media(1)) as [PayMedia];
    return {
      run: () =>
        this.keypad.t.request(this.dw.pw.api.baseUrl, this.dw.pw.api.tls.serverCaPem, {
          method: 'POST',
          path: '/taps',
          body: this.dw.pw.tap(m),
        }),
    };
  }

  /** Empreinte comptable du grand livre : écritures et lignes (rien de plus après un refus). */
  async footprint(): Promise<{ transactions: number; postings: number }> {
    const [row] = await ownerRows<{ t: number; p: number }>(
      `SELECT (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $1) AS t,
              (SELECT count(*)::int FROM posting WHERE ledger_id = $1) AS p`,
      [this.dw.ledger],
    );
    return { transactions: row!.t, postings: row!.p };
  }
}

/** Cas HTTP d'une entrée `DEBIT` de la liste (les autres couches ont leur preuve propre). */
export const HTTP_DEBIT_CASES = [
  'createPayment',
  'payPaymentRequest',
  'takeDeposit',
  'activateMedia',
  'releaseMedia',
] as const;
