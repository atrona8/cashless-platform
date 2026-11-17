// FR-022, FR-024, C-007 : relevés des parties (route 16). Le festival de référence est rejoué en entier par le moteur
// (T1 à T48) ; les relevés de l'organisateur, du prestataire et de la plateforme égalent, ligne à ligne, les soldes
// `L-ORG-*`, `L-OPE-*` et `L-PLT-*` de `scenario_reference.json` (`expected.after_closing`).
import { Csv, type CsvColumn } from '../../../src/common/csv';
import {
  ALL_STATEMENT_ROLES,
  PARTY_KINDS,
  STATEMENT_ROLES,
  type PartyKind,
} from '../../../src/statements/party-statement-scope';
import { OTHER_CATEGORY, STATEMENT_CATEGORIES } from '../../../src/statements/statement-categories';
import { scenario } from '../../unit/builders/support/scenario-lines';
import { createStatementsWorld, expected, type StatementsWorld } from './statements-world';

jest.setTimeout(600_000);

interface Line {
  transaction_id: string;
  occurred_at: string;
  type: string;
  label: string;
  amount: number;
}
interface Statement {
  party_kind: PartyKind;
  party_id?: string;
  event_id: string;
  currency: string;
  data: Line[];
  next_cursor: string | null;
  has_more: boolean;
}

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'occurred_at', header: 'occurred_at', kind: 'text' },
  { key: 'type', header: 'type', kind: 'text' },
  { key: 'label', header: 'label', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'balance', header: 'balance', kind: 'number' },
];

const accounts = scenario.accounts as unknown as { code: string; purpose: string }[];
const transactions = scenario.transactions as unknown as {
  no: number;
  type: string;
  lines: { account: string; amount: number; memo?: string }[];
}[];

