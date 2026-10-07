package sn.cashless.nfcbench.core

/*
 * Logique PURE (aucune dépendance Android) du protocole MIFARE Ultralight EV1 MF0UL11
 * et du format B des bracelets. Miroir exact de reference/ev1_format.py ; les deux sont
 * testés sur les mêmes vecteurs (vecteurs_test_bracelet.py).
 *
 * Carte mémoire MF0UL11 : 20 pages de 4 octets (0x00..0x13)
 *   0x00-0x03 UID / verrous / OTP     0x04-0x0F utilisateur (format B en 0x04-0x0A)
 *   0x10 CFG0 = MOD, RFU, RFU, AUTH0  0x11 CFG1 = ACCESS, VCTID, RFU, RFU
 *   0x12 PWD (relu à 00)              0x13 PACK(2) + RFU(2)
 *
 * Source : datasheet NXP MF0ULX1 (MIFARE Ultralight EV1), citée de mémoire —
 * voir « Points à vérifier » dans le README.
 */
object Ev1 {
    const val PAGE_SIZE = 4
    const val MF0UL11_PAGES = 20

    const val PAGE_HEADER = 0x04
    const val PAGE_BODY_FIRST = 0x05
    const val PAGE_BODY_LAST = 0x0A
    const val PAGE_CFG0 = 0x10
    const val PAGE_CFG1 = 0x11
    const val PAGE_PWD = 0x12
    const val PAGE_PACK = 0x13

    const val CMD_GET_VERSION: Byte = 0x60
    const val CMD_READ: Byte = 0x30
    const val CMD_FAST_READ: Byte = 0x3A
    const val CMD_WRITE: Byte = 0xA2.toByte()
    const val CMD_PWD_AUTH: Byte = 0x1B
    const val CMD_READ_CNT: Byte = 0x39
    const val CMD_INCR_CNT: Byte = 0xA5.toByte()
    const val CMD_READ_SIG: Byte = 0x3C

    const val ACK = 0x0A
    const val COUNTER_CLONE = 2
    const val COUNTER_MAX = 0xFFFFFF

    const val ACCESS_PROT = 0x80
    const val ACCESS_CFGLCK = 0x40
    const val ACCESS_AUTHLIM_MASK = 0x07

    /** Réponse GET_VERSION de référence (MF0UL11, 17 pF). */
    val GET_VERSION_MF0UL11: ByteArray = hex("0004030101000b03")

    val NAK_LABELS = mapOf(
        0x0 to "argument invalide",
        0x1 to "erreur parité/CRC",
        0x4 to "AUTHLIM atteint",
        0x5 to "erreur écriture EEPROM",
    )

    // ---------------------------------------------------------------- trames
    // Pas de CRC_A : NfcA.transceive l'ajoute (et le retire des réponses).

    private fun page(p: Int): Byte {
        require(p in 0 until MF0UL11_PAGES) { "page hors MF0UL11 : $p" }
        return p.toByte()
    }

    private fun counter(n: Int): Byte {
        require(n in 0..2) { "compteur 0..2" }
        return n.toByte()
    }

    fun cmdGetVersion() = byteArrayOf(CMD_GET_VERSION)
    fun cmdRead(p: Int) = byteArrayOf(CMD_READ, page(p))

    fun cmdFastRead(start: Int, end: Int): ByteArray {
        require(end >= start) { "FAST_READ : end < start" }
        return byteArrayOf(CMD_FAST_READ, page(start), page(end))
    }

    fun cmdWrite(p: Int, data: ByteArray): ByteArray {
        require(data.size == 4) { "WRITE : 4 octets" }
        return byteArrayOf(CMD_WRITE, page(p)) + data
    }

    fun cmdPwdAuth(pwd: ByteArray): ByteArray {
        require(pwd.size == 4) { "PWD : 4 octets" }
        return byteArrayOf(CMD_PWD_AUTH) + pwd
    }

