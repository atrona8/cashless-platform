// Porteur de la perte (data-model.md, ligne 126) : la plateforme n'est jamais porteuse.
export type LossBearer = 'OPERATOR' | 'ORGANIZER' | 'MERCHANT';

export function lossBearer(
  providedBy: 'PLATFORM' | 'OPERATOR' | 'ORGANIZER' | 'MERCHANT',
): LossBearer {
  switch (providedBy) {
    case 'PLATFORM':
    case 'OPERATOR':
      return 'OPERATOR';
    case 'ORGANIZER':
      return 'ORGANIZER';
    case 'MERCHANT':
      return 'MERCHANT';
    default:
      throw new Error('provided_by inconnu');
  }
}
