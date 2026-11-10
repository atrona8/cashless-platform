// Données de démonstration PERSISTANTES de l'API locale partagée (archive « API », `demarrer-local.sh`) : de quoi
// faire tourner une application festivalier contre l'API réelle. Développement seulement : refusé en production.
//
// Idempotent : si le prestataire de démo existe déjà, rien n'est écrit (la base garde ce que les équipes y ont fait).
// Identifiants FIXES (dérivés d'un nom) : festivaliers, portefeuilles, prestataires, événement et codes de rattachement
// sont les mêmes d'une installation à l'autre ; `DONNEES-DEMO.md` les liste.
//
// Écritures directes du propriétaire : AMORÇAGE seulement, par les mêmes fonctions de la base et les mêmes fixtures que
// les tests d'intégration (`apps/api/test/support`). Toute opération ultérieure passe par l'API.
//
// Usage (variables de `tools/dev-db/env.sh` posées, base visée par DATABASE_URL_OWNER) :
//   npx tsx tools/demo-data/seed-demo.ts            amorce si la base est vide de données de démo
//   npx tsx tools/demo-data/seed-demo.ts --print    affiche les identifiants sans rien écrire
import { createHash } from 'node:crypto';
import { generateClaimCode, uuidToBytes } from '@cashless/tag-format';
import type { Client } from 'pg';
import { loadConfig } from '../../apps/api/src/config/config';
import { ClaimHasher } from '../../apps/api/src/kms/claim-hash';
import { withOwner } from '../../apps/api/test/support/db';
import { FakeIdp } from '../../apps/api/test/support/fake-idp';
import {
  activateMedia,
  createBatch,
  creditWallet,
  goLive,
  seedPersonalizedMedia,
} from '../../apps/api/test/support/media-fixtures';
import { asOperator } from '../../apps/api/test/integration/vendors/vendor-fixtures';

// ----- identifiants fixes

