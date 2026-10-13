// Cœur de la configuration (mission configuration-parties-evenements, WP06) : cascade versionnée. Le catalogue, les
// bornes, les messages et les valeurs provisoires sont des fonctions pures, importées directement. Global : les
// modules des routes (plateforme, organisation, événements) s'appuient sur CascadeService sans le redéclarer.
import { Global, Module } from '@nestjs/common';
import { CascadeService } from './cascade.service';

@Global()
@Module({ providers: [CascadeService], exports: [CascadeService] })
export class ConfigurationCoreModule {}
