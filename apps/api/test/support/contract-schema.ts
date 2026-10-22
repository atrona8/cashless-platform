// Contrôle d'une réponse contre un schéma de `openapi.yaml` (lot WP17) : les types générés de
// `@cashless/contracts` ne valent qu'à la compilation ; ce contrôle relit le contrat à l'exécution.
// Sous-ensemble de JSON Schema employé par ces schémas : `$ref`, `type` (dont `null`), `required`,
// `properties`, `items`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minLength`, formats
// `uuid` et `date-time`. Plus strict que le contrat sur un point : une propriété absente de
// `properties` est signalée (rien d'inventé hors du contrat, R-10).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

interface Schema {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  format?: string;
}

const contract = parse(
  readFileSync(join(__dirname, '../../../../packages/contracts/openapi.yaml'), 'utf8'),
) as { components: { schemas: Record<string, Schema> } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function follow(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const target = contract.components.schemas[schema.$ref.split('/').pop()!];
  if (!target) throw new Error(`schéma introuvable : ${schema.$ref}`);
  return follow(target);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function check(raw: Schema, value: unknown, path: string, out: string[]): void {
  const schema = follow(raw);
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
    if (!ok) {
      out.push(`${path} : type ${actual}, attendu ${allowed.join(' | ')}`);
      return;
    }
  }
  if (value === null) return;
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path} : hors énumération`);
  if (schema.const !== undefined && value !== schema.const) out.push(`${path} : ≠ const`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path} : motif`);
    if (schema.minLength !== undefined && value.length < schema.minLength)
      out.push(`${path} : trop court`);
    if (schema.format === 'uuid' && !UUID.test(value)) out.push(`${path} : uuid attendu`);
    if (schema.format === 'date-time' && !DATE_TIME.test(value))
      out.push(`${path} : date-heure attendue`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path} : < minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path} : > maximum`);
  }
  if (actual === 'array' && schema.items)
    (value as unknown[]).forEach((item, i) => check(schema.items!, item, `${path}[${i}]`, out));
  if (actual === 'object' && (schema.properties || schema.required)) {
    const object = value as Record<string, unknown>;
    for (const name of schema.required ?? [])
      if (!(name in object)) out.push(`${path}.${name} : obligatoire et absent`);
    for (const [name, item] of Object.entries(object)) {
      const property = schema.properties?.[name];
      if (!property) out.push(`${path}.${name} : hors contrat`);
      else check(property, item, `${path}.${name}`, out);
    }
  }
}

/** Écarts de `value` au schéma `components.schemas[name]` ; `[]` si conforme. */
export function contractViolations(name: string, value: unknown): string[] {
  const out: string[] = [];
  check({ $ref: `#/components/schemas/${name}` }, value, name, out);
  return out;
}