/** UUID stable dérivé d'un nom (forme v4, variante RFC 4122) : mêmes données à chaque installation. */
export function demoId(name: string): string {
  const h = createHash('sha256').update(`cashless-demo/v1/${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Code de rattachement stable (10 caractères de l'alphabet du kit), affiché `XXXXX-XXXXX`. */
export function demoClaimCode(name: string): string {
  const bytes = createHash('sha256').update(`cashless-demo/claim/${name}`).digest();
  const code = generateClaimCode((n) => bytes.subarray(0, n));
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

const KEY_REF = 'fake-kms:hmac:demo';
const OP = demoId('operator:A');
const OP_B = demoId('operator:B');
const ORG = demoId('organizer:A');
const ORG_B = demoId('organizer:B');
const EVENT = demoId('event:A');
const EVENT_B = demoId('event:B');

interface DemoCustomer {
  key: string;
  name: string;
  /** Numéro vérifié (connexion par code, `POST /customer-auth/otp`). */
  phone: string;
  operator: 'A' | 'B';
  /** Solde payé crédité (en XOF, par recharges successives) ; `null` : aucun portefeuille. */
  topups: number[] | null;
  walletStatus?: 'ACTIVE' | 'BLOCKED';
  /** Un bracelet actif rattaché au portefeuille. */
  bracelet: boolean;
  note: string;
}

export const CUSTOMERS: DemoCustomer[] = [
  {
    key: 'awa',
    phone: '+221770000001',
    name: 'Awa Diop',
    operator: 'A',
    topups: [10_000, 10_000, 5_000],
    bracelet: true,
    note: 'Cas nominal : portefeuille crédité de 25 000 XOF, bracelet actif.',
  },
  {
    key: 'moussa',
    phone: '+221770000002',
    name: 'Moussa Ndiaye',
    operator: 'A',
    topups: [3_000, 5_000],
    bracelet: true,
    note: 'Petit solde (8 000 XOF), bracelet actif.',
  },
  {
    key: 'fatou',
    phone: '+221770000003',
    name: 'Fatou Sarr',
    operator: 'A',
    topups: null,
    bracelet: false,
    note: 'Compte neuf : aucun portefeuille ni bracelet. Rattacher un bracelet libre (`POST /me/media`).',
  },
  {
    key: 'ibrahima',
    phone: '+221770000004',
    name: 'Ibrahima Fall',
    operator: 'A',
    topups: [5_000],
    walletStatus: 'BLOCKED',
    bracelet: true,
    note: 'Portefeuille BLOQUÉ (5 000 XOF) : pour les écrans d’erreur.',
  },
  {
    key: 'khady',
    phone: '+221770000005',
    name: 'Khady Ba',
    operator: 'B',
    topups: [7_000],
    bracelet: false,
    note: 'Autre prestataire (B) : ne voit rien de A (cloisonnement, réponses 404).',
  },
];

/** Codes publics des prestataires (`operator_code` de l'app multi-prestataires). */
export const OPERATOR_CODES = { A: 'demo-a', B: 'demo-b' } as const;

/** Bracelets libres (jamais activés) : un code chacun, pour `POST /me/media` (SELF_APP). Usage unique. */
export const FREE_BRACELETS = 20;
/** Bracelets anonymes actifs et crédités : consultation sans compte et rattachement « approvisionné ». */
export const ANONYMOUS = [
  { key: 'anon-1', balance: 10_000 },
  { key: 'anon-2', balance: 2_500 },
  { key: 'anon-3', balance: 0 },
];

const opOf = (c: DemoCustomer) => (c.operator === 'A' ? OP : OP_B);
const customerId = (c: DemoCustomer) => demoId(`customer:${c.key}`);
const walletId = (c: DemoCustomer) => demoId(`wallet:${c.key}`);

// ----- amorçage

async function walletWithAccounts(
  db: Client,
  input: { id: string; operatorId: string; ledgerId: string; customerId: string; status: string },
): Promise<void> {
  // Même forme que la route d'activation (deux comptes : payé, offert), comme `createCustomerWallet` des tests.
  await db.query(
    'INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status) VALUES ($1, $2, $3, $4, $5)',
    [input.id, input.operatorId, input.ledgerId, input.customerId, input.status],
  );
  for (const [suffix, purpose] of [
    ['P', 'WALLET_PAID'],
    ['X', 'WALLET_PROMO'],
  ] as const)
    await db.query(
      `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
       VALUES ($1, $2, $3, 'CLAIM', $4, $5, 'C')`,
      [input.operatorId, input.ledgerId, `L-WAL-${input.id}-${suffix}`, purpose, input.id],
    );
}

async function eventWorld(
  db: Client,
  idp: FakeIdp,
  input: { operatorId: string; organizerId: string; eventId: string; suffix: string },
): Promise<{ ledgerId: string; adminId: string; batchId: string }> {
  await db.query(
    `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', $2, 'SN')`,
    [input.operatorId, `Prestataire Démo ${input.suffix}`],
  );
  await db.query(
    `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, $3, 'SN')`,
    [input.organizerId, input.operatorId, `Organisateur Démo ${input.suffix}`],
  );
  const profile = demoId(`jurisdiction:${input.suffix}`);
  await db.query(
    `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
     VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
    [profile],
  );
  await db.query(
    `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
     VALUES ($1, $2, $3, $4, 'XOF', 'Africa/Dakar', $5, 'ORGANIZER')`,
    [input.eventId, input.operatorId, input.organizerId, `Festival Démo ${input.suffix}`, profile],
  );
  const contract = await db.query<{ id: string }>(
    `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer,
                           breakage_organizer_bps)
     VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 10000) RETURNING id`,
    [input.operatorId, input.organizerId],
  );
  // Rattachement depuis l'app autorisé (SELF_APP) en plus du guichet.
  await db.query(
    `UPDATE event SET contract_id = $2, activation_modes = ARRAY['DESK','SELF_APP'] WHERE id = $1`,
    [input.eventId, contract.rows[0]!.id],
  );
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [input.operatorId]);
  const ledgerId = (
    await db.query<{ id: string }>('SELECT open_event_ledger($1) AS id', [input.eventId])
  ).rows[0]!.id;
  await db.query(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, 1, $2)`, [
    input.operatorId,
    KEY_REF,
  ]);
  const admin = await idp.createPerson(db, {
    operatorId: input.operatorId,
    roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: input.operatorId }],
  });
  await goLive(db, input.operatorId, input.eventId, admin.userId);
  const batchId = await createBatch(db, {
    operatorId: input.operatorId,
    organizerId: input.organizerId,
    eventId: input.eventId,
    status: 'ACTIVE',
    quantity: 500,
  });
  return { ledgerId, adminId: admin.userId, batchId };
}

