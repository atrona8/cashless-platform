#!/usr/bin/env python3
"""Génère vectors.json : empreintes d'opérations (sync_protocol.md §3.3) et chaîne (§3.2).

Bibliothèque standard seule. Non exécuté par Jest : le résultat est committé. Les valeurs sont calculées ici,
jamais par le code testé (chained-content.ts). Forme canonique : JSON trié, sans espace, UTF-8 non échappé.
"""
import hashlib
import json
import uuid

CHAINED = ["seq", "type", "occurred_at", "amount", "currency", "tap", "lines", "reverses_seq",
           "reverses_transaction_id", "online_operation", "void_reason"]


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj):
    return hashlib.sha256(canon(obj).encode("utf-8")).hexdigest()


TAP = {
    "nfc_uid": "04a1b2c3d4e5f6",
    "token_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "counter": 413, "key_index": 1, "pack_verified": True,
    "originality_signature": "3a7f0c9e5b2d4a6f8e1c3b5d7f9a0c2e4b6d8f0a1c3e5b7d9f0a2c4e6b8d0f1a",
    "occurred_at": "2026-12-11T19:09:59Z",
}
LINES = [{"product_id": "9d1b7a4c-2e3f-4a5b-8c6d-7e8f9a0b1c2d", "quantity": 2, "unit_price": 3000}]
TX = "0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a"

CASES = [
    ("5b_purchase_tap_lines", {"seq": 1, "type": "PURCHASE", "occurred_at": "2026-12-11T19:10:00Z",
                               "amount": 6000, "currency": "XOF", "tap": TAP, "lines": LINES}),
    ("5b_purchase_keypad", {"seq": 7, "type": "PURCHASE", "occurred_at": "2026-12-11T20:05:00Z",
                            "amount": 4000, "currency": "XOF"}),
    ("batch_sale_lines", {"seq": 12, "type": "PURCHASE", "occurred_at": "2026-12-12T08:00:00Z",
                          "amount": 6000, "currency": "XOF", "tap": TAP, "lines": LINES}),
    ("reversal_by_seq", {"seq": 13, "type": "REVERSAL", "occurred_at": "2026-12-12T08:05:00Z",
                         "reverses_seq": 12}),
    ("reversal_by_transaction", {"seq": 14, "type": "REVERSAL", "occurred_at": "2026-12-12T08:06:00Z",
                                 "reverses_transaction_id": TX}),
    ("void", {"seq": 15, "type": "VOID", "occurred_at": "2026-12-12T08:07:00Z",
              "void_reason": "TERMINAL_ERROR"}),
    ("online_ref", {"seq": 16, "type": "ONLINE_REF", "occurred_at": "2026-12-12T08:08:00Z",
                    "online_operation": "PURCHASE", "amount": 1500, "currency": "XOF"}),
    ("seq_2_pow_32", {"seq": 4294967296, "type": "PURCHASE", "occurred_at": "2026-12-12T09:00:00Z",
                      "amount": 500, "currency": "XOF"}),
    ("seq_max_safe", {"seq": 9007199254740991, "type": "PURCHASE", "occurred_at": "2026-12-12T09:01:00Z",
                      "amount": 500, "currency": "XOF"}),
    ("unknown_tap_property", {"seq": 17, "type": "PURCHASE", "occurred_at": "2026-12-12T09:02:00Z",
                              "amount": 500, "currency": "XOF", "tap": {**TAP, "extra_é": "ü"}}),
]

STATE = {"online_status": "CONFIRMED", "online_transaction_id": TX, "online_tap_id": 5,
         "snapshot_version": 12, "config_id": 3, "local_available_before": 9000,
         "clock": {"x": 1}, "tap_id": 99, "customer_qr_token": "CQ7M2K9XQ4TP",
         "vendor_session_id": "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b"}

ops = []
for name, op in CASES:
    assert set(op) <= set(CHAINED)
    ops.append({"name": name, "op": op, "canonical": canon(op), "content_sha256": sha(op)})

DEVICE = "3b9f0c52-7a1e-4d68-9c24-5e8a1f7b6d30"
c1, c2, c3 = (bytes.fromhex(sha(op)) for _, op in CASES[2:5])
h0 = hashlib.sha256(b"CASHLESS/CHAIN/v1" + uuid.UUID(DEVICE).bytes).digest()
h1 = hashlib.sha256(h0 + c1).digest()
h2 = hashlib.sha256(h1 + c2).digest()
h3 = hashlib.sha256(h2 + c3).digest()

out = {
    "ops": ops,
    "state_fields": STATE,
    "chain": {
        "device_id": DEVICE,
        "chain_hash_0": h0.hex(),
        "links": [
            {"content_sha256": c.hex(), "chain_hash": h.hex()}
            for c, h in ((c1, h1), (c2, h2), (c3, h3))
        ],
    },
}
with open("vectors.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
    f.write("\n")
