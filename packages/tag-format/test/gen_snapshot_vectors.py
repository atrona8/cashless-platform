#!/usr/bin/env python3
"""Vecteurs fixes des enveloppes de snapshot (WP12, R-08). Script INDEPENDANT du code testé.

Usage : python3 gen_snapshot_vectors.py > snapshot-vectors.json
Dépendance : paquet `cryptography`. Aucune valeur ci-dessous n'est secrète (clés de TEST).
Construction rejouée sans la bibliothèque TypeScript : ECDH P-256 (éphémère fixe) -> HKDF-SHA256
(sel vide, info = AAD) -> AES-256-GCM (AAD = AAD), nonce fixe.
"""
import base64, json, struct, uuid
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

LEDGER = uuid.UUID("a0000000-0000-0000-0000-000000000001")
DEVICE = uuid.UUID("d0000000-0000-0000-0000-000000000002")
VERSION = 4_294_967_298  # > 2^32 : octets de poids fort non nuls
TOKEN_HASH = bytes(range(0x40, 0x60))
NFC_UID = bytes.fromhex("04a1b2c3d4e5f6")
KV = bytes(range(0x80, 0xA0))
NONCE = bytes(range(0x10, 0x1C))
RECIPIENT_D = 0x1B9D3F5A7C21E4086A5B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D5E6F7081
EPHEMERAL_D = 0x2C0E4A6B8D32F5197B6C4D5E6F708192A3B4C5D6E7F8091A2B3C4D5E6F708192

def aad_key():
    return b"CASHLESS/SNAPKEY/v1" + LEDGER.bytes + struct.pack(">Q", VERSION) + DEVICE.bytes

def aad_pwd():
    return (b"CASHLESS/SNAPPWD/v1" + LEDGER.bytes + struct.pack(">Q", VERSION) + TOKEN_HASH + NFC_UID)

def point(key):
    return key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)

recipient = ec.derive_private_key(RECIPIENT_D, ec.SECP256R1())
ephemeral = ec.derive_private_key(EPHEMERAL_D, ec.SECP256R1())
shared = ephemeral.exchange(ec.ECDH(), recipient.public_key())
aad = aad_key()
cek = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=aad).derive(shared)
sealed = AESGCM(cek).encrypt(NONCE, KV, aad)
ciphertext, tag = sealed[:-16], sealed[-16:]

# Mot de passe chiffré sous K_v (AES-256-GCM, AAD de snapshot), pour un PWD‖PACK fixe.
PWD_PACK = bytes.fromhex("c4a55e7f0199")
pwd_sealed = AESGCM(KV).encrypt(NONCE, PWD_PACK, aad_pwd())

print(json.dumps({
    "_generator": "gen_snapshot_vectors.py (Python, bibliothèque cryptography), indépendant du code testé",
    "ledger_id": str(LEDGER), "device_id": str(DEVICE), "version": str(VERSION),
    "token_hash": TOKEN_HASH.hex(), "nfc_uid": NFC_UID.hex(),
    "snapkey_aad_hex": aad_key().hex(), "snappwd_aad_hex": aad_pwd().hex(),
    "recipient_private_key_hex": format(RECIPIENT_D, "064x"),
    "recipient_public_key_hex": point(recipient).hex(),
    "k_v_hex": KV.hex(), "nonce_hex": NONCE.hex(),
    "envelope": {
        "alg": "ECDH-ES+HKDF-SHA256+A256GCM",
        "epk": base64.urlsafe_b64encode(point(ephemeral)).rstrip(b"=").decode(),
        "nonce": base64.b64encode(NONCE).decode(),
        "ciphertext": base64.b64encode(ciphertext).decode(),
        "tag": base64.b64encode(tag).decode(),
    },
    "wrapped_key": {
        "alg": "ECDH-ES+HKDF-SHA256+A256GCM",
        "epk": base64.urlsafe_b64encode(point(ephemeral)).rstrip(b"=").decode(),
        "iv": base64.b64encode(NONCE).decode(),
        "wrapped_key": base64.b64encode(sealed).decode(),
    },
    "pwd_pack_hex": PWD_PACK.hex(),
    "pwd_pack_enc_hex": (NONCE + pwd_sealed).hex(),
    "pwd_pack_sha256_hex": __import__("hashlib").sha256(NONCE + pwd_sealed).hexdigest(),
}, indent=2))