    fun cmdReadCnt(n: Int) = byteArrayOf(CMD_READ_CNT, counter(n))

    /** INCR_CNT : incrément sur 3 octets LSB d'abord + 1 octet ignoré, mis à 0. */
    fun cmdIncrCnt(n: Int, increment: Int = 1): ByteArray {
        require(increment in 0..COUNTER_MAX) { "incrément sur 24 bits" }
        return byteArrayOf(
            CMD_INCR_CNT, counter(n),
            (increment and 0xFF).toByte(), ((increment shr 8) and 0xFF).toByte(),
            ((increment shr 16) and 0xFF).toByte(), 0,
        )
    }

    fun cmdReadSig() = byteArrayOf(CMD_READ_SIG, 0x00)

    // ---------------------------------------------------------------- réponses

    /** READ_CNT → 3 octets LSB d'abord. */
    fun decodeReadCnt(r: ByteArray): Int {
        if (r.size != 3) throw FormatException("READ_CNT : 3 octets attendus, ${r.size} reçus")
        return (r[0].toInt() and 0xFF) or ((r[1].toInt() and 0xFF) shl 8) or ((r[2].toInt() and 0xFF) shl 16)
    }

    /** true = ACK, false = NAK (code = nibble bas). Réponse 4 bits remontée sur 1 octet. */
    fun isAck(r: ByteArray): Boolean = r.size == 1 && (r[0].toInt() and 0x0F) == ACK

    /**
     * Vérifie un MF0UL11 : vendeur 04 (NXP), type 03 (Ultralight), sous-type 01 (17 pF) ou
     * 02 (50 pF), version majeure 01, taille 0B, protocole 03. MF0UL21 (taille 0E), NTAG21x
     * (type 04) et cartes « magiques » à réponse non conforme sont rejetés.
     */
    fun isMf0ul11(v: ByteArray): Boolean =
        v.size == 8 && v[1].toInt() == 0x04 && v[2].toInt() == 0x03 &&
            (v[3].toInt() == 0x01 || v[3].toInt() == 0x02) &&
            v[4].toInt() == 0x01 && v[6].toInt() == 0x0B && v[7].toInt() == 0x03

    // ---------------------------------------------------------------- config

    fun accessByte(prot: Boolean, authlim: Int = 0, cfglck: Boolean = false): Int {
        require(authlim in 0..7) { "AUTHLIM sur 3 bits" }
        return (if (prot) ACCESS_PROT else 0) or (if (cfglck) ACCESS_CFGLCK else 0) or authlim
    }

    /** Remplace AUTH0 (octet 3 de CFG0) en conservant MOD et les RFU lus sur la puce. */
    fun cfg0WithAuth0(cfg0: ByteArray, auth0: Int): ByteArray {
        require(cfg0.size == 4 && auth0 in 0..0xFF)
        return cfg0.copyOf().also { it[3] = auth0.toByte() }
    }

    /** Remplace ACCESS (octet 0 de CFG1) ; conserve VCTID/RFU ; refuse si CFGLCK est posé. */
    fun cfg1WithAccess(cfg1: ByteArray, prot: Boolean, authlim: Int): ByteArray {
        require(cfg1.size == 4)
        if ((cfg1[0].toInt() and ACCESS_CFGLCK) != 0) {
            throw FormatException("CFGLCK posé : configuration verrouillée définitivement")
        }
        val rfu = cfg1[0].toInt() and 0x38
        return cfg1.copyOf().also { it[0] = (accessByte(prot, authlim) or rfu).toByte() }
    }

    fun packPage(pack: ByteArray): ByteArray {
        require(pack.size == 2) { "PACK : 2 octets" }
        return pack + byteArrayOf(0, 0)
    }

    // ---------------------------------------------------------------- CRC

