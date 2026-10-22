// Course entre une écriture et une demande de rattachement sur la même lecture (OP-N50, migrations
// 0024 et 0026 ; report de la relecture de WP05 vers WP18) : deux connexions de l'API publique
// (`cashless_app`). `consume_tap` et `consume_tap_for_claim` prennent le même verrou consultatif
// `media-tap-use:<lecture>` avant de lire la lecture : la seconde attend la fin de la première,
// puis la voit consommée et refuse (`CL022`, 409 TAP_UNUSABLE). Jamais une lecture ne porte à la
// fois une écriture et une demande. Vérifié jusqu'ici à la main seulement.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { APP_URL, connect, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';

interface World {
  operator: string;
  taps: [string, string];
  transactions: [string, string];
  claims: [string, string];
}

/** Données (propriétaire) : un bracelet, deux lectures récentes, deux écritures, deux demandes. */
async function createWorld(): Promise<World> {
  const operator = randomUUID();
  const organizer = randomUUID();
  const customer = randomUUID();
  const batch = randomUUID();
  const media = randomUUID();
  const device = randomUUID();
  const ledger = randomUUID();
  const transactions: [string, string] = [randomUUID(), randomUUID()];
  const claims: [string, string] = [randomUUID(), randomUUID()];
  const uid = Buffer.concat([Buffer.from([0x04]), randomBytes(6)]);
  return withOwner(async (db) => {
    await db.query(
      `INSERT INTO party (id, kind, legal_name, country_code)
       VALUES ($1, 'OPERATOR', 'Prestataire course (test)', 'SN')`,
      [operator],
    );
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name)
       VALUES ($1, 'ORGANIZER', $3, 'Organisateur course'), ($2, 'CUSTOMER', $3, 'Festivalier')`,
      [organizer, customer, operator],
    );
    await db.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref)
       VALUES ($1, 1, 'test:hmac-course')`,
      [operator],
    );
    await db.query(
      `INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index)
       VALUES ($1, $2, $3, 'PUBLIC', 1, 1)`,
      [batch, operator, organizer],
    );
    await db.query(
      `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status)
       VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 1, 'PERSONALIZED')`,
      [media, operator, randomBytes(32), uid, batch],
    );
    await db.query(
      `INSERT INTO device (id, operator_id, kind, serial) VALUES ($1, $2, 'POS', $3)`,
      [device, operator, `RACE-${device.slice(0, 8)}`],
    );
    const taps = (
      await db.query<{ id: string }>(
        `INSERT INTO media_tap (operator_id, media_id, counter, nfc_uid, occurred_at, device_id,
                                mode, received_at)
         SELECT $1, $2, n, $3, now(), $4, 'ONLINE', clock_timestamp() FROM generate_series(1, 2) n
         RETURNING id::text`,
        [operator, media, uid, device],
      )
    ).rows.map((r) => r.id) as [string, string];
    await db.query(
      `INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id,
                           funds_holder_id)
       VALUES ($1, $2, 'ORGANIZER', $3, 'XOF', $3, $3)`,
      [ledger, operator, organizer],
    );
    // Écritures sans lignes : seul `consume_tap` les lit ici.
    await db.query(
      `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key,
                                        request_hash, occurred_at, source, device_id, media_id)
       SELECT t, $2, $3, 'PURCHASE', 'course:' || t, 'empreinte course', now(), 'ONLINE', $4, $5
         FROM unnest($1::uuid[]) t`,
      [transactions, operator, ledger, device, media],
    );
    await db.query(
      `INSERT INTO media_claim (id, operator_id, media_id, customer_id, status, confirmation_hash,
                                expires_at, confirmed_device_id, confirmed_by, confirmed_at)
       SELECT c, $2, $3, $4, 'CONFIRMED', sha256(convert_to(c::text, 'UTF8')),
              now() + interval '1 day', $5, $4, now()
         FROM unnest($1::uuid[]) c`,
      [claims, operator, media, customer, device],
    );
    return { operator, taps, transactions, claims };
  });
}

/** Connexion `cashless_app` dans une transaction ouverte, prestataire de session posé. */
async function openSession(operator: string): Promise<Client> {
  const client = await connect(APP_URL);
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.operator_id', $1, true)", [operator]);
  return client;
}

/** Attend que la connexion `pid` soit bloquée sur un verrou consultatif. */
async function waitForAdvisoryWait(observer: Client, pid: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const { rows } = await observer.query<{ waiting: boolean }>(
      `SELECT coalesce(bool_or(wait_event_type = 'Lock' AND wait_event = 'advisory'), false)
                AS waiting
         FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]!.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`la connexion ${pid} n'attend pas le verrou media-tap-use:`);
}

const sqlState = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'inconnu',
  );

describe('course écriture / demande de rattachement sur une lecture (OP-N50)', () => {
  let w: World;
  let observer: Client;

  beforeAll(async () => {
    w = await createWorld();
    observer = await connect(APP_URL);
  });

  afterAll(async () => {
    await observer?.end();
  });

  const state = async (tap: string) =>
    (
      await ownerRows<{ transaction_id: string | null; claims: string[] }>(
        `SELECT t.transaction_id,
                ARRAY(SELECT c.id::text FROM media_claim c
                       WHERE c.confirmed_tap_id = t.id) AS claims
           FROM media_tap t WHERE t.id = $1`,
        [tap],
      )
    )[0]!;

  it('écriture d’abord : la demande attend le verrou, puis refuse (CL022)', async () => {
    const [tap] = w.taps;
    const first = await openSession(w.operator);
    const second = await openSession(w.operator);
    try {
      await first.query('SELECT consume_tap($1, $2)', [tap, w.transactions[0]]);
      const pid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      const claim = sqlState(
        second.query('SELECT consume_tap_for_claim($1, $2)', [tap, w.claims[0]]),
      );
      await waitForAdvisoryWait(observer, pid);
      await first.query('COMMIT');
      expect(await claim).toBe('CL022');
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
    expect(await state(tap)).toEqual({ transaction_id: w.transactions[0], claims: [] });
  });

  it('demande d’abord : l’écriture attend le verrou, puis refuse (CL022)', async () => {
    const [, tap] = w.taps;
    const first = await openSession(w.operator);
    const second = await openSession(w.operator);
    try {
      await first.query('SELECT consume_tap_for_claim($1, $2)', [tap, w.claims[1]]);
      const pid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      const write = sqlState(second.query('SELECT consume_tap($1, $2)', [tap, w.transactions[1]]));
      await waitForAdvisoryWait(observer, pid);
      await first.query('COMMIT');
      expect(await write).toBe('CL022');
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
    expect(await state(tap)).toEqual({ transaction_id: null, claims: [w.claims[1]] });
  });
});
