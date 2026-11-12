// Commandes de l'outil d'administration (WP15, T066 et T067). A FAIRE RELIRE PAR UNE PERSONNE (CLAUDE.md, règle 4).
// Écart accepté (OP-N105, ADR-160) : l'inscription est faite par UNE personne ; l'étiquette `--by` n'authentifie pas
// cette personne (l'outil ne crée aucune identité). Compensation : alerte `EDGE_REGISTERED` levée par la base à
// l'instant de l'inscription, et délai avant l'envoi des mots de passe (réglage de plateforme `pack_delay_seconds`).
// Rien ici ne contourne ce délai. Décision 27 : deux titulaires nominatifs distincts et deux clés de site distinctes.
import { createHash, X509Certificate } from 'node:crypto';
import type { EdgeCaPort } from '../../../apps/api/src/edge/edge-ca.port';
import type { AdminDb } from './db';
import {
  assertHttpsUrl,
  checkCsr,
  FormatError,
  lanAuthority,
  normalizeHolder,
  parseRequestFile,
  parseSiteKey,
  serializeEnrollment,
  UUID,
  type EnrollmentFile,
} from './enrollment-format';
import { shortFingerprint } from './redact';

export const DEFAULT_PACK_DELAY_SECONDS = 1800;

/** Erreur d'usage ou de configuration : code de sortie 1 (jamais d'appel à la base). */
export class CliError extends Error {}

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

export interface Deps {
  env: NodeJS.ProcessEnv;
  io: Io;
  now(): Date;
  /** Base ouverte à la demande, après toutes les validations. */
  db(): AdminDb;
  readText(path: string): Promise<string>;
  /** Création exclusive en 0600 ; refuse d'écraser. */
  writeExclusive(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  ca(): Promise<EdgeCaPort>;
}

export function auditLabel(value: string | undefined, env: NodeJS.ProcessEnv): string {
  const label = (value ?? env.EDGE_ADMIN_LABEL ?? '').trim();
  if (label.length < 3 || label.length > 80)
    throw new CliError('--by (ou EDGE_ADMIN_LABEL) : étiquette de 3 à 80 caractères obligatoire');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(label))
    throw new CliError('--by : caractères de contrôle interdits');
  return label;
}

function uuid(value: string | undefined, flag: string): string {
  if (!value || !UUID.test(value)) throw new CliError(`${flag} : UUID attendu`);
  return value.toLowerCase();
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new CliError(`${flag} : obligatoire`);
  return value.trim();
}

/** Autorité des passerelles : refus du faux en production, avant tout fichier lu et tout appel à la base. */
export async function resolveCa(deps: Deps): Promise<EdgeCaPort> {
  const ca = await deps.ca();
  if (ca.isFake && deps.env.NODE_ENV === 'production')
    throw new CliError(
      'EDGE_CA : le faux est interdit en production (autorité réelle : mission 12b)',
    );
  return ca;
}

export interface RegisterArgs {
  request?: string;
  operator?: string;
  event?: string;
  ledger?: string;
  serial?: string;
  role?: string;
  lanUrl?: string;
  by?: string;
  out?: string;
  centralUrl?: string;
  centralCaFile?: string;
  deviceCaFile?: string;
  siteKeyA?: string;
  siteHolderA?: string;
  siteKeyB?: string;
  siteHolderB?: string;
}

async function readKeyArg(deps: Deps, value: string): Promise<string> {
  return value.includes('BEGIN') || !(await deps.exists(value)) ? value : deps.readText(value);
}

