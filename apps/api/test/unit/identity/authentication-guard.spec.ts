// Garde d'authentification : `X-Staff-Authorization` n'est lu que sur une route de guichet
// (`@StaffToken()`, mission 5a, WP12). Relecture WP12 (M1) : ce test échoue si le refus de l'en-tête
// hors d'une route de guichet est retiré, sur une route de personne comme sur une route publique
// non-terminal (`GET /v1/health`). Sans base : vérifieur et lecture de la personne simulés.
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { AuthenticationGuard } from '../../../src/identity/authentication.guard';
import type { IdentityVerifier } from '../../../src/identity/oidc-verifier';
import { IS_PUBLIC } from '../../../src/identity/public.decorator';
import { STAFF_TOKEN_ROUTE } from '../../../src/identity/staff-token.decorator';

const PERSON = {
  user_id: '7d1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f',
  operator_id: '0b5f4c1e-8f1b-4d55-9a3c-1f2e3d4c5b6a',
  status: 'ACTIVE',
  assignments: [],
};

type Kind = 'person' | 'public' | 'staff';

function setup() {
  const verifier = {
    verifyAccess: jest.fn(async (token: string) => ({
      issuer: 'https://idp.test',
      subject: `sub-${token}`,
      expiresAt: new Date(Date.now() + 60_000),
    })),
    verifyApproval: jest.fn(),
  };
  const tx = { identify: jest.fn(async () => PERSON) };
  const guard = new AuthenticationGuard(
    new Reflector(),
    verifier as unknown as IdentityVerifier,
    tx as unknown as TenantTx,
  );
  const run = (kind: Kind, headers: Record<string, string>) => {
    // Métadonnées posées comme par `@Public()` et `@StaffToken()`.
    const handler = () => undefined;
    if (kind === 'public') Reflect.defineMetadata(IS_PUBLIC, true, handler);
    if (kind === 'staff') Reflect.defineMetadata(STAFF_TOKEN_ROUTE, true, handler);
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req: Record<string, unknown> = { header: (name: string) => lower[name.toLowerCase()] };
    const context = {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { result: guard.canActivate(context), req };
  };
  return { verifier, tx, run };
}

async function refused(promise: Promise<boolean>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemException);
    return (error as ProblemException).code;
  }
  throw new Error('requête acceptée');
}

describe('AuthenticationGuard : X-Staff-Authorization hors des routes de guichet (WP12, M1)', () => {
  it('route de personne : 401 avec un jeton valide dans Authorization, aucun jeton vérifié', async () => {
    const { verifier, tx, run } = setup();
    const { result, req } = run('person', {
      Authorization: 'Bearer personne',
      'X-Staff-Authorization': 'Bearer guichet',
    });
    expect(await refused(result)).toBe('UNAUTHENTICATED');
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
    expect(tx.identify).not.toHaveBeenCalled();
    expect(req.principal).toBeUndefined();
  });

  it('route publique non-terminal : 401 au lieu de laisser passer', async () => {
    const { verifier, run } = setup();
    const { result } = run('public', { 'X-Staff-Authorization': 'Bearer guichet' });
    expect(await refused(result)).toBe('UNAUTHENTICATED');
    expect(verifier.verifyAccess).not.toHaveBeenCalled();
  });

  it('en-tête vide ou mal formé : refusé aussi (présence seule)', async () => {
    const { run } = setup();
    for (const value of ['', 'Basic abc', 'Bearer'])
      expect(await refused(run('person', { 'X-Staff-Authorization': value }).result)).toBe(
        'UNAUTHENTICATED',
      );
  });

  it('contrôles : sans l’en-tête, la route de personne et la route publique passent', async () => {
    const { verifier, run } = setup();
    const person = run('person', { Authorization: 'Bearer personne' });
    expect(await person.result).toBe(true);
    expect(verifier.verifyAccess).toHaveBeenCalledWith('personne');
    expect(person.req.principal).toMatchObject({ userId: PERSON.user_id });
    expect(await run('public', {}).result).toBe(true);
  });

  it('route de guichet : le jeton de la personne est lu dans X-Staff-Authorization seulement', async () => {
    const { verifier, run } = setup();
    const ok = run('staff', {
      Authorization: 'Bearer jeton-appareil',
      'X-Staff-Authorization': 'Bearer guichet',
    });
    expect(await ok.result).toBe(true);
    expect(verifier.verifyAccess).toHaveBeenCalledTimes(1);
    expect(verifier.verifyAccess).toHaveBeenCalledWith('guichet');
    // Sans X-Staff-Authorization, le jeton d'Authorization n'est jamais pris pour celui de la personne.
    expect(await refused(run('staff', { Authorization: 'Bearer personne' }).result)).toBe(
      'UNAUTHENTICATED',
    );
    expect(verifier.verifyAccess).toHaveBeenCalledTimes(1);
  });
});
