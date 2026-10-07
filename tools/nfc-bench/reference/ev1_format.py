"""
Référence Python (logique pure) du banc de mesure NFC — MIFARE Ultralight EV1 MF0UL11.

Ce module ne parle à aucun matériel. Il sert :
  * de spécification exécutable pour le code Kotlin (sn.cashless.nfcbench.core.Ev1Protocol) ;
  * de générateur / vérificateur de vecteurs de test (voir test_ev1_format.py).

Carte mémoire MF0UL11 (20 pages de 4 octets, adresses 0x00–0x13) :
  0x00–0x03  UID, octets de verrouillage, OTP
  0x04–0x0F  mémoire utilisateur (48 octets) — le format B occupe 0x04–0x0A
  0x10       CFG0 : MOD, RFUI, RFUI, AUTH0
  0x11       CFG1 : ACCESS, VCTID, RFUI, RFUI
  0x12       PWD (4 octets, lu comme 00 00 00 00)
  0x13       PACK (2 octets) + 2 octets RFUI

Format B (pages 4–10, 28 octets) :
  page 4     major (1), minor (1), key_index (2, big-endian)
  pages 5–8  identité aléatoire (16)
  page 9     flags (1) + 3 octets réservés (00)
  page 10    CRC-32/ISO-HDLC big-endian calculé sur les pages 4–9 (24 octets)

Les points marqués « À VÉRIFIER » reposent sur la datasheet NXP MF0ULX1
(« MIFARE Ultralight EV1 – Contactless ticket IC », rév. 3.x) citée de mémoire.
"""
from __future__ import annotations

import hashlib
import hmac
import zlib
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Constantes de la puce
# ---------------------------------------------------------------------------
PAGE_SIZE = 4
MF0UL11_PAGES = 20                 # 0x00..0x13
FORMAT_B_FIRST_PAGE = 4
FORMAT_B_LAST_PAGE = 10
FORMAT_B_LEN = 28                  # 7 pages
FORMAT_B_CRC_COVERED = 24          # pages 4..9

PAGE_CFG0 = 0x10
PAGE_CFG1 = 0x11
PAGE_PWD = 0x12
PAGE_PACK = 0x13

CMD_GET_VERSION = 0x60
CMD_READ = 0x30
CMD_FAST_READ = 0x3A
CMD_WRITE = 0xA2
CMD_PWD_AUTH = 0x1B
CMD_READ_CNT = 0x39
CMD_INCR_CNT = 0xA5
CMD_READ_SIG = 0x3C

ACK = 0x0A
# Codes NAK (4 bits) — datasheet MF0ULX1, tableau « ACK and NAK values » (À VÉRIFIER) :
NAK_CODES = {
    0x0: "argument invalide (adresse de page / de compteur invalide)",
    0x1: "erreur de parité ou de CRC",
    0x4: "débordement du compteur d'authentification (AUTHLIM atteint)",
    0x5: "erreur d'écriture EEPROM",
}

# Réponse GET_VERSION attendue pour MF0UL11 (8 octets) :
# en-tête fixe 00, vendeur 04 (NXP), type 03 (Ultralight), sous-type 01 (17 pF) ou 02 (50 pF, « H »),
# version majeure 01, mineure 00, taille 0B (MF0UL11 ; 0E = MF0UL21), protocole 03 (ISO 14443-3).
GET_VERSION_MF0UL11 = bytes.fromhex("0004030101000b03")

COUNTER_CLONE_DETECTION = 0x02
COUNTER_MAX = 0xFFFFFF

SUPPORTED_MAJOR = 1


# ---------------------------------------------------------------------------
# CRC-32/ISO-HDLC
# ---------------------------------------------------------------------------
def crc32_iso_hdlc(data: bytes) -> int:
    """CRC-32/ISO-HDLC (= CRC-32 « zip ») : poly 0x04C11DB7 réfléchi (0xEDB88320),
    init 0xFFFFFFFF, refin/refout, xorout 0xFFFFFFFF. Contrôle : « 123456789 » → 0xCBF43926.

    Implémentation bit à bit volontairement explicite (même algorithme que le Kotlin),
    recoupée avec zlib.crc32 dans les tests."""
    crc = 0xFFFFFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ (0xEDB88320 if crc & 1 else 0)
    return crc ^ 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Format B
