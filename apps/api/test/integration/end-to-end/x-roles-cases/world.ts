// Monde de test de la matrice `x-roles` (WP10) : le monde des caisses (prestataire A, événement en service, terminal
// de guichet avec session ouverte, lots, bracelet) augmenté d'un commerçant participant, d'un point de vente, d'un
// vendeur, de ventes, et d'UNE personne par rôle du personnel, chacune dans la portée qui couvre ces objets :
//   PLATFORM_ADMIN : plateforme ; OPERATOR_ADMIN et PERSONALIZER : prestataire A ; ORGANIZER_ADMIN et SUPERVISOR :
//   organisateur A ; CASHIER : événement A ; MERCHANT_ADMIN : le commerçant participant.
// Amorçage en propriétaire seulement ; les appels de la matrice passent tous par l'API.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { seedSales, type SalesFixture } from '../../backoffice/sales-seed';
import { createKeyProcess, type KeyProcessApp } from '../../../support/app';
import { createCashWorld, type CashWorld } from '../../../support/cash-fixtures';
import { withOwner } from '../../../support/db';
import { seedPersonalizedMedia } from '../../../support/media-fixtures';
import request from 'supertest';
import { tapBody, type SeededMedia } from '../../../support/media-fixtures';
import type { PreparedCall, StaffRole, XRolesFixture } from './registry';

export interface XRolesPerson {
  userId: string;
  token: string;
}

export interface XRolesWorld extends XRolesFixture {
  media: SeededMedia;
  cash: CashWorld;
  sales: SalesFixture;
  people: Record<StaffRole, XRolesPerson>;
  api: INestApplication;
  /** Processus de personnalisation (routes des postes de personnalisation). */
  personalization: KeyProcessApp;
  close(): Promise<void>;
}

export async function createXRolesWorld(): Promise<XRolesWorld> {
  const cash = await createCashWorld();
  const w = cash.w;
  const sales = await withOwner((db) => seedSales(db, w, { count: 4, rich: true }));
  const { merchantAdmin, participationId, media } = await withOwner(async (db) => {
    const merchantAdmin = await w.idp.createPerson(db, {
      operatorId: w.ops.a,
      roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: sales.merchants[0] }],
    });
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM merchant_participation WHERE merchant_id = $1',
      [sales.merchants[0]],
    );
    const media = await seedPersonalizedMedia(db, {
      operatorId: w.ops.a,
      batchId: cash.batches.plain,
      kmsKeyRef: w.keyRef.a,
      count: 1,
    });
    return { merchantAdmin, participationId: rows[0]!.id, media: media[0]! };
  });
  const personalization = await createKeyProcess('personalization', { identity: w.idp });
  const ids: Record<string, string> = {
    operator_id: w.ops.a,
    organizer_id: w.ids.organizerA,
    event_id: w.ids.eventA,
    ledger_id: w.ids.ledgerA,
    wallet_id: w.ids.walletA,
    device_id: sales.devices[0],
    media_id: media.id,
    batch_id: cash.batches.plain,
    merchant_id: sales.merchants[0],
    pos_id: sales.pos[0],
    participation_id: participationId,
    vendor_id: sales.vendors[0],
    transaction_id: sales.sales[0]!,
    cash_session_id: cash.session.sessionId,
    other_cash_session_id: cash.otherSession.sessionId,
    step: 'CLOSE',
    party_kind: 'ORGANIZER',
    method: 'CARD',
    seq: '1',
    key_index: '1',
    version: '1',
    manufacturer: 'matrice',
    model: 'modele-1',
  };
  const people: Record<StaffRole, XRolesPerson> = {
    PLATFORM_ADMIN: w.platformAdmin,
    OPERATOR_ADMIN: w.operatorAdminA,
    ORGANIZER_ADMIN: w.organizerAdminA,
    MERCHANT_ADMIN: merchantAdmin,
    SUPERVISOR: w.supervisorA,
    CASHIER: w.cashierA,
    PERSONALIZER: w.personalizerA,
  };
  let counter = 1000;
  const call: XRolesFixture['call'] = async (role, prepared: PreparedCall) => {
    const method = prepared.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = request(cash.app.getHttpServer())
      [method](`/v1${prepared.path}`)
      .set('Authorization', `Bearer ${people[role].token}`)
      .set('Idempotency-Key', randomUUID());
    if (prepared.headers) req = req.set(prepared.headers);
    const res =
      method === 'get' || method === 'delete' ? await req : await req.send(prepared.body ?? {});
    return { status: res.status, body: res.body as Record<string, unknown> };
  };
  return {
    ids,
    media,
    tap: () => tapBody(media, (counter += 1)),
    owner: withOwner,
    call,
    newTargetUser: () =>
      withOwner(
        async (db) => (await w.idp.createPerson(db, { operatorId: w.ops.a, roles: [] })).userId,
      ),
    cash,
    sales,
    people,
    api: cash.app,
    personalization,
    close: async () => {
      await personalization.app.close();
      await cash.close();
    },
  };
}
