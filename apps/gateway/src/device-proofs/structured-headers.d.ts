// `structured-headers` publie ses types par le champ `exports`, que la résolution `node` du dépôt
// (tsconfig.base.json) ne lit pas : les types sont repris ici du fichier publié, sans copie.
declare module 'structured-headers' {
  export * from 'structured-headers/dist/index';
}
