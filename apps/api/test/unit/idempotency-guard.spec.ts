// Architecture (RISK-2 de la mission 1, research R-10) : une route `@Idempotent` écrit par sa transaction métier.
// Analyse syntaxique (compilateur TypeScript) de src/**/*.ts : toute méthode `@Idempotent(` a un paramètre
// `@IdempotentTransaction()`, et aucune classe qui déclare une telle route n'injecte `TenantTx`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = join(__dirname, '../../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function decoratorNames(node: ts.Node): string[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).map((decorator) => {
    const expression = decorator.expression;
    return ts.isCallExpression(expression) ? expression.expression.getText() : expression.getText();
  });
}

/** Fautes d'un fichier : « fichier › Classe.méthode : raison ». */
export function idempotencyOffenders(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text ?? '(anonyme)';
      const routes = node.members.filter(
        (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && decoratorNames(member).includes('Idempotent'),
      );
      for (const route of routes) {
        const withTx = route.parameters.some((param) => decoratorNames(param).includes('IdempotentTransaction'));
        if (!withTx) offenders.push(`${path} › ${className}.${route.name.getText()} : sans @IdempotentTransaction()`);
      }
      const ctor = node.members.find(ts.isConstructorDeclaration);
      const injectsTenantTx = ctor?.parameters.some((param) => param.type?.getText() === 'TenantTx') ?? false;
      if (routes.length > 0 && injectsTenantTx) {
        offenders.push(`${path} › ${className} : injecte TenantTx alors qu'il déclare une route @Idempotent`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offenders;
}

describe('idempotence : écriture par la transaction métier (RISK-2)', () => {
  it('aucune route @Idempotent de src/ n’écrit hors de IdempotentTx', () => {
    const offenders = sources(SRC).flatMap((path) =>
      idempotencyOffenders(relative(SRC, path).split(sep).join('/'), readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('un contrôleur fautif est signalé par fichier et par méthode', () => {
    const faulty = `
      @Controller('x')
      export class FaultyController {
        constructor(private readonly tx: TenantTx) {}

        @Post('a')
        @Idempotent({ scope: (req) => \`pos:\${req.params.id}:\` })
        create(@Body() body: unknown) {
          return this.tx.run('op', (client) => client.query('INSERT …'));
        }

        @Post('b')
        @Idempotent({ scope: 'app:' })
        fine(@IdempotentTransaction() tx: IdempotentTx) {
          return tx.run(async () => ({}));
        }
      }`;
    expect(idempotencyOffenders('faulty.controller.ts', faulty)).toEqual([
      'faulty.controller.ts › FaultyController.create : sans @IdempotentTransaction()',
      "faulty.controller.ts › FaultyController : injecte TenantTx alors qu'il déclare une route @Idempotent",
    ]);
  });

  it('un contrôleur conforme n’est pas signalé', () => {
    const fine = `
      export class FineController {
        constructor(private readonly service: Service) {}
        @Idempotent({ scope: 'bo:' })
        create(@Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
          return tx.run(async () => body);
        }
      }`;
    expect(idempotencyOffenders('fine.controller.ts', fine)).toEqual([]);
  });
});
