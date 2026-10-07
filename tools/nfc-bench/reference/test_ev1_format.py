"""
Tests de la référence Python contre les vecteurs de packages/tag-format/vecteurs_test_bracelet.py.

Exécution (stdlib seule, « cryptography » optionnel pour le test AES-GCM) :
    cd nfc_bench/reference && python3 -m unittest -v test_ev1_format
(compatible pytest : python3 -m pytest -q)
"""
import hashlib
import unittest
import uuid
import zlib

import ev1_format as ev1

# --- Vecteurs repris de vecteurs_test_bracelet.py (ne pas modifier sans régénérer) -------------------------
IDENT = bytes.fromhex("3f9a1c7e5b2d48e0a6c4f1d29b7e0c53")
FULL_B = bytes.fromhex(
    "01000001" "3f9a1c7e" "5b2d48e0" "a6c4f1d2" "9b7e0c53" "00000000" "672f4329")
CRC_B = 0x672F4329
MASTER_TEST = bytes(range(32))
OP = uuid.UUID("00000000-0000-0000-0000-000000000002").bytes
UID = bytes.fromhex("04a1b2c3d4e5f6")
KDF_MSG = bytes.fromhex(
    "00000001434153484c4553532f554c2d4556312f5057442f76310000000000000000000000000000000002"
    "000104a1b2c3d4e5f600000030")
PWD, PACK = bytes.fromhex("283e8c48"), bytes.fromhex("428c")
DEK_TEST = bytes(range(0x10, 0x30))
MEDIA_ID = uuid.UUID("40000000-0000-0000-0000-000000000001").bytes
BLOB = bytes.fromhex("000102030405060708090a0bf282e1ec76777dd9d1a82c60ad37fdcb0c2afc4a80b2")


class TestCrc(unittest.TestCase):
    def test_check_value(self):
        self.assertEqual(ev1.crc32_iso_hdlc(b"123456789"), 0xCBF43926)

    def test_matches_zlib(self):
        for data in (b"", b"\x00", bytes(range(256)), FULL_B[:24]):
            self.assertEqual(ev1.crc32_iso_hdlc(data), zlib.crc32(data) & 0xFFFFFFFF)

    def test_vector_crc(self):
        self.assertEqual(ev1.crc32_iso_hdlc(FULL_B[:24]), CRC_B)


class TestFormatB(unittest.TestCase):
    def test_build_matches_vector(self):
        self.assertEqual(ev1.build_format_b(1, 0, 1, IDENT, flags=0), FULL_B)

    def test_page4(self):
        self.assertEqual(ev1.build_header(1, 0, 1), bytes.fromhex("01000001"))
        self.assertEqual(ev1.parse_header(bytes.fromhex("01000001")), ev1.Header(1, 0, 1))
        # key_index big-endian
        self.assertEqual(ev1.build_header(1, 0, 0x1234), bytes.fromhex("01001234"))
        self.assertEqual(ev1.parse_header(bytes.fromhex("0102fffe")).key_index, 0xFFFE)

    def test_pages(self):
        pages = ev1.split_pages(FULL_B)
        self.assertEqual(len(pages), 7)
        self.assertEqual(pages[6], bytes.fromhex("672f4329"))   # page 10

    def test_parse_ok(self):
        f = ev1.parse_format_b(FULL_B)
        self.assertTrue(f.crc_ok)
        self.assertEqual((f.major, f.minor, f.key_index, f.flags), (1, 0, 1, 0))
        self.assertEqual(f.identity, IDENT)
        self.assertEqual(f.crc_stored, CRC_B)

    def test_parse_corrupted(self):
        bad = ev1.build_format_b(1, 0, 1, IDENT, corrupt_crc=True)
        self.assertFalse(ev1.parse_format_b(bad).crc_ok)
        flipped = bytearray(FULL_B)
        flipped[10] ^= 0x01                                        # un bit de l'identité
        self.assertFalse(ev1.parse_format_b(bytes(flipped)).crc_ok)

    def test_parse_bad_length(self):
        with self.assertRaises(ev1.FormatError):
            ev1.parse_format_b(FULL_B[:27])

    def test_bounds(self):
        with self.assertRaises(ValueError):
            ev1.build_header(1, 0, 65536)
        with self.assertRaises(ValueError):
            ev1.build_format_b(1, 0, 1, IDENT[:15])

    def test_token_hash(self):
        self.assertEqual(ev1.token_hash(IDENT), hashlib.sha256(IDENT).digest())
        # valeur figée, reprise telle quelle dans le test Kotlin
        self.assertEqual(ev1.token_hash(IDENT).hex(),
                         "8ed44d9bf7aa3e9e4292e616f21d6e62c3e7f02e1e65c22829756f0879fbd24e")


