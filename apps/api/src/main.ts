// Point d'entrée de l'API publique (SPECIFICATION §2, §3.2). Aucun droit sur le service de clés des bracelets.
import 'reflect-metadata';
import { loadConfig } from './config/config';
import { serve } from './processes/bootstrap';
import { PublicProcessModule } from './processes/public.module';

void serve(PublicProcessModule, loadConfig().port);
