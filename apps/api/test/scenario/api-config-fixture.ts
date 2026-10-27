// Configuration du scénario de référence construite PAR LES ROUTES DE L'API (mission configuration-parties-evenements,
// SC-001, SC-004) : profil de législation, prestataire, contrat et redevance de plateforme, organisateur, contrat et
// frais du prestataire, commerçants, événement (avec son grand livre et ses comptes), participations (avec leurs
// comptes), commissions et frais de l'événement. Les valeurs viennent des paramètres de scenario_reference.json
// (`scenarioConfig()`), jamais de constantes recopiées.
//
// Restent posés par le rôle propriétaire, comme dans la fixture de la mission 1 (leurs missions ne sont pas faites) :
// portefeuilles et leurs comptes, comptes de caisse et de canal de paiement, lots et supports avec caution. Les
// personnes du faux serveur d'identité sont amorcées en base.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { withOwner } from '../support/db';
import type { FakeIdp, TestPerson } from '../support/fake-idp';
import { scenario, scenarioConfig } from '../unit/builders/support/scenario-lines';
import {
  MERCHANTS,
  WALLETS,
  type MerchantKey,
  type PartyKey,
  type ScenarioFixture,
  type WalletKey,
} from './fixture';

/** Pays réservé à cette fixture (code d'usage privé ISO 3166) : son profil porte la TVA du scénario. */
const COUNTRY = 'AA';
const EFFECTIVE = '2026-01-01T00:00:00Z';
const DEPOSIT = 2000;
/** Canaux de paiement du scénario → clé de `scenarioConfig().pspFees`. */
const CHANNELS = ['WAVE', 'OM', 'CARTE'] as const;

export interface ApiConfigFixture extends ScenarioFixture {
  people: { platformAdmin: TestPerson; operatorAdmin: TestPerson; organizerAdmin: TestPerson };
  contractId: string;
  platformContractId: string;
  jurisdictionId: string;
  /** Règle de commission par commerçant. */
  commissionRules: Record<MerchantKey, string>;
  /** Configuration PSP (brouillon) portant la règle de frais de chaque canal (WP10) ; l'organisateur est le titulaire. */
  pspConfigurations: Record<(typeof CHANNELS)[number], string>;
}