async function catalog(
  db: Client,
  operatorId: string,
  eventId: string,
  actor: string,
): Promise<void> {
  const shops: Array<[string, string, Array<[string, string, number]>]> = [
    [
      'Bar Démo',
      'Boissons',
      [
        ['Jus de bissap', 'Bissap juice', 1500],
        ['Soda', 'Soda', 1000],
        ['Eau', 'Water', 500],
      ],
    ],
    [
      'Restauration Démo',
      'Plats',
      [
        ['Thiéboudienne', 'Thieboudienne', 3500],
        ['Dibi', 'Dibi', 3000],
      ],
    ],
    [
      'Boutique Démo',
      'Souvenirs',
      [
        ['T-shirt', 'T-shirt', 7500],
        ['Casquette', 'Cap', 4000],
      ],
    ],
  ];
  for (const [name, category, items] of shops) {
    const merchant = demoId(`merchant:${name}`);
    const participation = demoId(`participation:${name}`);
    const pos = demoId(`pos:${name}`);
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'MERCHANT', $2, $3, 'SN')`,
      [merchant, operatorId, name],
    );
    await db.query(
      `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
       VALUES ($1, $2, $3, $4, 'EXTERNAL', $4)`,
      [participation, operatorId, eventId, merchant],
    );
    await db.query(
      `INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES ($1, $2, $3, $4)`,
      [pos, operatorId, participation, `Comptoir ${name}`],
    );
    await asOperator(db, operatorId, async () => {
      await db.query('SELECT open_participation_account($1)', [participation]);
      const cat = (
        await db.query<{ id: string }>(
          'SELECT id FROM create_catalog_category($1, $2, $2, 0, $3)',
          [pos, category, actor],
        )
      ).rows[0]!.id;
      for (const [fr, en, price] of items)
        await db.query('SELECT id FROM create_catalog_item($1, $2, $3, $4, 1800, $5)', [
          cat,
          fr,
          en,
          price,
          actor,
        ]);
    });
  }
}

/** Code imprimé associé à un bracelet (même écriture que l'association du fichier de l'imprimeur). */
async function attachClaimCode(
  db: Client,
  hasher: ClaimHasher,
  input: { operatorId: string; batchId: string; mediaId: string; code: string },
): Promise<void> {
  const hash = hasher.claimCodeHash(input.code);
  await db.query(
    `INSERT INTO claim_code (operator_id, batch_id, code_hash, media_id, associated_at) VALUES ($1, $2, $3, $4, now())`,
    [input.operatorId, input.batchId, hash, input.mediaId],
  );
  await db.query('UPDATE media SET claim_code_hash = $2 WHERE id = $1', [input.mediaId, hash]);
}

async function seed(): Promise<void> {
  const config = loadConfig();
  if (config.production)
    throw new Error('Données de démo refusées en configuration de production.');
  const hasher = new ClaimHasher(config);
  const idp = await FakeIdp.create(config.oidc);

  await withOwner(async (db) => {
    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (démo)'
          WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      );
      const a = await eventWorld(db, idp, {
        operatorId: OP,
        organizerId: ORG,
        eventId: EVENT,
        suffix: 'A',
      });
      const b = await eventWorld(db, idp, {
        operatorId: OP_B,
        organizerId: ORG_B,
        eventId: EVENT_B,
        suffix: 'B',
      });
      await catalog(db, OP, EVENT, a.adminId);
      const worlds = { A: a, B: b };

      for (const c of CUSTOMERS) {
        const operatorId = opOf(c);
        const w = worlds[c.operator];
        const eventId = c.operator === 'A' ? EVENT : EVENT_B;
        await db.query(
          "INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'CUSTOMER', $2, $3)",
          [customerId(c), operatorId, c.name],
        );
        if (c.topups === null) continue;
        await walletWithAccounts(db, {
          id: walletId(c),
          operatorId,
          ledgerId: w.ledgerId,
          customerId: customerId(c),
          status: 'ACTIVE',
        });
        for (const amount of c.topups)
          await creditWallet(db, {
            operatorId,
            ledgerId: w.ledgerId,
            walletId: walletId(c),
            amount,
          });
        if (c.bracelet) {
          const [m] = await seedPersonalizedMedia(db, {
            operatorId,
            batchId: w.batchId,
            kmsKeyRef: KEY_REF,
            count: 1,
          });
          await attachClaimCode(db, hasher, {
            operatorId,
            batchId: w.batchId,
            mediaId: m!.id,
            code: demoClaimCode(`bracelet:${c.key}`),
          });
          await activateMedia(db, {
            operatorId,
            eventId,
            walletId: walletId(c),
            mediaIds: [m!.id],
          });
        }
        if (c.walletStatus === 'BLOCKED')
          await db.query(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [walletId(c)]);
      }

      // Bracelets libres du prestataire A : jamais activés, code imprimé connu.
      const free = await seedPersonalizedMedia(db, {
        operatorId: OP,
        batchId: a.batchId,
        kmsKeyRef: KEY_REF,
        count: FREE_BRACELETS,
      });
      for (const [i, m] of free.entries())
        await attachClaimCode(db, hasher, {
          operatorId: OP,
          batchId: a.batchId,
          mediaId: m.id,
          code: demoClaimCode(`free:${i + 1}`),
        });

      // Bracelets anonymes actifs, crédités : consultation sans compte, rattachement d'un bracelet approvisionné.
      for (const anon of ANONYMOUS) {
        const [m] = await seedPersonalizedMedia(db, {
          operatorId: OP,
          batchId: a.batchId,
          kmsKeyRef: KEY_REF,
          count: 1,
        });
        await attachClaimCode(db, hasher, {
          operatorId: OP,
          batchId: a.batchId,
          mediaId: m!.id,
          code: demoClaimCode(anon.key),
        });
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [OP]);
        const wallet = (
          await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [EVENT])
        ).rows[0]!.id;
        await activateMedia(db, {
          operatorId: OP,
          eventId: EVENT,
          walletId: wallet,
          mediaIds: [m!.id],
        });
        if (anon.balance > 0)
          await creditWallet(db, {
            operatorId: OP,
            ledgerId: a.ledgerId,
            walletId: wallet,
            amount: anon.balance,
          });
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * Codes publics et numéros vérifiés des festivaliers de démo. Idempotent (ON CONFLICT DO NOTHING), et rejoué à chaque
 * lancement : une base de démo déjà amorcée avant l'authentification par code reçoit ainsi ses numéros.
 */
async function seedAuthentication(): Promise<void> {
  await withOwner(async (db) => {
    await db.query('BEGIN');
    try {
      for (const [side, code] of Object.entries(OPERATOR_CODES))
        await db.query(
          `INSERT INTO operator_public_code (operator_id, code) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [side === 'A' ? OP : OP_B, code],
        );
      for (const c of CUSTOMERS)
        await db.query(
          `INSERT INTO customer_identity (customer_id, operator_id, phone)
           SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM party WHERE id = $1)
           ON CONFLICT DO NOTHING`,
          [customerId(c), opOf(c), c.phone],
        );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}

