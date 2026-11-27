// D9 (mission 12b-1, décision du porteur du 26/11/2026) : `receivePspWebhook` accepte aussi le formulaire
// (PayDunya) et décrit la preuve d'origine par fournisseur. Rien d'autre ne change dans le contrat.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '../../../../..');
const CONTRACT = join(ROOT, 'packages/contracts/openapi.yaml');
const PATH = '/webhooks/{provider}/{psp_config_id}';
const FORM = 'application/x-www-form-urlencoded';
/**
 * Empreinte du contrat de `main` (825263fc) privé des trois seuls textes de D9 : description de l'opération,
 * contenu formulaire, description du schéma `pspHmac`. Tout autre changement du contrat la fait échouer.
 */
const FINGERPRINT_WITHOUT_D9 = 'b73da15a3ee6d5e0495b1dda09e358fa5248df5b9808fd92be7b9057a01049c6';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

function canonical(value: Json | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const load = (): Obj => parse(readFileSync(CONTRACT, 'utf8')) as Obj;
const operation = (spec: Obj): Obj => ((spec.paths as Obj)[PATH] as Obj).post as Obj;
const contentOf = (spec: Obj): Obj => (operation(spec).requestBody as Obj).content as Obj;

function fingerprintWithoutD9(spec: Obj): string {
  const copy = structuredClone(spec);
  const op = operation(copy);
  delete op.description;
  delete ((op.requestBody as Obj).content as Obj)[FORM];
  delete (((copy.components as Obj).securitySchemes as Obj).pspHmac as Obj).description;
  return createHash('sha256').update(canonical(copy)).digest('hex');
}

describe('contrat 12b-1 : receivePspWebhook en formulaire et décrit par fournisseur (D9)', () => {
  it('le contenu JSON existant est inchangé', () => {
    const json = contentOf(load())['application/json'] as Obj;
    expect(json).toBeDefined();
    expect(json.schema).toEqual({ $ref: '#/components/schemas/PspWebhookEvent' });
    expect((json.example as Obj).type).toBe('checkout.session.completed');
  });

  it('le contenu formulaire est un objet libre réservé à paydunya', () => {
    const form = contentOf(load())[FORM] as Obj;
    expect(form).toBeDefined();
    const schema = form.schema as Obj;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(true);
    expect(schema.description).toContain('`paydunya` seulement');
    expect(Object.keys(contentOf(load())).sort()).toEqual(['application/json', FORM]);
  });

  it('la description liste la preuve par fournisseur', () => {
    const description = operation(load()).description as string;
    expect(description).toContain('- `wave` : `Wave-Signature: t=…,v1=…`');
    expect(description).toContain('- `stripe` : `Stripe-Signature: t=…,v1=…`');
    expect(description).toContain(
      "- `paydunya` : corps en formulaire, preuve d'origine `data[hash]`",
    );
    expect(description).toContain('- `orange-money` : inchangé');
    expect(description).not.toContain('autres : `X-Webhook-Signature`');
  });

  it("x-roles, sécurité et paramètres de l'opération sont conservés", () => {
    const op = operation(load());
    expect(op['x-roles']).toEqual(['GATEWAY']);
    expect(op.security).toEqual([{ pspHmac: [] }]);
    expect(op.operationId).toBe('receivePspWebhook');
    expect(((((op.parameters as Json[])[0] as Obj).schema as Obj).enum as Json[]).sort()).toEqual([
      'orange-money',
      'paydunya',
      'stripe',
      'wave',
    ]);
  });

  it("rien d'autre ne change : empreinte du contrat de main privé des textes de D9", () => {
    expect(fingerprintWithoutD9(load())).toBe(FINGERPRINT_WITHOUT_D9);
  });
});
