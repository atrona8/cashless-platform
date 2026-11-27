// Mission 9b, WP14 (règle 3 et 4 de CLAUDE.md) : chaque écart accepté ou renforcement de la mission est consigné.
// Ce test lit les documents du dépôt (aucune base) et échoue si :
//   - une entrée OP-N131 à OP-N149 manque dans POINTS_OUVERTS.md (tableaux et fiche) ou n'est reprise par aucun ADR ;
//   - un ADR-197 à ADR-214 manque, ou ne cite aucun OP ;
//   - une dette n'est pas reportée dans PRD.md et PROMPTS-A-ENVOYER.md ;
//   - un test cité dans ces fiches n'existe plus sous ce nom ;
//   - le code des alertes d'exploitation envoie quelque chose à une personne (limite d'OP-N132 : à mettre à jour avec
//     la mission 12b, qui lève la limite).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '../../../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const OPS = Array.from({ length: 19 }, (_, i) => `OP-N${131 + i}`);
const ADRS = Array.from({ length: 18 }, (_, i) => `ADR-${197 + i}`);

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
      // Mission 11a (WP12) : les fiches de la 9b citent aussi `register.spec.ts` et
      // `commands-other.spec.ts` de l'outil de site ; ces fichiers existent sous `tools/`.
      ...walk(join(ROOT, 'tools/edge-admin/test')),
      // Mission 10a (WP11) : les fiches de la 10a (WP10, WP11) citent `production-refusals.spec.ts` de la passerelle, sous
      // `apps/gateway/test` ; le contrôle d'existence reste entier (le fichier doit y être).
      ...walk(join(ROOT, 'apps/gateway/test')),
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

// Mission 11b, WP11 (cycle 2, OP-N194 levé) : même contrôle pour OP-N185 à OP-N198 et ADR-235, ADR-236.
describe('consignation de la mission 11b', () => {
  const OPS_11B = Array.from({ length: 14 }, (_, i) => `OP-N${185 + i}`);
  const ops = read('docs/POINTS_OUVERTS.md');
  const adr = read('docs/DECISIONS_ADR.md');
  const prd = read('PRD.md');
  const prompts = read('PROMPTS-A-ENVOYER.md');
  const section15 = ops.slice(ops.indexOf('## 15. Mission 11b'));

  it.each(OPS_11B)('%s : ligne du tableau, fiche du §15 et reprise par ADR-236', (op) => {
    expect(ops).toMatch(new RegExp(`^\\| ${op} \\|`, 'm'));
    expect(section15).toMatch(new RegExp(`^- \\*\\*${op}[ .(]`, 'm'));
    const adr236 = adr.slice(adr.indexOf('## ADR-236'));
    expect(adr236).toContain(op);
  });

  it.each(OPS_11B)('%s : reportée dans PRD.md et PROMPTS-A-ENVOYER.md', (op) => {
    expect(prd).toContain(op);
    expect(prompts).toContain(op);
  });

  it.each(['ADR-235', 'ADR-236'])('%s : fiche présente et rattachée à un OP', (id) => {
    const match = adr.match(
      new RegExp(`^## ${id} — [^\\n]*\\n([\\s\\S]*?)(?=^## ADR-|(?![\\s\\S]))`, 'm'),
    );
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/OP-N\d+/);
  });

  it('OP-N170 est levé par la mission 11b ; OP-N194 est levé', () => {
    expect(ops).toMatch(/^\| OP-N170 \|.*\*\*levé\*\* le 25\/11\/2026/m);
    expect(ops).toMatch(/^\| OP-N194 \|.*\*\*Levé le 25\/11\/2026\*\*/m);
  });

  it('OP-N185 bloque la production (confirmé par le porteur)', () => {
    expect(ops).toMatch(/^\| OP-N185 \|.*\| Non \| \*\*Oui\*\* \(confirmé par le porteur/m);
  });

  it('les tests cités dans le §15 existent', () => {
    const names = new Set(
      [...section15.matchAll(/`([\w./-]+\.(?:spec\.ts|sql))`/g)].map((m) => m[1]!),
    );
    const files = [
      ...walk(join(ROOT, 'apps/api/test')),
      ...walk(join(ROOT, 'packages/ledger-sql')),
    ].map((f) => relative(ROOT, f));
    const missing = [...names].filter((name) => {
      const base = name.split('/').pop()!;
      return !files.some((f) => f.endsWith(`/${base}`));
    });
    expect(missing.filter((m) => /spec\.ts$|tests_/.test(m))).toEqual([]);
    expect(names.size).toBeGreaterThan(10);
  });
});

