// T117 / DoD du lot WP25 : le workflow de CI porte les étapes qui rendent les preuves de la mission
// opposables. Le test lit `.github/workflows/ledger-tests.yml` et échoue si :
//   - l'étape « Stabilité du contrat (témoin positif) » manque, ou est tolérante (`continue-on-
//     error`) ;
//   - les migrations de la passerelle ou l'étape `gateway-integration` manquent ;
//   - le job `gateway-e2e` manque (service postgres:17, ubuntu-24.04, délai propre,
//     jest.e2e.config.cjs en
//     série, construction et balayage de l'image) ;
//   - `M8_MIN_DEBIT_RATE` du job `gateway-e2e` est inférieur à 100 (décision 54, NFR-001) ;
//   - `M8_E2E_LONG` du job `gateway-e2e` n'est pas "1" (volumes de la DoD : 20 bascules, 10 000
//     opérations) ;
//   - une étape de stabilité, `gateway-integration`, le jest e2e ou le balayage est affaiblie par la
//     forme de sa commande (`|| true`, `|| :`, `; true`, `set +e`, `--passWithNoTests`), porte un
//     `if:` (comme le job `gateway-e2e`), ou l'appel bloquant de Trivy perd `--exit-code 1` ;
//   - une action `uses:` n'est pas épinglée par SHA de commit, ou une écoute sur le port 80
//     apparaît.
// Contrôle de sensibilité : les mêmes règles sont jouées sur des copies mutées du workflow et
//   doivent
// toutes échouer (un contrôle qui ne peut pas échouer ne prouve rien).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const REPO = join(__dirname, '..', '..', '..', '..');
const WORKFLOW = join(REPO, '.github', 'workflows', 'ledger-tests.yml');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: unknown;
  env?: Record<string, unknown>;
  'continue-on-error'?: unknown;
}
interface Job {
  'runs-on'?: string;
  'timeout-minutes'?: number;
  'continue-on-error'?: unknown;
  if?: unknown;
  services?: Record<string, { image?: string }>;
  env?: Record<string, unknown>;
  steps?: Step[];
}
interface Workflow {
  jobs?: Record<string, Job>;
}

/** Formes d'une commande qui laissent passer un échec ou un lot de tests vide. */
const WEAKENING: Array<[RegExp, string]> = [
  [/\|\|\s*(true|:|exit\s+0)\b/, '`|| true` (ou `|| :`, `|| exit 0`)'],
  [/\|\|\s*:(\s|$)/, '`|| :`'],
  [/;\s*(true|:)\s*($|\n|;)/, '`; true`'],
  [/;\s*exit\s+0\b/, '`; exit 0`'],
  [/\|\s*tee\b/, '`| tee` (pas de pipefail par défaut : le code de sortie est celui de tee)'],
  [/\bset\s+\+[a-z]*e/, '`set +e`'],
  [/--passWithNoTests/, '`--passWithNoTests`'],
  [/--exit-code[ =]0\b/, '`--exit-code 0`'],
];

const SHA = /^[^@\s]+@[0-9a-f]{40}(\s|$)/;

