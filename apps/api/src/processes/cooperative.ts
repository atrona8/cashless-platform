// Calcul long sans bloquer la boucle d'événements (WP21, NFR-005). Un travailleur qui traite 50 000 lignes d'un
// coup, d'un seul tenant, empêche tout le reste du processus d'avancer, y compris le traitement urgent d'un autre
// grand livre. On découpe donc en tranches et on rend la main entre deux (`setImmediate` : les entrées-sorties en
// attente passent avant la tranche suivante). Rien n'est changé au résultat : seul l'ordonnancement diffère.

/** Nombre de lignes traitées entre deux rendus de la main (quelques millisecondes de calcul au plus). */
export const SLICE_ROWS = 500;

/** Rend la main à la boucle d'événements. */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
