// Intégration : codes de rattachement à la commande (FR-015, FR-017, NFR-002, SC-004 ; ADR-56). Le fichier de commande
// est le seul moment où les codes existent en clair côté serveur : remis une fois, jamais conservé — ni en base, ni
// dans l'audit, ni dans le registre d'idempotence, ni dans les journaux. Puis import du fichier de l'imprimeur.
import { randomBytes, randomUUID } from 'node:crypto';
import { CLAIM_CODE_ALPHABET, generateClaimCode } from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { ClaimCodesService, MAX_ASSOCIATION_LINES } from '../../../src/media/batches/claim-codes.service';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { client, createBatchWorld, KEY, rows, seedMedia, type BatchWorld } from './batch-fixtures';

const LINE = new RegExp(`^(\\d+),([${CLAIM_CODE_ALPHABET}]{4})-([${CLAIM_CODE_ALPHABET}]{6}),https://pay\\.cashless\\.test/c/([${CLAIM_CODE_ALPHABET}]{10})$`);

/** Codes d'un fichier de commande, sans tiret. */
function codesOf(csv: string): string[] {
  const lines = csv.trimEnd().split('\n');
  expect(lines[0]).toBe('rank,code,url');
  return lines.slice(1).map((line, index) => {
    const match = LINE.exec(line);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(String(index + 1));
    expect(`${match![2]}${match![3]}`).toBe(match![4]);
    return match![4]!;
  });
}