/** Violations des règles de la CI (liste vide = conforme). */
export function violations(doc: Workflow): string[] {
  const out: string[] = [];
  const jobs = doc.jobs ?? {};
  const ledger = jobs['ledger'];
  const e2e = jobs['gateway-e2e'];
  const steps = (job?: Job): Step[] => job?.steps ?? [];
  const named = (job: Job | undefined, text: string): Step | undefined =>
    steps(job).find((s) => (s.name ?? '').includes(text));

  if (!ledger) out.push('job ledger absent');
  if (!e2e) out.push('job gateway-e2e absent');

  // Stabilité du contrat : après « Types du contrat à jour », jamais tolérante.
  const names = steps(ledger).map((s) => s.name ?? '');
  const stab = named(ledger, 'Stabilité du contrat (témoin positif)');
  if (!stab) out.push('étape « Stabilité du contrat (témoin positif) » absente');
  else {
    if (!(stab.run ?? '').includes('node tools/contract-stability/check.mjs'))
      out.push('la stabilité du contrat ne lance pas tools/contract-stability/check.mjs');
    if (!(stab.run ?? '').includes('check.test.mjs'))
      out.push('la stabilité du contrat ne lance pas le test du comparateur');
    const at = names.indexOf(stab.name ?? '');
    const types = names.findIndex((n) => n.startsWith('Types du contrat à jour'));
    if (types < 0 || at < types) out.push('stabilité du contrat avant « Types du contrat à jour »');
  }

  // Migrations de la passerelle puis gateway-integration (hors e2e, en série).
  const mig = steps(ledger).findIndex(
    (s) => /@cashless\/gateway/.test(s.run ?? '') && /migrate/.test(s.run ?? ''),
  );
  const integ = steps(ledger).findIndex((s) => (s.name ?? '').includes('gateway-integration'));
  if (mig < 0) out.push('migrations de la passerelle absentes du job ledger');
  if (integ < 0) out.push('étape gateway-integration absente du job ledger');
  else {
    const run = steps(ledger)[integ]!.run ?? '';
    if (!run.includes('@cashless/gateway') || !run.includes('--runInBand'))
      out.push('gateway-integration : apps/gateway en série (--runInBand) attendu');
    if (mig >= 0 && mig > integ) out.push('migrations de la passerelle après gateway-integration');
  }

  // Job gateway-e2e.
  if (e2e) {
    if (e2e['runs-on'] !== 'ubuntu-24.04') out.push('gateway-e2e : ubuntu-24.04 attendu');
    if (typeof e2e['timeout-minutes'] !== 'number') out.push('gateway-e2e : délai propre manquant');
    if (!/^postgres:17$/.test(e2e.services?.['postgres']?.image ?? ''))
      out.push('gateway-e2e : service postgres:17 attendu');
    const runs = steps(e2e).map((s) => s.run ?? '');
    const jest = runs.find((r) => r.includes('jest.e2e.config.cjs'));
    if (!jest) out.push('gateway-e2e : jest.e2e.config.cjs non lancé');
    else if (!jest.includes('--runInBand')) out.push('gateway-e2e : suites e2e hors série');
    if (!runs.some((r) => /docker build .*apps\/gateway\/Dockerfile/.test(r)))
      out.push('gateway-e2e : image de la passerelle non construite');
    if (!runs.some((r) => r.includes('docker save') && /trivy@sha256:[0-9a-f]{64}/.test(r)))
      out.push('gateway-e2e : balayage de l’image (docker save + outil épinglé) absent');
    const rates = [
      e2e.env?.['M8_MIN_DEBIT_RATE'],
      ...steps(e2e).map((s) => s.env?.['M8_MIN_DEBIT_RATE']),
    ];
    const jobRate = Number(e2e.env?.['M8_MIN_DEBIT_RATE']);
    if (!(jobRate >= 100)) out.push(`gateway-e2e : M8_MIN_DEBIT_RATE=${String(jobRate)} < 100`);
    for (const r of rates) {
      if (r !== undefined && !(Number(r) >= 100))
        out.push(`gateway-e2e : plancher abaissé (${String(r)})`);
    }
    if (
      runs.some(
        (r) =>
          /M8_MIN_DEBIT_RATE\s*=\s*\d+/.test(r) && !/M8_MIN_DEBIT_RATE\s*=\s*([1-9]\d{2,})/.test(r),
      )
    )
      out.push('gateway-e2e : plancher abaissé dans une commande');
  }

  // Étapes qui rendent les preuves opposables : aucune forme de commande tolérante, aucun `if:`.
  if (e2e && e2e.if !== undefined) out.push('gateway-e2e : `if:` sur le job');
  if (String(e2e?.env?.['M8_E2E_LONG']) !== '1')
    out.push(`gateway-e2e : M8_E2E_LONG=${String(e2e?.env?.['M8_E2E_LONG'])} (attendu "1")`);
  for (const s of steps(e2e)) {
    if (s.env?.['M8_E2E_LONG'] !== undefined && String(s.env['M8_E2E_LONG']) !== '1')
      out.push('gateway-e2e : M8_E2E_LONG modifié dans une étape');
    if (/M8_E2E_LONG\s*=\s*(?!1\b)/.test(s.run ?? ''))
      out.push('gateway-e2e : M8_E2E_LONG modifié dans une commande');
  }
  const critical: Array<[string, Step]> = [];
  if (stab) critical.push(['stabilité du contrat', stab]);
  if (integ >= 0) critical.push(['gateway-integration', steps(ledger)[integ]!]);
  for (const s of steps(e2e))
    if (/jest\.e2e\.config\.cjs|docker save|docker build/.test(s.run ?? ''))
      critical.push(['gateway-e2e', s]);
  for (const [where, s] of critical) {
    if (s.if !== undefined) out.push(`${where} : \`if:\` sur « ${s.name ?? '?'} »`);
    for (const [re, label] of WEAKENING)
      if (re.test(s.run ?? '')) out.push(`${where} : ${label} dans « ${s.name ?? '?'} »`);
  }
  const scan = steps(e2e).find((s) => (s.run ?? '').includes('docker save'));
  if (scan && !/--exit-code[ =]1\b/.test(scan.run ?? ''))
    out.push('gateway-e2e : balayage sans `--exit-code 1` sur l’appel bloquant');
  // L'appel bloquant (celui qui porte `--exit-code 1`) exige HIGH et CRITICAL (décision du 12/11).
  for (const call of (scan?.run ?? '').split(/\n(?=\s*docker run)/)) {
    if (!/--exit-code[ =]1\b/.test(call)) continue;
    const sev = /--severity[ =]([A-Z,]+)/.exec(call)?.[1]?.split(',') ?? [];
    if (!sev.includes('HIGH') || !sev.includes('CRITICAL'))
      out.push('gateway-e2e : l’appel bloquant de Trivy doit exiger HIGH et CRITICAL');
  }

  // Le contexte `job` n'existe pas dans l'`env` d'un job : GitHub rejette alors tout le fichier.
  for (const [jobName, job] of Object.entries(jobs))
    for (const [k, v] of Object.entries(job.env ?? {}))
      if (/\$\{\{[^}]*\bjob\./.test(String(v)))
        out.push(`${jobName} : contexte \`job\` dans l'env du job (${k})`);
  // Le job `ledger` s'exécute toujours.
  if (ledger && ledger.if !== undefined) out.push('ledger : `if:` sur le job');
  // Réglages locaux de charge : jamais dans la CI, sauf un débit offert d'au moins 100.
  {
    const all = JSON.stringify(doc);
    if (/M8_LOAD_WORKERS/.test(all)) out.push('M8_LOAD_WORKERS présent dans le workflow');
    if (/M8_OFFERED_RATE/.test(all)) {
      const vals: unknown[] = [];
      for (const job of Object.values(jobs)) {
        vals.push(job.env?.['M8_OFFERED_RATE']);
        for (const s of steps(job)) vals.push(s.env?.['M8_OFFERED_RATE']);
      }
      const inRuns = Object.values(jobs).flatMap((j) =>
        steps(j).flatMap((s) =>
          [...(s.run ?? '').matchAll(/M8_OFFERED_RATE\s*=\s*"?([^\s"]*)/g)].map((m) => m[1]),
        ),
      );
      for (const v of [...vals.filter((x) => x !== undefined), ...inRuns])
        if (!(Number(v) >= 100)) out.push(`M8_OFFERED_RATE=${String(v)} < 100 dans le workflow`);
    }
  }

  // Aucune tolérance d'échec, aucune action non épinglée, aucune écoute sur le port 80.
  for (const [jobName, job] of Object.entries(jobs)) {
    if (job['continue-on-error'] !== undefined)
      out.push(`${jobName} : continue-on-error au niveau du job`);
    for (const s of steps(job)) {
      if (s['continue-on-error'] !== undefined)
        out.push(`${jobName} : continue-on-error sur « ${s.name ?? s.uses ?? '?'} »`);
      if (s.uses !== undefined && !SHA.test(s.uses))
        out.push(`${jobName} : action non épinglée par SHA : ${s.uses}`);
      if (/(^|[\s"':=])80:80\b|--port[ =]80\b|:80\/|PORT[=:]\s*"?80"?\s*$/m.test(s.run ?? ''))
        out.push(`${jobName} : écoute sur le port 80`);
    }
  }
  return out;
}

const load = (): Workflow => parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
const clone = (): Workflow => JSON.parse(JSON.stringify(load())) as Workflow;

describe('T117 : le workflow de CI (ledger-tests.yml)', () => {
  it('le workflow du dépôt respecte toutes les règles (témoin positif)', () => {
    expect(violations(load())).toEqual([]);
  });

  it('le workflow est lisible et porte les deux jobs', () => {
    expect(Object.keys(load().jobs ?? {})).toEqual(
      expect.arrayContaining(['ledger', 'gateway-e2e']),
    );
  });

  describe('sensibilité : chaque mutation est détectée', () => {
    const cases: Array<[string, (d: Workflow) => void, RegExp]> = [
      [
        'étape de stabilité retirée',
        (d) => {
          d.jobs!['ledger']!.steps = d.jobs!['ledger']!.steps!.filter(
            (s) => !(s.name ?? '').startsWith('Stabilité du contrat'),
          );
        },
        /Stabilité du contrat \(témoin positif\)/,
      ],
      [
        'stabilité tolérante (continue-on-error)',
        (d) => {
          d.jobs!['ledger']!.steps!.find((s) => (s.name ?? '').startsWith('Stabilité du contrat'))![
            'continue-on-error'
          ] = true;
        },
        /continue-on-error/,
      ],
      [
        'migrations de la passerelle retirées',
        (d) => {
          d.jobs!['ledger']!.steps = d.jobs!['ledger']!.steps!.filter(
            (s) => !/@cashless\/gateway/.test(s.run ?? '') || !/migrate/.test(s.run ?? ''),
          );
        },
        /migrations de la passerelle/,
      ],
      [
        'gateway-integration retirée',
        (d) => {
          d.jobs!['ledger']!.steps = d.jobs!['ledger']!.steps!.filter(
            (s) => !(s.name ?? '').includes('gateway-integration'),
          );
        },
        /gateway-integration/,
      ],
      [
        'job gateway-e2e retiré',
        (d) => {
          delete d.jobs!['gateway-e2e'];
        },
        /gateway-e2e absent/,
      ],
      [
        'plancher NFR-001 abaissé à 99',
        (d) => {
          d.jobs!['gateway-e2e']!.env!['M8_MIN_DEBIT_RATE'] = '99';
        },
        /M8_MIN_DEBIT_RATE=99/,
      ],
      [
        'plancher abaissé dans une étape',
        (d) => {
          d.jobs!['gateway-e2e']!.steps![0]!.env = { M8_MIN_DEBIT_RATE: '50' };
        },
        /plancher abaissé/,
      ],
      [
        'action non épinglée (tag flottant)',
        (d) => {
          d.jobs!['gateway-e2e']!.steps![0]!.uses = 'actions/checkout@v4';
        },
        /non épinglée par SHA/,
      ],
      [
        'balayage de l’image retiré',
        (d) => {
          d.jobs!['gateway-e2e']!.steps = d.jobs!['gateway-e2e']!.steps!.filter(
            (s) => !(s.run ?? '').includes('docker save'),
          );
        },
        /balayage de l’image/,
      ],
      [
        'suites e2e hors série',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs'))
              s.run = s.run!.replace('--runInBand', '');
        },
        /hors série/,
      ],
      [
        'M8_E2E_LONG retiré du job gateway-e2e',
        (d) => {
          delete d.jobs!['gateway-e2e']!.env!['M8_E2E_LONG'];
        },
        /M8_E2E_LONG/,
      ],
      [
        'M8_E2E_LONG à 0',
        (d) => {
          d.jobs!['gateway-e2e']!.env!['M8_E2E_LONG'] = '0';
        },
        /M8_E2E_LONG/,
      ],
      [
        'M8_E2E_LONG abaissé dans la commande jest',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs')) s.run = `M8_E2E_LONG=0 ${s.run!}`;
        },
        /M8_E2E_LONG modifié/,
      ],
      [
        'stabilité du contrat suivie de || true',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').startsWith('Stabilité du contrat'),
          )!;
          st.run = st.run!.replace(
            'node tools/contract-stability/check.mjs',
            'node tools/contract-stability/check.mjs || true',
          );
        },
        /\|\| true/,
      ],
      [
        'stabilité du contrat suivie de || :',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').startsWith('Stabilité du contrat'),
          )!;
          st.run = st.run!.replace(
            'node tools/contract-stability/check.mjs',
            'node tools/contract-stability/check.mjs || :',
          );
        },
        /\|\| :/,
      ],
      [
        'stabilité du contrat avec ; true',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').startsWith('Stabilité du contrat'),
          )!;
          st.run = `${st.run!}\ntrue; true\nnode x ; true\n`;
        },
        /; true/,
      ],
      [
        'stabilité du contrat avec set +e',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').startsWith('Stabilité du contrat'),
          )!;
          st.run = `set +e\n${st.run!}`;
        },
        /set \+e/,
      ],
      [
        'if: sur l’étape de stabilité',
        (d) => {
          d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').startsWith('Stabilité du contrat'),
          )!.if = "github.ref == 'refs/heads/none'";
        },
        /`if:`/,
      ],
      [
        '--passWithNoTests sur gateway-integration',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').includes('gateway-integration'),
          )!;
          st.run = `${st.run!} --passWithNoTests`;
        },
        /passWithNoTests/,
      ],
      [
        '|| true sur gateway-integration',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').includes('gateway-integration'),
          )!;
          st.run = `${st.run!} || true`;
        },
        /\|\| true/,
      ],
      [
        '|| true sur le jest e2e',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs')) s.run = `${s.run!} || true`;
        },
        /\|\| true/,
      ],
      [
        '--passWithNoTests sur le jest e2e',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs'))
              s.run = `${s.run!} --passWithNoTests`;
        },
        /passWithNoTests/,
      ],
      [
        'if: sur le job gateway-e2e',
        (d) => {
          d.jobs!['gateway-e2e']!.if = 'false';
        },
        /`if:` sur le job/,
      ],
      [
        'if: sur l’étape jest e2e',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs')) s.if = 'false';
        },
        /`if:`/,
      ],
      [
        'balayage : --exit-code 1 retiré',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('docker save')) s.run = s.run!.replace('--exit-code 1', '');
        },
        /--exit-code 1/,
      ],
      [
        'balayage bloquant limité à CRITICAL',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('docker save'))
              s.run = s.run!.replace('--severity HIGH,CRITICAL', '--severity CRITICAL');
        },
        /HIGH et CRITICAL/,
      ],
      [
        'balayage bloquant limité à HIGH',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('docker save'))
              s.run = s.run!.replace('--severity HIGH,CRITICAL', '--severity HIGH');
        },
        /HIGH et CRITICAL/,
      ],
      [
        'balayage suivi de || true',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('docker save')) s.run = `${s.run!.trimEnd()} || true\n`;
        },
        /\|\| true/,
      ],
      [
        'balayage avec set +e',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('docker save')) s.run = `set +e\n${s.run!}`;
        },
        /set \+e/,
      ],
      [
        'contexte job dans l’env du job gateway-e2e',
        (d) => {
          d.jobs!['gateway-e2e']!.env!['M8_PG_CONTAINER'] = '${{ job.services.postgres.id }}';
        },
        /contexte `job` dans l'env du job/,
      ],
      [
        'if: sur le job ledger',
        (d) => {
          d.jobs!['ledger']!.if = "github.ref == 'refs/heads/none'";
        },
        /ledger : `if:` sur le job/,
      ],
      [
        '; exit 0 sur le jest e2e',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs')) s.run = `${s.run!}; exit 0`;
        },
        /; exit 0/,
      ],
      [
        '| tee sur le jest e2e',
        (d) => {
          for (const s of d.jobs!['gateway-e2e']!.steps!)
            if ((s.run ?? '').includes('jest.e2e.config.cjs')) s.run = `${s.run!} | tee e2e.log`;
        },
        /\| tee/,
      ],
      [
        '; exit 0 sur gateway-integration',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').includes('gateway-integration'),
          )!;
          st.run = `${st.run!}; exit 0`;
        },
        /; exit 0/,
      ],
      [
        '| tee sur gateway-integration',
        (d) => {
          const st = d.jobs!['ledger']!.steps!.find((s) =>
            (s.name ?? '').includes('gateway-integration'),
          )!;
          st.run = `${st.run!} | tee gw.log`;
        },
        /\| tee/,
      ],
      [
        'M8_LOAD_WORKERS posé dans le job gateway-e2e',
        (d) => {
          d.jobs!['gateway-e2e']!.env!['M8_LOAD_WORKERS'] = '1';
        },
        /M8_LOAD_WORKERS/,
      ],
      [
        'M8_OFFERED_RATE à 50 dans le job gateway-e2e',
        (d) => {
          d.jobs!['gateway-e2e']!.env!['M8_OFFERED_RATE'] = '50';
        },
        /M8_OFFERED_RATE=50/,
      ],
      [
        'écoute sur le port 80',
        (d) => {
          d.jobs!['gateway-e2e']!.steps!.push({ name: 'x', run: 'docker run -p 80:80 nginx' });
        },
        /port 80/,
      ],
    ];
    it.each(cases)('%s', (_name, mutate, expected) => {
      const doc = clone();
      mutate(doc);
      const found = violations(doc);
      expect(found.length).toBeGreaterThan(0);
      expect(found.join('\n')).toMatch(expected);
    });
  });
});
