// Portée du back-office des terminaux (`deviceScope`, relecture de WP16, défense en profondeur) :
// tout le prestataire n'est donné que par une attribution OPERATOR_ADMIN de portée OPERATOR sur le
// prestataire de la requête ; une attribution d'une autre forme (autre prestataire, autre type de
// portée) ne l'élargit jamais. La base refuse déjà ces attributions (role_assignment_guard,
// device-isolation.spec.ts) : ce test échoue si le contrôle applicatif est retiré.
import { randomUUID } from 'node:crypto';
import { deviceScope } from '../../src/devices/admin/device-admin.service';
import type { Assignment } from '../../src/identity/principal';

const operatorId = randomUUID();
const organizer = randomUUID();
const actor = (assignments: Assignment[]) => ({
  operatorId,
  principal: {
    userId: randomUUID(),
    operatorId,
    assignments,
    issuer: 'https://idp.test',
    subject: 'personne',
  },
});

describe('deviceScope', () => {
  it('OPERATOR_ADMIN de portée OPERATOR sur ce prestataire : tout le prestataire', () => {
    expect(
      deviceScope(actor([{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: operatorId }])),
    ).toBeNull();
  });

  it('OPERATOR_ADMIN sur un autre prestataire : jamais tout le prestataire', () => {
    expect(
      deviceScope(
        actor([{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: randomUUID() }]),
      ),
    ).toEqual([]);
  });

  it('OPERATOR_ADMIN d’une autre portée (mal formée) : seuls les organisateurs administrés', () => {
    expect(
      deviceScope(
        actor([
          { role: 'OPERATOR_ADMIN', scopeType: 'ORGANIZER', scopeId: operatorId },
          { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: null },
          { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizer },
        ]),
      ),
    ).toEqual([organizer]);
  });

  it('ORGANIZER_ADMIN : ses organisateurs seulement', () => {
    expect(
      deviceScope(actor([{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizer }])),
    ).toEqual([organizer]);
  });
});
