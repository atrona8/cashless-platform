// Fixture du scénario de référence, posée par le rôle propriétaire : mêmes parties, profil de législation, événement,
// grand livre et comptes que la fixture pgTAP générée par gen_golden.py (codes, familles, fonctions, titulaires, sens,
// noms), plus ce que le moteur exige de réel : portefeuilles et participations rattachés aux comptes, lots et supports
// avec caution (R-07).
//
// Écart assumé (consigné, FR-024) : les identifiants sont neufs à chaque exécution au lieu des UUID fixes de
// gen_golden.py. La suite peut ainsi être relancée sans recréer la base, que les autres suites d'intégration
// utilisent en parallèle ; les montants, les codes et les clés d'idempotence restent ceux du scénario.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { withOwner } from '../support/db';
import { scenario } from '../unit/builders/support/scenario-lines';

export const WALLETS = ['W01', 'W02', 'W03', 'W04', 'W05', 'W06'] as const;
export type WalletKey = (typeof WALLETS)[number];
export const MERCHANTS = ['BAR', 'FOOD', 'TEE'] as const;
export type MerchantKey = (typeof MERCHANTS)[number];
export type PartyKey = 'PLT' | 'OPE' | 'ORG' | MerchantKey;

export interface ScenarioFixture {
  parties: Record<PartyKey, string>;
  eventId: string;
  ledgerId: string;
  wallets: Record<WalletKey, string>;
  participations: Record<MerchantKey, string>;
  /** Supports avec caution : W04 (lot SEPARATE), W05 (lot FROM_BALANCE). */
  media: { W04: string; W05: string };
  /** Auteur et valideur distincts des écritures BACKOFFICE et des passages de statut. */
  users: { author: string; approver: string };
}

const fresh = <K extends string>(keys: readonly K[]): Record<K, string> =>
  Object.fromEntries(keys.map((key) => [key, randomUUID()])) as Record<K, string>;

/** Caution par bracelet (paramètre du scénario). */
const DEPOSIT = 2000;

export async function createScenarioFixture(): Promise<ScenarioFixture> {
  const parties = fresh(['PLT', 'OPE', 'ORG', ...MERCHANTS] as const);
  const fx: ScenarioFixture = {
    parties,
    eventId: randomUUID(),
    ledgerId: randomUUID(),
    wallets: fresh(WALLETS),
    participations: fresh(MERCHANTS),
    media: { W04: randomUUID(), W05: randomUUID() },
    users: { author: randomUUID(), approver: randomUUID() },
  };
  const jurisdictionId = randomUUID();
  const op = parties.OPE;

  await withOwner(async (db) => {
    const q = (text: string, values: unknown[] = []) => db.query(text, values);
    for (const [key, party] of Object.entries(scenario.parties) as [PartyKey, { kind: string; name: string }][]) {
      const tenant = party.kind === 'PLATFORM' || party.kind === 'OPERATOR' ? null : op;
      await q(`INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, $2, $3, $4, 'SN')`, [
        parties[key],
        party.kind,
        tenant,
        party.name,
      ]);
    }
    await q(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
       VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
      [jurisdictionId, randomInt(1_000_000, 2_000_000_000)],
    );
    // Événement créé en DRAFT : le rejeu le fait passer par set_event_status, comme la projection R-08.
    await q(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
       VALUES ($1, $2, $3, $4, 'XOF', 'Africa/Dakar', $5, 'ORGANIZER')`,
      [fx.eventId, op, parties.ORG, (scenario as unknown as { name: string }).name, jurisdictionId],
    );
    await q(
      `INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
       VALUES ($1, $2, 'EVENT', $3, 'XOF', $4, $4)`,
      [fx.ledgerId, op, fx.eventId, parties.ORG],
    );
    // Le bar appartient à l'organisateur (participation interne, versée à l'organisateur) ; les autres sont externes.
    for (const key of MERCHANTS) {
      const internal = key === 'BAR';
      await q(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to, pitch_fee_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [fx.participations[key], op, fx.eventId, parties[key], internal ? 'INTERNAL' : 'EXTERNAL', internal ? parties.ORG : parties[key], internal ? 'PREPAID' : 'DEDUCT_OR_DEBT'],
      );
    }
    for (const key of WALLETS) {
      await q(`INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)`, [fx.wallets[key], op, fx.ledgerId]);
    }

    for (const account of scenario.accounts as {
      code: string;
      family: string;
      purpose: string;
      owner: PartyKey | null;
      normal_side: string;
      allow_negative: boolean;
    }[]) {
      const wallet = /^L-WAL-(W\d\d)-/.exec(account.code)?.[1] as WalletKey | undefined;
      const merchant = /^L-MCH-([A-Z]+)$/.exec(account.code)?.[1] as MerchantKey | undefined;
      await q(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, wallet_id, participation_id,
                              normal_side, allow_negative)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          op,
          fx.ledgerId,
          account.code,
          account.family,
          account.purpose,
          account.owner ? parties[account.owner] : null,
          wallet ? fx.wallets[wallet] : null,
          merchant ? fx.participations[merchant] : null,
          account.normal_side,
          account.allow_negative,
        ],
      );
    }
    // Comptes chauds comme dans gen_golden.py (les comptes MERCHANT le deviennent par déclencheur).
    await q(
      `UPDATE account SET hot = true WHERE ledger_id = $1 AND code IN ('L-ORG-COM','L-ORG-TVA','A-PSP-WAVE','A-PSP-OM','A-PSP-CARTE')`,
      [fx.ledgerId],
    );

    // Cautions (R-07) : un lot par mode, un support actif par portefeuille. Le rattachement (n = 1) est créé par le
    // déclencheur de journal des statuts du support (media_status_log) à l'insertion d'un support ACTIVE.
    await q(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, 1, 'arn:test:scenario')`, [op]);
    for (const [wallet, mode] of [
      ['W04', 'SEPARATE'],
      ['W05', 'FROM_BALANCE'],
    ] as const) {
      const batchId = randomUUID();
      const tokenHash = randomBytes(32);
      await q(
        `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, deposit_amount, deposit_mode)
         VALUES ($1, $2, $3, $4, 'PUBLIC', 1, 1, 'ACTIVE', $5, $6)`,
        [batchId, op, parties.ORG, fx.eventId, DEPOSIT, mode],
      );
      await q(
        `INSERT INTO media (id, operator_id, kind, token_hash, batch_id, wallet_id, status)
         VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 'ACTIVE')`,
        [fx.media[wallet], op, tokenHash, batchId, fx.wallets[wallet]],
      );
    }
  });
  return fx;
}
