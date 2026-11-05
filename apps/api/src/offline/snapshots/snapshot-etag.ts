// ETag d'un snapshot servi (R-30.9) : `"<grand livre>:<version>:<terminal>:<empreinte clé d'accord>"`.
// Lié au terminal appelant (identité du jeton) et à sa clé d'accord courante : un autre terminal ne
// peut ni obtenir ni deviner un `304` sur l'ETag d'un tiers, et une clé d'accord changée change l'ETag.
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function snapshotEtag(
  ledgerId: string,
  version: string,
  deviceId: string,
  agreementKeySha256: string,
): string {
  if (
    !UUID.test(ledgerId) ||
    !UUID.test(deviceId) ||
    !/^[0-9]+$/.test(version) ||
    !HEX64.test(agreementKeySha256)
  )
    throw new Error('Composants de l’ETag du snapshot invalides.');
  return `"${ledgerId}:${version}:${deviceId}:${agreementKeySha256}"`;
}
