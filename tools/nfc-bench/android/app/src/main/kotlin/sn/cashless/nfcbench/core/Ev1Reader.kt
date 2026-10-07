package sn.cashless.nfcbench.core

import java.io.IOException

/*
 * Ev1Reader : commandes MIFARE Ultralight EV1 au-dessus d'un [Transceiver].
 *
 * Le Transceiver est une abstraction de android.nfc.tech.NfcA : en production c'est
 * NfcATransceiver (paquet android) ; dans les tests JVM c'est un simulateur de puce.
 * Ainsi toute la logique (y compris la gestion d'erreurs) est testable sans téléphone.
 */

/** Échange brut d'une trame ISO 14443-3A (CRC_A ajouté/retiré par la couche basse). */
interface Transceiver {
    /** Ouvre la connexion (NfcA.connect). Par défaut : rien (déjà connecté). */
    @Throws(IOException::class)
    fun connect() {}

    /** Ferme la connexion (NfcA.close) ; ne lève jamais. */
    fun close() {}

    /**
     * @throws TagLostIOException si la puce a quitté le champ (android.nfc.TagLostException)
     * @throws IOException pour toute autre erreur. ATTENTION : sur de nombreux téléphones un NAK
     *         4 bits n'est PAS remonté comme un octet mais provoque une IOException
     *         (« Transceive failed ») — l'appelant ne peut donc pas toujours distinguer NAK et
     *         perte du tag. Voir [reconnect] pour lever l'ambiguïté a posteriori.
     */
    @Throws(IOException::class)
    fun transceive(cmd: ByteArray): ByteArray

    /**
     * Ferme puis rouvre la connexion (nouvelle sélection de la puce). Nécessaire après un NAK :
     * la puce EV1 repasse alors en état IDLE et n'accepte plus de commande tant qu'elle n'est pas
     * re-sélectionnée ; l'authentification PWD est perdue. Renvoie false si la puce est absente.
     */
    fun reconnect(): Boolean = false
}

/** Perte du tag (champ quitté). Sous-classe d'IOException comme android.nfc.TagLostException. */
class TagLostIOException(msg: String = "tag perdu", cause: Throwable? = null) : IOException(msg, cause)

class Ev1Exception(
    val kind: Kind,
    val command: String,
    message: String,
    val nakCode: Int? = null,
    cause: Throwable? = null,
) : Exception("$command : $message", cause) {
    enum class Kind {
        /** TagLostException : bracelet retiré / hors champ pendant l'échange. */
        TAG_LOST,
        /** IOException autre : NAK avalé par la pile, timeout, erreur contrôleur… */
        IO,
        /** NAK explicite (octet 0x0_ / 0x1_ / 0x4_ / 0x5_). */
        NAK,
        /** Réponse de longueur inattendue (puce non conforme, carte « magique », réponse tronquée). */
        BAD_RESPONSE,
    }
}

class Ev1Reader(private val t: Transceiver) {

    /** Dernier échange, pour le journal de débogage du banc. */
    var lastCommand: ByteArray? = null
        private set
    var lastResponse: ByteArray? = null
        private set

    fun getVersion(): ByteArray = exchange("GET_VERSION", Ev1.cmdGetVersion(), 8)

    /** READ : 16 octets (4 pages, retour à 0 en fin de mémoire). */
    fun read(page: Int): ByteArray = exchange("READ", Ev1.cmdRead(page), 16)

    fun fastRead(start: Int, end: Int): ByteArray =
        exchange("FAST_READ", Ev1.cmdFastRead(start, end), (end - start + 1) * Ev1.PAGE_SIZE)

    /** PWD_AUTH → PACK (2 octets). Un mauvais mot de passe donne un NAK (ou IOException). */
    fun pwdAuth(pwd: ByteArray): ByteArray = exchange("PWD_AUTH", Ev1.cmdPwdAuth(pwd), 2)

    fun readCnt(counter: Int): Int = Ev1.decodeReadCnt(exchange("READ_CNT", Ev1.cmdReadCnt(counter), 3))

    fun incrCnt(counter: Int, increment: Int = 1) = exchangeAck("INCR_CNT", Ev1.cmdIncrCnt(counter, increment))

    /** READ_SIG → signature ECC NXP (32 octets) de l'UID. */
    fun readSig(): ByteArray = exchange("READ_SIG", Ev1.cmdReadSig(), 32)

    fun write(page: Int, data: ByteArray) = exchangeAck("WRITE", Ev1.cmdWrite(page, data))

    fun reconnect(): Boolean = t.reconnect()

    // -------------------------------------------------------------------------------------------

    private fun raw(name: String, cmd: ByteArray): ByteArray {
        lastCommand = cmd
        lastResponse = null
        val r = try {
            t.transceive(cmd)
        } catch (e: TagLostIOException) {
            throw Ev1Exception(Ev1Exception.Kind.TAG_LOST, name, "tag perdu", cause = e)
        } catch (e: IOException) {
            throw Ev1Exception(Ev1Exception.Kind.IO, name, e.message ?: "IOException", cause = e)
        }
        lastResponse = r
        return r
    }

    private fun exchange(name: String, cmd: ByteArray, expectedLen: Int): ByteArray {
        val r = raw(name, cmd)
        if (r.size == expectedLen) return r
        if (r.size == 1) {
            val code = r[0].toInt() and 0x0F
            throw Ev1Exception(Ev1Exception.Kind.NAK, name, "NAK 0x%X (%s)".format(code, Ev1.NAK_LABELS[code] ?: "?"), code)
        }
        throw Ev1Exception(Ev1Exception.Kind.BAD_RESPONSE, name, "réponse de ${r.size} octets, $expectedLen attendus")
    }

    private fun exchangeAck(name: String, cmd: ByteArray) {
        val r = raw(name, cmd)
        if (Ev1.isAck(r)) return
        if (r.size == 1) {
            val code = r[0].toInt() and 0x0F
            throw Ev1Exception(Ev1Exception.Kind.NAK, name, "NAK 0x%X (%s)".format(code, Ev1.NAK_LABELS[code] ?: "?"), code)
        }
        throw Ev1Exception(Ev1Exception.Kind.BAD_RESPONSE, name, "ACK attendu, ${r.size} octets reçus")
    }
}