/** Cherche des valeurs dans toutes les colonnes texte, JSON, tableau et binaires de la base ; rend les tables touchées. */
async function findAtRest(values: string[]): Promise<string[]> {
  // Avec ou sans tiret, quelle que soit la casse.
  const pattern = values.map((code) => `${code.slice(0, 4)}-?${code.slice(4)}`).join('|');
  const columns = await rows<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_schema, c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE t.table_type = 'BASE TABLE' AND c.table_schema IN ('public', 'ops')
        AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea', 'ARRAY')`,
  );
  const byTable = new Map<string, string[]>();
  for (const column of columns) {
    const table = `"${column.table_schema}"."${column.table_name}"`;
    const expression = column.data_type === 'bytea' ? `encode("${column.column_name}", 'escape') ~* $1` : `"${column.column_name}"::text ~* $1`;
    byTable.set(table, [...(byTable.get(table) ?? []), expression]);
  }
  const hits: string[] = [];
  for (const [table, expressions] of byTable) {
    const found = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${expressions.join(' OR ')}`, [pattern]);
    if (found[0]!.n > 0) hits.push(table);
  }
  return hits;
}

describe('codes de rattachement à la commande', () => {
  let w: BatchWorld;
  let api: ReturnType<typeof client>;
  let hasher: ClaimHasher;
  const A = () => `/v1/operators/${w.ops.a}/media-batches`;
  const create = async (body: object = {}) => {
    const res = await api.post(w.orgAdmin, A(), { organizer_id: w.ids.a1, kind: 'PUBLIC', quantity: 25, key_index: KEY.shared, ...body });
    expect(res.status).toBe(201);
    return res.body.batch_id as string;
  };
  const order = (batchId: string, key: string = randomUUID(), who = w.orgAdmin) => api.post(who, `${A()}/${batchId}/claim-code-order`, undefined as unknown as object, key);

  beforeAll(async () => {
    w = await createBatchWorld();
    api = client(w);
    hasher = w.app.get(ClaimHasher, { strict: false });
  });

  afterAll(async () => {
    await w.app.close();
  });

  describe('fichier de commande', () => {
    let batchId: string;
    let key: string;
    let codes: string[];
    let logged = '';

    beforeAll(async () => {
      batchId = await create();
      key = randomUUID();
      // Tout ce que le processus écrit sur ses sorties pendant la demande est gardé pour le contrôle des journaux.
      const spies = [jest.spyOn(process.stdout, 'write'), jest.spyOn(process.stderr, 'write')];
      const res = await order(batchId, key);
      logged = spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0]))).join('');
      spies.forEach((spy) => spy.mockRestore());
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="claim-codes-${batchId}.csv"`);
      expect(res.headers['idempotency-replayed']).toBeUndefined();
      codes = codesOf(res.text);
    });

    it('un code par bracelet, tous distincts, à l’alphabet de 32 caractères', () => {
      expect(codes).toHaveLength(25);
      expect(new Set(codes).size).toBe(25);
    });

    it('la base ne garde que les empreintes à clé', async () => {
      const stored = await rows<{ code_hash: Buffer; media_id: string | null }>('SELECT code_hash, media_id FROM claim_code WHERE batch_id = $1', [batchId]);
      expect(stored).toHaveLength(25);
      expect(new Set(stored.map((row) => row.code_hash.toString('hex')))).toEqual(new Set(codes.map((code) => hasher.claimCodeHash(code).toString('hex'))));
      expect(stored.every((row) => row.media_id === null)).toBe(true);
      expect((await api.get(w.orgAdmin, `${A()}/${batchId}`)).body.claim_codes_issued).toBe(true);
    });

    it('aucun code en clair au repos : ni en base, ni dans l’audit, ni dans le registre d’idempotence, ni dans les journaux', async () => {
      expect(await findAtRest(codes)).toEqual([]);
      for (const code of codes) {
        expect(logged).not.toContain(code);
        expect(logged).not.toContain(`${code.slice(0, 4)}-${code.slice(4)}`);
      }
      expect(await rows(`SELECT action, after FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'CLAIM_CODES_ISSUED'`, [w.ops.a, batchId])).toEqual([
        { action: 'CLAIM_CODES_ISSUED', after: { count: 25 } },
      ]);
      const stored = await rows<{ response_status: number; body: string }>(`SELECT response_status, response_body::text AS body FROM api_idempotency WHERE operator_id = $1 AND idempotency_key = $2`, [w.ops.a, key]);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.response_status).toBe(409);
      expect(stored[0]!.body).not.toContain('rank,code,url');
    });

    it('la recherche au repos trouve bien un code quand il y en a un (contrôle du contrôle)', async () => {
      const planted = 'K7QM4XH9RT';
      const id = randomUUID();
      await rows(`INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, $3)`, [id, w.ops.a, `fuite k7qm-4xh9rt`]);
      try {
        expect(await findAtRest([planted])).toEqual(['"public"."party"']);
      } finally {
        await rows('DELETE FROM party WHERE id = $1', [id]);
      }
    });

    it('le fichier n’est produit qu’une fois : même clé ou nouvelle clé, 409 et aucun code', async () => {
      const replay = await order(batchId, key);
      expect(replay.status).toBe(409);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.text).not.toContain('rank,code,url');
      const again = await order(batchId);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('CONFLICT_STATE');
      for (const code of codes) expect(`${replay.text}${again.text}`).not.toContain(code);
      expect(await rows('SELECT count(*)::int AS n FROM claim_code WHERE batch_id = $1', [batchId])).toEqual([{ n: 25 }]);
    });

    it('la quantité ne se modifie plus une fois le fichier produit', async () => {
      expect((await api.patch(w.orgAdmin, `${A()}/${batchId}`, { quantity: 30 })).status).toBe(409);
      expect((await api.patch(w.orgAdmin, `${A()}/${batchId}`, { print_order_ref: 'BC-9' })).status).toBe(200);
    });
  });

  it('deux demandes simultanées : un seul fichier', async () => {
    const batchId = await create({ quantity: 5 });
    const results = await Promise.all([order(batchId), order(batchId), order(batchId)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409]);
    expect(await rows('SELECT count(*)::int AS n FROM claim_code WHERE batch_id = $1', [batchId])).toEqual([{ n: 5 }]);
  });

  it('une empreinte déjà prise fait retirer le code concerné', async () => {
    const batchId = await create({ quantity: 3 });
    // Le premier code tiré existe déjà chez ce prestataire : il doit être remplacé, pas refusé.
    const taken = generateClaimCode(randomBytes);
    const other = await create({ quantity: 1 });
    await rows('INSERT INTO claim_code (operator_id, batch_id, code_hash) VALUES ($1, $2, $3)', [w.ops.a, other, hasher.claimCodeHash(taken)]);
    const real = hasher.claimCodeHash.bind(hasher);
    let forced = false;
    const spy = jest.spyOn(hasher, 'claimCodeHash').mockImplementation((code: string) => {
      if (forced) return real(code);
      forced = true;
      return real(taken);
    });
    const res = await order(batchId);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(codesOf(res.text)).toHaveLength(3);
    const stored = await rows<{ code_hash: Buffer }>('SELECT code_hash FROM claim_code WHERE batch_id = $1', [batchId]);
    expect(stored).toHaveLength(3);
    expect(stored.map((row) => row.code_hash.toString('hex'))).not.toContain(real(taken).toString('hex'));
  });

  it('les lots STAFF et VIP n’ont pas de code ; un lot clos non plus', async () => {
    for (const kind of ['STAFF', 'VIP']) {
      const batchId = await create({ kind });
      const res = await order(batchId);
      expect(res.status).toBe(409);
      expect(await rows('SELECT 1 FROM claim_code WHERE batch_id = $1', [batchId])).toEqual([]);
    }
    const closed = await create();
    expect((await api.post(w.orgAdmin, `${A()}/${closed}/closure`)).body.status).toBe('CLOSED');
    expect((await order(closed)).status).toBe(409);
  });

  it('seul l’administrateur de l’organisateur obtient le fichier', async () => {
    const batchId = await create({ quantity: 2 });
    for (const who of [w.operatorAdmin, w.supervisor, w.otherOrgAdmin]) expect((await order(batchId, randomUUID(), who)).status).toBe(403);
    expect((await order(batchId, randomUUID(), w.orgAdminB)).status).toBe(404);
    expect(await rows('SELECT 1 FROM claim_code WHERE batch_id = $1', [batchId])).toEqual([]);
    expect((await api.post(w.orgAdmin, `${A()}/${randomUUID()}/claim-code-order`)).status).toBe(404);
  });

  it('en production, le domaine des liens est obligatoire dès le démarrage', () => {
    const config = w.app.get<AppConfig>(APP_CONFIG, { strict: false });
    expect(config.claimCodeDomain).toBe('pay.cashless.test');
    expect(() => new ClaimCodesService({ production: true, claimCodeDomain: '' }, hasher, {} as never)).toThrow(/CLAIM_CODE_DOMAIN/);
    expect(() => new ClaimCodesService({ production: true, claimCodeDomain: 'pay.example.org' }, hasher, {} as never)).not.toThrow();
  });

  describe('import du fichier de l’imprimeur', () => {
    let batchId: string;
    let otherBatch: string;
    let codes: string[];
    let otherCodes: string[];
    let media: { id: string; uid: string }[];
    const path = () => `${A()}/${batchId}/claim-code-associations`;
    const dashed = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

    beforeAll(async () => {
      batchId = await create({ quantity: 8 });
      otherBatch = await create({ quantity: 2 });
      codes = codesOf((await order(batchId)).text);
      otherCodes = codesOf((await order(otherBatch)).text);
      media = await withOwner((db) => seedMedia(db, w.ops.a, batchId, KEY.shared, 6));
    });

    it('associe les lignes justes, refuse les autres par numéro de ligne et motif, sans jamais renvoyer un code', async () => {
      const file = [
        '\uFEFFcode,uid', // 1 : en-tête, précédé de la marque d'ordre des octets d'un tableur
        `${dashed(codes[0]!)},${media[0]!.uid}`, // 2 : acceptée (avec tiret)
        `${codes[1]!.toLowerCase()}, ${media[1]!.uid.toLowerCase()} `, // 3 : acceptée (minuscules, espaces)
        '', // 4 : ligne vide, ignorée
        `${codes[2]},${media[2]!.uid},en-trop`, // 5
        `${codes[2]!.slice(0, 9)}0,${media[2]!.uid}`, // 6 : caractère hors alphabet
        `${codes[2]},04ZZ`, // 7
        `${codes[2]},04FFFFFFFFFFFF`, // 8 : puce inconnue du lot
        `ZZZZZZZZZZ,${media[2]!.uid}`, // 9 : code jamais émis
        `${otherCodes[0]},${media[2]!.uid}`, // 10 : code d'un autre lot
        `${codes[0]},${media[3]!.uid}`, // 11 : code déjà associé (ligne 2)
        `${codes[3]},${media[0]!.uid}`, // 12 : bracelet qui porte déjà un code
        `${codes[4]},${media[4]!.uid}`, // 13 : acceptée
      ].join('\r\n');
      const res = await api.csv(w.orgAdmin, path(), file);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accepted: 3,
        rejected: [
          { line: 5, reason: 'MALFORMED_LINE' },
          { line: 6, reason: 'BAD_CLAIM_CODE' },
          { line: 7, reason: 'BAD_UID' },
          { line: 8, reason: 'MEDIA_UNKNOWN' },
          { line: 9, reason: 'CLAIM_CODE_UNKNOWN' },
          { line: 10, reason: 'CLAIM_CODE_OTHER_BATCH' },
          { line: 11, reason: 'CLAIM_CODE_ALREADY_ASSOCIATED' },
          { line: 12, reason: 'MEDIA_ALREADY_HAS_CODE' },
        ],
      });
      for (const code of [...codes, ...otherCodes]) expect(JSON.stringify(res.body)).not.toContain(code);
      const hash = (code: string) => hasher.claimCodeHash(code).toString('hex');
      expect(await rows(`SELECT encode(claim_code_hash, 'hex') AS h FROM media WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`, [[media[0]!.id, media[1]!.id, media[4]!.id, media[2]!.id]])).toEqual([
        { h: hash(codes[0]!) }, { h: hash(codes[1]!) }, { h: hash(codes[4]!) }, { h: null },
      ]);
      expect(await rows('SELECT count(*)::int AS n FROM claim_code WHERE batch_id = $1 AND media_id IS NOT NULL', [batchId])).toEqual([{ n: 3 }]);
      expect(await rows(`SELECT after FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'CLAIM_CODES_ASSOCIATED'`, [w.ops.a, batchId])).toEqual([{ after: { accepted: 3, rejected: 8 } }]);
      // Le fichier importé ne laisse aucun code en clair non plus (registre d'idempotence compris).
      expect(await findAtRest([...codes, ...otherCodes])).toEqual([]);
    });

    it('renvoyer le même fichier ne double rien : les lignes déjà faites sont refusées une à une', async () => {
      const res = await api.csv(w.orgAdmin, path(), `${codes[0]},${media[0]!.uid}\n${codes[5]},${media[5]!.uid}\n`);
      expect(res.body).toEqual({ accepted: 1, rejected: [{ line: 1, reason: 'CLAIM_CODE_ALREADY_ASSOCIATED' }] });
      expect(await rows('SELECT count(*)::int AS n FROM claim_code WHERE batch_id = $1 AND media_id IS NOT NULL', [batchId])).toEqual([{ n: 4 }]);
    });

    it('même clé d’idempotence, autre fichier : refusé ; même fichier : résultat rejoué', async () => {
      const key = randomUUID();
      const file = `ZZZZZZZZZZ,${media[3]!.uid}\n`;
      const first = await api.csv(w.orgAdmin, path(), file, key);
      const replay = await api.csv(w.orgAdmin, path(), file, key);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect((await api.csv(w.orgAdmin, path(), `YYYYYYYYYY,${media[3]!.uid}\n`, key)).status).toBe(409);
    });

    it('corps qui n’est pas un fichier, fichier trop long ou trop volumineux : 400', async () => {
      expect((await api.post(w.orgAdmin, path(), { code: codes[6], uid: media[3]!.uid })).status).toBe(400);
      const tooMany = Array.from({ length: MAX_ASSOCIATION_LINES + 1 }, () => 'x').join('\n');
      expect((await api.csv(w.orgAdmin, path(), tooMany)).status).toBe(400);
      expect((await api.csv(w.orgAdmin, path(), 'x'.repeat(1_100_000))).status).toBe(400);
      expect(await rows('SELECT count(*)::int AS n FROM claim_code WHERE batch_id = $1 AND media_id IS NOT NULL', [batchId])).toEqual([{ n: 4 }]);
    });

    it('rôles et isolation', async () => {
      const file = `${codes[6]},${media[3]!.uid}\n`;
      for (const who of [w.operatorAdmin, w.supervisor, w.otherOrgAdmin]) expect((await api.csv(who, path(), file)).status).toBe(403);
      expect((await api.csv(w.orgAdminB, path(), file)).status).toBe(404);
      expect((await api.csv(w.orgAdminB, `/v1/operators/${w.ops.b}/media-batches/${batchId}/claim-code-associations`, file)).status).toBe(404);
      expect(await rows('SELECT claim_code_hash FROM media WHERE id = $1', [media[3]!.id])).toEqual([{ claim_code_hash: null }]);
    });

    it('code invalidé pendant l’import (contrôle préalable passé) : la ligne porte le motif de la base', async () => {
      // Relecture du cycle 7 (correspondance fixe héritée du WP12) : la lecture préalable, sans verrou, ne voit pas
      // l'invalidation en cours ; associate_claim_code l'attend puis refuse. Le motif rendu est relu, pas fixé.
      const lone = await create({ quantity: 1 });
      const [code] = codesOf((await order(lone)).text);
      const [target] = await withOwner((db) => seedMedia(db, w.ops.a, lone, KEY.shared, 1));
      const res = await commitWhileWaiting(
        { sql: 'UPDATE claim_code SET invalidated_at = clock_timestamp() WHERE code_hash = $1', params: [hasher.claimCodeHash(code!)] },
        { role: 'cashless_app', statement: 'associate_claim_code' },
        () => api.csv(w.orgAdmin, `${A()}/${lone}/claim-code-associations`, `${code},${target!.uid}\n`),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accepted: 0, rejected: [{ line: 1, reason: 'CLAIM_CODE_INVALIDATED' }] });
      expect(await rows('SELECT claim_code_hash FROM media WHERE id = $1', [target!.id])).toEqual([{ claim_code_hash: null }]);
    });

    it('à la clôture, les codes jamais associés sont invalidés et ne s’associent plus', async () => {
      const res = await api.post(w.orgAdmin, `${A()}/${batchId}/closure`);
      expect(res.body).toEqual({ status: 'CLOSED', remaining_deposits: 0, retired_media: 6, invalidated_claim_codes: 4 });
      expect(await rows('SELECT count(*)::int AS n FROM claim_code WHERE batch_id = $1 AND invalidated_at IS NOT NULL', [batchId])).toEqual([{ n: 4 }]);
      expect((await api.csv(w.orgAdmin, path(), `${codes[6]},${media[3]!.uid}\n`)).body).toEqual({ accepted: 0, rejected: [{ line: 1, reason: 'CLAIM_CODE_INVALIDATED' }] });
    });
  });
});
