// Unitaires : registre des actions à deux personnes (doublon refusé au démarrage, action inconnue).
import { Test } from '@nestjs/testing';
import { ApprovalActionRegistry, registerApprovalActions, type ApprovalActionDefinition } from '../../../src/approval/action-registry';

const definition = (action: ApprovalActionDefinition['action']): ApprovalActionDefinition => ({
  action,
  requiredRole: 'OPERATOR_ADMIN',
  scopeOf: () => ({ type: 'PLATFORM' }),
  validate: (payload) => payload as never,
  execute: () => Promise.resolve({ result: null }),
});

describe('ApprovalActionRegistry', () => {
  it('enregistre et retrouve une action ; action inconnue : undefined', () => {
    const registry = new ApprovalActionRegistry();
    registry.register(definition('WAIVE_SEQ_GAP'));
    expect(registry.get('WAIVE_SEQ_GAP')?.requiredRole).toBe('OPERATOR_ADMIN');
    expect(registry.get('PAYOUT')).toBeUndefined();
    expect(registry.get('INCONNUE')).toBeUndefined();
    expect(registry.all().map((d) => d.action)).toEqual(['WAIVE_SEQ_GAP']);
  });

  it('doublon : erreur', () => {
    const registry = new ApprovalActionRegistry();
    registry.register(definition('PAYOUT'));
    expect(() => registry.register(definition('PAYOUT'))).toThrow(/déjà enregistrée : PAYOUT/);
  });

  it('registerApprovalActions : enregistre au démarrage ; doublon entre deux modules : démarrage refusé', async () => {
    // Le registre est global (ApprovalModule) : les modules d'enregistrement le voient.
    const host = () => ({ module: class RegistryHost {}, global: true, providers: [ApprovalActionRegistry], exports: [ApprovalActionRegistry] });
    const ok = await Test.createTestingModule({ imports: [host(), registerApprovalActions(definition('LATE_CLAIM'))] }).compile();
    expect(ok.get(ApprovalActionRegistry).get('LATE_CLAIM')).toBeDefined();
    await expect(
      Test.createTestingModule({
        imports: [
          host(),
          registerApprovalActions(definition('PAYOUT')),
          registerApprovalActions(definition('PAYOUT')),
        ],
      }).compile(),
    ).rejects.toThrow(/déjà enregistrée : PAYOUT/);
  });
});