describe('relevés des parties : scénario de référence rejoué par le moteur', () => {
  let w: StatementsWorld;
  let balances: Record<string, bigint>;
  beforeAll(async () => {
    w = await createStatementsWorld();
    await w.replayTo(expected.after_closing.after_tx);
    balances = await w.balances();
  });
  afterAll(async () => w.close());

  const path = (kind: string, query = '') => w.eventPath(`/statements/${kind}${query}`);
  const pages = async (kind: PartyKind, partyId: string | null, token?: string, limit = 7) => {
    const lines: Line[] = [];
    let cursor: string | null = null;
    let first: Statement | null = null;
    for (let guard = 0; guard < 500; guard += 1) {
      const query = `?limit=${limit}${partyId ? `&party_id=${partyId}` : ''}${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await w.get(path(kind, query), token);
      expect(res.status).toBe(200);
      const body = res.body as Statement;
      first ??= body;
      lines.push(...body.data);
      cursor = body.next_cursor;
      if (!body.has_more) return { first: first!, lines };
    }
    throw new Error('pagination sans fin');
  };
  /** Somme des montants par catégorie (le suffixe « — commerçant » est retiré). */
  const byCategory = (lines: Line[]) => {
    const sums = new Map<string, number>();
    for (const line of lines) {
      const category = line.label.split(' — ')[0]!;
      sums.set(category, (sums.get(category) ?? 0) + line.amount);
    }
    return sums;
  };
  /** Ventes nettes du commerçant interne (L-MCH-BAR) : PURCHASE et REVERSAL du scénario, crédit positif. */
  const internalSales = transactions
    .filter((tx) => tx.type === 'PURCHASE' || tx.type === 'REVERSAL')
    .flatMap((tx) => tx.lines.filter((l) => l.account === 'L-MCH-BAR'))
    .reduce((sum, l) => sum - l.amount, 0);
  /** Attendu pour une catégorie : somme des soldes (crédit positif) des comptes du scénario de ses finalités. */
  const expectedFor = (kind: PartyKind, category: string): number => {
    // « Ventes internes » : ventes et annulations du commerçant interne (BAR) dans le scénario, hors versements.
    if (kind === 'ORGANIZER' && category === 'Ventes internes') return internalSales;
    const purposes = new Set(
      STATEMENT_CATEGORIES[kind].filter((c) => c.category === category).flatMap((c) => c.purposes),
    );
    return accounts
      .filter((a) => purposes.has(a.purpose))
      .reduce((sum, a) => sum - Number(balances[a.code] ?? 0n), 0);
  };

  it('le grand livre est celui du scénario de référence après la clôture', async () => {
    const want = Object.fromEntries(
      Object.entries(expected.after_closing.balances).map(([code, v]) => [code, BigInt(v)]),
    );
    expect(Object.fromEntries(Object.keys(want).map((code) => [code, balances[code]]))).toEqual(
      want,
    );
  });

  it.each([
    ['ORGANIZER', 'ORG', 'L-ORG-'],
    ['OPERATOR', 'OPE', 'L-OPE-'],
    ['PLATFORM', 'PLT', 'L-PLT-'],
  ] as const)(
    'FR-022 : le relevé %s égale, catégorie par catégorie et en solde, les soldes %s*',
    async (kind, key, prefix) => {
      const partyId = kind === 'ORGANIZER' ? w.fx.parties.ORG : null;
      const token =
        kind === 'PLATFORM' ? w.fx.people.platformAdmin.token : w.fx.people.operatorAdmin.token;
      const { first, lines } = await pages(kind, partyId, token);
      expect(first).toMatchObject({ party_kind: kind, event_id: w.fx.eventId, currency: 'XOF' });
      const own = Object.entries(expected.after_closing.balances).filter(([code]) =>
        code.startsWith(prefix),
      );
      expect(own.length).toBeGreaterThan(0);
      // Solde : somme des lignes ; `closing_balance` n'est pas servi en JSON (voir le service), le CSV le porte.
      expect(first).not.toHaveProperty('closing_balance');
      const internal = kind === 'ORGANIZER' ? internalSales : 0;
      expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(
        internal - own.reduce((sum, [, v]) => sum + v, 0),
      );
      // Chaque catégorie égale la somme des soldes de ses comptes ; aucun mouvement ne tombe dans « Autres ».
      const sums = byCategory(lines);
      expect(sums.has(OTHER_CATEGORY)).toBe(false);
      for (const entry of STATEMENT_CATEGORIES[kind])
        expect({ [entry.category]: sums.get(entry.category) ?? 0 }).toEqual({
          [entry.category]: expectedFor(kind, entry.category),
        });
      // Ligne à ligne : mêmes transactions et mêmes montants que les écritures des comptes de la partie.
      const rows = await w.owner<{ transaction_id: string; amount: string }>(
        `SELECT p.transaction_id, (-p.amount)::text AS amount FROM posting p
           JOIN account a ON a.id = p.account_id
          WHERE p.ledger_id = $1 AND left(a.purpose, 4) = $2
          ORDER BY p.transaction_id, p.amount`,
        [w.fx.ledgerId, `${key}_`],
      );
      if (kind === 'ORGANIZER')
        rows.push(
          ...(await w.owner<{ transaction_id: string; amount: string }>(
            `SELECT p.transaction_id, (-p.amount)::text AS amount FROM posting p
               JOIN account a ON a.id = p.account_id
               JOIN merchant_participation mp ON mp.id = a.participation_id
               JOIN journal_transaction t ON t.id = p.transaction_id
              WHERE p.ledger_id = $1 AND a.purpose = 'MERCHANT' AND mp.link_type = 'INTERNAL'
                AND t.type IN ('PURCHASE', 'REVERSAL') AND p.fee_rule_id IS NULL`,
            [w.fx.ledgerId],
          )),
        );
      const seen = lines
        .map((l) => ({ transaction_id: l.transaction_id, amount: String(l.amount) }))
        .sort(
          (a, b) =>
            a.transaction_id.localeCompare(b.transaction_id) || Number(b.amount) - Number(a.amount),
        );
      expect(seen).toEqual(
        rows.sort(
          (a, b) =>
            a.transaction_id.localeCompare(b.transaction_id) || Number(b.amount) - Number(a.amount),
        ),
      );
    },
  );

  it('recoupement : le total d’une étape de clôture (closing_step.summary) égale les lignes du relevé de son type', async () => {
    const steps = await w.owner<{ step: string; total: number }>(
      `SELECT step, (summary->>'total')::bigint::int AS total FROM closing_step WHERE event_id = $1`,
      [w.fx.eventId],
    );
    const total = (step: string) => steps.find((s) => s.step === step)?.total;
    const sumOf = async (kind: PartyKind, partyId: string | null, token: string, type: string) =>
      (await pages(kind, partyId, token, 50)).lines
        .filter((l) => l.type === type)
        .reduce((sum, l) => sum + l.amount, 0);
    const op = w.fx.people.operatorAdmin.token;
    expect(total('PITCH_FEES')).toBe(25_000);
    expect(await sumOf('ORGANIZER', w.fx.parties.ORG, op, 'PITCH_FEE')).toBe(total('PITCH_FEES'));
    expect(await sumOf('OPERATOR', null, op, 'OPERATOR_FEE')).toBe(total('OPERATOR_FEE'));
    expect(await sumOf('PLATFORM', null, w.fx.people.platformAdmin.token, 'PLATFORM_FEE')).toBe(
      total('PLATFORM_FEE'),
    );
    const breakage =
      (await sumOf('ORGANIZER', w.fx.parties.ORG, op, 'BREAKAGE')) +
      (await sumOf('OPERATOR', null, op, 'BREAKAGE'));
    expect(breakage).toBe(total('BREAKAGE'));
  });

  it('décision 15 : « Ventes internes » = ventes et annulations des commerçants INTERNAL, jamais les EXTERNAL', async () => {
    const { lines } = await pages('ORGANIZER', w.fx.parties.ORG);
    const internalLines = lines.filter((l) => l.label.split(' — ')[0] === 'Ventes internes');
    expect(internalSales).toBe(18_500);
    expect(internalLines.reduce((sum, l) => sum + l.amount, 0)).toBe(internalSales);
    expect(new Set(internalLines.map((l) => l.type))).toEqual(new Set(['PURCHASE', 'REVERSAL']));
    // Les transactions de ces lignes sont exactement celles du compte du commerçant interne.
    const bar = await w.owner<{ transaction_id: string }>(
      `SELECT p.transaction_id FROM posting p JOIN account a ON a.id = p.account_id
         JOIN merchant_participation mp ON mp.id = a.participation_id
         JOIN journal_transaction t ON t.id = p.transaction_id
        WHERE mp.id = $1 AND t.type IN ('PURCHASE', 'REVERSAL') AND p.fee_rule_id IS NULL`,
      [w.fx.participations.BAR],
    );
    expect(internalLines.map((l) => l.transaction_id).sort()).toEqual(
      bar.map((r) => r.transaction_id).sort(),
    );
    // Aucune vente des commerçants EXTERNAL (FOOD, TEE) : leurs transactions n'ont aucune ligne « Ventes internes »
    // (hors transaction partagée avec le bar), et le CSV porte la même catégorie.
    const external = await w.owner<{ transaction_id: string }>(
      `SELECT DISTINCT p.transaction_id FROM posting p JOIN account a ON a.id = p.account_id
        WHERE a.participation_id = ANY($1::uuid[]) AND p.transaction_id <> ALL($2::uuid[])`,
      [[w.fx.participations.FOOD, w.fx.participations.TEE], bar.map((r) => r.transaction_id)],
    );
    expect(external.length).toBeGreaterThan(0);
    const externalIds = new Set(external.map((r) => r.transaction_id));
    expect(internalLines.some((l) => externalIds.has(l.transaction_id))).toBe(false);
    const res = await w
      .get(path('ORGANIZER', `?party_id=${w.fx.parties.ORG}&format=csv`))
      .buffer(true);
    const csvRows = Csv.parse(res.text, CSV_COLUMNS);
    expect(
      csvRows
        .filter((r) => String(r.label).startsWith('Ventes internes'))
        .reduce((sum, r) => sum + Number(r.amount), 0),
    ).toBe(internalSales);
    // Un autre organisateur ne voit rien de ce relevé (404), ni par le chemin d'un autre événement.
    const stranger = w.people.foreignOrganizer.token;
    expect((await w.get(path('ORGANIZER', `?party_id=${w.fx.parties.ORG}`), stranger)).status).toBe(
      404,
    );
  });

  it('FR-022 : le relevé d’un commerçant donne ventes, commission, droit de place, versements, solde', async () => {
    for (const [key, person] of [
      ['FOOD', w.people.merchantFood],
      ['TEE', w.people.merchantTee],
    ] as const) {
      const { first, lines } = await pages('MERCHANT', w.fx.parties[key], person.token);
      const code = `L-MCH-${key}`;
      expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(0 - Number(balances[code]));
      expect(first.party_id).toBe(w.fx.parties[key]);
      const sums = byCategory(lines);
      // Attendu : les lignes du compte dans scenario_reference.json, classées comme §12.3.
      const want = new Map<string, number>();
      const add = (category: string, amount: number) =>
        want.set(category, (want.get(category) ?? 0) - amount);
      for (const tx of transactions)
        for (const l of tx.lines.filter((x) => x.account === code)) {
          if (tx.type === 'PURCHASE')
            add(l.memo?.startsWith('Commission') ? 'Commissions' : 'Ventes brutes', l.amount);
          else if (tx.type === 'REVERSAL') add('Annulations', l.amount);
          else if (tx.type === 'PITCH_FEE') add('Droit de place', l.amount);
          else if (tx.type.startsWith('PAYOUT_')) add('Versements', l.amount);
          else add(OTHER_CATEGORY, l.amount);
        }
      expect(Object.fromEntries(sums)).toEqual(Object.fromEntries(want));
      expect(sums.get('Ventes brutes') ?? 0).toBeGreaterThan(0);
      expect(sums.get('Commissions') ?? 0).toBeLessThan(0);
    }
  });

  describe('périmètre (liste figée des rôles)', () => {
    it('la liste des rôles par nature de partie ne s’élargit pas', () => {
      expect(STATEMENT_ROLES).toEqual({
        MERCHANT: ['MERCHANT_ADMIN', 'ORGANIZER_ADMIN', 'OPERATOR_ADMIN'],
        ORGANIZER: ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'],
        OPERATOR: ['OPERATOR_ADMIN'],
        PLATFORM: ['PLATFORM_ADMIN'],
      });
      expect(Object.isFrozen(STATEMENT_ROLES)).toBe(true);
      expect(PARTY_KINDS.every((k) => Object.isFrozen(STATEMENT_ROLES[k]))).toBe(true);
      expect([...ALL_STATEMENT_ROLES].sort()).toEqual(
        ['MERCHANT_ADMIN', 'ORGANIZER_ADMIN', 'OPERATOR_ADMIN', 'PLATFORM_ADMIN'].sort(),
      );
    });

    it('MERCHANT_ADMIN : son commerçant seulement ; un autre commerçant, une participation ou une autre nature : refusés', async () => {
      const food = w.people.merchantFood.token;
      const { FOOD, TEE, BAR, ORG, OPE } = w.fx.parties;
      expect((await w.get(path('MERCHANT', `?party_id=${FOOD}`), food)).status).toBe(200);
      // Autre commerçant du même événement, participation, organisateur, identifiant inconnu : 404, jamais 403.
      for (const other of [
        TEE,
        BAR,
        w.fx.participations.FOOD,
        ORG,
        '00000000-0000-4000-8000-000000000999',
      ]) {
        const res = await w.get(path('MERCHANT', `?party_id=${other}`), food);
        expect({ party: other, status: res.status }).toEqual({ party: other, status: 404 });
        expect(res.headers['content-type']).toMatch(/problem\+json/);
      }
      expect((await w.get(path('MERCHANT'), food)).status).toBe(404);
      // Nature détournée : 403 (le rôle ne suffit pas pour cette nature), avec ou sans partie existante.
      for (const [kind, party] of [
        ['ORGANIZER', ORG],
        ['OPERATOR', OPE],
        ['PLATFORM', ''],
      ] as const)
        expect((await w.get(path(kind, party ? `?party_id=${party}` : ''), food)).status).toBe(403);
      // Mêmes réponses pour un événement inconnu : le refus de rôle ne dépend pas de l'événement.
      const unknownEvent = `/v1/operators/${OPE}/events/00000000-0000-4000-8000-000000000999/statements/OPERATOR`;
      expect((await w.get(unknownEvent, food)).status).toBe(403);
      // Un commerçant qui ne participe pas à l'événement : 404.
      const [stray] = await w.owner<{ id: string }>(
        `INSERT INTO party (kind, operator_id, legal_name) VALUES ('MERCHANT', $1, 'Sans stand') RETURNING id`,
        [OPE],
      );
      expect((await w.get(path('MERCHANT', `?party_id=${stray!.id}`))).status).toBe(404);
    });

    it('ORGANIZER_ADMIN : ses commerçants et son organisateur ; un autre organisateur : 404', async () => {
      const org = w.fx.people.organizerAdmin.token;
      const { FOOD, TEE, BAR, ORG, OPE } = w.fx.parties;
      for (const merchant of [FOOD, TEE, BAR])
        expect((await w.get(path('MERCHANT', `?party_id=${merchant}`), org)).status).toBe(200);
      expect((await w.get(path('ORGANIZER', `?party_id=${ORG}`), org)).status).toBe(200);
      expect((await w.get(path('OPERATOR'), org)).status).toBe(403);
      expect((await w.get(path('PLATFORM'), org)).status).toBe(403);
      expect((await w.get(path('ORGANIZER', `?party_id=${OPE}`), org)).status).toBe(404);
      // Un autre ORGANIZER_ADMIN du même prestataire : tout est hors de sa portée.
      const stranger = w.people.foreignOrganizer.token;
      for (const [kind, party] of [
        ['ORGANIZER', ORG],
        ['MERCHANT', FOOD],
        ['MERCHANT', BAR],
      ] as const) {
        const res = await w.get(path(kind, `?party_id=${party}`), stranger);
        expect({ kind, status: res.status }).toEqual({ kind, status: 404 });
      }
      expect((await w.get(path('OPERATOR'), stranger)).status).toBe(403);
    });

    it('OPERATOR_ADMIN : tout sauf la plateforme ; PLATFORM_ADMIN : la plateforme seulement', async () => {
      const { FOOD, ORG, OPE } = w.fx.parties;
      const op = w.fx.people.operatorAdmin.token;
      expect((await w.get(path('MERCHANT', `?party_id=${FOOD}`), op)).status).toBe(200);
      expect((await w.get(path('ORGANIZER', `?party_id=${ORG}`), op)).status).toBe(200);
      expect((await w.get(path('OPERATOR', `?party_id=${OPE}`), op)).status).toBe(200);
      expect((await w.get(path('OPERATOR', `?party_id=${ORG}`), op)).status).toBe(404);
      expect((await w.get(path('PLATFORM'), op)).status).toBe(403);
      const platform = w.fx.people.platformAdmin.token;
      expect((await w.get(path('PLATFORM'), platform)).status).toBe(200);
      for (const kind of ['MERCHANT', 'ORGANIZER', 'OPERATOR'])
        expect((await w.get(path(kind, `?party_id=${ORG}`), platform)).status).toBe(403);
    });

    it('SUPERVISOR et CASHIER : 403 pour toute nature ; sans jeton : 401 ; nature inconnue : 404', async () => {
      for (const person of [w.people.supervisor, w.people.cashier])
        for (const kind of PARTY_KINDS)
          expect(
            (await w.get(path(kind, `?party_id=${w.fx.parties.ORG}`), person.token)).status,
          ).toBe(403);
      expect((await w.get(path('ORGANIZER')).set('Authorization', '')).status).toBe(401);
      expect((await w.get(path('FAMILY'))).status).toBe(404);
    });

    it('autre prestataire : son administrateur reçoit 404 ; notre administrateur, pour son événement, aussi', async () => {
      const foreign = w.people.foreignOperator.token;
      const { OPE, ORG } = w.fx.parties;
      // Notre événement, notre chemin, avec son jeton.
      expect((await w.get(path('ORGANIZER', `?party_id=${ORG}`), foreign)).status).toBe(404);
      // Son prestataire dans le chemin, notre événement.
      const foreignOperatorId = (
        await w.owner<{ operator_id: string }>(`SELECT operator_id FROM event WHERE id = $1`, [
          w.people.foreignOperatorEventId,
        ])
      )[0]!.operator_id;
      const own = w.eventPath('/statements/OPERATOR', foreignOperatorId);
      expect((await w.get(own, foreign)).status).toBe(404);
      // Notre administrateur sur l'événement de l'autre prestataire (RLS) : 404.
      const theirs = `/v1/operators/${OPE}/events/${w.people.foreignOperatorEventId}/statements/OPERATOR`;
      expect((await w.get(theirs)).status).toBe(404);
    });
  });

  describe('JSON et CSV', () => {
    it('CSV : en-têtes, type, UTF-8 ; mêmes totaux que le JSON ; nombre de lignes identique', async () => {
      const { first, lines } = await pages('ORGANIZER', w.fx.parties.ORG);
      const res = await w
        .get(path('ORGANIZER', `?party_id=${w.fx.parties.ORG}&format=csv`))
        .buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="statement-organizer-/,
      );
      const rows = Csv.parse(res.text, CSV_COLUMNS);
      expect(rows).toHaveLength(lines.length);
      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      expect(rows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(total);
      expect(rows[rows.length - 1]!.balance).toBe(total);
      expect(rows.map((r) => [r.occurred_at, r.type, r.label, r.amount])).toEqual(
        lines.map((l) => [l.occurred_at, l.type, l.label, l.amount]),
      );
      expect(res.text.split('\r\n')[0]).toBe('occurred_at,type,label,amount,balance');
    });

    it('CSV : guillemets, virgules et sauts de ligne d’un libellé de tiers ; formule neutralisée', async () => {
      const { FOOD, TEE } = w.fx.parties;
      const nasty = 'Chez "Mamy", café\nbar';
      await w.owner(`UPDATE party SET legal_name = $2 WHERE id = $1`, [TEE, nasty]);
      await w.owner(`UPDATE party SET legal_name = $2 WHERE id = $1`, [
        FOOD,
        '=HYPERLINK("http://exemple.test","x")',
      ]);
      try {
        const res = await w
          .get(path('ORGANIZER', `?party_id=${w.fx.parties.ORG}&format=csv`))
          .buffer(true);
        const rows = Csv.parse(res.text, CSV_COLUMNS);
        expect(rows.some((r) => String(r.label).includes(nasty))).toBe(true);
        expect(res.text).toContain('Chez ""Mamy"", café\nbar'); // guillemets doublés, champ entre guillemets
        // Aucune cellule texte ne commence par un caractère de formule.
        for (const r of rows)
          for (const cell of [r.occurred_at, r.type, r.label])
            expect(String(cell)).not.toMatch(/^[=+\-@\t\r]/);
        expect(rows.some((r) => String(r.label).includes('=HYPERLINK'))).toBe(true);
        // Le libellé commence par la catégorie : la charge n'arrive jamais en tête de cellule dans ce relevé. La
        // neutralisation est donc prouvée sur l'écrivain même du relevé (mêmes colonnes) avec une charge en tête.
        const written = Csv.write(
          [
            {
              occurred_at: '2026-12-01T00:00:00.000Z',
              type: 'PURCHASE',
              label: '=HYPERLINK("http://x","y")',
              amount: 1,
              balance: 1,
            },
          ],
          CSV_COLUMNS,
        );
        expect(written).toContain(`'=HYPERLINK`);
        expect(Csv.parse(written, CSV_COLUMNS)[0]!.label).not.toMatch(/^[=+\-@\t\r]/);
      } finally {
        await w.owner(`UPDATE party SET legal_name = $2 WHERE id = $1`, [
          TEE,
          'Vendeur de tee-shirts',
        ]);
        await w.owner(`UPDATE party SET legal_name = $2 WHERE id = $1`, [FOOD, 'Food truck']);
      }
    });

    it('format inconnu : 400 ; limite hors bornes : 400 ; curseur illisible : 400', async () => {
      const q = `party_id=${w.fx.parties.ORG}`;
      expect((await w.get(path('ORGANIZER', `?${q}&format=xml`))).status).toBe(400);
      expect((await w.get(path('ORGANIZER', `?${q}&limit=0`))).status).toBe(400);
      expect((await w.get(path('ORGANIZER', `?${q}&limit=201`))).status).toBe(400);
      expect((await w.get(path('ORGANIZER', `?${q}&cursor=%25%25`))).status).toBe(400);
    });

    it('pagination : curseur stable, aucun doublon ni trou, même suite qu’une page unique', async () => {
      const small = await pages('ORGANIZER', w.fx.parties.ORG, undefined, 5);
      const big = await pages('ORGANIZER', w.fx.parties.ORG, undefined, 200);
      expect(small.lines.length).toBeGreaterThan(10);
      expect(small.lines).toEqual(big.lines);
      expect(small.lines).toHaveLength(big.lines.length);
    });
  });

  it('aucune écriture au grand livre ; FR-024 : l’export CSV est tracé sans montant, le JSON ne l’est pas', async () => {
    const before = await w.counts();
    await w.get(path('ORGANIZER', `?party_id=${w.fx.parties.ORG}`));
    const audits = async () =>
      w.owner<{ actor_id: string; after: Record<string, unknown> }>(
        `SELECT actor_id, after FROM audit_log WHERE action = 'PARTY_STATEMENT_EXPORTED' AND object_id = $1`,
        [w.fx.eventId],
      );
    const jsonOnly = (await audits()).length;
    await w.get(path('OPERATOR'));
    await w.get(path('ORGANIZER', `?party_id=${w.fx.parties.ORG}&format=csv`));
    const rows = await audits();
    expect(rows.length).toBe(jsonOnly + 1);
    const last = rows[rows.length - 1]!;
    expect(last.actor_id).toBe(w.fx.people.operatorAdmin.userId);
    expect(Object.keys(last.after).sort()).toEqual(['lines', 'party_id', 'party_kind']);
    expect(last.after).toMatchObject({ party_kind: 'ORGANIZER', party_id: w.fx.parties.ORG });
    expect(await w.counts()).toEqual(before);
  });
});