    /**
     * CRC-32/ISO-HDLC : poly réfléchi 0xEDB88320, init/xorout 0xFFFFFFFF.
     * Contrôle : "123456789" → 0xCBF43926. (Équivalent à java.util.zip.CRC32 ; implémenté à la
     * main pour rester strictement identique à la référence Python et aux autres terminaux.)
     */
    fun crc32IsoHdlc(data: ByteArray, from: Int = 0, len: Int = data.size - from): Long {
        var crc = 0xFFFFFFFFL
        for (i in from until from + len) {
            crc = crc xor (data[i].toLong() and 0xFF)
            repeat(8) { crc = if (crc and 1L != 0L) (crc ushr 1) xor 0xEDB88320L else crc ushr 1 }
        }
        return crc xor 0xFFFFFFFFL
    }
}

class FormatException(msg: String) : Exception(msg)

/** En-tête (page 4) : lisible sans authentification (AUTH0 = 5). */
data class Header(val major: Int, val minor: Int, val keyIndex: Int) {
    companion object {
        fun parse(p: ByteArray): Header {
            if (p.size < 4) throw FormatException("page 4 : 4 octets attendus, ${p.size} reçus")
            return Header(p[0].u(), p[1].u(), (p[2].u() shl 8) or p[3].u())
        }

        fun build(major: Int, minor: Int, keyIndex: Int): ByteArray {
            require(major in 0..0xFF && minor in 0..0xFF) { "major/minor sur 1 octet" }
            require(keyIndex in 0..0xFFFF) { "key_index sur 2 octets" }
            return byteArrayOf(major.toByte(), minor.toByte(), (keyIndex shr 8).toByte(), keyIndex.toByte())
        }
    }
}

/** Format B, pages 4–10 (28 octets). */
class FormatB(
    val header: Header,
    val identity: ByteArray,
    val flags: Int,
    val reserved: ByteArray,
    val crcStored: Long,
    val crcComputed: Long,
) {
    val crcOk get() = crcStored == crcComputed

    companion object {
        const val LEN = 28

        /** @param corruptCrc bracelet volontairement hors format (lot de test). */
        fun build(
            major: Int, minor: Int, keyIndex: Int, identity: ByteArray,
            flags: Int = 0, reserved: ByteArray = ByteArray(3), corruptCrc: Boolean = false,
        ): ByteArray {
            require(identity.size == 16) { "identité : 16 octets" }
            require(reserved.size == 3 && flags in 0..0xFF)
            val body = Header.build(major, minor, keyIndex) + identity + byteArrayOf(flags.toByte()) + reserved
            var crc = Ev1.crc32IsoHdlc(body)
            if (corruptCrc) crc = crc xor 0xFF
            return body + beU32(crc)
        }

        /** 28 octets (page 4 + pages 5–10). Ne lève pas sur CRC faux : voir [crcOk]. */
        fun parse(d: ByteArray): FormatB {
            if (d.size != LEN) throw FormatException("format B : $LEN octets attendus, ${d.size} reçus")
            return FormatB(
                Header.parse(d.copyOfRange(0, 4)), d.copyOfRange(4, 20), d[20].u(),
                d.copyOfRange(21, 24), readBeU32(d, 24), Ev1.crc32IsoHdlc(d, 0, 24),
            )
        }
    }
}

// ------------------------------------------------------------------- utilitaires

internal fun Byte.u(): Int = toInt() and 0xFF

fun beU32(v: Long) = byteArrayOf((v shr 24).toByte(), (v shr 16).toByte(), (v shr 8).toByte(), v.toByte())

fun readBeU32(d: ByteArray, off: Int): Long =
    ((d[off].u().toLong() shl 24) or (d[off + 1].u().toLong() shl 16) or
        (d[off + 2].u().toLong() shl 8) or d[off + 3].u().toLong())

fun hex(s: String): ByteArray {
    val c = s.replace(" ", "")
    require(c.length % 2 == 0)
    return ByteArray(c.length / 2) { c.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
}

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
