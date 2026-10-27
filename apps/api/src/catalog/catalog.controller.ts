// Routes du catalogue (openapi.yaml, tag Catalogue : `getCatalog`, `createCatalogCategory`,
// `updateCatalogCategory`, `createCatalogItem`, `updateCatalogItem`, `getCatalogVersion`,
// `setCatalogPolicy` ; mission 5b, lot WP10). Personne authentifiée (garde globale) ; prestataire
// de la
// transaction : celui de la personne (aucun prestataire au chemin). Rôle absent : `403` ; portée et
// délégation : `CatalogService` puis la base (A21). Écritures idempotentes (`bo:`), une fonction de
// la
// base et une ligne d'audit dans `IdempotentTx.run`.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { pickLanguage } from '../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import {
  parseCategoryCreate,
  parseCategoryUpdate,
  parseItemCreate,
  parseItemUpdate,
  parsePolicy,
  parseVersionNumber,
} from './catalog.dto';
import { CATALOG_ROLES, CatalogService } from './catalog.service';

const language = (req: Request) => pickLanguage(req.header('Accept-Language'));

@Controller()
export class CatalogController {
  constructor(
    private readonly access: TenantAccess,
    private readonly catalog: CatalogService,
  ) {}

  @Get('points-of-sale/:pos_id/catalog')
  get(@Req() req: Request, @Param('pos_id') posId: string) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(posId);
    return this.access.read(actor, (client) => this.catalog.getCatalog(client, actor, id));
  }

  @Get('points-of-sale/:pos_id/catalog/versions/:version')
  version(@Req() req: Request, @Param('pos_id') posId: string, @Param('version') version: string) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(posId);
    const number = parseVersionNumber(version);
    return this.access.read(actor, (client) => this.catalog.getVersion(client, actor, id, number));
  }

  @Post('points-of-sale/:pos_id/catalog/categories')
  @Idempotent({ scope: 'bo:' })
  createCategory(
    @Req() req: Request,
    @Param('pos_id') posId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(posId);
    const input = parseCategoryCreate(body, language(req));
    return tx.run((client) => this.catalog.createCategory(client, actor, id, input));
  }

  @Patch('catalog-categories/:category_id')
  @Idempotent({ scope: 'bo:' })
  updateCategory(
    @Req() req: Request,
    @Param('category_id') categoryId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(categoryId);
    const input = parseCategoryUpdate(body, language(req));
    return tx.run((client) => this.catalog.updateCategory(client, actor, id, input));
  }

  @Post('catalog-categories/:category_id/items')
  @Idempotent({ scope: 'bo:' })
  createItem(
    @Req() req: Request,
    @Param('category_id') categoryId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(categoryId);
    const input = parseItemCreate(body, language(req));
    return tx.run((client) => this.catalog.createItem(client, actor, id, input));
  }

  @Patch('catalog-items/:item_id')
  @Idempotent({ scope: 'bo:' })
  updateItem(
    @Req() req: Request,
    @Param('item_id') itemId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(itemId);
    const input = parseItemUpdate(body, language(req));
    return tx.run((client) => this.catalog.updateItem(client, actor, id, input));
  }

  @Put('points-of-sale/:pos_id/catalog-policy')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  setPolicy(
    @Req() req: Request,
    @Param('pos_id') posId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, CATALOG_ROLES);
    const id = requireUuid(posId);
    const input = parsePolicy(body, language(req));
    return tx.run((client) => this.catalog.setPolicy(client, actor, id, input));
  }
}
