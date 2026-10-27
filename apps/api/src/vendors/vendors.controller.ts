// Routes du back-office des vendeurs (mission 5b, lot WP09, T039) : `listVendors`, `createVendor`,
// `getVendor`, `setVendorPin`, `setVendorStatus`. Personne authentifiée (garde globale) ;
// prestataire de la transaction : celui de la personne. Rôles : `OPERATOR_ADMIN` (tout le
// prestataire), `MERCHANT_ADMIN` (ses commerçants) ; autre rôle : 403 ; hors portée : 404.
// Écritures idempotentes (`bo:`) ; l'empreinte du PIN est calculée AVANT la transaction (aucune
// transaction ouverte pendant argon2) ; la réponse enregistrée ne contient ni PIN ni empreinte.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import type { Role } from '../identity/principal';
import { pageOf, pageRequest, requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { VendorPinHasher } from '../vendor-pin/vendor-pin.hasher';
import {
  parseVendorCreate,
  parseVendorPinChange,
  parseVendorStatusChange,
  parseVendorStatusFilter,
  vendorDto,
} from './vendors.dto';
import { assertMerchantInScope, VendorsService } from './vendors.service';

const VENDOR_ADMINS: readonly Role[] = ['OPERATOR_ADMIN', 'MERCHANT_ADMIN'];

@Controller()
export class VendorsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly vendors: VendorsService,
    private readonly hasher: VendorPinHasher,
  ) {}

  @Get('merchants/:merchant_id/vendors')
  list(
    @Req() req: Request,
    @Param('merchant_id') merchantId: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, VENDOR_ADMINS);
    const merchant = requireUuid(merchantId);
    const filter = parseVendorStatusFilter(status);
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) =>
      pageOf(await this.vendors.list(client, actor, merchant, filter, page), page, vendorDto),
    );
  }

  @Post('merchants/:merchant_id/vendors')
  @Idempotent({ scope: 'bo:', pinFields: ['pin'] })
  async create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('merchant_id') merchantId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, VENDOR_ADMINS);
    const merchant = requireUuid(merchantId);
    const input = parseVendorCreate(body);
    // Hors portée : 404 avant tout calcul d'empreinte.
    assertMerchantInScope(actor, merchant);
    const pinHash = await this.hasher.hash(input.pin);
    return tx.run(async (client) => {
      const created = await this.vendors.create(
        client,
        actor,
        merchant,
        input.displayName,
        pinHash,
      );
      res.setHeader('Location', `/v1/vendors/${created.vendor_id}`);
      return created;
    });
  }

  @Get('vendors/:vendor_id')
  async get(@Req() req: Request, @Param('vendor_id') vendorId: string) {
    const actor = this.access.actor(req, VENDOR_ADMINS);
    const id = requireUuid(vendorId);
    return vendorDto(
      await this.access.read(actor, (client) => this.vendors.find(client, actor, id)),
    );
  }

  @Post('vendors/:vendor_id/pin')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:', pinFields: ['pin'] })
  async setPin(
    @Req() req: Request,
    @Param('vendor_id') vendorId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, VENDOR_ADMINS);
    const id = requireUuid(vendorId);
    const pinHash = await this.hasher.hash(parseVendorPinChange(body));
    return tx.run((client) => this.vendors.setPin(client, actor, id, pinHash));
  }

  @Post('vendors/:vendor_id/status')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  setStatus(
    @Req() req: Request,
    @Param('vendor_id') vendorId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, VENDOR_ADMINS);
    const id = requireUuid(vendorId);
    const status = parseVendorStatusChange(body);
    return tx.run((client) => this.vendors.setStatus(client, actor, id, status));
  }
}
