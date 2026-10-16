// Garde des routes du festivalier : compte prouvé par le port, puis vérifié en base (festivalier de ce prestataire).
// Pose `req.customer` ; le prestataire de la transaction est celui du compte.
import {
  applyDecorators,
  Inject,
  Injectable,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ProblemException } from '../errors/problem';
import { Public } from '../identity/public.decorator';
import {
  CUSTOMER_DIRECTORY,
  CUSTOMER_IDENTITY,
  type CustomerDirectory,
  type CustomerIdentityPort,
  type CustomerRequest,
} from './customer-identity.port';

@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    @Inject(CUSTOMER_IDENTITY) private readonly identity: CustomerIdentityPort,
    @Inject(CUSTOMER_DIRECTORY) private readonly directory: CustomerDirectory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CustomerRequest>();
    const claims = await this.identity.identify(req);
    if (!claims || !(await this.directory.exists(claims.operatorId, claims.customerId)))
      throw new ProblemException('UNAUTHENTICATED');
    req.customer = claims;
    return true;
  }
}

/** Route appelée par l'app festivalier : pas de jeton de personne du personnel, compte festivalier obligatoire. */
export const CustomerAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Public(), UseGuards(CustomerGuard));
