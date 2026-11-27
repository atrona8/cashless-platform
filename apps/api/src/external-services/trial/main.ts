// Commande d'essai par service (mission 12b-1, WP11 ; FR-014, interfaces.md §8) :
//   npm run essai -w @cashless/api -- <service> [--sandbox] [--return-url U] [--secret-ref R | --credentials F]
//                                      [--provider P] [--retention-days N] [--notification-url U]
// Exécute le parcours minimal du service contre le VRAI service (identifiants posés par le porteur) et écrit sur la
// sortie standard un compte rendu JSON sans secret, à commiter sous `docs/essais/<service>.json`.
// Codes : 0 tout `ok` ; 1 une étape en échec ou sortie refusée ; 2 arguments ou réglages invalides ; 3 production.
// Jamais en production, jamais d'écriture dans le grand livre, jamais d'identifiant en argument ni en variable.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../config/config';
import { PSP_PROVIDERS, type PspProviderName } from '../../psp/psp.types';
import { EXTERNAL_SERVICES, OUT_OF_SCOPE, type ExternalService } from '../services';
import type { TrialOptions } from './context';
import { looksSecret } from './report';
import { runTrial, type TrialDeps } from './runner';

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, PRODUCTION: 3 } as const;

export interface Parsed {
  service: ExternalService;
  options: TrialOptions;
}

const VALUE_FLAGS = {
  '--return-url': 'returnUrl',
  '--notification-url': 'notificationUrl',
  '--secret-ref': 'secretRef',
  '--credentials': 'credentialsFile',
  '--provider': 'provider',
  '--retention-days': 'retentionDays',
} as const;

/** Les messages nomment un argument, jamais sa valeur (une référence de secret n'est pas écrite). */
export function parseArgs(argv: readonly string[]): Parsed | { error: string } {
  const [service, ...rest] = argv;
  if (service === undefined || service.startsWith('--'))
    return { error: `service obligatoire ; attendus : ${EXTERNAL_SERVICES.join(', ')}` };
  if ((OUT_OF_SCOPE as readonly string[]).includes(service))
    return { error: 'service hors périmètre de la mission' };
  if (!(EXTERNAL_SERVICES as readonly string[]).includes(service))
    return { error: `service inconnu ; attendus : ${EXTERNAL_SERVICES.join(', ')}` };
  const found: Record<string, string> = {};
  let sandbox = false;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]!;
    if (flag === '--sandbox') {
      sandbox = true;
      continue;
    }
    const key = (VALUE_FLAGS as Record<string, string>)[flag];
    if (key === undefined) return { error: 'argument inconnu' };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--') || found[key] !== undefined)
      return { error: `argument ${flag} sans valeur ou répété` };
    found[key] = value;
    i += 1;
  }
  const options: TrialOptions = { sandbox };
  if (found.returnUrl !== undefined) options.returnUrl = found.returnUrl;
  if (found.notificationUrl !== undefined) options.notificationUrl = found.notificationUrl;
  if (found.secretRef !== undefined) options.secretRef = found.secretRef;
  if (found.credentialsFile !== undefined) options.credentialsFile = found.credentialsFile;
  if (found.provider !== undefined) {
    if (!(PSP_PROVIDERS as readonly string[]).includes(found.provider))
      return { error: '--provider : fournisseur inconnu' };
    options.provider = found.provider as PspProviderName;
  }
  if (found.retentionDays !== undefined) {
    if (!/^[0-9]{1,5}$/.test(found.retentionDays) || Number(found.retentionDays) < 1)
      return { error: '--retention-days : entier de 1 à 36500' };
    options.retentionDays = Number(found.retentionDays);
    if (options.retentionDays > 36500) return { error: '--retention-days : entier de 1 à 36500' };
  }
  const isPsp = service.startsWith('psp.') && service !== 'psp.secrets';
  if (isPsp && (options.secretRef === undefined) === (options.credentialsFile === undefined))
    return { error: 'un PSP exige --secret-ref ou --credentials, l’un des deux seulement' };
  if (
    service === 'psp.secrets' &&
    (options.secretRef === undefined || options.provider === undefined)
  )
    return { error: 'psp.secrets exige --secret-ref et --provider' };
  return { service: service as ExternalService, options };
}

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export interface Overrides {
  readFile?: TrialDeps['readFile'];
  now?: TrialDeps['now'];
  newId?: TrialDeps['newId'];
}

/** Point d'entrée testable : rend le code de sortie. `env` : `process.env` ou un jeu de test. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Io,
  overrides: Overrides = {},
): Promise<number> {
  // Refus avant toute autre lecture : un essai ne tourne jamais en production.
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    io.err(
      'essai refusé : NODE_ENV=production (la commande vise le vrai service, hors production)\n',
    );
    return EXIT.PRODUCTION;
  }
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.err(`essai : ${parsed.error}\n`);
    return EXIT.USAGE;
  }
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    io.err(`essai : réglages invalides (${error instanceof Error ? error.message : 'erreur'})\n`);
    return EXIT.USAGE;
  }
  if (config.production) {
    io.err('essai refusé : configuration de production\n');
    return EXIT.PRODUCTION;
  }
  const { report, seen } = await runTrial(parsed.service, parsed.options, {
    config,
    readFile: overrides.readFile ?? ((path) => readFileSync(path, 'utf8')),
    now: overrides.now ?? (() => new Date()),
    newId: overrides.newId ?? randomUUID,
  });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  // Dernier rempart : une valeur lue dans le coffre, une référence, le compartiment, ou tout ce qui ressemble à un
  // secret n'est jamais écrit.
  if (seen.some((value) => value.length > 0 && text.includes(value)) || looksSecret(text)) {
    io.err('essai : sortie refusée, elle contiendrait une valeur secrète ou qui y ressemble\n');
    return EXIT.FAILED;
  }
  io.out(text);
  if (report.service !== parsed.service)
    io.err(
      'essai en bac à sable : ce compte rendu ne prouve pas le service réel, ne pas le déposer dans docs/essais\n',
    );
  return report.ok ? EXIT.OK : EXIT.FAILED;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write('essai : erreur inattendue\n');
      process.exitCode = EXIT.FAILED;
    },
  );
}
