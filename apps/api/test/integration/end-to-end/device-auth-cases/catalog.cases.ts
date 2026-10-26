// Cas de la matrice des preuves du terminal apportés par le lot WP10 (catalogue) : aucun. Le lot
// n'ajoute aucune route de terminal — les sept routes du catalogue sont des routes de personne
// (back-office, `CatalogController`), et `GET /device/config`, qui sert désormais le catalogue, a
// déjà
// son cas dans la matrice. Fichier vide permis par le registre (`registry.ts`) : il marque que le
// lot
// a été passé en revue, sans dupliquer le cas de la configuration.
import type { CaseFile } from './registry';

const file: CaseFile = {
  controllers: [],
  cases: () => ({}),
};

export const { controllers, cases } = file;
