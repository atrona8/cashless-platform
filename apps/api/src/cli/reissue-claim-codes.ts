// Commande d'exploitation `reissue-claim-codes` (mission serveur-app-festivalier, WP08 ; FR-007, FR-008, SC-003).
// Après une rotation du secret des codes de rattachement, tire de nouveaux codes pour les bracelets d'un lot PUBLIC
// sans code ou au code d'une ancienne version jamais utilisé, les enregistre sous le rôle `cashless_claimadmin` (aucun
// droit de table : `reissuable_media`, `reissue_claim_codes` et `claim_key_version_max` seulement) et écrit le fichier
// de commande `rank,code,url,uid,printed_number` (mode 0600, jamais écrasé). Le code en clair n'existe qu'en mémoire et dans ce fichier :
// ni sortie standard (le nombre seul), ni erreur, ni base, ni journal.
//
// Ordre sûr : la base refuse de réémettre un code de la version courante, donc un code perdu serait irrécupérable.
// Le fichier est donc écrit (et synchronisé) AVANT l'appel de base, et supprimé si la base refuse.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { closeSync, fchmodSync, fsyncSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { claimCodeUrl, formatClaimCode, generateClaimCode } from '@cashless/tag-format';
import { claimAdminSettings } from '../config/config';
import {
  type ClaimAdminConnection,
  openClaimAdminConnection,
  RoleRefused,
} from '../db/claim-admin-connection';
import { ClaimHasher } from '../kms/claim-hash';

/** Codes de sortie (contracts/claim-code-rotation.md). */
export const EXIT = { OK: 0, ERROR: 1, BATCH: 2, NOTHING: 3 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAW_ATTEMPTS = 3;

export interface Args {
  operator: string;
  batch: string;
  out: string;
}

/** Arguments `--operator`, `--batch`, `--out`, tous obligatoires, aucun autre. Le message n'écrit jamais la valeur. */
export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const found: Partial<Record<keyof Args, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    const key =
      flag === '--operator'
        ? 'operator'
        : flag === '--batch'
          ? 'batch'
          : flag === '--out'
            ? 'out'
            : null;
    if (key === null) return { error: 'argument inconnu ; attendu : --operator, --batch, --out' };
    if (value === undefined || value.startsWith('--') || found[key] !== undefined)
      return { error: `argument ${flag} sans valeur ou répété` };
    found[key] = value;
  }
  for (const key of ['operator', 'batch', 'out'] as const)
    if (!found[key]) return { error: `argument --${key} obligatoire` };
  if (!UUID.test(found.operator!)) return { error: '--operator : identifiant mal formé' };
  if (!UUID.test(found.batch!)) return { error: '--batch : identifiant mal formé' };
  return found as Args;
}

/** Code de sortie d'une erreur de base : lot non PUBLIC (CL020) ou introuvable : 2 ; le reste : 1. Pure. */
export function exitCodeForSqlState(code: string | undefined): number {
  return code === 'CL020' || code === 'P0002' ? EXIT.BATCH : EXIT.ERROR;
}

const sqlState = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

interface Drawn {
  codes: string[];
  hashes: Buffer[];
}

function draw(hasher: ClaimHasher, quantity: number): Drawn {
  const byHash = new Map<string, string>();
  while (byHash.size < quantity) {
    const code = generateClaimCode(randomBytes);
    byHash.set(hasher.claimCodeHash(code).toString('hex'), code);
  }
  const hashes = [...byHash.keys()].map((hex) => Buffer.from(hex, 'hex'));
  return { codes: [...byHash.values()], hashes };
}

/** Écrit le fichier de commande : création exclusive en 0600, synchronisé ; supprimé si l'écriture échoue. */
interface Bracelet {
  media_id: string;
  rank: number;
  nfc_uid: Buffer | null;
  printed_number: string | null;
}

function writeOrderFile(
  path: string,
  domain: string,
  codes: readonly string[],
  bracelets: readonly Bracelet[],
): void {
  const fd = openSync(path, 'wx', 0o600); // échoue si le fichier existe : jamais d'écrasement
  try {
    fchmodSync(fd, 0o600);
    const lines = ['rank,code,url,uid,printed_number'];
    codes.forEach((code, i) => {
      const b = bracelets[i]!;
      const uid = b.nfc_uid!.toString('hex');
      lines.push(
        `${b.rank},${formatClaimCode(code)},${claimCodeUrl(domain, code)},${uid},${b.printed_number ?? ''}`,
      );
    });
    writeSync(fd, `${lines.join('\n')}\n`);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    removeQuietly(path);
    throw error;
  }
  closeSync(fd);
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // déjà absent
  }
}

