// Colis de mots de passe des passerelles : travailleur du processus `tag-keys` (WP15, T068).
// Importé par `processes/tag-keys.module.ts` (une ligne) ; aucun contrôleur ni route.
// Configuration : `EDGE_PACK_OPERATORS` = UUID de prestataires séparés par des virgules (décision 43,
// ADR-184). Un UUID mal formé refuse le démarrage ; liste vide ou absente : aucun colis déposé.
import { Module } from '@nestjs/common';
import { KeysTagKeysModule } from '../../media/keys/keys-tag-keys.module';
import { EdgePacksService } from './edge-packs.service';

@Module({ imports: [KeysTagKeysModule], providers: [EdgePacksService] })
export class EdgePacksModule {}
