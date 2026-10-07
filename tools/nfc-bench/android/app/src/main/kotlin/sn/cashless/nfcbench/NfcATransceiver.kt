package sn.cashless.nfcbench

// ⚠ NON TESTÉ SUR APPAREIL — écrit sans SDK Android ni téléphone à disposition.

import android.nfc.Tag
import android.nfc.TagLostException
import android.nfc.tech.NfcA
import sn.cashless.nfcbench.core.TagLostIOException
import sn.cashless.nfcbench.core.Transceiver
import java.io.IOException

/**
 * Adaptateur android.nfc.tech.NfcA → [Transceiver].
 *
 * - NfcA.transceive ajoute/retire lui-même le CRC_A : on n'envoie que la commande EV1.
 * - TagLostException (sous-classe d'IOException) → TagLostIOException (classée TAG_LOST).
 * - SecurityException « Tag … is out of date » (objet Tag périmé) → aussi TAG_LOST.
 * - Les autres IOException (dont les NAK que certaines piles NFC transforment en
 *   « Transceive failed ») sont propagées telles quelles.
 */
class NfcATransceiver(tag: Tag, private val timeoutMs: Int?) : Transceiver {
    private val nfcA: NfcA = NfcA.get(tag) ?: throw IOException("technologie NfcA absente")

    val atqa: ByteArray get() = nfcA.atqa
    val sak: Int get() = nfcA.sak.toInt()
    val maxTransceiveLength: Int get() = nfcA.maxTransceiveLength

    override fun connect() {
        guard {
            if (!nfcA.isConnected) nfcA.connect()
            // Délai max d'attente de réponse ; défaut plate-forme si null. Doit couvrir l'écriture
            // EEPROM (WRITE / INCR_CNT, quelques ms) avec marge.
            if (timeoutMs != null) nfcA.timeout = timeoutMs
        }
    }

    override fun transceive(cmd: ByteArray): ByteArray = guard { nfcA.transceive(cmd) }

    override fun close() {
        try {
            nfcA.close()
        } catch (_: Exception) {
        }
    }

    /**
     * close() + connect() : sur la plupart des piles cela provoque une nouvelle sélection de la
     * puce (nécessaire après un NAK, qui la renvoie en IDLE). À VÉRIFIER par modèle de téléphone :
     * certaines piles réutilisent la cible sans la re-sélectionner.
     */
    override fun reconnect(): Boolean = try {
        close()
        nfcA.connect()
        timeoutMs?.let { nfcA.timeout = it }
        true
    } catch (_: Exception) {
        false
    }

    private inline fun <T> guard(block: () -> T): T = try {
        block()
    } catch (e: TagLostException) {
        throw TagLostIOException(e.message ?: "TagLostException", e)
    } catch (e: SecurityException) {
        throw TagLostIOException("Tag périmé : ${e.message}", e)
    }
}
