// Fixture minimale du moteur, posée par le rôle propriétaire : un prestataire, un organisateur, un commerçant externe
// (commission 12 %), un événement LIVE et son grand livre, les comptes nécessaires, deux portefeuilles, un lot avec
// caution SEPARATE et un support ; plus un événement DRAFT avec son propre grand livre. Identifiants aléatoires : les
// suites d'intégration tournent en parallèle sur la même base.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { ConfigResolver } from '../../../src/ledger/ports/config-resolver';
import type { ResolvedConfig } from '../../../src/ledger/types';
import { withOwner } from '../../support/db';

export interface MiniFixture {
  operatorId: string;
  organizerId: string;
  merchantId: string;
  eventId: string;
  ledgerId: string;
  participationId: string;
  wallet1: string;
  wallet2: string;
  mediaId: string;
  draftEventId: string;
  draftLedgerId: string;
  config: ResolvedConfig;
}

/** Comptes du grand livre : code → (famille, fonction, sens, titulaire, portefeuille, participation). */
type AccountSpec = [code: string, family: string, purpose: string, side: 'D' | 'C', owner: 'org' | 'merchant' | null, extra?: { wallet?: string; participation?: boolean }];

export async function createMiniFixture(): Promise<MiniFixture> {
  const f = {
    operatorId: randomUUID(),
    organizerId: randomUUID(),
    merchantId: randomUUID(),
    eventId: randomUUID(),
    ledgerId: randomUUID(),
    participationId: randomUUID(),
    wallet1: randomUUID(),
    wallet2: randomUUID(),
    mediaId: randomUUID(),
    draftEventId: randomUUID(),
    draftLedgerId: randomUUID(),
  };
  const jurisdictionId = randomUUID();
  const batchId = randomUUID();

  await withOwner(async (db) => {
    const q = (text: string, values: unknown[] = []) => db.query(text, values);
    await q(`INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Prestataire (moteur)', 'SN')`, [f.operatorId]);
    await q(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
         ($1, 'ORGANIZER', $3, 'Organisateur (moteur)', 'SN'), ($2, 'MERCHANT', $3, 'Food truck (moteur)', 'SN')`,
      [f.organizerId, f.merchantId, f.operatorId],
    );
    await q(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
       VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
      [jurisdictionId, randomInt(1_000_000, 2_000_000_000)],
    );
    for (const [eventId, ledgerId, status] of [
      [f.eventId, f.ledgerId, 'LIVE'],
      [f.draftEventId, f.draftLedgerId, 'DRAFT'],
    ] as const) {
      await q(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
         VALUES ($1, $2, $3, 'Festival (moteur)', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', $5)`,
        [eventId, f.operatorId, f.organizerId, jurisdictionId, status],
      );
      await q(
        `INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
         VALUES ($1, $2, 'EVENT', $3, 'XOF', $4, $4)`,
        [ledgerId, f.operatorId, eventId, f.organizerId],
      );
    }
    await q(
      `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
       VALUES ($1, $2, $3, $4, 'EXTERNAL', $4)`,
      [f.participationId, f.operatorId, f.eventId, f.merchantId],
    );
    await q(`INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $3, $4), ($2, $3, $4)`, [f.wallet1, f.wallet2, f.operatorId, f.ledgerId]);

    const accounts: AccountSpec[] = [
      ['A-PSP-WAVE', 'ASSET', 'PSP', 'D', 'org'],
      ['A-CAISSE-C1', 'ASSET', 'CASH_DESK', 'D', 'org'],
      ['L-WAL-W1-P', 'CLAIM', 'WALLET_PAID', 'C', null, { wallet: f.wallet1 }],
      ['L-WAL-W1-X', 'CLAIM', 'WALLET_PROMO', 'C', null, { wallet: f.wallet1 }],
      ['L-WAL-W2-P', 'CLAIM', 'WALLET_PAID', 'C', null, { wallet: f.wallet2 }],
      ['L-WAL-W2-X', 'CLAIM', 'WALLET_PROMO', 'C', null, { wallet: f.wallet2 }],
      ['L-MCH-FOOD', 'CLAIM', 'MERCHANT', 'C', 'merchant', { participation: true }],
      ['L-ORG-COM', 'CLAIM', 'ORG_COM', 'C', 'org'],
      ['L-ORG-TVA', 'CLAIM', 'ORG_TAX', 'C', 'org'],
      ['L-ORG-FPSP', 'CLAIM', 'ORG_FPSP', 'D', 'org'],
      ['L-ORG-PROMO', 'CLAIM', 'ORG_PROMO', 'D', 'org'],
      ['L-ORG-CAUTION', 'CLAIM', 'ORG_DEPOSIT', 'C', 'org'],
      ['S-ATTENTE', 'SUSPENSE', 'SUSPENSE', 'D', null],
    ];
    for (const [code, family, purpose, side, owner, extra] of accounts) {
      await q(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, wallet_id, participation_id,
                              normal_side, allow_negative)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          f.operatorId,
          f.ledgerId,
          code,
          family,
          purpose,
          owner === 'org' ? f.organizerId : owner === 'merchant' ? f.merchantId : null,
          extra?.wallet ?? null,
          extra?.participation ? f.participationId : null,
          side,
          side === 'D' && family !== 'ASSET',
        ],
      );
    }
    await q(`UPDATE account SET hot = true WHERE ledger_id = $1 AND code IN ('L-ORG-COM', 'L-ORG-TVA', 'A-PSP-WAVE')`, [f.ledgerId]);

    await q(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, 1, 'arn:test:moteur')`, [f.operatorId]);
    await q(
      `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, deposit_amount, deposit_mode)
       VALUES ($1, $2, $3, $4, 'PUBLIC', 10, 1, 'ACTIVE', 500, 'SEPARATE')`,
      [batchId, f.operatorId, f.organizerId, f.eventId],
    );
    await q(
      `INSERT INTO media (id, operator_id, kind, token_hash, batch_id, wallet_id, status)
       VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 'ACTIVE')`,
      [f.mediaId, f.operatorId, randomBytes(32), batchId, f.wallet1],
    );
  });

  const config: ResolvedConfig = {
    parties: { platformId: randomUUID(), operatorId: f.operatorId, organizerId: f.organizerId },
    taxBps: 1800n,
    commissions: { [f.participationId]: { rateBps: 1200n } },
    pspFees: {},
    pspFeeBearer: 'ORGANIZER',
    activationFee: {},
    refundFee: {},
    operatorFees: [],
    platformFee: {},
    breakageOrganizerBps: 10000n,
    pitchFees: {},
    spendOrder: 'PROMO_FIRST',
    chargebackBearer: 'ORGANIZER',
    cashDiffBearer: 'ORGANIZER',
    offlineLossBearer: 'ORGANIZER',
    breakageDestination: 'ORGANIZER',
  };
  return { ...f, config };
}

/** ConfigResolver de test, en mémoire : la même configuration quelle que soit la date. */
export function inMemoryConfigResolver(config: () => ResolvedConfig): ConfigResolver {
  return { resolve: () => Promise.resolve(config()) };
}
