import { makeRep, hex, q, uid, type Rep } from './_support/harness';

// Canari : octets sentinelles placés dans le colis chiffré et la clé scellée. Le colis reste
// chiffré de bout en bout ; aucune de ses variantes ne doit sortir en clair vers la base (hors
// colonne chiffrée), les journaux ou la sortie du processus.
const CANARY = 'CANARI-MDP-0123456789';
const variants = (s: string): string[] => {
  const buf = Buffer.from(s, 'utf8');
  return [
    s,
    buf.toString('hex'),
    buf.toString('hex').toUpperCase(),
    buf.toString('base64'),
    buf.toString('base64url'),
  ];
};
const blob = {
  nonce: Buffer.from('nonce-nonce1').toString('base64'),
  ciphertext: Buffer.from('chiffre-opaque').toString('base64'),
  tag: Buffer.from('tag-tag-tag-tag-').toString('base64'),
};

let r: Rep;
beforeEach(async () => {
  r = await makeRep();
});
afterEach(async () => {
  await r.close();
});

async function dump(): Promise<string> {
  // contenu textuel de toutes les tables SAUF les colonnes chiffrées, rendu en texte
  const tables = await q<{ table_name: string }>(
    r,
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  let out = '';
  for (const { table_name } of tables) {
    const cols = await q<{ column_name: string }>(
      r,
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1
        AND column_name NOT IN ('pwd_pack_enc', 'sealed_key')`,
      [table_name],
    );
    if (cols.length === 0) continue;
    const list = cols.map((c) => `"${c.column_name}"::text`).join(', ');
    const res = await r.db.pool.query(`SELECT ${list} FROM "${table_name}"`);
    out += JSON.stringify(res.rows);
  }
  return out;
}

/** Le détecteur réel : variantes du canari trouvées dans la base (hors colonnes chiffrées) ou les journaux. */
function leaks(haystack: string): string[] {
  return variants(CANARY).filter((v) => haystack.includes(v));
}
async function capture(fn: () => Promise<void> | void): Promise<string> {
  const logged: string[] = [];
  const spies = (['log', 'warn', 'error'] as const).map((k) =>
    jest.spyOn(console, k).mockImplementation((...a: unknown[]) => void logged.push(a.join(' '))),
  );
  const out = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((c: unknown) => (logged.push(String(c)), true));
  const err = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation((c: unknown) => (logged.push(String(c)), true));
  try {
    await fn();
  } finally {
    [...spies, out, err].forEach((x) => x.mockRestore());
  }
  return logged.join('\n');
}

describe('NFR-010 : aucun mot de passe en clair', () => {
  it('canari dans un colis : absent de la base (hors colonne chiffrée), des journaux et de la sortie', async () => {
    const logs = await capture(async () => {
      r.feed.queue.push(
        r.page(
          {
            media: [
              {
                token_hash: hex(3),
                nfc_uid: '04aabbccddeeff',
                key_index: 1,
                status: 'ACTIVE',
                pwd_pack_enc: { ...blob, ciphertext: Buffer.from(CANARY).toString('base64') },
                pwd_pack_sha256: 'f'.repeat(64),
              },
            ],
            pwd_pack_key: {
              alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
              epk: 'ZXBr',
              iv: 'aXZpdml2aXZpdg==',
              wrapped_key: 'd3JhcHBlZA==',
            },
          },
          {
            to_change_seq: 1,
            devices: [
              {
                device_id: uid(),
                serial: 'T',
                kind: 'POS',
                app_mode: null,
                status: 'ACTIVE',
                public_key: 'cHVi',
                cert_sha256: 'a'.repeat(64),
              },
            ],
          },
        ),
      );
      await r.svc.pullOnce();
      // page refusée : le message d’erreur ne reprend pas le contenu
      r.feed.queue.push(r.page({ wallets: [{ wallet_id: 'pas-un-uuid', pwd: CANARY }] }));
      await expect(r.svc.pullOnce()).rejects.toThrow();
    });
    const haystack = (await dump()) + logs;
    // le colis est bien stocké, chiffré (la colonne chiffrée n’est pas fouillée : elle
    // porte le canari en base64)
    expect(await q(r, 'SELECT 1 FROM edge_media WHERE pwd_pack_enc IS NOT NULL')).toHaveLength(1);
    expect(leaks(haystack)).toEqual([]);
  });

  it('contrôle positif : canari journalisé ou écrit en clair dans une colonne -> le détecteur réel le voit', async () => {
    // 1. journal fautif réel : le code journalise le canari (base64url, hex)
    const logs = await capture(() => {
      console.warn(`colis=${Buffer.from(CANARY).toString('base64url')}`);
      process.stderr.write(Buffer.from(CANARY).toString('hex'));
    });
    expect(leaks(logs).length).toBeGreaterThanOrEqual(2);
    // 2. colonne en clair fautive : le canari est écrit dans une table non chiffrée
    await r.db.pool.query(
      `INSERT INTO edge_vendor (vendor_id, display_name, status) VALUES ($1, $2, 'ACTIVE')`,
      [uid(), CANARY],
    );
    expect(leaks(await dump())).toContain(CANARY);
  });
});
