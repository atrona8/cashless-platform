// Amorçage du premier administrateur de la plateforme (contracts/identity.md « Amorçage », FR-014).
// Rôle d'exécution : le propriétaire des tables (DATABASE_URL_OWNER) — les lignes de plateforme (operator_id NULL)
// sont invisibles sous RLS pour le rôle applicatif. Idempotent : relancée, la commande ne crée rien.
//   npm run bootstrap-admin -w @cashless/ledger-sql -- --issuer <iss> --subject <sub> --name <nom> [--email <e>] [--phone <p>]
import { parseArgs } from 'node:util';
import { Client } from 'pg';

export interface BootstrapAdminInput {
  issuer: string;
  subject: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface BootstrapAdminResult {
  created: boolean;
  userId: string;
}

export function parseBootstrapArgs(argv: string[]): BootstrapAdminInput {
  const { values } = parseArgs({
    args: argv,
    options: {
      issuer: { type: 'string' },
      subject: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
    },
    strict: true,
  });
  const { issuer, subject, name, email, phone } = values;
  if (!issuer || !subject || !name) throw new Error('--issuer, --subject et --name sont obligatoires.');
  if (!email && !phone) throw new Error('--email ou --phone est obligatoire.');
  return { issuer, subject, name, email, phone };
}

/** Crée la personne de plateforme et son attribution PLATFORM_ADMIN si absentes, avec une ligne d'audit. */
export async function bootstrapAdmin(client: Client, input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  await client.query('BEGIN');
  try {
    // Deux lancements simultanés : le second attend le premier puis voit la personne créée.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bootstrap-admin', 0))");
    const { rows: existing } = await client.query<{ id: string; admin: boolean }>(
      `SELECT u.id, EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = u.id AND ra.role = 'PLATFORM_ADMIN'
                                AND ra.revoked_at IS NULL) AS admin
         FROM app_user u WHERE u.issuer = $1 AND u.subject = $2`,
      [input.issuer, input.subject],
    );
    const person = existing[0];
    if (person?.admin) {
      await client.query('ROLLBACK');
      return { created: false, userId: person.id };
    }
    if (person) {
      // Personne existante sans attribution active : l'amorçage ne réécrit pas une identité déjà enregistrée.
      throw new Error(`La personne (${input.issuer}, ${input.subject}) existe sans rôle PLATFORM_ADMIN : amorçage refusé.`);
    }
    const { rows: users } = await client.query<Record<string, unknown> & { id: string }>(
      `INSERT INTO app_user (operator_id, issuer, subject, email, phone, display_name, created_by)
       VALUES (NULL, $1, $2, $3, $4, $5, NULL) RETURNING *`,
      [input.issuer, input.subject, input.email ?? null, input.phone ?? null, input.name],
    );
    const user = users[0]!;
    const { rows: assignments } = await client.query(
      `INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
       VALUES ($1, 'PLATFORM_ADMIN', 'PLATFORM', NULL, NULL) RETURNING *`,
      [user.id],
    );
    await client.query(
      `INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
       VALUES (NULL, NULL, NULL, 'PLATFORM_ADMIN_BOOTSTRAPPED', 'app_user', $1, $2, 'bootstrap-admin')`,
      [user.id, JSON.stringify({ person: user, assignment: assignments[0] })],
    );
    await client.query('COMMIT');
    return { created: true, userId: user.id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const input = parseBootstrapArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL_OWNER;
  if (!connectionString) {
    throw new Error('DATABASE_URL_OWNER non défini (rôle propriétaire des tables, jamais cashless_app).');
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await bootstrapAdmin(client, input);
    console.log(
      result.created
        ? `[bootstrap-admin] administrateur de la plateforme créé : ${result.userId}`
        : `[bootstrap-admin] déjà présent : ${result.userId} (rien d'écrit)`,
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[bootstrap-admin] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
