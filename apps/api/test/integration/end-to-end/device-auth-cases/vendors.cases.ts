// Cas de la matrice des preuves pour les routes de terminal des vendeurs (mission 5b, lot WP09,
// T043 ; C-003). Amorçage : le terminal de la matrice est affecté à un point de vente d'un
// commerçant du prestataire A, qui a un vendeur au PIN connu. L'ouverture de session est appelée
// avec le BON PIN (`201`) : un `401` métier se confondrait avec un refus de preuve.
import { VendorPinHasher } from '../../../../src/vendor-pin/vendor-pin.hasher';
import { withOwner } from '../../../support/db';
import { asOperator, assignPos, seedPos, seedVendor } from '../../vendors/vendor-fixtures';
import type { CaseContext, CaseFile, RouteCase } from './registry';

const PIN = '246810';

export const controllers: CaseFile['controllers'] = ['VendorSessionsController'];

export function cases(_ctx: CaseContext): Record<string, RouteCase> {
  let vendorId = '';
  const prepare = async (ctx: CaseContext): Promise<void> => {
    if (vendorId !== '') return;
    const hasher = ctx.api.app.get(VendorPinHasher, { strict: false });
    const pinHash = await hasher.hash(PIN);
    vendorId = await withOwner(async (db) => {
      const pos = await seedPos(db, { operatorId: ctx.w.ops.a, eventId: ctx.w.ids.eventA });
      // Compte du commerçant de la participation : sans lui, une vente de ce terminal (lot WP11,
      // `payments.cases.ts`) serait refusée par le moteur.
      await asOperator(db, ctx.w.ops.a, () =>
        db.query('SELECT open_participation_account($1)', [pos.participationId]),
      );
      await assignPos(db, ctx.terminal.deviceId, pos.posId);
      return seedVendor(db, {
        operatorId: ctx.w.ops.a,
        merchantId: pos.merchantId,
        actorId: ctx.w.operatorAdminA.userId,
        displayName: 'Vendeur de la matrice',
        pinHash,
      });
    });
  };
  return {
    'GET /vendor-sessions/vendors': {
      server: 'api',
      path: () => '/vendor-sessions/vendors',
      ok: 200,
      prepare,
    },
    'POST /vendor-sessions': {
      server: 'api',
      path: () => '/vendor-sessions',
      body: () => ({ vendor_id: vendorId, pin: PIN }),
      ok: 201,
      prepare,
    },
    'DELETE /vendor-sessions/current': {
      server: 'api',
      path: () => '/vendor-sessions/current',
      ok: 204,
      prepare,
    },
  };
}
