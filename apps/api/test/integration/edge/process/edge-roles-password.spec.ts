// Mots de passe des rôles de la passerelle (WP10, suivi WP09) : `migrate.ts` pose CASHLESS_EDGE_PASSWORD et
// CASHLESS_EDGEADMIN_PASSWORD comme pour les autres rôles ; en production, leur absence refuse la série entière
// (jamais de rôle LOGIN sans mot de passe). Client simulé : seule la logique de `migrate` est en jeu.
import 'reflect-metadata';
import type { Client } from 'pg';
import { migrate } from '@cashless/ledger-sql/src/migrate';

function recorder(): { client: Client; queries: string[] } {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [{ literal: `'${text.length}'` }] };
    },
  } as unknown as Client;
  return { client, queries };
}
const files = { roles: 'SELECT 1', postRoles: 'SELECT 2' };

describe('mots de passe de cashless_edge et cashless_edgeadmin', () => {
  it('posés par la série quand les variables existent', async () => {
    const { client, queries } = recorder();
    await migrate(client, [], files, {
      CASHLESS_EDGE_PASSWORD: 'a',
      CASHLESS_EDGEADMIN_PASSWORD: 'b',
    });
    expect(queries.filter((q) => q.startsWith('ALTER ROLE cashless_edge PASSWORD'))).toHaveLength(
      1,
    );
    expect(
      queries.filter((q) => q.startsWith('ALTER ROLE cashless_edgeadmin PASSWORD')),
    ).toHaveLength(1);
    expect(queries[queries.length - 1]).toBe('COMMIT');
  });

  it.each(['CASHLESS_EDGE_PASSWORD', 'CASHLESS_EDGEADMIN_PASSWORD'])(
    'en production, sans %s : la série est refusée et annulée',
    async (missing) => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        CASHLESS_EDGE_PASSWORD: 'a',
        CASHLESS_EDGEADMIN_PASSWORD: 'b',
      };
      delete env[missing];
      const { client, queries } = recorder();
      await expect(migrate(client, [], files, env)).rejects.toThrow(
        new RegExp(`${missing} manquant`),
      );
      expect(queries).toContain('ROLLBACK');
      expect(queries).not.toContain('COMMIT');
    },
  );

  it('hors production, l’absence est tolérée (comme les autres rôles)', async () => {
    const { client } = recorder();
    await expect(migrate(client, [], files, { NODE_ENV: 'development' })).resolves.toBeDefined();
  });
});
