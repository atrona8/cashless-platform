// Moteur d'écritures branché sur la configuration réelle (mission configuration-parties-evenements, WP12) : le port
// CONFIG_RESOLVER du moteur est fourni par SqlConfigResolver. Les modules des missions suivantes importent ce module
// pour écrire dans le grand livre ; les tests du moteur qui injectent une fixture gardent leur propre enregistrement
// (`LedgerModule.register(fixture)`).
import { Module } from '@nestjs/common';
import { CONFIG_RESOLVER, LedgerModule } from '../ledger/ledger.module';
import { SqlConfigResolver } from './sql-config-resolver';

const ledger = LedgerModule.register({ provide: CONFIG_RESOLVER, useClass: SqlConfigResolver });

@Module({ imports: [ledger], exports: [ledger] })
export class ConfigResolverModule {}
