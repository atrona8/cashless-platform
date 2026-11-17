// Mission 9b, WP14 (règle 3 et 4 de CLAUDE.md) : chaque écart accepté ou renforcement de la mission est consigné.
// Ce test lit les documents du dépôt (aucune base) et échoue si :
//   - une entrée OP-N131 à OP-N149 manque dans POINTS_OUVERTS.md (tableaux et fiche) ou n'est reprise par aucun ADR ;
//   - un ADR-197 à ADR-213 manque, ou ne cite aucun OP ;
//   - une dette n'est pas reportée dans PRD.md et PROMPTS-A-ENVOYER.md ;
//   - un test cité dans ces fiches n'existe plus sous ce nom ;
//   - le code des alertes d'exploitation envoie quelque chose à une personne (limite d'OP-N132 : à mettre à jour avec
//     la mission 12b, qui lève la limite).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '../../../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const OPS = Array.from({ length: 19 }, (_, i) => `OP-N${131 + i}`);
const ADRS = Array.from({ length: 17 }, (_, i) => `ADR-${197 + i}`);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

describe('consignation de la mission 9b', () => {
  const ops = read('docs/POINTS_OUVERTS.md');
  const adr = read('docs/DECISIONS_ADR.md');
  const prd = read('PRD.md');
  const prompts = read('PROMPTS-A-ENVOYER.md');

  it.each(OPS)('%s : ligne du tableau, fiche et reprise par un ADR', (op) => {
    expect(ops).toMatch(new RegExp(`^\\| ${op} \\|`, 'm'));
    expect(ops).toMatch(new RegExp(`^### ${op} — `, 'm'));
    // OP-N149 est un trou dans la preuve, pas un écart accepté : aucun ADR.
    if (op !== 'OP-N149') expect(adr).toContain(op);
  });

  it.each(ADRS)('%s : fiche présente et rattachée à un OP', (id) => {
    const match = adr.match(
      new RegExp(`^## ${id} — [^\\n]*\\n([\\s\\S]*?)(?=^## ADR-|(?![\\s\\S]))`, 'm'),
    );
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/OP-N\d+/);
  });

  it.each(OPS.filter((op) => op !== 'OP-N146'))(
    '%s : reportée dans PRD.md et PROMPTS-A-ENVOYER.md',
    (op) => {
      expect(prd).toContain(op);
      expect(prompts).toContain(op);
    },
  );

  it('les tests cités dans les fiches de la mission existent', () => {
    const start = ops.indexOf('## 10. Mission 9b');
    const adrStart = adr.indexOf('## ADR-197');
    const text = ops.slice(start) + adr.slice(adrStart);
    const names = new Set([...text.matchAll(/`([\w./-]+\.(?:spec\.ts|sql))`/g)].map((m) => m[1]!));
    const files = [
      ...walk(join(ROOT, 'apps/api/test')),
      ...walk(join(ROOT, 'packages/ledger-sql')),
    ].map((f) => relative(ROOT, f));
    const missing = [...names].filter((name) => {
      const base = name.split('/').pop()!;
      return !files.some((f) => f.endsWith(`/${base}`) && (name === base || f.endsWith(name)));
    });
    // `post-roles.sql` n'est pas un test : seul un nom de test ou de suite est cherché.
    expect(missing.filter((m) => /spec\.ts$|tests_/.test(m))).toEqual([]);
    expect(names.size).toBeGreaterThan(20);
  });

  it('OP-N132 : le code des alertes ne contient aucun envoi à une personne', () => {
    const dir = join(ROOT, 'apps/api/src/processes');
    const sources = walk(dir).filter((f) => f.endsWith('.ts'));
    const alertSources = [
      join(ROOT, 'apps/api/src/processes/ops-alerts.ts'),
      ...walk(join(ROOT, 'apps/api/src/processes/controls')).filter((f) => f.endsWith('.ts')),
      ...walk(join(ROOT, 'apps/api/src/sealing')).filter((f) => f.endsWith('.ts')),
    ].filter((f) => existsSync(f));
    expect(alertSources.length).toBeGreaterThan(1);
    expect(sources.length).toBeGreaterThan(0);
    const sender =
      /OtpSender|nodemailer|sendgrid|twilio|axios|node-fetch|\bfetch\(|from 'node:https?'|from 'https?'|slack|webhook/i;
    for (const file of alertSources)
      expect({
        file: relative(ROOT, file),
        sends: sender.test(readFileSync(file, 'utf8')),
      }).toEqual({
        file: relative(ROOT, file),
        sends: false,
      });
    // Le seul canal en dehors de l'audit et du journal : la notification de la base.
    expect(readFileSync(alertSources[0]!, 'utf8')).toContain('ops_raise_alert');
    expect(readFileSync(alertSources[0]!, 'utf8')).toContain('pg_notify');
  });
});