class TestFrames(unittest.TestCase):
    def test_frames(self):
        self.assertEqual(ev1.cmd_get_version(), b"\x60")
        self.assertEqual(ev1.cmd_read(4), b"\x30\x04")
        self.assertEqual(ev1.cmd_fast_read(4, 4), b"\x3a\x04\x04")
        self.assertEqual(ev1.cmd_fast_read(5, 10), b"\x3a\x05\x0a")
        self.assertEqual(ev1.cmd_pwd_auth(PWD), bytes.fromhex("1b283e8c48"))
        self.assertEqual(ev1.cmd_read_cnt(2), b"\x39\x02")
        self.assertEqual(ev1.cmd_incr_cnt(2), bytes.fromhex("a50201000000"))
        self.assertEqual(ev1.cmd_incr_cnt(2, 0x030201), bytes.fromhex("a50201020300"))
        self.assertEqual(ev1.cmd_read_sig(), b"\x3c\x00")
        self.assertEqual(ev1.cmd_write(0x12, PWD), bytes.fromhex("a212283e8c48"))

    def test_frame_bounds(self):
        for bad in (lambda: ev1.cmd_read(20), lambda: ev1.cmd_fast_read(10, 5),
                    lambda: ev1.cmd_read_cnt(3), lambda: ev1.cmd_incr_cnt(0, 1 << 24),
                    lambda: ev1.cmd_pwd_auth(b"\x00" * 3)):
            with self.assertRaises(ValueError):
                bad()

    def test_read_cnt_lsb_first(self):
        self.assertEqual(ev1.decode_read_cnt(bytes.fromhex("010000")), 1)
        self.assertEqual(ev1.decode_read_cnt(bytes.fromhex("563412")), 0x123456)
        self.assertEqual(ev1.decode_read_cnt(bytes.fromhex("ffffff")), 0xFFFFFF)
        with self.assertRaises(ev1.FormatError):
            ev1.decode_read_cnt(b"\x01\x00")

    def test_ack_nak(self):
        self.assertEqual(ev1.decode_ack_nak(b"\x0a"), ("ACK", 0xA))
        self.assertEqual(ev1.decode_ack_nak(b"\x00"), ("NAK", 0x0))
        self.assertEqual(ev1.decode_ack_nak(b"\x04"), ("NAK", 0x4))

    def test_get_version(self):
        self.assertTrue(ev1.is_mf0ul11(ev1.GET_VERSION_MF0UL11))
        self.assertTrue(ev1.is_mf0ul11(bytes.fromhex("0004030201000b03")))    # MF0UL11 50 pF
        self.assertFalse(ev1.is_mf0ul11(bytes.fromhex("0004030101000e03")))   # MF0UL21
        self.assertFalse(ev1.is_mf0ul11(bytes.fromhex("0004040201000f03")))   # NTAG213
        self.assertFalse(ev1.is_mf0ul11(b"\x00" * 7))


class TestConfig(unittest.TestCase):
    def test_access(self):
        self.assertEqual(ev1.access_byte(prot=True, authlim=0), 0x80)
        self.assertEqual(ev1.access_byte(prot=False, authlim=0), 0x00)
        self.assertEqual(ev1.access_byte(prot=True, authlim=7), 0x87)
        self.assertEqual(ev1.parse_access(0xC5), {"prot": True, "cfglck": True, "authlim": 5})

    def test_cfg_pages(self):
        cfg0_default = bytes.fromhex("000000ff")         # valeur usine (AUTH0 = 0xFF)
        cfg1_default = bytes.fromhex("00050000")         # ACCESS 00, VCTID 05
        self.assertEqual(ev1.cfg0_with_auth0(cfg0_default, 5), bytes.fromhex("00000005"))
        self.assertEqual(ev1.cfg0_with_auth0(bytes.fromhex("040000ff"), 5), bytes.fromhex("04000005"))
        self.assertEqual(ev1.cfg1_with_access(cfg1_default, True, 0), bytes.fromhex("80050000"))
        with self.assertRaises(ValueError):
            ev1.cfg1_with_access(bytes.fromhex("40050000"), True, 0)   # CFGLCK déjà posé
        self.assertEqual(ev1.pack_page(PACK), bytes.fromhex("428c0000"))

    def test_personalization_plan(self):
        plan = ev1.personalization_writes(FULL_B, PWD, PACK, bytes.fromhex("000000ff"),
                                          bytes.fromhex("00050000"))
        self.assertEqual([p for p, _ in plan], [4, 5, 6, 7, 8, 9, 10, 0x12, 0x13, 0x11, 0x10])
        self.assertEqual(plan[-1], (0x10, bytes.fromhex("00000005")))  # AUTH0 en dernier
        self.assertEqual(plan[-2], (0x11, bytes.fromhex("80050000")))
        self.assertEqual(plan[7], (0x12, PWD))
        self.assertEqual(plan[8], (0x13, bytes.fromhex("428c0000")))
        with self.assertRaises(ValueError):
            ev1.personalization_writes(FULL_B, PWD, PACK, bytes(4), bytes(4), auth0=3)
        with self.assertRaises(ValueError):
            ev1.personalization_writes(FULL_B, PWD, PACK, bytes(4), bytes(4), authlim=2)


class TestPwdPack(unittest.TestCase):
    def test_kdf_message(self):
        self.assertEqual(ev1.kdf_message(OP, 1, UID), KDF_MSG)

    def test_derive(self):
        self.assertEqual(ev1.derive_pwd_pack(MASTER_TEST, OP, 1, UID), (PWD, PACK))

    def test_decrypt_blob(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest("module cryptography absent")
        aad = ev1.pwd_pack_aad(MEDIA_ID, OP, 1, UID)
        self.assertEqual(ev1.decrypt_pwd_pack(DEK_TEST, BLOB, aad), (PWD, PACK))
        with self.assertRaises(Exception):
            ev1.decrypt_pwd_pack(DEK_TEST, BLOB, aad[:-1] + b"\x00")   # autre UID → refus


if __name__ == "__main__":
    unittest.main(verbosity=2)
