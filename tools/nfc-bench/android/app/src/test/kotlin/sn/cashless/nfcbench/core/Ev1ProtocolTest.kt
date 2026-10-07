package sn.cashless.nfcbench.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

/** Mêmes vecteurs que reference/test_ev1_format.py (issus de vecteurs_test_bracelet.py). */
class Ev1ProtocolTest {
    companion object {
        val IDENT = hex("3f9a1c7e5b2d48e0a6c4f1d29b7e0c53")
        val FULL_B = hex("01000001 3f9a1c7e 5b2d48e0 a6c4f1d2 9b7e0c53 00000000 672f4329")
        const val CRC_B = 0x672F4329L
        val MASTER_TEST = ByteArray(32) { it.toByte() }
        val OP: UUID = UUID.fromString("00000000-0000-0000-0000-000000000002")
        val UID = hex("04a1b2c3d4e5f6")
        val PWD = hex("283e8c48")
        val PACK = hex("428c")
        val DEK_TEST = ByteArray(32) { (0x10 + it).toByte() }
        val MEDIA: UUID = UUID.fromString("40000000-0000-0000-0000-000000000001")
        val BLOB = hex("000102030405060708090a0bf282e1ec76777dd9d1a82c60ad37fdcb0c2afc4a80b2")
    }

    @Test fun crcCheckValue() = assertEquals(0xCBF43926L, Ev1.crc32IsoHdlc("123456789".toByteArray()))

    @Test fun crcMatchesJavaUtilZip() {
        val data = ByteArray(256) { it.toByte() }
        val z = java.util.zip.CRC32().apply { update(data) }.value
        assertEquals(z, Ev1.crc32IsoHdlc(data))
    }

    @Test fun crcVector() = assertEquals(CRC_B, Ev1.crc32IsoHdlc(FULL_B, 0, 24))

    @Test fun buildFormatB() = assertArrayEquals(FULL_B, FormatB.build(1, 0, 1, IDENT))

    @Test fun page4() {
        assertArrayEquals(hex("01000001"), Header.build(1, 0, 1))
        assertArrayEquals(hex("01001234"), Header.build(1, 0, 0x1234))
        assertEquals(Header(1, 0, 1), Header.parse(hex("01000001")))
        assertEquals(0xFFFE, Header.parse(hex("0102fffe")).keyIndex)
    }

    @Test fun parseFormatB() {
        val f = FormatB.parse(FULL_B)
        assertTrue(f.crcOk)
        assertEquals(Header(1, 0, 1), f.header)
        assertArrayEquals(IDENT, f.identity)
        assertEquals(CRC_B, f.crcStored)
        assertFalse(FormatB.parse(FormatB.build(1, 0, 1, IDENT, corruptCrc = true)).crcOk)
        val flipped = FULL_B.copyOf().also { it[10] = (it[10].toInt() xor 1).toByte() }
        assertFalse(FormatB.parse(flipped).crcOk)
    }

    @Test(expected = FormatException::class)
    fun parseBadLength() {
        FormatB.parse(FULL_B.copyOf(27))
    }

    @Test fun tokenHash() {
        val h = java.security.MessageDigest.getInstance("SHA-256").digest(IDENT)
        assertEquals("8ed44d9bf7aa3e9e4292e616f21d6e62c3e7f02e1e65c22829756f0879fbd24e", h.toHex())
    }

    @Test fun frames() {
        assertEquals("60", Ev1.cmdGetVersion().toHex())
        assertEquals("3004", Ev1.cmdRead(4).toHex())
        assertEquals("3a0404", Ev1.cmdFastRead(4, 4).toHex())
        assertEquals("3a050a", Ev1.cmdFastRead(5, 10).toHex())
        assertEquals("1b283e8c48", Ev1.cmdPwdAuth(PWD).toHex())
        assertEquals("3902", Ev1.cmdReadCnt(2).toHex())
        assertEquals("a50201000000", Ev1.cmdIncrCnt(2).toHex())
        assertEquals("a50201020300", Ev1.cmdIncrCnt(2, 0x030201).toHex())
        assertEquals("3c00", Ev1.cmdReadSig().toHex())
        assertEquals("a212283e8c48", Ev1.cmdWrite(0x12, PWD).toHex())
    }

