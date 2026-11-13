import { unavailableCatchUp } from '../../src/authority/ports';
import type { GatewayConfig } from '../../src/config/config';
import { REPLICATION_CATCH_UP } from '../../src/authority/ports';
import { assertRuntimeSafe } from '../../src/processes/bootstrap';
import { StartupRefusedError, evaluateProviderRules } from '../../src/processes/startup-guard';
import { DrainService } from '../../src/queue/drain.service';
import { ReplicationService } from '../../src/replication/replication.service';

const prod = { production: true } as GatewayConfig;
const dev = { production: false } as GatewayConfig;
const keystore = { isFake: false };

describe('aucun bouchon de rattrapage en production', () => {
  it('le bouchon de WP17 refuse le démarrage en production', () => {
    const v = evaluateProviderRules(prod, {
      keystore,
      catchUp: unavailableCatchUp,
      deltaPurgeProvided: true,
    });
    expect(v.join()).toContain('REPLICATION_CATCH_UP');
  });
  it('l’absence de fournisseur refuse aussi', () => {
    expect(
      evaluateProviderRules(prod, {
        keystore,
        catchUp: undefined,
        deltaPurgeProvided: true,
      }).join(),
    ).toContain('REPLICATION_CATCH_UP');
  });
  it('le vrai service est accepté ; hors production rien n’est refusé', () => {
    const real = Object.create(ReplicationService.prototype);
    expect(
      evaluateProviderRules(prod, { keystore, catchUp: real, deltaPurgeProvided: true }),
    ).toEqual([]);
    expect(
      evaluateProviderRules(dev, {
        keystore,
        catchUp: unavailableCatchUp,
        deltaPurgeProvided: true,
      }),
    ).toEqual([]);
  });
  it('le module de la passerelle ne déclare plus le bouchon', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${__dirname}/../../src/authority/authority.module.ts`, 'utf8');
    expect(src).not.toMatch(/provide: REPLICATION_CATCH_UP/);
  });

  // B2 : le chemin réel (bootstrap -> assertRuntimeSafe) porte le fournisseur de rattrapage.
  describe('assertRuntimeSafe (chemin réel du démarrage)', () => {
    // Clé TLS client hors sujet ici (décision 32, contrôlée par `client-key-file.spec.ts`).
    const config = {
      production: true,
      databaseUrl: 'postgres://u:p@127.0.0.1:1/x',
      centralClientKeyFile: null,
    } as never;
    const appWith = (catchUp: () => unknown) =>
      ({
        get: (token: unknown) => {
          if (token === REPLICATION_CATCH_UP) return catchUp();
          // WP20 : la vraie règle DELTA_PURGE est branchée (sinon refus, testé ailleurs).
          if (token === DrainService) return { hasDeltaPurge: true };
          return keystore;
        },
      }) as never;
    it('bouchon unavailableCatchUp : démarrage refusé', async () => {
      await expect(
        assertRuntimeSafe(
          config,
          appWith(() => unavailableCatchUp),
        ),
      ).rejects.toThrow(/REPLICATION_CATCH_UP/);
    });
    it('aucun fournisseur (get lève) : démarrage refusé', async () => {
      const absent = () => {
        throw new Error('introuvable');
      };
      await expect(assertRuntimeSafe(config, appWith(absent))).rejects.toBeInstanceOf(
        StartupRefusedError,
      );
    });
    it('le vrai service passe la garde de fournisseurs (l’échec vient ensuite de la base)', async () => {
      const real = Object.create(ReplicationService.prototype);
      const error = await assertRuntimeSafe(
        config,
        appWith(() => real),
      ).catch((e) => e);
      expect(error).not.toBeInstanceOf(StartupRefusedError);
    });
  });
});