// Mission 12b-1, WP13 (règle 3 de CLAUDE.md) : OP-N199 à OP-N211 et ADR-237 à ADR-240.
// Aucune base : lit les documents et deux fichiers de code dont l'état est une limite consignée
// (exception Android, extensions Apple).
describe('consignation de la mission 12b-1', () => {
  const OPS_12B1 = Array.from({ length: 13 }, (_, i) => `OP-N${199 + i}`);
  // Chaque OP est repris par l'ADR qui porte son écart ou sa limite.
  const ADR_OF: Record<string, string> = {
    'OP-N199': 'ADR-238',
    'OP-N200': 'ADR-238',
    'OP-N201': 'ADR-238',
    'OP-N202': 'ADR-239',
    'OP-N203': 'ADR-239',
  };
  const ops = read('docs/POINTS_OUVERTS.md');
  const adr = read('docs/DECISIONS_ADR.md');
  const prd = read('PRD.md');
  const prompts = read('PROMPTS-A-ENVOYER.md');
  const section16 = ops.slice(ops.indexOf('## 16. Mission 12b-1'));
  const adrSection = (id: string): string => {
    const match = adr.match(
      new RegExp(`^## ${id} — [^\\n]*\\n([\\s\\S]*?)(?=^## ADR-|(?![\\s\\S]))`, 'm'),
    );
    expect(match).not.toBeNull();
    return match![0];
  };

  it('le §16 existe et les OP sont numérotés sans trou ni doublon', () => {
    expect(section16.startsWith('## 16. Mission 12b-1')).toBe(true);
    const rows = [...ops.matchAll(/^\| (OP-N\d+) \|/gm)].map((m) => m[1]!);
    expect(rows.filter((op) => op === 'OP-N198')).toHaveLength(1);
    for (const op of OPS_12B1) expect(rows.filter((r) => r === op)).toHaveLength(1);
    expect(rows.filter((r) => Number(r.slice(4)) > 211)).toEqual([]);
  });

  it.each(OPS_12B1)('%s : ligne du tableau, fiche du §16 et reprise par un ADR', (op) => {
    expect(ops).toMatch(new RegExp(`^\\| ${op} \\|`, 'm'));
    expect(section16).toMatch(new RegExp(`^- \\*\\*${op}[ .(]`, 'm'));
    expect(adrSection(ADR_OF[op] ?? 'ADR-240')).toContain(op);
  });

  it.each(OPS_12B1)('%s : reportée dans PRD.md et PROMPTS-A-ENVOYER.md', (op) => {
    expect(prd).toContain(op);
    expect(prompts).toContain(op);
  });

  it.each(['ADR-237', 'ADR-238', 'ADR-239', 'ADR-240'])(
    '%s : fiche présente, rattachée à un OP, avec risque ou raison et report',
    (id) => {
      const text = adrSection(id);
      expect(text).toMatch(/OP-N\d+/);
      expect(text).toMatch(/\*\*Report\.\*\*/);
      if (id !== 'ADR-237') expect(text).toMatch(/Mission qui le lève|Missions qui les lèvent/);
    },
  );

  it('ADR-237 porte la ligne lue par check-baseline-decision.mjs (D9)', () => {
    expect(adrSection('ADR-237')).toMatch(/^Décision du porteur : 26\/11\/2026 ADR-237$/m);
  });

  it('les écarts de sécurité ont un risque, une mission et une condition de levée', () => {
    for (const id of ['ADR-238', 'ADR-239']) {
      const text = adrSection(id);
      expect(text).toMatch(/\*\*Risque\.\*\*/);
      expect(text).toMatch(/\*\*Mission qui le lève\.\*\*/);
      expect(text).toMatch(/\*\*Condition de levée\.\*\*/);
      expect(text).toMatch(/\*\*Test de borne/);
    }
  });

  it('décisions du porteur du 27/11/2026 (OP-N202, OP-N203, mission 13)', () => {
    const row = (op: string) => ops.match(new RegExp(`^\\| ${op} \\|.*$`, 'm'))![0];
    expect(row('OP-N203')).toContain('Décision du porteur : 27/11/2026');
    expect(row('OP-N202')).toContain('Décision du porteur : 27/11/2026');
    expect(row('OP-N202')).not.toMatch(/proposition de l'Agent/);
    expect(adrSection('ADR-239')).not.toMatch(/proposition de l'Agent/);
    expect(prompts).toMatch(/proposé, en attente du porteur/);
    for (const op of ['OP-N207', 'OP-N208', 'OP-N211'])
      expect(row(op)).toContain('Mission 13 (décision du porteur du 27/11/2026)');
    expect(row('OP-N205')).toMatch(/puis décision du porteur/);
    expect(row('OP-N205')).not.toContain('Mission 13');
    expect(row('OP-N209')).toContain('`S3SealCopy`');
    expect(adrSection('ADR-240')).not.toMatch(/ou décision du porteur/);
  });

  it('Apple et RKP sont reportés à la mission 12 dans PROMPTS et PRD', () => {
    const mission12 = prompts.slice(
      prompts.indexOf('## Mission 12 — App terminal'),
      prompts.indexOf('## Mission 12b — '),
    );
    expect(mission12).toContain('OP-N202');
    expect(mission12).toContain('OP-N203');
    expect(mission12).toContain('apple_validation_category_01');
    expect(prd).toMatch(/OP-N203[^]*mission 12/);
  });

  it('OP-N209 bloque la production et la liste des services essayés est vide', () => {
    expect(ops).toMatch(/^\| OP-N209 \|.*\| Non \| \*\*Oui\*\* \|/m);
    const list = read('apps/api/src/external-services/production-enabled.ts');
    expect(list).toMatch(/PRODUCTION_ENABLED_SERVICES: readonly ExternalService\[\] = \[\];/);
  });

  it('les tests cités dans le §16 existent', () => {
    // Les tests manquants (OP-N202, OP-N203, OP-N207) sont nommés sans apostrophes inversées.
    const names = new Set(
      [...section16.matchAll(/`([\w./-]+\.(?:spec\.ts|sql))`/g)].map((m) => m[1]!),
    );
    const files = [
      ...walk(join(ROOT, 'apps/api/test')),
      ...walk(join(ROOT, 'packages/ledger-sql')),
    ].map((f) => relative(ROOT, f));
    const missing = [...names].filter((name) => {
      const base = name.split('/').pop()!;
      return !files.some((f) => f.endsWith(`/${base}`));
    });
    expect(missing).toEqual([]);
    expect(names.size).toBeGreaterThan(15);
  });

  it('OP-N202 : l’exception Android reste limitée à une seule racine', () => {
    const src = read('apps/api/src/attestation/android-key-attestation.ts');
    expect(src).toContain('settings.expiredExemptRootKeys ?? [GOOGLE_FACTORY_ROOT_SPKI_SHA256]');
    // Une seule empreinte de 64 caractères hexadécimaux : celle de la racine d'usine.
    expect(src.match(/\b[0-9a-f]{64}\b/g)).toHaveLength(1);
  });

  it('OP-N203 : App Attest ne contrôle pas encore les extensions Apple (mission 12)', () => {
    for (const file of ['ios-app-attest.ts', 'ios-app-attest-assertion.ts']) {
      const src = read(`apps/api/src/attestation/${file}`);
      expect(src).not.toContain('apple_validation_category_01');
      expect(src).not.toContain('apple_bundle_version_01');
    }
  });
});
