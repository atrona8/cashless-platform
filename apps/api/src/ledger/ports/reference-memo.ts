// Mémoire de données de RÉFÉRENCE, limitée à l'exécution d'UN lot hors ligne (NFR-003, mission 7, lot WP21 part J).
// Créée par la boucle du lot, jetée à sa fin : jamais partagée entre lots, terminaux ou prestataires (le chemin en ligne
// n'en passe jamais). Ne reçoit QUE des lectures d'objets immuables par construction (désignés par leur identifiant) :
// aucun statut, aucune entrée de conformité, aucun solde, aucune donnée datée de l'heure de l'opération, aucun verrou.
// Seuls les succès sont gardés : une lecture qui échoue (donnée absente, panne) sera refaite à l'appel suivant.
export class ReferenceMemo {
  private readonly values = new Map<string, Promise<unknown>>();
  private loads = 0;

  /** Rend la valeur gardée sous `key` ; sinon la charge (une seule fois, même appelée en même temps) et la garde. */
  remember<T>(key: string, load: () => Promise<T>): Promise<T> {
    const known = this.values.get(key);
    if (known) return known as Promise<T>;
    this.loads += 1;
    const pending = load().catch((error: unknown) => {
      this.values.delete(key);
      throw error;
    });
    this.values.set(key, pending);
    return pending;
  }

  /** Nombre de lectures réellement faites (les autres appels ont été servis par la mémoire). */
  get loadCount(): number {
    return this.loads;
  }
}