/** Exécute la commande ; rend le code de sortie. Écrit sur `out` le nombre seul, sur `err` les messages sans code. */
export async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  const args = parseArgs(argv);
  if ('error' in args) {
    err(`reissue-claim-codes : ${args.error}\n`);
    return EXIT.ERROR;
  }
  let settings: ReturnType<typeof claimAdminSettings>;
  try {
    settings = claimAdminSettings(env);
  } catch (error) {
    err(`reissue-claim-codes : configuration refusée : ${(error as Error).message}\n`);
    return EXIT.ERROR;
  }
  if (!env.DATABASE_URL_CLAIMADMIN) {
    err('reissue-claim-codes : DATABASE_URL_CLAIMADMIN manquant\n');
    return EXIT.ERROR;
  }
  const hasher = new ClaimHasher({
    claimCodeHmacKey: settings.claimCodeHmacKey,
    claimCodeKeyVersion: settings.claimCodeKeyVersion,
  });
  const version = hasher.keyVersion;
  let client: ClaimAdminConnection | undefined;
  let written = false;
  try {
    client = await openClaimAdminConnection(settings.claimAdminDatabaseUrl, settings.production);
    const max = (await client.query<{ v: number }>('SELECT claim_key_version_max() AS v')).rows[0]!
      .v;
    if (version < max) {
      err(
        `reissue-claim-codes : version du secret ${version} inférieure à la version ${max} de la base ` +
          '(rotation à l’envers) ; rien n’est écrit\n',
      );
      return EXIT.ERROR;
    }
    const list = (
      await client.query<Bracelet>(
        `SELECT media_id, rank, nfc_uid, printed_number
           FROM reissuable_media($1, $2, $3::smallint) ORDER BY rank`,
        [args.operator, args.batch, version],
      )
    ).rows;
    if (list.length === 0) {
      err('reissue-claim-codes : aucun bracelet à réémettre dans ce lot\n');
      return EXIT.NOTHING;
    }
    // Le fichier nomme le bracelet de chaque code : un bracelet sans UID rend la réémission entière impossible.
    if (list.some((row) => row.nfc_uid === null)) {
      err('reissue-claim-codes : un bracelet du lot n’a pas d’UID ; rien n’est écrit\n');
      return EXIT.ERROR;
    }
    const media = list.map((row) => row.media_id);
    for (let attempt = 1; ; attempt += 1) {
      const drawn = draw(hasher, media.length);
      writeOrderFile(args.out, settings.claimCodeDomain, drawn.codes, list);
      written = true;
      let phase: 'database' | 'commit' = 'database';
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ n: number }>(
          'SELECT reissue_claim_codes($1, $2, $3::uuid[], $4::bytea[], $5::smallint) AS n',
          [args.operator, args.batch, media, drawn.hashes, version],
        );
        phase = 'commit';
        await client.query('COMMIT');
        out(`${rows[0]!.n}\n`);
        return EXIT.OK;
      } catch (error) {
        if (phase === 'commit') {
          // Issue incertaine : la base a peut-être enregistré les codes. Le fichier est conservé, jamais supprimé.
          err(
            'reissue-claim-codes : validation de la base d’issue incertaine ; le fichier est conservé, ' +
              'vérifier avant toute relance\n',
          );
          return EXIT.ERROR;
        }
        await client.query('ROLLBACK').catch(() => undefined);
        removeQuietly(args.out);
        written = false;
        // Empreinte déjà prise chez un autre prestataire (invisible d'ici) : nouveau tirage, comme issueOrder.
        if (sqlState(error) === '23505' && attempt < DRAW_ATTEMPTS) continue;
        throw error;
      }
    }
  } catch (error) {
    if (written) removeQuietly(args.out);
    const state = sqlState(error);
    const fileError =
      state === 'EEXIST' || state === 'ENOENT' || state === 'EACCES' || state === 'ENOSPC';
    if (error instanceof RoleRefused) {
      err(`reissue-claim-codes : ${error.message}\n`);
      return EXIT.ERROR;
    }
    err(
      fileError
        ? `reissue-claim-codes : fichier de sortie inutilisable (${state}) ; rien n’est écrit en base\n`
        : state && /^[0-9A-Z]{5}$/.test(state)
          ? `reissue-claim-codes : refus de la base (SQLSTATE ${state})\n`
          : 'reissue-claim-codes : échec ; rien n’est écrit\n',
    );
    return fileError ? EXIT.ERROR : exitCodeForSqlState(state);
  } finally {
    await client?.end().catch(() => undefined);
  }
}

if (require.main === module) {
  run(
    process.argv.slice(2),
    process.env,
    (text) => process.stdout.write(text),
    (text) => process.stderr.write(text),
  ).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write('reissue-claim-codes : échec inattendu\n');
      process.exitCode = EXIT.ERROR;
    },
  );
}
