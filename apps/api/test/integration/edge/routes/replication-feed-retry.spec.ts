// Rejeu du flux de réplication (WP12, cycle 2 ; replication-feed.service.ts) : `40001` (conflit de sérialisation) et
// `23505` (écriture concurrente de l'horizon) sont rejoués, au plus MAX_ATTEMPTS fois ; toute autre erreur et la
// dernière tentative propagent l'erreur ; `42501` devient le 401 de la garde. Client simulé : aucune base requise.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { EdgeGateway } from '../../../../src/edge/auth/edge-gateway';
import {
  MAX_ATTEMPTS,
  ReplicationFeedService,
} from '../../../../src/edge/replication/replication-feed.service';
import { ProblemException } from '../../../../src/errors/problem';

const PAGE = {
  ledger_id: '00000000-0000-0000-0000-000000000001',
  epoch: 0,
  from_posting_id: 0,
  to_posting_id: 7,
  wallets: [],
  media: [],
  has_more: false,
};
const gateway = { operatorId: 'op', gatewayId: 'gw' } as unknown as EdgeGateway;
const query = { afterPostingId: 0, limit: 10, afterChangeSeq: null };

/** Service dont la fonction de page lève `codes[i]` à la i-ème tentative, puis rend la page. */
function build(codes: (string | undefined)[]) {
  let attempts = 0;
  const tx = {
    withoutTenant: async (fn: (client: unknown) => Promise<unknown>) => {
      const code = codes[attempts];
      attempts += 1;
      const client = {
        query: (sql: string) => {
          if (sql.includes('edge_replication_page') && code)
            return Promise.reject(Object.assign(new Error(`SQLSTATE ${code}`), { code }));
          return Promise.resolve({
            rows: sql.includes('edge_replication_page') ? [{ page: PAGE }] : [],
          });
        },
      };
      return fn(client);
    },
  };
  return { service: new ReplicationFeedService(tx as never), attempts: () => attempts };
}

describe('rejeu du flux de réplication', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['40001', '23505'])(
    '%s puis réussite : la page est rendue à la 2e tentative',
    async (code) => {
      const { service, attempts } = build([code]);
      await expect(service.page(gateway, query)).resolves.toMatchObject({ to_posting_id: 7 });
      expect(attempts()).toBe(2);
    },
  );

  it.each(['40001', '23505'])(
    '%s à chaque tentative : erreur propagée après %d essais',
    async (code) => {
      expect(MAX_ATTEMPTS).toBe(3);
      const { service, attempts } = build([code, code, code, code]);
      await expect(service.page(gateway, query)).rejects.toMatchObject({ code });
      expect(attempts()).toBe(MAX_ATTEMPTS);
    },
  );

  it('une autre erreur n’est jamais rejouée', async () => {
    const { service, attempts } = build(['XX000']);
    await expect(service.page(gateway, query)).rejects.toMatchObject({ code: 'XX000' });
    expect(attempts()).toBe(1);
  });

  it('42501 (passerelle retirée entre la garde et l’appel) : même 401 que la garde, sans rejeu', async () => {
    const { service, attempts } = build(['42501']);
    await expect(service.page(gateway, query)).rejects.toBeInstanceOf(ProblemException);
    expect(attempts()).toBe(1);
  });
});
