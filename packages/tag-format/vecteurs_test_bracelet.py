import hmac, hashlib, zlib, uuid
# format B (1.0) — page 4 : majeur, mineur, index de clé sur 2 octets (big-endian) ; page 9 : drapeaux + 3 octets réservés
major, minor, key_index, flags = 1, 0, 1, 0
KI = key_index.to_bytes(2, "big")                    # index de clé : 0 à 65 535
ident = bytes.fromhex("3f9a1c7e5b2d48e0a6c4f1d29b7e0c53")
page9 = bytes([flags]) + bytes(3)
body = bytes([major, minor]) + KI + ident + page9
crc = zlib.crc32(body) & 0xffffffff
full = body + crc.to_bytes(4, "big")
print("format B, 28 octets, CRC", f"{crc:08x}")
for p in range(7): print(f"  page {4+p:2d} : {full[p*4:p*4+4].hex(' ')}")
# KDF — NIST SP 800-108 (mode compteur, PRF = HMAC-SHA256), un seul bloc.
# Compatible AWS KMS : le message ci-dessous est passé à GenerateMac (clé HMAC_256 du prestataire).
def kdf_800_108(key, label, context, L_bits):
    msg = (1).to_bytes(4, "big") + label + b"\x00" + context + L_bits.to_bytes(4, "big")
    return msg, hmac.new(key, msg, hashlib.sha256).digest()[: L_bits // 8]
K = bytes(range(32))                      # clé maître de TEST uniquement
op = uuid.UUID("00000000-0000-0000-0000-000000000002").bytes
uid = bytes.fromhex("04a1b2c3d4e5f6")
msg, okm = kdf_800_108(K, b"CASHLESS/UL-EV1/PWD/v1", op + KI + uid, 48)
print("message GenerateMac", msg.hex())
print("SP800-108 okm", okm.hex(), "PWD", okm[:4].hex(), "PACK", okm[4:6].hex())

# Stockage chiffré de PWD||PACK (chiffrement enveloppe, AES-256-GCM)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
dek   = bytes(range(0x10, 0x30))                     # clé de données de TEST (en production : KMS GenerateDataKey)
nonce = bytes(range(12))                             # TEST uniquement ; en production : 12 octets aléatoires
media_id = uuid.UUID("40000000-0000-0000-0000-000000000001").bytes
aad = b"CASHLESS/PWDPACK/v1" + media_id + op + KI + uid
ct = AESGCM(dek).encrypt(nonce, okm, aad)            # 6 octets chiffrés + 16 octets d'authentification
blob = nonce + ct
print("AAD", aad.hex())
print("pwd_pack_enc (34 octets)", blob.hex(), len(blob))
assert AESGCM(dek).decrypt(blob[:12], blob[12:], aad) == okm
try:
    AESGCM(dek).decrypt(blob[:12], blob[12:], aad[:-1] + b"\x00")   # autre UID : doit échouer
    print("ERREUR : AAD non vérifiée")
except Exception:
    print("déchiffrement refusé si l'AAD change : OK")
