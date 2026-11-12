// Type des corps HTTP, lignes SQL et doubles de test dont la forme n'est pas modélisée : les suites
// y lisent des champs sans les déclarer un à un. Unique emplacement de `any` des tests de ce lot ;
// jamais utilisé dans le code livré (`src/`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
