// Corps et réponses des routes « Personnes » (contrat openapi.yaml, schémas StaffUser, StaffUserCreate, RoleGrant,
// RoleAssignment). Validation stricte des champs attendus ; tout champ inconnu (dont `approved_by`) est ignoré.
import { ProblemException } from '../../errors/problem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const STAFF_ROLES = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER', 'MERCHANT_ADMIN', 'VENDOR', 'CUSTOMER'];
const SCOPE_TYPES = ['PLATFORM', 'OPERATOR', 'ORGANIZER', 'EVENT', 'MERCHANT'];

export interface StaffUserCreate {
  issuer: string;
  subject: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface RoleGrantInput {
  role: string;
  scopeType: string;
  scopeId: string | null;
}

export interface RoleAssignmentRow {
  id: string;
  user_id: string;
  role: string;
  scope_type: string;
  scope_id: string | null;
  granted_by: string | null;
  granted_at: Date;
  revoked_at: Date | null;
}

export interface AppUserRow {
  id: string;
  operator_id: string | null;
  issuer: string;
  subject: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  created_at: Date;
  disabled_at: Date | null;
  created_by: string | null;
}

export interface RoleAssignmentDto {
  assignment_id: string;
  role: string;
  scope_type: string;
  scope_id: string | null;
  granted_by: string | null;
  granted_at: Date;
  revoked_at: Date | null;
}

export interface StaffUserDto {
  user_id: string;
  operator_id: string | null;
  issuer: string;
  subject: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  created_at: Date;
  disabled_at: Date | null;
  role_assignments: RoleAssignmentDto[];
}

const invalid = (detail: string): ProblemException => new ProblemException('VALIDATION_FAILED', { status: 400, detail });

function text(body: Record<string, unknown>, name: string, max: number, required: boolean): string | null {
  const value = body[name];
  if (value === undefined || value === null) {
    if (required) throw invalid(`Champ obligatoire : ${name}.`);
    return null;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw invalid(`${name} : chaîne de 1 à ${max} caractères attendue.`);
  }
  return value;
}

function object(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('Corps JSON (objet) attendu.');
  return body as Record<string, unknown>;
}

export function parseStaffUserCreate(raw: unknown): StaffUserCreate {
  const body = object(raw);
  const email = text(body, 'email', 320, false);
  const phone = text(body, 'phone', 16, false);
  if (email !== null && !/^[^\s@]+@[^\s@]+$/.test(email)) throw invalid('email : adresse invalide.');
  if (phone !== null && !E164.test(phone)) throw invalid('phone : numéro E.164 attendu.');
  if (email === null && phone === null) throw invalid('email ou phone est obligatoire.');
  return {
    issuer: text(body, 'issuer', 512, true)!,
    subject: text(body, 'subject', 255, true)!,
    displayName: text(body, 'display_name', 200, true)!,
    email,
    phone,
  };
}

export function parseRoleGrant(raw: unknown): RoleGrantInput {
  const body = object(raw);
  const role = text(body, 'role', 32, true)!;
  const scopeType = text(body, 'scope_type', 16, true)!;
  if (!STAFF_ROLES.includes(role)) throw invalid(`role : valeur inconnue (${role}).`);
  if (!SCOPE_TYPES.includes(scopeType)) throw invalid(`scope_type : valeur inconnue (${scopeType}).`);
  const scopeId = body.scope_id ?? null;
  if (scopeId !== null && (typeof scopeId !== 'string' || !UUID.test(scopeId))) throw invalid('scope_id : UUID attendu.');
  return { role, scopeType, scopeId };
}

export function assignmentDto(row: RoleAssignmentRow): RoleAssignmentDto {
  return {
    assignment_id: row.id,
    role: row.role,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    granted_by: row.granted_by,
    granted_at: row.granted_at,
    revoked_at: row.revoked_at,
  };
}

export function staffUserDto(user: AppUserRow, assignments: RoleAssignmentRow[]): StaffUserDto {
  return {
    user_id: user.id,
    operator_id: user.operator_id,
    issuer: user.issuer,
    subject: user.subject,
    email: user.email,
    phone: user.phone,
    display_name: user.display_name,
    status: user.status,
    created_at: user.created_at,
    disabled_at: user.disabled_at,
    role_assignments: assignments.map(assignmentDto),
  };
}

/** Curseur opaque de pagination : position (created_at en texte exact, id) de la dernière personne rendue. */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && UUID.test(String(value[1]))) {
      return [value[0], String(value[1])];
    }
  } catch {
    // curseur illisible : refusé ci-dessous
  }
  throw invalid('cursor : curseur invalide.');
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 50;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalid('limit : entier de 1 à 200 attendu.');
  return limit;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
