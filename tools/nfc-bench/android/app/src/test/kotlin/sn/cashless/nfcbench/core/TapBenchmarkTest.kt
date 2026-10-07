package sn.cashless.nfcbench.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

/** Séquence complète contre le simulateur (voir limites dans FakeUltralightEv1). */
class TapBenchmarkTest {
    private val op = UUID.fromString("00000000-0000-0000-0000-000000000002")
    private val master = ByteArray(32) { it.toByte() }
    private val kdf = TestKdfProvider(master, op)
    private val ident = hex("3f9a1c7e5b2d48e0a6c4f1d29b7e0c53")

    /** Bracelet personnalisé via le Personalizer (donc teste aussi celui-ci). */
    private fun personalized(clock: FakeClock? = null, corruptCrc: Boolean = false, major: Int = 1): FakeUltralightEv1 {
        val tag = FakeUltralightEv1(clock = clock)
        val res = Personalizer(kdf).personalize(
            tag.uid, tag, PersonalizeRequest(major = major, keyIndex = 1, identity = ident, corruptCrc = corruptCrc),
        )
        assertTrue(res.error ?: "", res.ok)
        tag.reconnect() // nouvelle présentation : authentification perdue
        tag.log.clear(); tag.exchanges = 0
        return tag
    }

    @Test fun personalizedTagMatchesVectors() {
        val tag = personalized()
        val pages = (4..10).fold(ByteArray(0)) { a, p -> a + tag.mem[p] }
        assertArrayEquals(Ev1ProtocolTest.FULL_B, pages)
        assertEquals("283e8c48", tag.mem[0x12].toHex())
        assertEquals("428c0000", tag.mem[0x13].toHex())
        assertEquals("80050000", tag.mem[0x11].toHex())
        assertEquals("00000005", tag.mem[0x10].toHex())
    }

    @Test fun nominalTapWithTimings() {
        val clock = FakeClock()
        val tag = personalized(clock)
        val bench = TapBenchmark(kdf, TapConfig(readSignature = true), clock)
        val r = bench.run(tag.uid, tag)
        assertEquals(r.errorMessage, Outcome.OK, r.outcome)
        assertEquals(1, r.counter)
        assertEquals("8ed44d9bf7aa3e9e4292e616f21d6e62c3e7f02e1e65c22829756f0879fbd24e", r.tokenHash!!.toHex())
        assertEquals(32, r.signature!!.size)
        // Trames exactes envoyées, dans l'ordre de la séquence cible.
        assertEquals(
            listOf("60", "3a0404", "1b283e8c48", "3a050a", "a50201000000", "3902", "3c00"),
            tag.log,
        )
        // 7 échanges à 4 ms simulées chacun.
        assertEquals(28.0, r.totalMs, 1e-6)
        assertEquals(4.0, r.stepsMs[Step.PWD_AUTH]!!, 1e-6)
        assertEquals(0.0, r.stepsMs[Step.CONNECT]!!, 1e-6)
        assertEquals(r.totalMs, r.stepsMs.values.sum(), 1e-6)
        val m = r.toMap()
        assertEquals("OK", m["outcome"])
        assertEquals(4.0, m["t_read_body_ms"])
        assertNull(m["t_nonexistent"])
    }

    @Test fun counterReplayDetected() {
        val tag = personalized()
        val bench = TapBenchmark(kdf)
        assertEquals(Outcome.OK, bench.run(tag.uid, tag).outcome)
        tag.reconnect()
        assertEquals(Outcome.OK, bench.run(tag.uid, tag).outcome)
        // « Clone » : même UID, même contenu, compteur remis en arrière (carte magique).
        tag.counters[2] = 0
        tag.reconnect()
        val r = bench.run(tag.uid, tag)
        assertEquals(Outcome.COUNTER_REPLAY, r.outcome)
        assertEquals(1, r.counter)
    }

    @Test fun wrongPwdIsAuthFailed() {
        val tag = personalized()
        tag.mem[0x12] = hex("01020304") // PWD de la puce ≠ PWD dérivé
        val r = TapBenchmark(kdf).run(tag.uid, tag)
        assertEquals(Outcome.AUTH_FAILED, r.outcome)
        assertEquals(Step.PWD_AUTH, r.failedStep)
        assertEquals(Ev1Exception.Kind.NAK, r.errorKind)
        assertEquals(0, r.nakCode)
        assertEquals(true, r.tagPresentAfterError)
    }

    @Test fun wrongPwdWhenStackSwallowsNak() {
        val tag = personalized()
        tag.mem[0x12] = hex("01020304")
        tag.nakAsIOException = true
        val r = TapBenchmark(kdf).run(tag.uid, tag)
        assertEquals(Outcome.AUTH_FAILED, r.outcome)
        assertEquals(Ev1Exception.Kind.IO, r.errorKind)
        assertEquals(true, r.tagPresentAfterError) // la re-sélection prouve que ce n'était pas un retrait
    }

    @Test fun packMismatch() {
        val tag = personalized()
        tag.mem[0x13] = hex("beef0000")
        assertEquals(Outcome.PACK_MISMATCH, TapBenchmark(kdf).run(tag.uid, tag).outcome)
    }

