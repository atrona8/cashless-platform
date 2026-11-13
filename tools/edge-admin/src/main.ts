// Outil d'administration des passerelles : `npm run edge-admin -w @cashless/edge-admin -- <commande> ...`
// Codes de sortie : 0 réussi, 2 refus de la base (message résumé), 1 panne ou usage. Toute sortie passe par `redact`.
import { constants } from 'node:fs';
import { access, chmod, open, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { assertEdgeAdminUrl, openAdminDb, type AdminDb } from './db';
import {
  CliError,
  FormatError,
  register,
  revoke,
  rotateCert,
  swapRoles,
  type Deps,
  type Io,
} from './commands';
import { redact } from './redact';

const COMMON = { by: { type: 'string' }, operator: { type: 'string' } } as const;
const SPECS = {
  register: {
    ...COMMON,
    request: { type: 'string' },
    event: { type: 'string' },
    ledger: { type: 'string' },
    serial: { type: 'string' },
    role: { type: 'string' },
    'lan-url': { type: 'string' },
    out: { type: 'string' },
    'central-url': { type: 'string' },
    'central-ca-file': { type: 'string' },
    'device-ca-file': { type: 'string' },
    'site-key-a': { type: 'string' },
    'site-holder-a': { type: 'string' },
    'site-key-b': { type: 'string' },
    'site-holder-b': { type: 'string' },
  },
  revoke: { ...COMMON, gateway: { type: 'string' }, reason: { type: 'string' } },
  'rotate-cert': {
    ...COMMON,
    gateway: { type: 'string' },
    request: { type: 'string' },
    out: { type: 'string' },
  },
  'swap-roles': { ...COMMON, old: { type: 'string' }, new: { type: 'string' } },
} as const;

const DB_REFUSAL = /^(CL\d{3}|P0002|23\d{3}|22\d{3}|42501)$/;

export function realDeps(env: NodeJS.ProcessEnv, io: Io): Deps {
  let db: AdminDb | null = null;
  return {
    env,
    io,
    now: () => new Date(),
    db() {
      db ??= openAdminDb(assertEdgeAdminUrl(env.DATABASE_URL_EDGEADMIN));
      return db;
    },
    readText: (path) => readFile(path, 'utf8'),
    async writeExclusive(path, content) {
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
      await chmod(path, 0o600);
    },
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    async ca() {
      if (env.EDGE_CA === 'fake') {
        if (env.NODE_ENV === 'production')
          throw new CliError(
            'EDGE_CA : le faux est interdit en production (autorité réelle : mission 12b)',
          );
        const { FakeEdgeCa } = await import('../../../apps/api/src/edge/ca/fake-edge-ca');
        return FakeEdgeCa.inMemory();
      }
      throw new CliError(
        env.EDGE_CA
          ? 'EDGE_CA : adaptateur réel non disponible (mission 12b)'
          : 'EDGE_CA obligatoire (fake en développement)',
      );
    },
  };
}

/** Ferme la base ouverte par la commande, quoi qu'il arrive. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Io,
  make: (env: NodeJS.ProcessEnv, io: Io) => Deps = realDeps,
): Promise<number> {
  const safe: Io = { out: (l) => io.out(redact(l)), err: (l) => io.err(redact(l)) };
  const deps = make(env, safe);
  const [command, ...rest] = argv;
  const used: { db?: AdminDb } = {};
  const original = deps.db;
  deps.db = () => (used.db ??= original());
  try {
    if (!command || !(command in SPECS))
      throw new CliError('commande : register | revoke | rotate-cert | swap-roles');
    const { values } = parseArgs({
      args: [...rest],
      options: SPECS[command as keyof typeof SPECS] as never,
      strict: true,
    });
    const v = values as Record<string, string | undefined>;
    switch (command) {
      case 'register':
        return await register(
          {
            request: v.request,
            operator: v.operator,
            event: v.event,
            ledger: v.ledger,
            serial: v.serial,
            role: v.role,
            lanUrl: v['lan-url'],
            by: v.by,
            out: v.out,
            centralUrl: v['central-url'],
            centralCaFile: v['central-ca-file'],
            deviceCaFile: v['device-ca-file'],
            siteKeyA: v['site-key-a'],
            siteHolderA: v['site-holder-a'],
            siteKeyB: v['site-key-b'],
            siteHolderB: v['site-holder-b'],
          },
          deps,
        );
      case 'revoke':
        return await revoke(v, deps);
      case 'rotate-cert':
        return await rotateCert(v, deps);
      default:
        return await swapRoles(v, deps);
    }
  } catch (error) {
    return report(error, command, safe);
  } finally {
    await used.db?.close().catch(() => undefined);
  }
}

function report(error: unknown, command: string | undefined, io: Io): number {
  if (error instanceof CliError || error instanceof FormatError) {
    io.err(`Refus : ${error.message}`);
    return 1;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && DB_REFUSAL.test(code)) {
    const message = (error as Error).message;
    io.err(`Refus de la base (${code}) : ${message}`);
    if (code === 'CL013' && command === 'revoke')
      io.err('Un handover est ouvert : passer par la reprise forcée à deux.');
    if (command === 'swap-roles')
      io.err(
        'Rappel : un échange réussi fait repartir le délai de 30 minutes avant les mots de passe.',
      );
    return 2;
  }
  if (
    error instanceof TypeError ||
    (error as { code?: unknown }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
  )
    io.err(`Refus : usage incorrect (${(error as Error).message})`);
  else
    io.err(
      'Panne : base injoignable, identifiants refusés ou erreur interne (aucun détail affiché).',
    );
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, {
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  }).then((code) => process.exit(code));
}