    @Test fun frameBounds() {
        val bad = listOf<() -> Unit>(
            { Ev1.cmdRead(20) }, { Ev1.cmdFastRead(10, 5) }, { Ev1.cmdReadCnt(3) },
            { Ev1.cmdIncrCnt(0, 1 shl 24) }, { Ev1.cmdPwdAuth(ByteArray(3)) },
        )
        for (b in bad) {
            try {
                b(); throw AssertionError("exception attendue")
            } catch (_: IllegalArgumentException) {
            }
        }
    }

    @Test fun readCntLsbFirst() {
        assertEquals(1, Ev1.decodeReadCnt(hex("010000")))
        assertEquals(0x123456, Ev1.decodeReadCnt(hex("563412")))
        assertEquals(0xFFFFFF, Ev1.decodeReadCnt(hex("ffffff")))
    }

    @Test fun ackNak() {
        assertTrue(Ev1.isAck(hex("0a")))
        assertFalse(Ev1.isAck(hex("00")))
        assertFalse(Ev1.isAck(hex("04")))
    }

    @Test fun getVersion() {
        assertTrue(Ev1.isMf0ul11(Ev1.GET_VERSION_MF0UL11))
        assertTrue(Ev1.isMf0ul11(hex("0004030201000b03")))
        assertFalse(Ev1.isMf0ul11(hex("0004030101000e03")))   // MF0UL21
        assertFalse(Ev1.isMf0ul11(hex("0004040201000f03")))   // NTAG213
        assertFalse(Ev1.isMf0ul11(ByteArray(7)))
    }

    @Test fun configBytes() {
        assertEquals(0x80, Ev1.accessByte(prot = true))
        assertEquals(0x87, Ev1.accessByte(prot = true, authlim = 7))
        assertEquals("00000005", Ev1.cfg0WithAuth0(hex("000000ff"), 5).toHex())
        assertEquals("04000005", Ev1.cfg0WithAuth0(hex("040000ff"), 5).toHex())
        assertEquals("80050000", Ev1.cfg1WithAccess(hex("00050000"), true, 0).toHex())
        assertEquals("428c0000", Ev1.packPage(PACK).toHex())
    }

    @Test(expected = FormatException::class)
    fun cfglckRefused() {
        Ev1.cfg1WithAccess(hex("40050000"), true, 0)
    }

    @Test fun personalizationPlan() {
        val plan = Personalizer.plan(FULL_B, PWD, PACK, hex("000000ff"), hex("00050000"))
        assertEquals(listOf(4, 5, 6, 7, 8, 9, 10, 0x12, 0x13, 0x11, 0x10), plan.map { it.first })
        assertEquals("00000005", plan.last().second.toHex())
        assertEquals("80050000", plan[9].second.toHex())
        assertEquals("428c0000", plan[8].second.toHex())
    }

    @Test fun kdfVector() {
        assertEquals(
            "00000001434153484c4553532f554c2d4556312f5057442f76310000000000000000000000000000000002" +
                "000104a1b2c3d4e5f600000030",
            PwdPackCrypto.kdfMessage(OP, 1, UID).toHex(),
        )
        val k = PwdPackCrypto.derive(MASTER_TEST, OP, 1, UID)
        assertArrayEquals(PWD, k.pwd)
        assertArrayEquals(PACK, k.pack)
    }

    @Test fun blobVector() {
        val p = EncryptedBlobProvider(DEK_TEST, OP, mapOf(UID.toHex() to EncryptedBlobProvider.Entry(MEDIA, 1, BLOB)))
        val k = p.lookup(UID, Header(1, 0, 1))!!
        assertArrayEquals(PWD, k.pwd)
        assertArrayEquals(PACK, k.pack)
        // Même blob présenté par un autre UID : AAD différente → refus.
        val other = hex("04a1b2c3d4e5f7")
        val p2 = EncryptedBlobProvider(DEK_TEST, OP, mapOf(other.toHex() to EncryptedBlobProvider.Entry(MEDIA, 1, BLOB)))
        assertEquals(null, p2.lookup(other, Header(1, 0, 1)))
    }
}
