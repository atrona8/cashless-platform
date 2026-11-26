// Cas d'isolement des trois recherches du back-office (WP08). Le personnel de B cherche des objets de A : le
// bracelet et le numéro rendent `200` vide (identique à « inconnu », sans indice d'existence), le portefeuille `404`.
import { loadConfig } from '../../../../src/config/config';
import { ClaimHasher } from '../../../../src/kms/claim-hash';
import { withOwner } from '../../../support/db';
import { batchOf, createBracelet, createPhoneCustomer } from '../../backoffice/search-fixtures';
import type { BackofficeIsolationCase } from './registry';

export const cases: BackofficeIsolationCase[] = [
  {
    operationId: 'searchMedia',
    method: 'GET',
    path: (fx) => `/search/media?nfc_uid=${fx.data.searchMediaUid}`,
    selfScoped: true,
    note: 'Bracelet d’un autre prestataire : 200 avec une liste vide, identique à un bracelet inconnu.',
    async prepare(fx) {
      const hasher = new ClaimHasher(loadConfig({ ...process.env, NODE_ENV: 'test' }));
      await withOwner(async (db) => {
        const customer = await createPhoneCustomer(db, {
          operatorId: fx.w.ops.a,
          ledgerId: fx.w.ids.ledgerA,
          funds: 4321,
        });
        const batch = await batchOf(db, fx.w, fx.w.ids.eventA, fx.w.ids.organizerA);
        const bracelet = await createBracelet(db, fx.w, hasher, {
          batchId: batch,
          eventId: fx.w.ids.eventA,
          walletId: customer.walletId,
        });
        fx.data.searchMediaUid = bracelet.media.uid;
        fx.data.searchWalletId = customer.walletId;
        fx.data.searchPhone = customer.phone;
        fx.secrets.push(
          bracelet.media.uid,
          bracelet.media.id,
          bracelet.printedNumber,
          customer.walletId,
          customer.phone,
          customer.phone.slice(1),
        );
      });
    },
  },
  {
    operationId: 'getWalletOverview',
    method: 'GET',
    path: (fx) => `/search/wallets/${fx.data.searchWalletId}`,
  },
  {
    operationId: 'searchCustomerByPhone',
    method: 'POST',
    path: () => '/search/customers',
    body: (fx) => ({ phone: fx.data.searchPhone }),
    selfScoped: true,
    note: 'Numéro d’un festivalier d’un autre prestataire : 200 avec wallets vide, identique à un numéro inconnu.',
  },
];