    @Test fun crcMismatch() {
        val tag = personalized(corruptCrc = true)
        val r = TapBenchmark(kdf).run(tag.uid, tag)
        assertEquals(Outcome.CRC_MISMATCH, r.outcome)
        assertEquals(Step.CHECK_CRC, r.failedStep)
        assertNull(r.counter) // le compteur n'est pas consommé pour un bracelet hors format
    }

    @Test fun unsupportedMajor() {
        val tag = personalized(major = 2)
        assertEquals(Outcome.UNSUPPORTED_FORMAT, TapBenchmark(kdf).run(tag.uid, tag).outcome)
    }

    @Test fun notMf0ul11() {
        val tag = personalized()
        tag.version = hex("0004040201000f03") // NTAG213
        assertEquals(Outcome.NOT_MF0UL11, TapBenchmark(kdf).run(tag.uid, tag).outcome)
    }

    @Test fun unknownKey() {
        val tag = personalized()
        val r = TapBenchmark(TestTableProvider(emptyMap())).run(tag.uid, tag)
        assertEquals(Outcome.UNKNOWN_KEY, r.outcome)
    }

    @Test fun unprotectedTagStillReadsButAuthFails() {
        // Bracelet vierge (AUTH0 = 0xFF, PWD usine FFFFFFFF) : pas de format B → major 0.
        val tag = FakeUltralightEv1()
        assertEquals(Outcome.UNSUPPORTED_FORMAT, TapBenchmark(kdf).run(tag.uid, tag).outcome)
    }

    @Test fun tagLostMidSequenceAndRetryCountsAsSameGesture() {
        val clock = FakeClock()
        val tag = personalized(clock)
        val bench = TapBenchmark(kdf, clock = clock)
        tag.loseAfter = 3 // perdu pendant FAST_READ 5–10
        val r1 = bench.run(tag.uid, tag)
        assertEquals(Outcome.TAG_LOST, r1.outcome)
        assertEquals(Step.READ_BODY, r1.failedStep)
        assertNull(r1.tagPresentAfterError) // pas de sonde après TAG_LOST
        // Réessai 1 s plus tard.
        clock.advanceMs(1000.0)
        tag.loseAfter = null; tag.present = true; tag.reconnect()
        val r2 = bench.run(tag.uid, tag)
        assertEquals(Outcome.OK, r2.outcome)
        assertEquals(r1.gestureId, r2.gestureId)
        assertEquals(2, r2.attempt)
        // Nouveau geste après un succès.
        tag.reconnect()
        val r3 = bench.run(tag.uid, tag)
        assertEquals(r2.gestureId + 1, r3.gestureId)
        assertEquals(1, r3.attempt)
    }

    @Test fun headerViaRead4IsRefusedWhenProtected() {
        // Hypothèse de la datasheet (à vérifier) : READ 4 déborde sur 5–7 protégées → NAK.
        val tag = personalized()
        val r = TapBenchmark(kdf, TapConfig(headerRead = HeaderRead.READ_4)).run(tag.uid, tag)
        assertEquals(Outcome.NAK, r.outcome)
        assertEquals(Step.READ_HEADER, r.failedStep)
    }

    @Test fun dwellMeasurement() {
        val clock = FakeClock()
        val tag = personalized(clock)
        val bench = TapBenchmark(kdf, TapConfig(measureDwell = true, dwellPollMs = 30), clock) { clock.advanceMs(it.toDouble()) }
        tag.loseAfter = 6 + 5 // 6 échanges du tap puis 5 sondages réussis
        val r = bench.run(tag.uid, tag)
        assertEquals(Outcome.OK, r.outcome)
        // 5 × (4 ms + 30 ms) + 4 ms pour le sondage qui échoue
        assertEquals(174.0, r.dwellMs!!, 1e-6)
    }

    @Test fun personalizeRefusesProtectedTagWithoutPwd() {
        val tag = personalized()
        val res = Personalizer(kdf).personalize(tag.uid, tag, PersonalizeRequest(identity = ident))
        assertTrue(!res.ok && res.error!!.contains("PWD actuel"))
        tag.reconnect()
        val res2 = Personalizer(kdf).personalize(
            tag.uid, tag, PersonalizeRequest(identity = ident, flags = 1, currentPwd = hex("283e8c48")),
        )
        assertTrue(res2.error ?: "", res2.ok)
        assertEquals("01000000", tag.mem[9].toHex())
    }

    @Test fun unprotectRecyclesTag() {
        val tag = personalized()
        val res = Personalizer(kdf).unprotect(tag.uid, tag, hex("283e8c48"))
        assertTrue(res.error ?: "", res.ok)
        assertEquals(0xFF, tag.mem[0x10][3].u())
        assertEquals(0x00, tag.mem[0x11][0].u())
        tag.reconnect()
        // Lisible sans authentification.
        assertEquals(28, Ev1Reader(tag).also { tag.connect() }.fastRead(4, 10).size)
    }
}