export async function register(args: RegisterArgs, deps: Deps): Promise<number> {
  const ca = await resolveCa(deps);
  const label = auditLabel(args.by, deps.env);
  const operator = uuid(args.operator, '--operator');
  const event = uuid(args.event, '--event');
  const ledger = uuid(args.ledger, '--ledger');
  const serial = required(args.serial, '--serial');
  const role = required(args.role, '--role');
  if (role !== 'PRIMARY' && role !== 'STANDBY') throw new CliError('--role : PRIMARY ou STANDBY');
  const lanUrl = required(args.lanUrl, '--lan-url');
  const allowHttp = deps.env.NODE_ENV !== 'production';
  const centralUrl = assertHttpsUrl(
    required(args.centralUrl, '--central-url'),
    '--central-url',
    allowHttp,
  );
  // Décision 27 : deux titulaires nominatifs distincts, deux clés de site distinctes.
  const holderA = required(args.siteHolderA, '--site-holder-a');
  const holderB = required(args.siteHolderB, '--site-holder-b');
  for (const holder of [holderA, holderB])
    if (holder.length < 3 || holder.length > 80)
      throw new CliError('titulaires de clé de site : 3 à 80 caractères');
  if (normalizeHolder(holderA) === normalizeHolder(holderB))
    throw new CliError(
      'deux titulaires nominatifs distincts exigés pour les clés de site (décision 27)',
    );
  const keyA = parseSiteKey(await readKeyArg(deps, required(args.siteKeyA, '--site-key-a')));
  const keyB = parseSiteKey(await readKeyArg(deps, required(args.siteKeyB, '--site-key-b')));
  if (keyA.equals(keyB)) throw new CliError('deux clés de site distinctes exigées (décision 27)');
  const outPath = args.out ?? `enrolment-${serial.replace(/[^0-9A-Za-z._-]/g, '_')}.json`;
  if (await deps.exists(outPath)) throw new CliError(`${outPath} existe déjà : refus d'écraser`);

  const request = parseRequestFile(await deps.readText(required(args.request, '--request')));
  if (request.serial !== serial) throw new CliError('--serial : différent de la demande');
  if (request.role !== role) throw new CliError('--role : différent de la demande');
  if (request.lanUrl !== lanUrl) throw new CliError('--lan-url : différente de la demande');
  await checkCsr(request);
  const centralCa = await deps.readText(required(args.centralCaFile, '--central-ca-file'));
  const deviceCa = await deps.readText(required(args.deviceCaFile, '--device-ca-file'));
  for (const pem of [centralCa, deviceCa]) {
    try {
      new X509Certificate(pem);
    } catch {
      throw new CliError('autorité fournie : certificat PEM illisible');
    }
  }
  const authority = lanAuthority(lanUrl);

  const certPem = await ca.issue(request.csrPem, serial);
  const certDigest = createHash('sha256').update(new X509Certificate(certPem).raw).digest();

  const gatewayId = await deps.db().withOperator(operator, async (session) => {
    const id = await session.call('register_edge_gateway', [
      operator,
      event,
      serial,
      role,
      certDigest,
      request.batchPublicKey,
      request.agreementPublicKey,
      lanUrl,
      label,
    ]);
    if (typeof id !== 'string') throw new Error('identifiant de passerelle non rendu');
    await session.call('edge_register_snapshot_key', [
      id,
      request.snapshotKeyId,
      request.snapshotPublicKey,
      label,
    ]);
    return id;
  });

  const file: EnrollmentFile = {
    gateway_id: gatewayId,
    operator_id: operator,
    event_id: event,
    ledger_id: ledger,
    serial,
    role,
    central_url: centralUrl.toString(),
    central_ca_pem: centralCa,
    device_ca_pem: deviceCa,
    client_cert_pem: certPem,
    lan_authority: authority,
    site_order_keys: [
      { holder: holderA, public_key: keyA.toString('base64') },
      { holder: holderB, public_key: keyB.toString('base64') },
    ],
  };
  await deps.writeExclusive(outPath, serializeEnrollment(file));
  const effective = new Date(deps.now().getTime() + DEFAULT_PACK_DELAY_SECONDS * 1000);
  deps.io.out(
    `Passerelle inscrite : ${gatewayId} (${role}), certificat ${shortFingerprint(certDigest)}`,
  );
  deps.io.out(`Fichier d'enrôlement (usage unique, 0600, à détruire après usage) : ${outPath}`);
  deps.io.out(
    `Mots de passe de bracelet : au plus tôt ${effective.toISOString()} (délai par défaut de ` +
      `${DEFAULT_PACK_DELAY_SECONDS / 60} minutes ; le réglage de plateforme fait foi).`,
  );
  deps.io.out(
    "ATTENTION : l'alerte EDGE_REGISTERED a été levée (inscription par une seule personne).",
  );
  return 0;
}

export async function revoke(
  args: { gateway?: string; operator?: string; reason?: string; by?: string },
  deps: Deps,
): Promise<number> {
  const label = auditLabel(args.by, deps.env);
  const operator = uuid(args.operator, '--operator');
  const gateway = uuid(args.gateway, '--gateway');
  const reason = required(args.reason, '--reason');
  await deps
    .db()
    .withOperator(operator, (s) => s.call('revoke_edge_gateway', [gateway, reason, label]));
  deps.io.out(`Passerelle ${gateway} révoquée.`);
  return 0;
}

export async function rotateCert(
  args: { gateway?: string; operator?: string; request?: string; by?: string; out?: string },
  deps: Deps,
): Promise<number> {
  const ca = await resolveCa(deps);
  const label = auditLabel(args.by, deps.env);
  const operator = uuid(args.operator, '--operator');
  const gateway = uuid(args.gateway, '--gateway');
  const outPath = required(args.out, '--out');
  if (await deps.exists(outPath)) throw new CliError(`${outPath} existe déjà : refus d'écraser`);
  const request = parseRequestFile(await deps.readText(required(args.request, '--request')));
  await checkCsr(request);
  const certPem = await ca.issue(request.csrPem, request.serial);
  const digest = createHash('sha256').update(new X509Certificate(certPem).raw).digest();
  await deps
    .db()
    .withOperator(operator, (s) => s.call('rotate_edge_gateway_cert', [gateway, digest, label]));
  await deps.writeExclusive(outPath, certPem);
  deps.io.out(`Certificat de ${gateway} remplacé (${shortFingerprint(digest)}) : ${outPath}`);
  deps.io.out("L'ancienne empreinte est refusée dès maintenant.");
  return 0;
}

export async function swapRoles(
  args: { old?: string; new?: string; operator?: string; by?: string },
  deps: Deps,
): Promise<number> {
  const label = auditLabel(args.by, deps.env);
  const operator = uuid(args.operator, '--operator');
  const oldId = uuid(args.old, '--old');
  const newId = uuid(args.new, '--new');
  await deps
    .db()
    .withOperator(operator, (s) => s.call('swap_edge_gateway_roles', [oldId, newId, label]));
  deps.io.out(
    `Rôles échangés : ${newId} est PRIMARY, ${oldId} est STANDBY. Alerte EDGE_ROLE_CHANGED levée.`,
  );
  deps.io.out("Le délai avant l'envoi des mots de passe repart pour la nouvelle PRIMARY.");
  return 0;
}

export { FormatError };
