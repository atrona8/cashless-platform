package sn.cashless.nfcbench.core

import java.nio.ByteBuffer
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/*
 * Étape 4 du tap : obtenir PWD (4 o) / PACK (2 o) du bracelet.
 *
 * En production : cache local de blobs chiffrés (AES-256-GCM, clé de données fournie par le
 * serveur) ou appel serveur. Le terminal ne détient JAMAIS la clé maître KDF.
 *
 * Dans le banc, trois sources interchangeables :
 *   - TestTableProvider     : table UID → PWD/PACK chargée depuis Flutter (le plus simple) ;
 *   - EncryptedBlobProvider : même chose que la prod (déchiffrement AES-GCM), pour mesurer le
 *                             coût réel du déchiffrement sur chaque téléphone ;
 *   - TestKdfProvider       : dérive PWD/PACK avec la clé maître DE TEST (bytes 0..31) ;
 *                             pratique pour personnaliser des lots, INTERDIT en production.
 */

class PwdPack(val pwd: ByteArray, val pack: ByteArray) {
    init {
        require(pwd.size == 4 && pack.size == 2) { "PWD 4 o / PACK 2 o" }
    }
}

fun interface PwdPackProvider {
    /** @return null si le bracelet / l'index de clé est inconnu (rejet « clé inconnue »). */
    fun lookup(uid: ByteArray, header: Header): PwdPack?
}

/** Table locale : clé = UID en hexadécimal minuscule. */
class TestTableProvider(private val table: Map<String, PwdPack>) : PwdPackProvider {
    override fun lookup(uid: ByteArray, header: Header): PwdPack? = table[uid.toHex()]
}

/** Contexte commun KDF / AAD. */
object PwdPackCrypto {
    val PWD_LABEL = "CASHLESS/UL-EV1/PWD/v1".toByteArray(Charsets.US_ASCII)
    val AAD_LABEL = "CASHLESS/PWDPACK/v1".toByteArray(Charsets.US_ASCII)

    fun uuidBytes(u: UUID): ByteArray =
        ByteBuffer.allocate(16).putLong(u.mostSignificantBits).putLong(u.leastSignificantBits).array()

    private fun ki(keyIndex: Int) = byteArrayOf((keyIndex shr 8).toByte(), keyIndex.toByte())

    /** Message NIST SP 800-108 (mode compteur, 1 bloc, L = 48 bits) — identique à vecteurs_test_bracelet.py. */
    fun kdfMessage(op: UUID, keyIndex: Int, uid: ByteArray): ByteArray =
        byteArrayOf(0, 0, 0, 1) + PWD_LABEL + byteArrayOf(0) + uuidBytes(op) + ki(keyIndex) + uid +
            byteArrayOf(0, 0, 0, 48)

    fun derive(masterKey: ByteArray, op: UUID, keyIndex: Int, uid: ByteArray): PwdPack {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(masterKey, "HmacSHA256"))
        val okm = mac.doFinal(kdfMessage(op, keyIndex, uid))
        return PwdPack(okm.copyOfRange(0, 4), okm.copyOfRange(4, 6))
    }

    fun aad(mediaId: UUID, op: UUID, keyIndex: Int, uid: ByteArray): ByteArray =
        AAD_LABEL + uuidBytes(mediaId) + uuidBytes(op) + ki(keyIndex) + uid

    /** blob = nonce(12) ‖ chiffré(6) ‖ tag GCM(16). Lève AEADBadTagException si l'AAD diffère. */
    fun decrypt(dek: ByteArray, blob: ByteArray, aad: ByteArray): PwdPack {
        require(blob.size == 34) { "pwd_pack_enc : 34 octets" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(dek, "AES"), GCMParameterSpec(128, blob, 0, 12))
        c.updateAAD(aad)
        val okm = c.doFinal(blob, 12, 22)
        return PwdPack(okm.copyOfRange(0, 4), okm.copyOfRange(4, 6))
    }
}

/** TEST UNIQUEMENT : clé maître de test dans le terminal. */
class TestKdfProvider(
    private val testMasterKey: ByteArray,
    private val operator: UUID,
    private val allowedKeyIndexes: Set<Int>? = null,
) : PwdPackProvider {
    init {
        require(testMasterKey.size == 32) { "clé HMAC 32 octets" }
    }

    override fun lookup(uid: ByteArray, header: Header): PwdPack? {
        if (allowedKeyIndexes != null && header.keyIndex !in allowedKeyIndexes) return null
        return PwdPackCrypto.derive(testMasterKey, operator, header.keyIndex, uid)
    }
}

/** Même chemin que la production : cache de blobs chiffrés + déchiffrement à chaque tap. */
class EncryptedBlobProvider(
    private val dek: ByteArray,
    private val operator: UUID,
    private val entries: Map<String, Entry>,
) : PwdPackProvider {
    class Entry(val mediaId: UUID, val keyIndex: Int, val blob: ByteArray)

    override fun lookup(uid: ByteArray, header: Header): PwdPack? {
        val e = entries[uid.toHex()] ?: return null
        if (e.keyIndex != header.keyIndex) return null
        return try {
            PwdPackCrypto.decrypt(dek, e.blob, PwdPackCrypto.aad(e.mediaId, operator, header.keyIndex, uid))
        } catch (_: javax.crypto.AEADBadTagException) {
            null
        }
    }
}
