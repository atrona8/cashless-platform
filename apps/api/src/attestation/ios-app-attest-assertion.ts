// Vérification d'une ASSERTION App Attest (OP-N64 « côté serveur prêt », mission
// durcissements-serveur, WP13 ; interfaces.md `IosAppAttestAssertionVerifier`), selon la procédure
// d'Apple « Validating apps that connect to your server ». AUCUNE route ne l'appelle : la borne iOS
// (`POST /media/auth-keys` refuse un terminal iOS) reste intacte, sa levée dépend de l'app
// (mission 12).
//
// Ordre : objet CBOR `{ signature, authenticatorData }` strict ; `nonce = SHA-256(authenticatorData
// ‖ clientDataHash)` ; lecture de la clé et du compteur de l'appareil (sous RLS, SELECT seul) ;
// signature DER vérifiée sur `nonce` TRAITÉ COMME UN MESSAGE (ECDSA-SHA256 le hache une seconde
// fois : c'est la procédure d'Apple, ne jamais le passer comme déjà haché) ; `rpIdHash` ; compteur
// strictement croissant ; enfin avance atomique par `advance_app_attest_counter` (dernier effet,
// une seule instruction conditionnelle côté base : jamais « lire puis écrire » ici).
//
// LIMITE (R1 de la recherche) : les vecteurs de test sont produits par nous ; une erreur de double
// hachage serait invisible. UN VECTEUR RÉEL D'APPLE EST EXIGÉ AVANT LA MISSION 12.
// Rien de secret n'est journalisé : ni la signature, ni la clé, ni l'objet CBOR, ni le compteur.
//
// À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, CLAUDE.md « Revue »).
import { createHash, createPublicKey, timingSafeEqual, verify as ecdsaVerify } from 'node:crypto';
import { decode } from 'cbor2';
import type { TxClient } from '../db/tenant-tx';
import { AttestationError } from './attestation.port';

/** Bornes : un objet démesuré est refusé avant tout décodage. */
const MAX_ASSERTION_BYTES = 1024;
const AUTHENTICATOR_DATA_BYTES = 37;
const RP_ID_HASH_END = 32;
const FLAGS_OFFSET = 32;
const COUNTER_OFFSET = 33;
/** Drapeau « attested credential data » : absent d'une assertion. */
const FLAG_AT = 0x40;
const MAX_COUNTER = 4_294_967_295;
/** Erreur de la base : prestataire de session absent, compteur hors plage, appareil refusé ou
 * révoqué. */
const SQLSTATE_APP_ATTEST_REFUSED = 'CL059';

export interface IosAppAttestAssertionSettings {
  teamId: string;
  bundleId: string;
}

export interface IosAssertionInput {
  deviceId: string;
  /** Objet CBOR d'assertion, tel que reçu. */
  assertion: Buffer;
  /** Condensé de la requête, déjà calculé par l'appelant (le choix des champs : mission 12). */
  clientDataHash: Buffer;
}

interface StoredKey {
  key_id: Buffer;
  public_key: Buffer;
  /** `bigint` : le client `pg` de l'API lit les int8 en BigInt. */
  counter: string | bigint;
}

function fail(reason: string): never {
  throw new AttestationError(`iOS assertion : ${reason}`);
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function bytes(value: unknown, name: string): Buffer {
  if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8Array]')
    return fail(`${name} : chaîne d’octets attendue`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export class IosAppAttestAssertionVerifier {
  private readonly rpIdHash: Buffer;

  constructor(settings: IosAppAttestAssertionSettings) {
    this.rpIdHash = sha256(Buffer.from(`${settings.teamId}.${settings.bundleId}`, 'utf8'));
  }

  /**
   * `client` : client DANS la transaction du prestataire (`TenantTx.run`) ; la fonction de la base
   * compare le prestataire de session. Résout si l'assertion est valide et le compteur avancé ;
   * sinon lève `AttestationError` (raison interne, jamais renvoyée au client).
   */
  async verify(input: IosAssertionInput, client: TxClient): Promise<void> {
    const { signature, authenticatorData } = this.decode(input.assertion);
    const nonce = sha256(authenticatorData, input.clientDataHash);

    const { rows } = await client.query<StoredKey>(
      `SELECT key_id, public_key, counter FROM device_app_attest_key WHERE device_id = $1`,
      [input.deviceId],
    );
    const stored = rows[0];
    if (!stored) return fail('appareil sans clé App Attest');

    this.checkSignature(stored.public_key, nonce, signature);
    if (!sameBytes(authenticatorData.subarray(0, RP_ID_HASH_END), this.rpIdHash))
      fail('rpIdHash d’une autre application');
    const signCount = authenticatorData.readUInt32BE(COUNTER_OFFSET);
    if (!(signCount > Number(stored.counter))) fail('compteur non croissant');
    await this.advance(client, input.deviceId, stored.key_id, signCount);
  }

  /** CBOR : exactement `signature` et `authenticatorData` ; 37 octets, drapeau AT absent. */
  private decode(raw: Buffer): { signature: Buffer; authenticatorData: Buffer } {
    if (raw.length === 0 || raw.length > MAX_ASSERTION_BYTES) fail('objet de taille refusée');
    let object: unknown;
    try {
      object = decode(raw, {
        preferMap: true,
        rejectDuplicateKeys: true,
        rejectStreaming: true,
        ignoreGlobalTags: true,
      });
    } catch {
      return fail('objet illisible (CBOR)');
    }
    if (!(object instanceof Map)) return fail('table CBOR attendue');
    const keys = [...object.keys()].sort();
    if (keys.length !== 2 || keys[0] !== 'authenticatorData' || keys[1] !== 'signature')
      fail('clés attendues : signature et authenticatorData');
    const signature = bytes(object.get('signature'), 'signature');
    const authenticatorData = bytes(object.get('authenticatorData'), 'authenticatorData');
    if (authenticatorData.length !== AUTHENTICATOR_DATA_BYTES)
      fail('authenticatorData de longueur inattendue');
    if ((authenticatorData[FLAGS_OFFSET]! & FLAG_AT) !== 0) fail('drapeau de clé attestée présent');
    return { signature, authenticatorData };
  }

  /** ECDSA P-256 / SHA-256 sur `nonce` COMME MESSAGE, signature DER. */
  private checkSignature(spki: Buffer, nonce: Buffer, signature: Buffer): void {
    let valid = false;
    try {
      const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
        return fail('clé enregistrée autre que P-256');
      valid = ecdsaVerify('sha256', nonce, { key, dsaEncoding: 'der' }, signature);
    } catch (error) {
      if (error instanceof AttestationError) throw error;
      return fail('signature illisible');
    }
    if (!valid) fail('signature invalide');
  }

  /** Dernier effet : une seule fonction conditionnelle côté base ; faux = rejeu ou perte de
   * course. */
  private async advance(
    client: TxClient,
    deviceId: string,
    keyId: Buffer,
    signCount: number,
  ): Promise<void> {
    if (signCount > MAX_COUNTER) fail('compteur hors plage');
    let advanced: boolean;
    try {
      const { rows } = await client.query<{ advanced: boolean }>(
        'SELECT advance_app_attest_counter($1, $2, $3) AS advanced',
        [deviceId, keyId, signCount],
      );
      advanced = rows[0]?.advanced === true;
    } catch (error) {
      if ((error as { code?: string }).code === SQLSTATE_APP_ATTEST_REFUSED)
        return fail('appareil refusé');
      throw error;
    }
    if (!advanced) fail('compteur non avancé (rejeu ou assertion concurrente)');
  }
}
