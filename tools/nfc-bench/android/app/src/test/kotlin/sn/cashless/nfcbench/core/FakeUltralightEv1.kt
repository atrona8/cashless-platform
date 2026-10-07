package sn.cashless.nfcbench.core

import java.io.IOException

/*
 * Simulateur logiciel d'un MF0UL11, pour les tests JVM.
 *
 * IMPORTANT : il modélise NOTRE LECTURE de la datasheet MF0ULX1, pas le silicium. Les points
 * incertains (READ débordant sur une zone protégée → NAK ; compteurs non protégés par PWD ;
 * NAK → état IDLE) sont signalés dans le README et doivent être confirmés sur de vraies puces.
 */
class FakeClock(var now: Long = 1_000_000_000L) : NanoClock {
    override fun nanoTime() = now
    fun advanceMs(ms: Double) {
        now += (ms * 1e6).toLong()
    }
}

class FakeUltralightEv1(
    val uid: ByteArray = hex("04a1b2c3d4e5f6"),
    private val clock: FakeClock? = null,
    /** Latence simulée par échange (ms). */
    private val latencyMs: Double = 4.0,
    var version: ByteArray = Ev1.GET_VERSION_MF0UL11.copyOf(),
) : Transceiver {
    val mem = Array(Ev1.MF0UL11_PAGES) { ByteArray(4) }
    val counters = IntArray(3)
    var signature = ByteArray(32) { it.toByte() }

    /** Émule les piles Android qui transforment un NAK en IOException. */
    var nakAsIOException = false
    /** Après ce nombre d'échanges, le tag « quitte le champ ». */
    var loseAfter: Int? = null
    var present = true
    var exchanges = 0
    val log = ArrayList<String>()

    private var authenticated = false
    private var halted = false
    private var connected = false

    init {
        // UID 7 octets dans les pages 0-2 (BCC non calculés : sans importance ici).
        mem[0] = byteArrayOf(uid[0], uid[1], uid[2], 0)
        mem[1] = uid.copyOfRange(3, 7)
        mem[Ev1.PAGE_CFG0] = hex("000000ff")
        mem[Ev1.PAGE_CFG1] = hex("00050000")
        mem[Ev1.PAGE_PWD] = hex("ffffffff")
        mem[Ev1.PAGE_PACK] = hex("00000000")
    }

    private val auth0 get() = mem[Ev1.PAGE_CFG0][3].u()
    private val prot get() = (mem[Ev1.PAGE_CFG1][0].u() and Ev1.ACCESS_PROT) != 0
    private fun readProtected(p: Int) = prot && !authenticated && p >= auth0
    private fun writeProtected(p: Int) = !authenticated && p >= auth0

    override fun connect() {
        if (!present) throw TagLostIOException()
        connected = true
    }

    override fun close() {
        connected = false
    }

    override fun reconnect(): Boolean {
        authenticated = false
        halted = false
        connected = present
        return present
    }

    private fun nak(code: Int): ByteArray {
        halted = true               // NAK → la puce repasse en IDLE (à confirmer)
        authenticated = false
        if (nakAsIOException) throw IOException("Transceive failed")
        return byteArrayOf(code.toByte())
    }

    private fun ack() = byteArrayOf(Ev1.ACK.toByte())

    private fun readPage(p: Int): ByteArray =
        if (p == Ev1.PAGE_PWD || p == Ev1.PAGE_PACK) ByteArray(4) else mem[p].copyOf()

    override fun transceive(cmd: ByteArray): ByteArray {
        clock?.advanceMs(latencyMs)
        exchanges++
        log += cmd.toHex()
        loseAfter?.let { if (exchanges > it) present = false }
        if (!present) throw TagLostIOException()
        check(connected) { "transceive sans connect()" }
        if (halted) throw IOException("pas de réponse (puce en IDLE)")
        val c = cmd[0]
        return when (c) {
            Ev1.CMD_GET_VERSION -> version.copyOf()
            Ev1.CMD_READ -> {
                val p = cmd[1].u()
                if (p >= Ev1.MF0UL11_PAGES) return nak(0)
                val pages = (0 until 4).map { (p + it) % Ev1.MF0UL11_PAGES }
                if (pages.any { readProtected(it) }) return nak(0)
                pages.fold(ByteArray(0)) { acc, q -> acc + readPage(q) }
            }
            Ev1.CMD_FAST_READ -> {
                val s = cmd[1].u()
                val e = cmd[2].u()
                if (e < s || e >= Ev1.MF0UL11_PAGES) return nak(0)
                if ((s..e).any { readProtected(it) }) return nak(0)
                (s..e).fold(ByteArray(0)) { acc, q -> acc + readPage(q) }
            }
            Ev1.CMD_WRITE -> {
                val p = cmd[1].u()
                if (p < 2 || p >= Ev1.MF0UL11_PAGES || cmd.size != 6) return nak(0)
                if (writeProtected(p)) return nak(0)
                mem[p] = cmd.copyOfRange(2, 6)
                ack()
            }
            Ev1.CMD_PWD_AUTH -> {
                if (cmd.copyOfRange(1, 5).contentEquals(mem[Ev1.PAGE_PWD])) {
                    authenticated = true
                    mem[Ev1.PAGE_PACK].copyOfRange(0, 2)
                } else nak(0)
            }
            Ev1.CMD_READ_CNT -> {
                val n = cmd[1].u()
                if (n > 2) return nak(0)
                val v = counters[n]
                byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte())
            }
            Ev1.CMD_INCR_CNT -> {
                val n = cmd[1].u()
                if (n > 2) return nak(0)
                val inc = cmd[2].u() or (cmd[3].u() shl 8) or (cmd[4].u() shl 16)
                if (counters[n].toLong() + inc > Ev1.COUNTER_MAX) return nak(0)
                counters[n] += inc
                ack()
            }
            Ev1.CMD_READ_SIG -> signature.copyOf()
            else -> nak(0)
        }
    }
}
