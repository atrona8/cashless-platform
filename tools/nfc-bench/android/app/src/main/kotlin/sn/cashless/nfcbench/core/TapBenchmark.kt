package sn.cashless.nfcbench.core

import java.security.MessageDigest

/*
 * TapBenchmark : exécute la séquence cible d'un tap et chronomètre chaque étape.
 *
 *   CONNECT → GET_VERSION → READ_HEADER (page 4) → PWD_LOOKUP → PWD_AUTH (+ contrôle PACK)
 *   → READ_BODY (FAST_READ 5–10) → CHECK_CRC → INCR_CNT → READ_CNT → [READ_SIG] → HASH
 *
 * Logique pure (horloge injectée) : testée sur JVM avec un simulateur de puce. Sur téléphone,
 * l'horloge est System.nanoTime() et t0 = entrée dans ReaderCallback.onTagDiscovered.
 *
 * LIMITE : la phase « découverte » (entrée du bracelet dans le champ → callback) n'est pas
 * observable par l'application ; elle se mesure au protocole terrain (vidéo haute cadence).
 */

fun interface NanoClock {
    fun nanoTime(): Long

    companion object {
        val SYSTEM = NanoClock { System.nanoTime() }
    }
}

enum class Step { CONNECT, GET_VERSION, READ_HEADER, PWD_LOOKUP, PWD_AUTH, READ_BODY, CHECK_CRC, INCR_CNT, READ_CNT, READ_SIG, HASH }

enum class Outcome {
    OK,
    TAG_LOST,            // TagLostException
    IO_ERROR,            // IOException (dont NAK avalés par la pile)
    NAK,                 // NAK explicite hors PWD_AUTH
    BAD_RESPONSE,        // longueur inattendue
    NOT_MF0UL11,         // GET_VERSION non conforme (NTAG, MF0UL21, carte magique…)
    UNSUPPORTED_FORMAT,  // major ≠ 1
    UNKNOWN_KEY,         // pas de PWD/PACK pour cet UID / key_index
    AUTH_FAILED,         // NAK ou IOException sur PWD_AUTH (mauvais PWD)
    PACK_MISMATCH,       // PACK renvoyé ≠ PACK attendu (puce non authentique ?)
    CRC_MISMATCH,        // CRC pages 4–9 faux
    COUNTER_REPLAY,      // compteur ≤ dernier vu (clone probable) — logique « serveur » simulée
    INTERNAL_ERROR,
}

enum class HeaderRead { FAST_READ_4, READ_4 }

data class TapConfig(
    /** Étape 8 optionnelle. */
    val readSignature: Boolean = false,
    /** FAST_READ 4-4 (4 o) recommandé ; READ 4 (16 o) déborde sur les pages 5-7 protégées. */
    val headerRead: HeaderRead = HeaderRead.FAST_READ_4,
    val incrementCounter: Boolean = true,
    /** Après IO/NAK : tenter une re-sélection pour savoir si le tag était encore là. */
    val probeAfterError: Boolean = true,
    /** Mesure du temps jusqu'au retrait (sondage GET_VERSION périodique après le résultat). */
    val measureDwell: Boolean = false,
    val dwellPollMs: Long = 30,
    val dwellMaxMs: Long = 5_000,
    /** Deux lectures du même UID à moins de cette fenêtre après un échec = même geste (réessai). */
    val gestureWindowMs: Long = 4_000,
)

class TapResult(
    val seq: Int,
    val uid: ByteArray,
    val outcome: Outcome,
    val failedStep: Step?,
    val errorKind: Ev1Exception.Kind?,
    val nakCode: Int?,
    val errorMessage: String?,
    val version: ByteArray?,
    val header: Header?,
    val counter: Int?,
    val tokenHash: ByteArray?,
    val signature: ByteArray?,
    val stepsMs: LinkedHashMap<Step, Double>,
    val totalMs: Double,
    val tagPresentAfterError: Boolean?,
    val dwellMs: Double?,
    val gestureId: Int,
    val attempt: Int,
) {
    /** Sérialisation pour l'EventChannel (types supportés par StandardMessageCodec). */
    fun toMap(): Map<String, Any?> = linkedMapOf(
        "seq" to seq,
        "uid" to uid.toHex(),
        "outcome" to outcome.name,
        "failed_step" to failedStep?.name,
        "error_kind" to errorKind?.name,
        "nak_code" to nakCode,
        "error" to errorMessage,
        "version" to version?.toHex(),
        "major" to header?.major,
        "minor" to header?.minor,
        "key_index" to header?.keyIndex,
        "counter" to counter,
        "token_hash" to tokenHash?.toHex(),
        "signature" to signature?.toHex(),
        "total_ms" to totalMs,
        "tag_present_after_error" to tagPresentAfterError,
        "dwell_ms" to dwellMs,
        "gesture_id" to gestureId,
        "attempt" to attempt,
    ) + Step.values().associate { "t_${it.name.lowercase()}_ms" to stepsMs[it] }
}

