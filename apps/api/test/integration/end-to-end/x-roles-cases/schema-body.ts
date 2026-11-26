// Corps d'essai tiré du schéma du contrat (WP10) : l'exemple MINIMAL valide en forme (propriétés obligatoires, premier
// membre d'une énumération, entier au minimum, identifiant tiré au hasard), pour les routes dont le contrôle de rôle
// est fait par le service APRÈS la validation du corps : un corps `{}` y serait refusé en 400 avant que le droit soit
// jugé, et la matrice ne prouverait rien. Ce n'est qu'un corps de forme valide : le métier peut encore répondre 4xx.
import { randomUUID } from 'node:crypto';

type Schema = Record<string, unknown>;

interface OpenApi {
  paths: Record<
    string,
    Record<string, { requestBody?: { content?: Record<string, { schema?: Schema }> } }>
  >;
  components?: { schemas?: Record<string, Schema> };
}

function resolve(doc: OpenApi, schema: Schema | undefined): Schema {
  let current: Schema = schema ?? {};
  for (let depth = 0; depth < 20 && typeof current.$ref === 'string'; depth += 1) {
    const name = current.$ref.split('/').pop()!;
    current = doc.components?.schemas?.[name] ?? {};
  }
  return current;
}

export function example(doc: OpenApi, raw: Schema | undefined, depth = 0): unknown {
  const schema = resolve(doc, raw);
  if (depth > 8) return null;
  if (Array.isArray(schema.allOf)) {
    const merged = (schema.allOf as Schema[]).map((part) => example(doc, part, depth + 1));
    return Object.assign({}, ...merged.filter((v) => typeof v === 'object' && v !== null));
  }
  for (const key of ['oneOf', 'anyOf'] as const)
    if (Array.isArray(schema[key])) return example(doc, (schema[key] as Schema[])[0], depth + 1);
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const type = schema.type ?? (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(
        required.map((name) => [name, example(doc, properties[name], depth + 1)]),
      );
    }
    case 'array': {
      const min = Number(schema.minItems ?? 0);
      return Array.from({ length: min }, () => example(doc, schema.items as Schema, depth + 1));
    }
    case 'integer':
    case 'number':
      return Math.max(Number(schema.minimum ?? 1), 1);
    case 'boolean':
      return false;
    case 'string': {
      if (schema.format === 'uuid') return randomUUID();
      if (schema.format === 'date-time') return new Date().toISOString();
      if (schema.format === 'date') return new Date().toISOString().slice(0, 10);
      if (schema.format === 'email') return 'x-roles@example.test';
      const min = Number(schema.minLength ?? 1);
      return 'x'.repeat(Math.max(min, 1));
    }
    default:
      return {};
  }
}

/** Corps JSON d'une opération, d'après son schéma de requête ; `{}` si elle n'en a pas. */
export function bodyOf(doc: OpenApi, path: string, method: string): unknown {
  const content = doc.paths[path]?.[method.toLowerCase()]?.requestBody?.content;
  const schema = content?.['application/json']?.schema;
  return schema ? example(doc, schema) : {};
}