# ---------------------------------------------------------------------------
class FormatError(ValueError):
    """Contenu de bracelet hors format (longueur, CRC, version)."""


@dataclass(frozen=True)
class Header:
    major: int
    minor: int
    key_index: int


@dataclass(frozen=True)
class FormatB:
    major: int
    minor: int
    key_index: int
    identity: bytes      # 16 octets
    flags: int
    reserved: bytes      # 3 octets
    crc_stored: int
    crc_computed: int

    @property
    def crc_ok(self) -> bool:
        return self.crc_stored == self.crc_computed


def build_header(major: int, minor: int, key_index: int) -> bytes:
    if not (0 <= major <= 0xFF and 0 <= minor <= 0xFF):
        raise ValueError("major/minor sur 1 octet")
    if not 0 <= key_index <= 0xFFFF:
        raise ValueError("key_index sur 2 octets (0..65535)")
    return bytes([major, minor]) + key_index.to_bytes(2, "big")


def parse_header(page4: bytes) -> Header:
    if len(page4) < 4:
        raise FormatError(f"page 4 : 4 octets attendus, {len(page4)} reçus")
    return Header(page4[0], page4[1], int.from_bytes(page4[2:4], "big"))


def build_format_b(major: int, minor: int, key_index: int, identity: bytes,
                   flags: int = 0, reserved: bytes = b"\x00\x00\x00",
                   corrupt_crc: bool = False) -> bytes:
    """Construit les 28 octets des pages 4–10. corrupt_crc=True : bracelet volontairement
    « hors format » pour le banc (CRC inversé sur son dernier octet)."""
    if len(identity) != 16:
        raise ValueError("identité : 16 octets")
    if len(reserved) != 3 or not 0 <= flags <= 0xFF:
        raise ValueError("page 9 : flags 1 octet + 3 octets réservés")
    body = build_header(major, minor, key_index) + identity + bytes([flags]) + reserved
    crc = crc32_iso_hdlc(body)
    if corrupt_crc:
        crc ^= 0x000000FF
    return body + crc.to_bytes(4, "big")


def parse_format_b(data: bytes) -> FormatB:
    """Analyse 28 octets (pages 4–10). Ne lève pas sur CRC faux : c'est à l'appelant de
    décider (le banc compte les « faux rejets CRC »)."""
    if len(data) != FORMAT_B_LEN:
        raise FormatError(f"format B : {FORMAT_B_LEN} octets attendus, {len(data)} reçus")
    h = parse_header(data[0:4])
    return FormatB(h.major, h.minor, h.key_index, bytes(data[4:20]), data[20], bytes(data[21:24]),
                   int.from_bytes(data[24:28], "big"), crc32_iso_hdlc(data[0:24]))


def split_pages(data: bytes) -> list[bytes]:
    if len(data) % PAGE_SIZE:
        raise ValueError("longueur non multiple de 4")
    return [data[i:i + PAGE_SIZE] for i in range(0, len(data), PAGE_SIZE)]


def token_hash(identity: bytes) -> bytes:
    """token_hash = SHA-256(identité 16 octets)."""
    if len(identity) != 16:
        raise ValueError("identité : 16 octets")
    return hashlib.sha256(identity).digest()


# ---------------------------------------------------------------------------
# Trames de commande (sans CRC_A : Android NfcA.transceive l'ajoute lui-même)
# ---------------------------------------------------------------------------
def _page(p: int) -> int:
    if not 0 <= p < MF0UL11_PAGES:
        raise ValueError(f"page hors MF0UL11 : {p}")
    return p


def cmd_get_version() -> bytes:
    return bytes([CMD_GET_VERSION])


def cmd_read(page: int) -> bytes:
    """READ : renvoie 16 octets (4 pages), avec retour à la page 0 en fin de mémoire."""
    return bytes([CMD_READ, _page(page)])


def cmd_fast_read(start: int, end: int) -> bytes:
    """FAST_READ : renvoie (end-start+1)*4 octets ; NAK si end < start ou adresse invalide."""
    _page(start), _page(end)
    if end < start:
        raise ValueError("FAST_READ : end < start")
    return bytes([CMD_FAST_READ, start, end])


