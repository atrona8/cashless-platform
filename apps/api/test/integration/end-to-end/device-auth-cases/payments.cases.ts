// Cas de la matrice des preuves pour les routes du lot WP11 (mission 5b, T054 ; C-003 ; OP-N70) :
// `POST /payments` (terminal seul) et `GET /payments/{transaction_id}` (garde exclusive « terminal ou
// personne », A13).
//
// Amorçage (une fois, avant les appels de la matrice) : configuration minimale du résolveur RÉEL, événement
// EN SERVICE, point de vente du commerçant avec son catalogue, vendeur et session ouverte du terminal de la
// matrice, portefeuille du bracelet du jeu d'essai crédité. Une vente est faite par la route avec les trois
// preuves : `GET /payments/{}` lit cette vente (`ok: 200`, « vente du terminal »).
//
// Le terminal de la matrice passe en KEYPAD_TPE (montant saisi, sans catalogue) : la matrice l'affecte plus
// tard au point de vente de `vendors.cases.ts`, dont `vendors.cases.ts` ouvre le compte de commerçant, de sorte
// que `POST /payments` rend 201 (lecture neuve à chaque appel, clé `<serial>:<seq>` neuve,
// `X-Authority-Epoch: 0`).

import { randomUUID } from 'node:crypto';
import { VendorPinHasher } from '../../../../src/vendor-pin/vendor-pin.hasher';
import { withOwner } from '../../../support/db';
import { creditWallet, goLive, tapBody } from '../../../support/media-fixtures';
import { asOperator, assignPos, seedPos, seedVendor } from '../../vendors/vendor-fixtures';
import { seedPaymentConfiguration } from '../../payments/payments-fixtures';
import type { CaseContext, CaseFile, RouteCase } from './registry';

const PIN = '975310';

export const controllers: CaseFile['controllers'] = ['PaymentsController'];

export function cases(ctx: CaseContext): Record<string, RouteCase> {
  let saleId = '';
  let sessionId = '';
  const prepare = async (ctx: CaseContext): Promise<void> => {
    if (saleId !== '') return;
    const { w, terminal, api } = ctx;
    const pinHash = await api.app.get(VendorPinHasher, { strict: false }).hash(PIN);
    const seeded = await withOwner(async (db) => {
      const status = await db.query<{ status: string }>('SELECT status FROM event WHERE id = $1', [
        w.ids.eventA,
      ]);
      if (status.rows[0]!.status !== 'LIVE')
        await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      await seedPaymentConfiguration(db, w);
      const pos = await seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      await asOperator(db, w.ops.a, async () => {
        await db.query('SELECT open_participation_account($1)', [pos.participationId]);
        for (const [suffix, purpose] of [
          ['P', 'WALLET_PAID'],
          ['X', 'WALLET_PROMO'],
        ] as const)
          await db.query(
            `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
             VALUES ($1, $2, $3, 'CLAIM', $4, $5, 'C')`,
            [w.ops.a, w.ids.ledgerA, `L-WAL-${w.ids.walletA}-${suffix}`, purpose, w.ids.walletA],
          );
      });
      await creditWallet(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        walletId: w.ids.walletA,
        amount: 100_000,
      });
      const vendorId = await seedVendor(db, {
        operatorId: w.ops.a,
        merchantId: pos.merchantId,
        actorId: w.operatorAdminA.userId,
        displayName: 'Vendeur des paiements de la matrice',
        pinHash,
      });
      await assignPos(db, terminal.deviceId, pos.posId);
      await db.query("UPDATE device SET app_mode = 'KEYPAD_TPE' WHERE id = $1", [
        terminal.deviceId,
      ]);
      return { vendorId };
    });
    const session = await terminal.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/vendor-sessions',
      body: { vendor_id: seeded.vendorId, pin: PIN },
      idempotencyKey: randomUUID(),
    });
    if (session.status !== 201) throw new Error(`session refusée : ${session.status}`);
    sessionId = String(session.body.vendor_session_id);
    const sale = await terminal.request(
      api.baseUrl,
      api.tls.serverCaPem,
      {
        method: 'POST',
        path: '/payments',
        body: {
          amount: 1000,
          currency: 'XOF',
          occurred_at: new Date().toISOString(),
          vendor_session_id: sessionId,
          tap: tapBody(ctx.media, ctx.next()),
        },
        idempotencyKey: ctx.seqKey(terminal),
      },
      { headers: { 'x-authority-epoch': '0' } },
    );
    if (sale.status !== 201)
      throw new Error(`vente d’amorçage refusée : ${sale.status} ${sale.text}`);
    saleId = String(sale.body.transaction_id);
  };
  return {
    'POST /payments': {
      server: 'api',
      path: () => '/payments',
      body: () => ({
        amount: 1000,
        currency: 'XOF',
        occurred_at: new Date().toISOString(),
        vendor_session_id: sessionId,
        tap: tapBody(ctx.media, ctx.next()),
      }),
      ok: 201,
      idempotencyKey: (c, who) => c.seqKey(who),
      headers: () => ({ 'x-authority-epoch': '0' }),
      prepare,
    },
    'GET /payments/{}': {
      server: 'api',
      exclusive: 'person',
      path: () => `/payments/${saleId}`,
      ok: 200,
      prepare,
    },
  };
}
