// Route de guichet (terminal ET personne ; contrat `staffBearer`, décision du porteur du 20/10/2026,
// mission 5a, lot WP12) : le jeton d'appareil occupe `Authorization`, celui de la personne passe dans
// `X-Staff-Authorization: Bearer <JWT OIDC>`, vérifié exactement comme sur les routes des personnes.
// L'en-tête n'est lu que sur une route marquée ; présent sur toute autre route, la requête est
// refusée (401) : un jeton de personne n'est jamais lu à un endroit où la route ne l'attend pas.
import { SetMetadata } from '@nestjs/common';

export const STAFF_TOKEN_ROUTE = 'identity:staff-token';
export const STAFF_AUTHORIZATION_HEADER = 'x-staff-authorization';

export const StaffToken = (): MethodDecorator & ClassDecorator =>
  SetMetadata(STAFF_TOKEN_ROUTE, true);