export async function createApiConfigFixture(
  app: INestApplication,
  idp: FakeIdp,
): Promise<ApiConfigFixture> {
  const config = scenarioConfig();
  const names = scenario.parties as Record<PartyKey, { kind: string; name: string }>;
  const http = () => request(app.getHttpServer());
  const call = async (who: TestPerson, method: 'get' | 'post', path: string, body?: object) => {
    let req = http()[method](`/v1${path}`).set('Authorization', `Bearer ${who.token}`);
    if (method === 'post') req = req.set('Idempotency-Key', randomUUID());
    const res = await (body ? req.send(body) : req);
    return res;
  };
  const created = async (
    who: TestPerson,
    path: string,
    body: object,
  ): Promise<Record<string, string>> => {
    const res = await call(who, 'post', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} : ${res.status} ${res.text}`);
    return res.body as Record<string, string>;
  };

  const platformAdmin = await withOwner(async (db) => {
    await db.query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', $1 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      [names.PLT.name],
    );
    return idp.createPerson(db, {
      operatorId: null,
      roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }],
    });
  });

  // --- Plateforme : profil de législation (TVA, destination de la casse), prestataire, contrat, redevance.
  const profile = {
    country_code: COUNTRY,
    valid_from: '2026-01-01',
    breakage_destination: config.breakageDestination,
    rules: { taxes: { VAT: { rate_bps: Number(config.taxBps), inclusive: true } } },
  };
  const firstProfile = await call(platformAdmin, 'post', '/jurisdiction-profiles', profile);
  if (firstProfile.status !== 201 && firstProfile.status !== 409)
    throw new Error(`profil de législation : ${firstProfile.status} ${firstProfile.text}`);
  const profiles = await call(
    platformAdmin,
    'get',
    `/jurisdiction-profiles?country_code=${COUNTRY}&limit=200`,
  );
  const jurisdictionId = (profiles.body.data as { profile_id: string; version: number }[]).sort(
    (a, b) => b.version - a.version,
  )[0]!.profile_id;

  const operator = await created(platformAdmin, '/operators', {
    legal_name: names.OPE.name,
    country_code: COUNTRY,
  });
  const op = operator.operator_id!;
  const platformContract = await created(platformAdmin, `/operators/${op}/platform-contracts`, {
    valid_from: EFFECTIVE,
    platform_fee_mode: 'IN_POOL',
  });
  await created(platformAdmin, `/operators/${op}/platform-fee-rules`, {
    scope_type: 'PLATFORM_CONTRACT',
    scope_id: platformContract.contract_id,
    payer_purpose: 'OPE_REDEV',
    beneficiary_purpose: 'PLT_REDEV',
    basis: 'FEE_AMOUNT',
    rate_bps: Number(config.platformFee.rateBps),
    trigger: 'CLOSING',
    valid_from: EFFECTIVE,
  });

  // --- Prestataire : organisateur, contrat, frais du prestataire.
  const operatorAdmin = await withOwner((db) =>
    idp.createPerson(db, {
      operatorId: op,
      roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: op }],
    }),
  );
  const organizer = await created(operatorAdmin, `/operators/${op}/organizers`, {
    legal_name: names.ORG.name,
    country_code: COUNTRY,
  });
  const org = organizer.organizer_id!;
  const contract = await created(operatorAdmin, `/operators/${op}/organizers/${org}/contracts`, {
    valid_from: EFFECTIVE,
    offline_loss_bearer: config.offlineLossBearer,
    cash_diff_bearer: config.cashDiffBearer,
    chargeback_bearer: config.chargebackBearer,
    breakage_organizer_bps: Number(config.breakageOrganizerBps),
  });
  for (const { basis, rule } of config.operatorFees) {
    await created(operatorAdmin, `/operators/${op}/fee-rules`, {
      scope_type: 'OPERATOR_CONTRACT',
      scope_id: contract.contract_id,
      payer_purpose: 'ORG_FPREST',
      beneficiary_purpose: 'OPE_FRAIS',
      basis,
      rate_bps: Number(rule.rateBps ?? 0n),
      fixed_amount: Number(rule.fixed ?? 0n),
      trigger: 'CLOSING',
      valid_from: EFFECTIVE,
    });
  }

  // --- Organisateur : commerçants, événement (grand livre et comptes), participations (comptes), frais.
  const organizerAdmin = await withOwner((db) =>
    idp.createPerson(db, {
      operatorId: op,
      roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: org }],
    }),
  );
  // Réglages de cascade du scénario, posés au niveau de l'organisateur : le niveau plateforme, commun à toutes les
  // suites, ne doit pas décider de l'ordre de dépense ni du payeur des frais de paiement de ce festival.
  await created(organizerAdmin, `/operators/${op}/organizers/${org}/config-versions`, {
    settings: { spend_order: config.spendOrder, psp_fee_bearer: config.pspFeeBearer },
  });
  const merchants = {} as Record<MerchantKey, string>;
  for (const key of MERCHANTS)
    merchants[key] = (
      await created(organizerAdmin, `/operators/${op}/merchants`, { legal_name: names[key].name })
    ).merchant_id!;
  const event = await created(organizerAdmin, `/operators/${op}/events`, {
    organizer_id: org,
    name: (scenario as unknown as { name: string }).name,
    currency: 'XOF',
    timezone: 'Africa/Dakar',
    jurisdiction_id: jurisdictionId,
    funds_holder: 'ORGANIZER',
    contract_id: contract.contract_id,
  });
  const eventId = event.event_id!;
  const ledgerId = event.ledger_id!;

  const participations = {} as Record<MerchantKey, string>;
  const commissionRules = {} as Record<MerchantKey, string>;
  for (const key of MERCHANTS) {
    // Le bar appartient à l'organisateur (participation interne) ; son droit de place est réglé hors système.
    const internal = key === 'BAR';
    const participation = await created(
      organizerAdmin,
      `/operators/${op}/events/${eventId}/participations`,
      {
        merchant_id: merchants[key],
        link_type: internal ? 'INTERNAL' : 'EXTERNAL',
        pitch_fee_mode: internal ? 'PREPAID' : 'DEDUCT_OR_DEBT',
        pitch_fee: Number(config.pitchFees[key] ?? 0n),
      },
    );
    participations[key] = participation.participation_id!;
    const commission = await created(organizerAdmin, `/operators/${op}/fee-rules`, {
      scope_type: 'PARTICIPATION',
      scope_id: participations[key],
      payer_purpose: 'MERCHANT',
      beneficiary_purpose: 'ORG_COM',
      basis: 'SALE_AMOUNT',
      rate_bps: Number(config.commissions[key]!.rateBps ?? 0n),
      trigger: 'REALTIME',
      valid_from: EFFECTIVE,
    });
    commissionRules[key] = commission.fee_rule_id!;
  }
  const eventRule = (
    beneficiary: string,
    payer: string,
    basis: string,
    rule: { rateBps?: bigint; fixed?: bigint },
  ) =>
    created(organizerAdmin, `/operators/${op}/fee-rules`, {
      scope_type: 'EVENT',
      scope_id: eventId,
      payer_purpose: payer,
      beneficiary_purpose: beneficiary,
      basis,
      rate_bps: Number(rule.rateBps ?? 0n),
      fixed_amount: Number(rule.fixed ?? 0n),
      trigger: 'REALTIME',
      valid_from: EFFECTIVE,
    });
  await eventRule('ORG_FFEST', 'WALLET_PAID', 'PER_MEDIA', config.activationFee);
  await eventRule('ORG_FFEST', 'WALLET_PAID', 'PER_REFUND', config.refundFee);
  // Frais PSP (WP10) : une configuration par canal et sa règle `PSP_CONFIGURATION` (convention PSP:<canal> retirée).
  const pspConfigurations = {} as Record<(typeof CHANNELS)[number], string>;
  const METHODS = { WAVE: 'WAVE', OM: 'ORANGE_MONEY', CARTE: 'CARD' } as const;
  const PROVIDERS = { WAVE: 'WAVE', OM: 'ORANGE_MONEY', CARTE: 'STRIPE' } as const;
  for (const channel of CHANNELS) {
    const res = await call(operatorAdmin, 'post', `/organizers/${org}/psp-configurations`, {
      method: METHODS[channel],
      provider: PROVIDERS[channel],
      holder_party_id: org,
      secret_ref: `psp/${org}/scenario-${channel.toLowerCase()}`,
    });
    if (res.status !== 201) throw new Error(`configuration PSP : ${res.status} ${res.text}`);
    pspConfigurations[channel] = (res.body as { psp_config_id: string }).psp_config_id;
    const rule = config.pspFees[channel]!;
    await created(operatorAdmin, `/operators/${op}/fee-rules`, {
      scope_type: 'PSP_CONFIGURATION',
      scope_id: pspConfigurations[channel],
      payer_purpose: 'ORG_FPSP',
      beneficiary_purpose: 'PSP_FRAIS',
      basis: 'TOPUP_AMOUNT',
      rate_bps: Number(rule.rateBps ?? 0n),
      fixed_amount: Number(rule.fixed ?? 0n),
      trigger: 'REALTIME',
      valid_from: EFFECTIVE,
    });
  }

  // --- Ce que les missions suivantes créeront : portefeuilles, caisse, canaux de paiement, supports avec caution.
  const fresh = <K extends string>(keys: readonly K[]): Record<K, string> =>
    Object.fromEntries(keys.map((key) => [key, randomUUID()])) as Record<K, string>;
  const wallets = fresh(WALLETS);
  const media = { W04: randomUUID(), W05: randomUUID() };
  const platformId = await withOwner(async (db) => {
    const q = (text: string, values: unknown[] = []) => db.query(text, values);
    for (const key of WALLETS)
      await q(`INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)`, [
        wallets[key],
        op,
        ledgerId,
      ]);
    for (const account of scenario.accounts as unknown as {
      code: string;
      family: string;
      purpose: string;
      normal_side: string;
      allow_negative: boolean;
    }[]) {
      const wallet = /^L-WAL-(W\d\d)-/.exec(account.code)?.[1] as WalletKey | undefined;
      const money = /^A-(PSP|CAISSE)-/.test(account.code);
      if (!wallet && !money) continue;
      await q(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, wallet_id, normal_side, allow_negative, hot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          op,
          ledgerId,
          account.code,
          account.family,
          account.purpose,
          money ? org : null,
          wallet ? wallets[wallet] : null,
          account.normal_side,
          account.allow_negative,
          account.purpose === 'PSP',
        ],
      );
    }
    await q(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, 1, 'arn:test:scenario')`,
      [op],
    );
    for (const [wallet, mode] of [
      ['W04', 'SEPARATE'],
      ['W05', 'FROM_BALANCE'],
    ] as const) {
      const batchId = randomUUID();
      await q(
        `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, deposit_amount, deposit_mode)
         VALUES ($1, $2, $3, $4, 'PUBLIC', 1, 1, 'ACTIVE', $5, $6)`,
        [batchId, op, org, eventId, DEPOSIT, mode],
      );
      await q(
        `INSERT INTO media (id, operator_id, kind, token_hash, batch_id, wallet_id, status) VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 'ACTIVE')`,
        [media[wallet], op, randomBytes(32), batchId, wallets[wallet]],
      );
    }
    // La partie plateforme est celle que open_event_ledger a rendue titulaire des comptes de redevance.
    const { rows } = await q(
      `SELECT owner_party_id FROM account WHERE ledger_id = $1 AND purpose = 'PLT_REDEV'`,
      [ledgerId],
    );
    return (rows[0] as { owner_party_id: string }).owner_party_id;
  });

  return {
    parties: { PLT: platformId, OPE: op, ORG: org, ...merchants },
    eventId,
    ledgerId,
    wallets,
    participations,
    media,
    users: { author: randomUUID(), approver: randomUUID() },
    people: { platformAdmin, operatorAdmin, organizerAdmin },
    contractId: contract.contract_id!,
    platformContractId: platformContract.contract_id!,
    jurisdictionId,
    commissionRules,
    pspConfigurations,
  };
}