def cmd_write(page: int, data4: bytes) -> bytes:
    if len(data4) != 4:
        raise ValueError("WRITE : 4 octets")
    return bytes([CMD_WRITE, _page(page)]) + data4


def cmd_pwd_auth(pwd: bytes) -> bytes:
    if len(pwd) != 4:
        raise ValueError("PWD : 4 octets")
    return bytes([CMD_PWD_AUTH]) + pwd


def _counter(n: int) -> int:
    if n not in (0, 1, 2):
        raise ValueError("compteur 0..2")
    return n


def cmd_read_cnt(counter: int) -> bytes:
    return bytes([CMD_READ_CNT, _counter(counter)])


def cmd_incr_cnt(counter: int, increment: int = 1) -> bytes:
    """INCR_CNT : 3 octets d'incrément LSB d'abord + 1 octet ignoré (mis à 0)."""
    if not 0 <= increment <= COUNTER_MAX:
        raise ValueError("incrément sur 24 bits")
    return bytes([CMD_INCR_CNT, _counter(counter)]) + increment.to_bytes(3, "little") + b"\x00"


def cmd_read_sig() -> bytes:
    return bytes([CMD_READ_SIG, 0x00])


# ---------------------------------------------------------------------------
# Décodage des réponses
# ---------------------------------------------------------------------------
def decode_read_cnt(resp: bytes) -> int:
    """READ_CNT → 3 octets, LSB d'abord."""
    if len(resp) != 3:
        raise FormatError(f"READ_CNT : 3 octets attendus, {len(resp)} reçus")
    return int.from_bytes(resp, "little")


def decode_ack_nak(resp: bytes) -> tuple[str, int]:
    """Une réponse ACK/NAK est une trame de 4 bits ; Android la remonte (quand il la remonte :
    beaucoup de piles lèvent IOException à la place d'un NAK) sur 1 octet."""
    if len(resp) != 1:
        raise FormatError("ACK/NAK : 1 octet attendu")
    nib = resp[0] & 0x0F
    return ("ACK", nib) if nib == ACK else ("NAK", nib)


def parse_get_version(resp: bytes) -> dict:
    if len(resp) != 8:
        raise FormatError(f"GET_VERSION : 8 octets attendus, {len(resp)} reçus")
    return {
        "header": resp[0], "vendor": resp[1], "type": resp[2], "subtype": resp[3],
        "major": resp[4], "minor": resp[5], "storage": resp[6], "protocol": resp[7],
    }


def is_mf0ul11(resp: bytes) -> bool:
    """Accepte les sous-types 01 (17 pF) et 02 (50 pF). Tout le reste (MF0UL21 0E, NTAG21x type 04,
    cartes « magiques » à réponse différente) est rejeté."""
    try:
        v = parse_get_version(resp)
    except FormatError:
        return False
    return (v["vendor"] == 0x04 and v["type"] == 0x03 and v["subtype"] in (0x01, 0x02)
            and v["major"] == 0x01 and v["storage"] == 0x0B and v["protocol"] == 0x03)


# ---------------------------------------------------------------------------
# Pages de configuration CFG0 / CFG1 / PACK
# ---------------------------------------------------------------------------
ACCESS_PROT = 0x80     # bit 7 : 1 = lecture ET écriture protégées ; 0 = écriture seule
ACCESS_CFGLCK = 0x40   # bit 6 : verrou DÉFINITIF des pages de config — ne jamais poser dans le banc
ACCESS_AUTHLIM_MASK = 0x07


def access_byte(prot: bool, authlim: int = 0, cfglck: bool = False) -> int:
    if not 0 <= authlim <= 7:
        raise ValueError("AUTHLIM sur 3 bits")
    return (ACCESS_PROT if prot else 0) | (ACCESS_CFGLCK if cfglck else 0) | authlim


def parse_access(b: int) -> dict:
    return {"prot": bool(b & ACCESS_PROT), "cfglck": bool(b & ACCESS_CFGLCK),
            "authlim": b & ACCESS_AUTHLIM_MASK}


