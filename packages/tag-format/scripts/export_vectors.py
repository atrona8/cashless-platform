"""Fige en JSON les vecteurs du kit (vecteurs_test_bracelet.py), sans les recopier à la main.

Le script du kit est exécuté tel quel ; ses variables sont lues puis écrites dans vectors/vectors.json, que lisent les
suites TypeScript et Dart. La section "refusals" (cas de refus) est propre à ce dépôt : le kit n'en fournit pas.
Usage : python3 scripts/export_vectors.py [--check]   (exige le module `cryptography`, comme le script du kit).
"""
import contextlib, io, json, pathlib, runpy, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "vectors" / "vectors.json"


def build():
    with contextlib.redirect_stdout(io.StringIO()):
        ns = runpy.run_path(str(ROOT / "vecteurs_test_bracelet.py"))
    h = lambda b: bytes(b).hex()
    full = ns["full"]
    bad_major = bytes([2]) + full[1:]
    bad_crc = full[:27] + bytes([full[27] ^ 0x01])
    return {
        "source": "vecteurs_test_bracelet.py",
        "crc_check": {"input_ascii": "123456789", "crc": "cbf43926"},
        "format_b": {
            "major": ns["major"], "minor": ns["minor"], "key_index": ns["key_index"], "flags": ns["flags"],
            "identity": h(ns["ident"]), "crc": f"{ns['crc']:08x}", "bytes": h(full),
        },
        "kdf": {
            "test_key": h(ns["K"]), "operator_id": "00000000-0000-0000-0000-000000000002", "key_index": ns["key_index"],
            "uid": h(ns["uid"]), "message": h(ns["msg"]), "okm": h(ns["okm"]),
            "pwd": h(ns["okm"][:4]), "pack": h(ns["okm"][4:6]),
        },
        "envelope": {
            "dek": h(ns["dek"]), "nonce": h(ns["nonce"]), "media_id": "40000000-0000-0000-0000-000000000001",
            "aad": h(ns["aad"]), "plaintext": h(ns["okm"]), "pwd_pack_enc": h(ns["blob"]),
        },
        "refusals": {
            "format_b": [
                {"name": "majeur inconnu", "bytes": h(bad_major), "code": "UNKNOWN_MAJOR"},
                {"name": "CRC faux", "bytes": h(bad_crc), "code": "BAD_CRC"},
                {"name": "27 octets", "bytes": h(full[:27]), "code": "BAD_LENGTH"},
            ],
            "envelope": [
                {"name": "33 octets", "blob": h(ns["blob"][:33]), "aad": h(ns["aad"]), "code": "BAD_LENGTH"},
                {"name": "autre UID dans l'AAD", "blob": h(ns["blob"]), "aad": h(ns["aad"][:-1] + b"\x00"), "code": "AUTH_FAILED"},
            ],
            "claim_code": ["K7QM-4XH9R0", "K7QM-4XH9R1", "K7QM-4XH9RI", "K7QM-4XH9RO", "K7QM-4XH9", "K7QM-4XH9RTT"],
        },
        "claim_code": {"alphabet": "23456789ABCDEFGHJKLMNPQRSTUVWXYZ", "inputs": [
            {"input": "K7QM-4XH9RT", "normalized": "K7QM4XH9RT", "formatted": "K7QM-4XH9RT"},
            {"input": " k7qm 4xh9rt ", "normalized": "K7QM4XH9RT", "formatted": "K7QM-4XH9RT"},
        ]},
    }


if __name__ == "__main__":
    text = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        sys.exit(0 if OUT.read_text(encoding="utf-8") == text else 1)
    OUT.write_text(text, encoding="utf-8")
    print("écrit", OUT)