/** Configurations PSP de démo : une `ACTIVE` par moyen et par événement (références du faux coffre `demo-*`). */
export const PSP_DEMO = [
  { method: 'WAVE', provider: 'WAVE', name: 'demo-wave' },
  { method: 'ORANGE_MONEY', provider: 'ORANGE_MONEY', name: 'demo-om' },
  { method: 'CARD', provider: 'STRIPE', name: 'demo-card' },
] as const;

/**
 * Configurations PSP (recharge PSP testable avec les faux PSP, OP-N121). Idempotent, et rejoué à chaque lancement
 * comme `seedAuthentication` : une base déjà amorcée les reçoit. Ne réécrit rien si la configuration existe.
 * Titulaire = détenteur des fonds du grand livre ; règle de frais comme les tests d'intégration.
 */
async function seedPspConfigurations(idp: FakeIdp): Promise<number> {
  let written = 0;
  await withOwner(async (db) => {
    await db.query('BEGIN');
    try {
      const sides = [
        { operatorId: OP, organizerId: ORG, eventId: EVENT },
        { operatorId: OP_B, organizerId: ORG_B, eventId: EVENT_B },
      ];
      for (const side of sides) {
        const ledger = await db.query<{ holder: string }>(
          `SELECT funds_holder_id AS holder FROM ledger
            WHERE scope_type = 'EVENT' AND scope_id = $1`,
          [side.eventId],
        );
        const holder = ledger.rows[0]?.holder;
        if (holder === undefined) continue;
        let authors: [string, string] | null = null;
        for (const psp of PSP_DEMO) {
          const ref = `psp/${holder}/${psp.name}`;
          const exists = await db.query(
            'SELECT 1 FROM psp_configuration WHERE operator_id = $1 AND secret_ref = $2',
            [side.operatorId, ref],
          );
          if (exists.rowCount === 1) continue;
          // Deux personnes distinctes (créateur et valideur), créées une fois par événement au besoin.
          if (authors === null) {
            const roles = [
              { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: side.operatorId },
            ];
            authors = [
              (await idp.createPerson(db, { operatorId: side.operatorId, roles })).userId,
              (await idp.createPerson(db, { operatorId: side.operatorId, roles })).userId,
            ];
          }
          const row = await db.query<{ id: string }>(
            `INSERT INTO psp_configuration (operator_id, organizer_id, method, provider, holder_party_id,
                    secret_ref, compliance_ref, status, is_default, valid_from, created_by, approved_by,
                    activated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'KYB-DEMO', 'ACTIVE', true, '2026-01-01', $7, $8, now())
             ON CONFLICT DO NOTHING
             RETURNING psp_configuration_id AS id`,
            [
              side.operatorId,
              side.organizerId,
              psp.method,
              psp.provider,
              holder,
              ref,
              authors[0],
              authors[1],
            ],
          );
          // Un défaut actif existe déjà pour ce moyen (configuration posée à la main) : on n'y touche pas.
          const id = row.rows[0]?.id;
          if (id === undefined) continue;
          await db.query(
            `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose,
                                   basis, rate_bps, trigger, valid_from)
             VALUES ($1, 'PSP_CONFIGURATION', $2, 'ORG_FPSP', 'PSP_FRAIS', 'TOPUP_AMOUNT', 150,
                     'REALTIME', '2026-01-01')`,
            [side.operatorId, id],
          );
          written += 1;
        }
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
  return written;
}

function summary(): string {
  const codes = `codes publics des prestataires (operator_code) : A = ${OPERATOR_CODES.A}, B = ${OPERATOR_CODES.B}`;
  const lines = [
    `Prestataire A : ${OP}   (événement ${EVENT})`,
    `Prestataire B : ${OP_B}   (événement ${EVENT_B})`,
    '',
    codes,
    '',
    'Festivaliers (connexion par code, ou en-têtes X-Test-Customer-Id / X-Test-Operator-Id) :',
    ...CUSTOMERS.map(
      (c) =>
        `  ${c.name.padEnd(14)} ${c.phone}  client ${customerId(c)}  prestataire ${c.operator}` +
        (c.topups ? `  portefeuille ${walletId(c)}` : '') +
        (c.bracelet ? `  bracelet ${demoClaimCode(`bracelet:${c.key}`)}` : ''),
    ),
    '',
    `Recharge PSP : configurations ACTIVE par moyen (WAVE, ORANGE_MONEY, CARD) pour les événements A et B ; ` +
      `références psp/<titulaire>/${PSP_DEMO.map((p) => p.name).join('|')} ; paiement simulé par ` +
      `POST /v1/__dev/psp-topups/{topup_id}/outcome`,
    '',
    `Bracelets libres (POST /me/media) : ${Array.from({ length: FREE_BRACELETS }, (_, i) => demoClaimCode(`free:${i + 1}`)).join(' ')}`,
    `Bracelets anonymes : ${ANONYMOUS.map((a) => `${demoClaimCode(a.key)} (${a.balance} XOF)`).join(', ')}`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  // Avant toute lecture de la base : jamais de données de démo en production (le faux service de clés y sert).
  if (process.env.NODE_ENV === 'production')
    throw new Error(
      'Données de démo refusées en configuration de production (NODE_ENV=production).',
    );
  if (process.argv.includes('--print')) {
    console.log(summary());
    return;
  }
  const exists = await withOwner(
    async (db) => (await db.query('SELECT 1 FROM party WHERE id = $1', [OP])).rowCount === 1,
  );
  if (exists) {
    console.log('Données de démo déjà présentes : rien d’écrit (la base garde son état).');
  } else {
    await seed();
    console.log('Données de démo écrites.');
  }
  await seedAuthentication();
  const idp = await FakeIdp.create(loadConfig().oidc);
  const pspWritten = await seedPspConfigurations(idp);
  console.log(
    pspWritten > 0
      ? `Configurations PSP de démo écrites : ${pspWritten}.`
      : 'Configurations PSP de démo déjà présentes : rien d’écrit.',
  );
  console.log(summary());
}

// `uuidToBytes` importé pour vérifier au chargement que les identifiants dérivés sont des UUID valides.
for (const id of [OP, OP_B, EVENT, EVENT_B]) uuidToBytes(id);

if (require.main === module)
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