/** Registre local des compteurs vus (simule le refus serveur d'un compteur déjà vu). */
class CounterRegistry {
    private val last = HashMap<String, Int>()

    /** @return true si accepté (strictement supérieur au dernier vu). */
    @Synchronized
    fun accept(uidHex: String, counter: Int): Boolean {
        val prev = last[uidHex]
        if (prev != null && counter <= prev) return false
        last[uidHex] = counter
        return true
    }

    @Synchronized
    fun seed(uidHex: String, counter: Int) {
        last[uidHex] = counter
    }

    @Synchronized
    fun clear() = last.clear()
}

class TapBenchmark(
    private val provider: PwdPackProvider,
    var config: TapConfig = TapConfig(),
    private val clock: NanoClock = NanoClock.SYSTEM,
    val counters: CounterRegistry = CounterRegistry(),
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
) {
    private var seq = 0
    private var gestureSeq = 0
    private var lastUid: String? = null
    private var lastEndNs = 0L
    private var lastOk = true
    private var lastAttempt = 0

    private class Abort(val outcome: Outcome, val step: Step, val err: Ev1Exception? = null, val msg: String? = null) :
        Exception(msg)

    /**
     * Exécute un tap complet. N'émet jamais d'exception : tout est classé dans [TapResult.outcome].
     * @param t0Ns instant de référence (entrée dans onTagDiscovered) ; par défaut maintenant.
     */
    @Synchronized
    fun run(uid: ByteArray, t: Transceiver, t0Ns: Long = clock.nanoTime()): TapResult {
        val steps = LinkedHashMap<Step, Double>()
        val reader = Ev1Reader(t)
        var version: ByteArray? = null
        var header: Header? = null
        var counter: Int? = null
        var hash: ByteArray? = null
        var sig: ByteArray? = null
        var outcome = Outcome.OK
        var failedStep: Step? = null
        var err: Ev1Exception? = null
        var msg: String? = null

        fun <T> step(s: Step, block: () -> T): T {
            val a = clock.nanoTime()
            try {
                return block()
            } catch (e: Ev1Exception) {
                val o = when (e.kind) {
                    Ev1Exception.Kind.TAG_LOST -> Outcome.TAG_LOST
                    Ev1Exception.Kind.IO -> if (s == Step.PWD_AUTH) Outcome.AUTH_FAILED else Outcome.IO_ERROR
                    Ev1Exception.Kind.NAK -> if (s == Step.PWD_AUTH) Outcome.AUTH_FAILED else Outcome.NAK
                    Ev1Exception.Kind.BAD_RESPONSE -> Outcome.BAD_RESPONSE
                }
                throw Abort(o, s, e, e.message)
            } catch (e: Abort) {
                throw e
            } catch (e: java.io.IOException) {        // connect() : IOException / TagLostIOException
                val o = if (e is TagLostIOException) Outcome.TAG_LOST else Outcome.IO_ERROR
                throw Abort(o, s, null, e.message)
            } catch (e: Exception) {
                throw Abort(Outcome.INTERNAL_ERROR, s, null, e.toString())
            } finally {
                steps[s] = (clock.nanoTime() - a) / 1e6
            }
        }

        try {
            step(Step.CONNECT) { t.connect() }

            version = step(Step.GET_VERSION) { reader.getVersion() }
            if (!Ev1.isMf0ul11(version)) throw Abort(Outcome.NOT_MF0UL11, Step.GET_VERSION, msg = "GET_VERSION ${version.toHex()}")

            val page4 = step(Step.READ_HEADER) {
                when (config.headerRead) {
                    HeaderRead.FAST_READ_4 -> reader.fastRead(Ev1.PAGE_HEADER, Ev1.PAGE_HEADER)
                    HeaderRead.READ_4 -> reader.read(Ev1.PAGE_HEADER).copyOfRange(0, 4)
                }
            }
            val h = Header.parse(page4).also { header = it }
            if (h.major != 1) throw Abort(Outcome.UNSUPPORTED_FORMAT, Step.READ_HEADER, msg = "major ${h.major}")

            val keys = step(Step.PWD_LOOKUP) { provider.lookup(uid, h) }
                ?: throw Abort(Outcome.UNKNOWN_KEY, Step.PWD_LOOKUP, msg = "key_index ${h.keyIndex}")

            val pack = step(Step.PWD_AUTH) { reader.pwdAuth(keys.pwd) }
            if (!MessageDigest.isEqual(pack, keys.pack)) {
                throw Abort(Outcome.PACK_MISMATCH, Step.PWD_AUTH, msg = "PACK ${pack.toHex()} ≠ ${keys.pack.toHex()}")
            }

            val body = step(Step.READ_BODY) { reader.fastRead(Ev1.PAGE_BODY_FIRST, Ev1.PAGE_BODY_LAST) }
            val fb = step(Step.CHECK_CRC) { FormatB.parse(page4 + body) }
            if (!fb.crcOk) throw Abort(Outcome.CRC_MISMATCH, Step.CHECK_CRC, msg = "CRC %08x ≠ %08x".format(fb.crcStored, fb.crcComputed))

            if (config.incrementCounter) step(Step.INCR_CNT) { reader.incrCnt(Ev1.COUNTER_CLONE, 1) }
            counter = step(Step.READ_CNT) { reader.readCnt(Ev1.COUNTER_CLONE) }
            if (config.readSignature) sig = step(Step.READ_SIG) { reader.readSig() }
            hash = step(Step.HASH) { MessageDigest.getInstance("SHA-256").digest(fb.identity) }

            if (config.incrementCounter && !counters.accept(uid.toHex(), counter!!)) {
                outcome = Outcome.COUNTER_REPLAY
                failedStep = Step.READ_CNT
                msg = "compteur $counter déjà vu"
            }
        } catch (a: Abort) {
            outcome = a.outcome
            failedStep = a.step
            err = a.err
            msg = a.msg
        }
        val endNs = clock.nanoTime()
        val totalMs = (endNs - t0Ns) / 1e6

        // Hors chronométrage : diagnostic et temps de présence.
        var presentAfterError: Boolean? = null
        if (outcome != Outcome.OK && config.probeAfterError &&
            (err?.kind == Ev1Exception.Kind.IO || err?.kind == Ev1Exception.Kind.NAK)
        ) {
            presentAfterError = try { t.reconnect() } catch (_: Exception) { false }
        }
        var dwellMs: Double? = null
        if (outcome == Outcome.OK && config.measureDwell) dwellMs = measureDwell(reader, endNs)
        t.close()

        // Geste / tentative : un échec suivi d'une relecture du même UID dans la fenêtre = réessai.
        val uidHex = uid.toHex()
        val sameGesture = uidHex == lastUid && !lastOk && (t0Ns - lastEndNs) / 1_000_000 <= config.gestureWindowMs
        val attempt = if (sameGesture) lastAttempt + 1 else 1
        if (!sameGesture) gestureSeq++
        lastUid = uidHex
        lastEndNs = clock.nanoTime()
        lastOk = outcome == Outcome.OK
        lastAttempt = attempt

        return TapResult(
            ++seq, uid, outcome, failedStep, err?.kind, err?.nakCode, msg, version, header, counter, hash, sig,
            steps, totalMs, presentAfterError, dwellMs, gestureSeq, attempt,
        )
    }

    /** Sonde GET_VERSION jusqu'à la perte du tag ; renvoie la durée depuis la fin du tap (ms). */
    private fun measureDwell(reader: Ev1Reader, fromNs: Long): Double? {
        val deadline = fromNs + config.dwellMaxMs * 1_000_000
        while (clock.nanoTime() < deadline) {
            try {
                reader.getVersion()
            } catch (_: Ev1Exception) {
                return (clock.nanoTime() - fromNs) / 1e6
            }
            sleeper(config.dwellPollMs)
        }
        return null // toujours présent après dwellMaxMs
    }

    fun resetSession() {
        synchronized(this) {
            seq = 0; gestureSeq = 0; lastUid = null; lastOk = true; lastAttempt = 0
            counters.clear()
        }
    }
}
