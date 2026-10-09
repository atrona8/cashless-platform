// Route publique (sans jeton). Contrat : `GET /v1/health` uniquement (contracts/identity.md).
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'identity:public';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