def cfg0_with_auth0(cfg0: bytes, auth0: int) -> bytes:
    """Remplace AUTH0 (octet 3) en préservant MOD et les RFU lus sur la puce."""
    if len(cfg0) != 4 or not 0 <= auth0 <= 0xFF:
        raise ValueError("CFG0 : 4 octets, AUTH0 sur 1 octet")
    return bytes(cfg0[0:3]) + bytes([auth0])


def cfg1_with_access(cfg1: bytes, prot: bool, authlim: int) -> bytes:
    """Remplace ACCESS (octet 0) ; conserve VCTID et RFU. Refuse si CFGLCK est déjà posé."""
    if len(cfg1) != 4:
        raise ValueError("CFG1 : 4 octets")
    if cfg1[0] & ACCESS_CFGLCK:
        raise ValueError("CFGLCK posé : configuration verrouillée définitivement")
    rfu = cfg1[0] & 0x38                 # bits 5..3 RFU conservés tels quels
    return bytes([access_byte(prot, authlim) | rfu]) + bytes(cfg1[1:4])


def pack_page(pack: bytes) -> bytes:
    if len(pack) != 2:
        raise ValueError("PACK : 2 octets")
    return pack + b"\x00\x00"


def personalization_writes(format_b: bytes, pwd: bytes, pack: bytes, cfg0: bytes, cfg1: bytes,
                           auth0: int = 5, prot: bool = True, authlim: int = 0) -> list[tuple[int, bytes]]:
    """Plan d'écritures ordonné (page, 4 octets). L'ordre est choisi pour qu'une interruption
    ne laisse jamais une puce protégée par un mot de passe non écrit :
      1. données 4–10 ; 2. PWD ; 3. PACK ; 4. CFG1/ACCESS ; 5. CFG0/AUTH0 EN DERNIER."""
    if len(format_b) != FORMAT_B_LEN:
        raise ValueError("format B : 28 octets")
    if auth0 not in (5, 0xFF):
        raise ValueError("banc : AUTH0 limité à 5 (protégé) ou 0xFF (non protégé)")
    if authlim != 0:
        raise ValueError("banc : AUTHLIM doit rester 0 (sinon puce bloquée après N échecs)")
    plan = [(FORMAT_B_FIRST_PAGE + i, p) for i, p in enumerate(split_pages(format_b))]
    plan += [(PAGE_PWD, bytes(pwd)), (PAGE_PACK, pack_page(pack)),
             (PAGE_CFG1, cfg1_with_access(cfg1, prot, authlim)),
             (PAGE_CFG0, cfg0_with_auth0(cfg0, auth0))]
    return plan


# ---------------------------------------------------------------------------
# PWD/PACK de TEST (le terminal de production ne détient JAMAIS la clé maître)
# ---------------------------------------------------------------------------
PWD_LABEL = b"CASHLESS/UL-EV1/PWD/v1"
AAD_LABEL = b"CASHLESS/PWDPACK/v1"


def kdf_message(op_uuid: bytes, key_index: int, uid: bytes) -> bytes:
    """Message NIST SP 800-108 (compteur, 1 bloc, L = 48 bits) — cf. vecteurs_test_bracelet.py."""
    context = op_uuid + key_index.to_bytes(2, "big") + uid
    return (1).to_bytes(4, "big") + PWD_LABEL + b"\x00" + context + (48).to_bytes(4, "big")


def derive_pwd_pack(master_key: bytes, op_uuid: bytes, key_index: int, uid: bytes) -> tuple[bytes, bytes]:
    okm = hmac.new(master_key, kdf_message(op_uuid, key_index, uid), hashlib.sha256).digest()[:6]
    return okm[:4], okm[4:6]


def pwd_pack_aad(media_id: bytes, op_uuid: bytes, key_index: int, uid: bytes) -> bytes:
    return AAD_LABEL + media_id + op_uuid + key_index.to_bytes(2, "big") + uid


def decrypt_pwd_pack(dek: bytes, blob: bytes, aad: bytes) -> tuple[bytes, bytes]:
    """blob = nonce(12) || chiffré(6) || tag(16) — AES-256-GCM. Nécessite « cryptography »."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if len(blob) != 34:
        raise ValueError("pwd_pack_enc : 34 octets attendus")
    okm = AESGCM(dek).decrypt(blob[:12], blob[12:], aad)
    return okm[:4], okm[4:6]
