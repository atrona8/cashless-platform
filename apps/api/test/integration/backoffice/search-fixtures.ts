// Jeu d'essai des recherches du back-office (mission routes-backoffice, WP08) : un second événement chez A (autre
// organisateur), un bracelet activé avec code imprimé, des festivaliers avec numéro vérifié. Amorçage par le
// propriétaire seulement.
import { randomBytes, randomUUID } from 'node:crypto';
import { generateClaimCode } from '@cashless/tag-format';
import type { Client } from 'pg';
import type { Role, ScopeType } from '../../../src/identity/principal';
import type { ClaimHasher } from '../../../src/kms/claim-hash';
import type { TestPerson } from '../../support/fake-idp';
import { createCustomerWallet } from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  seedPersonalizedMedia,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

/** Numéro de test unique (E.164, 12 chiffres). */
export const phoneNumber = (): string =>
  `+2217${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Organisateur et événement supplémentaires du prestataire A, avec leur grand livre. */
export async function createSecondEvent(
  db: Client,
  w: MediaWorld,
): Promise<{ organizerId: string; eventId: string; ledgerId: string }> {
  const organizerId = randomUUID();
  const eventId = randomUUID();
  await db.query(
    `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
    [organizerId, w.ops.a],
  );
  await db.query(
    `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
     SELECT $1, $2, $3, 'Événement A2', currency, timezone, jurisdiction_id, funds_holder FROM event WHERE id = $4`,
    [eventId, w.ops.a, organizerId, w.ids.eventA],
  );
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
  const ledgerId = (
    await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventId])
  ).rows[0]!.ledger;
  return { organizerId, eventId, ledgerId };
}

export interface Customer {
  customerId: string;
  phone: string;
  walletId: string;
}

/** Festivalier de A avec numéro vérifié et un portefeuille crédité sur le grand livre donné. */
export async function createPhoneCustomer(
  db: Client,
  input: { operatorId: string; ledgerId: string; phone?: string; funds?: number },
): Promise<Customer> {
  const customerId = randomUUID();
  const phone = input.phone ?? phoneNumber();
  await db.query(
    "INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'CUSTOMER', $2, 'Festivalier test')",
    [customerId, input.operatorId],
  );
  await db.query(
    'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
    [customerId, input.operatorId, phone],
  );
  const { walletId } = await createCustomerWallet(db, {
    operatorId: input.operatorId,
    ledgerId: input.ledgerId,
    customerId,
    funds: input.funds ?? 0,
  });
  return { customerId, phone, walletId };
}

/** Portefeuille supplémentaire d'un festivalier existant (autre événement). */
export async function addWallet(
  db: Client,
  input: { operatorId: string; ledgerId: string; customerId: string; funds?: number },
): Promise<string> {
  return (await createCustomerWallet(db, input)).walletId;
}

export interface Bracelet {
  media: SeededMedia;
  code: string;
  printedNumber: string;
}

/** Bracelet personnalisé d'un lot, avec code imprimé et numéro imprimé ; activé si `walletId` est donné. */
export async function createBracelet(
  db: Client,
  w: MediaWorld,
  hasher: ClaimHasher,
  input: { batchId: string; eventId: string; walletId?: string },
): Promise<Bracelet> {
  const [media] = await seedPersonalizedMedia(db, {
    operatorId: w.ops.a,
    batchId: input.batchId,
    kmsKeyRef: w.keyRef.a,
    count: 1,
  });
  const code = generateClaimCode((n) => randomBytes(n));
  const printedNumber = `PN-${randomUUID().slice(0, 8).toUpperCase()}`;
  await db.query(
    `UPDATE media SET claim_code_hash = $2, claim_key_version = $3, printed_number = $4 WHERE id = $1`,
    [media!.id, hasher.claimCodeHash(code), hasher.keyVersion, printedNumber],
  );
  if (input.walletId)
    await activateMedia(db, {
      operatorId: w.ops.a,
      eventId: input.eventId,
      walletId: input.walletId,
      mediaIds: [media!.id],
    });
  return { media: media!, code, printedNumber };
}

export const batchOf = (db: Client, w: MediaWorld, eventId: string | null, organizerId: string) =>
  createBatch(db, {
    operatorId: w.ops.a,
    organizerId,
    eventId,
    status: 'ACTIVE',
  });

export interface SearchPeople {
  /** SUPERVISOR de l'événement A seulement. */
  supervisorEventA: TestPerson;
  /** ORGANIZER_ADMIN de l'organisateur du second événement. */
  organizerAdminA2: TestPerson;
  /** MERCHANT_ADMIN d'un commerçant de A qui ne participe à aucun événement. */
  merchantAdminA: TestPerson;
  /** MERCHANT_ADMIN d'un commerçant qui participe à l'événement A. */
  merchantAdminParticipant: TestPerson;
  /** VENDOR rattaché à l'événement A. */
  vendorA: TestPerson;
  operatorAdminB: TestPerson;
}

/** Personnes supplémentaires du jeu d'essai (propriétaire). */
export async function createSearchPeople(
  db: Client,
  w: MediaWorld,
  second: { organizerId: string },
): Promise<SearchPeople> {
  const person = (
    operatorId: string,
    role: Role,
    scopeType: ScopeType,
    scopeId: string,
  ): Promise<TestPerson> =>
    w.idp.createPerson(db, { operatorId, roles: [{ role, scopeType, scopeId }] });
  const merchant = async (): Promise<string> => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'MERCHANT', $2, 'Commerçant test', 'SN')`,
      [id, w.ops.a],
    );
    return id;
  };
  const idle = await merchant();
  const participant = await merchant();
  await db.query(
    `INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type, payout_to)
     VALUES ($1, $2, $3, 'INTERNAL', $4)`,
    [w.ops.a, w.ids.eventA, participant, w.ids.organizerA],
  );
  return {
    supervisorEventA: await person(w.ops.a, 'SUPERVISOR', 'EVENT', w.ids.eventA),
    organizerAdminA2: await person(w.ops.a, 'ORGANIZER_ADMIN', 'ORGANIZER', second.organizerId),
    merchantAdminA: await person(w.ops.a, 'MERCHANT_ADMIN', 'MERCHANT', idle),
    merchantAdminParticipant: await person(w.ops.a, 'MERCHANT_ADMIN', 'MERCHANT', participant),
    vendorA: await person(w.ops.a, 'VENDOR', 'MERCHANT', participant),
    operatorAdminB: await person(w.ops.b, 'OPERATOR_ADMIN', 'OPERATOR', w.ops.b),
  };
}
