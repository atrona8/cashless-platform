#!/usr/bin/env python3
"""Génère vectors.json : contenu, empreinte et chaîne des opérations d'une passerelle (research R-12) et charge
utile de signature d'un lot (R-13).

Bibliothèque standard seule (hashlib, json, uuid). Ne lit AUCUN fichier du dépôt, aucun code TypeScript ou
JavaScript : la canonicalisation JCS (RFC 8785) est réécrite ici, les valeurs sont calculées ici et jamais par le
code testé (packages/shared-rules). Non exécuté par Jest : le résultat est committé. Relancé deux fois, il produit
le même fichier (aucune horloge, aucun hasard).

Usage : python3 gen_edge_vectors.py   (écrit vectors.json dans le dossier courant)
"""
import hashlib
import json
import uuid

# --- JCS (RFC 8785), réécrit : clés triées par unités UTF-16, aucun espace, entiers en décimal ------------------

_ESC = {0x22: '\\"', 0x5C: "\\\\", 0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0C: "\\f", 0x0D: "\\r"}


def jcs_string(s):
    out = ['"']
    for ch in s:
        cp = ord(ch)
        if cp in _ESC:
            out.append(_ESC[cp])
        elif cp < 0x20:
            out.append("\\u%04x" % cp)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def jcs(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, str):
        return jcs_string(v)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(jcs_string(k) + ":" + jcs(v[k]) for k in keys) + "}"
    raise TypeError("type non canonicalisable : %r" % (type(v),))


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).digest()


# --- Contenu d'une opération de passerelle -----------------------------------------------------------------------

CHAINED = ["seq", "type", "occurred_at", "amount", "currency", "tap", "lines", "reverses_seq",
           "reverses_transaction_id", "online_operation", "void_reason"]
MAX_SAFE = 2 ** 53 - 1


def edge_content(op):
    edge_seq = op["edge_seq"]
    if not isinstance(edge_seq, int) or edge_seq < 0 or edge_seq > MAX_SAFE:
        raise ValueError("edge_seq hors des entiers sûrs")
    c = {k: op[k] for k in CHAINED if k in op}
    c["edge_seq"] = edge_seq
    c["device_serial"] = op["device_serial"]
    c["authorized_mode"] = op["authorized_mode"]
    for k in ("device_batch_id", "edge_guichet", "edge_decision"):
        if k in op:
            c[k] = op[k]
    return c


def edge_sha(op):
    return sha(jcs(edge_content(op)))


def genesis(gateway_id):
    return hashlib.sha256(b"CASHLESS/EDGE-CHAIN/v1" + uuid.UUID(gateway_id).bytes).digest()


def step(prev, content):
    return hashlib.sha256(prev + content).digest()


# --- Données ------------------------------------------------------------------------------------------------------

GATEWAY = "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5"
KIT_G1 = "e1000000-0000-0000-0000-000000000001"  # G1 de packages/ledger-sql/gen_tests.py (valeur recopiée)
SERIAL = "TPE-BAR-01"
TX = "0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a"
MEDIA = "5d4c3b2a-1908-4f7e-9d6c-5b4a39281706"
WALLET = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
EVENT = "11111111-2222-4333-8444-555555555555"
DESK = "c0ffee00-0000-4000-8000-00000000cafe"
BATCH = "3b9f0c52-7a1e-4d68-9c24-5e8a1f7b6d30"

TAP = {
    "nfc_uid": "04a1b2c3d4e5f6",
    "token_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "counter": 413, "key_index": 1, "pack_verified": True,
    "originality_signature": "3a7f0c9e5b2d4a6f8e1c3b5d7f9a0c2e4b6d8f0a1c3e5b7d9f0a2c4e6b8d0f1a",
    "occurred_at": "2026-12-11T19:09:59Z",
}
LINES = [{"product_id": "9d1b7a4c-2e3f-4a5b-8c6d-7e8f9a0b1c2d", "quantity": 2, "unit_price": 3000}]
DECISION_OK = {"status": "ACCEPTED", "charged_to_wallet": 6000, "shortfall_amount": 0}


def base(seq, edge_seq, typ, **extra):
    op = {"seq": seq, "type": typ, "occurred_at": "2026-12-12T08:%02d:00Z" % (edge_seq % 60),
          "edge_seq": edge_seq, "device_serial": SERIAL, "authorized_mode": "EDGE_ONLINE"}
    op.update(extra)
    return op


# (b) trois maillons EDGE_ONLINE : PURCHASE, VOID, REVERSAL
B1 = base(1, 1, "PURCHASE", amount=6000, currency="XOF", tap=TAP, lines=LINES, edge_decision=DECISION_OK)
B2 = base(2, 2, "VOID", void_reason="TERMINAL_ERROR")
B3 = base(3, 3, "REVERSAL", reverses_seq=1, reverses_transaction_id=TX)
# (c) DEVICE_OFFLINE relayé avec device_batch_id
C = base(12, 4, "PURCHASE", amount=3000, currency="XOF", tap=TAP, device_batch_id=BATCH,
         authorized_mode="DEVICE_OFFLINE", edge_decision={**DECISION_OK, "charged_to_wallet": 3000})
# (d) ACTIVATION, (e) DEPOSIT_CASH, (f) TOPUP_CASH
D = base(5, 5, "ACTIVATION", amount=0, currency="XOF", tap=TAP,
         edge_guichet={"media_id": MEDIA, "wallet_id": WALLET, "event_id": EVENT, "channel": "DESK"},
         edge_decision={"status": "ACCEPTED", "charged_to_wallet": 0, "shortfall_amount": 0})
E = base(6, 6, "DEPOSIT_CASH", amount=1000, currency="XOF",
         edge_guichet={"media_id": MEDIA, "deposit_amount": 1000, "cash_desk_account_id": DESK},
         edge_decision={"status": "ACCEPTED", "charged_to_wallet": 0, "shortfall_amount": 0})
F = base(7, 7, "TOPUP_CASH", amount=10000, currency="XOF", tap=TAP,
         edge_decision={"status": "ACCEPTED", "charged_to_wallet": 10000, "shortfall_amount": 0})
# (g) edge_seq = 2^32 et 2^53 - 1
G1_ = base(8, 2 ** 32, "PURCHASE", amount=500, currency="XOF")
G2_ = base(9, MAX_SAFE, "PURCHASE", amount=500, currency="XOF")
# (h) même contenu avec et sans edge_decision
H_WITH = base(10, 10, "PURCHASE", amount=500, currency="XOF", edge_decision=DECISION_OK)
H_WITHOUT = {k: v for k, v in H_WITH.items() if k != "edge_decision"}
# (i) propriété inconnue dans tap, conservée telle quelle
I = base(11, 11, "PURCHASE", amount=500, currency="XOF", tap={**TAP, "extra_é": "ü\n\u0001"})

OPS = [("b1_purchase", B1), ("b2_void", B2), ("b3_reversal", B3), ("c_device_offline_relayed", C),
       ("d_activation", D), ("e_deposit_cash", E), ("f_topup_cash", F), ("g1_edge_seq_2_pow_32", G1_),
       ("g2_edge_seq_max_safe", G2_), ("i_unknown_tap_property", I)]

ops = [{"name": n, "op": op, "edge_content_canonical": jcs(edge_content(op)),
        "content_sha256": edge_sha(op).hex()} for n, op in OPS]

# (a) genèse (et la valeur du kit pour G1)
genesis_cases = [{"name": "a_genesis", "gateway_id": GATEWAY, "chain_hash_0": genesis(GATEWAY).hex()},
                 {"name": "a_genesis_kit_g1", "gateway_id": KIT_G1, "chain_hash_0": genesis(KIT_G1).hex()}]

# (b) chaîne de trois maillons
h0 = genesis(GATEWAY)
links, prev = [], h0
for _, op in OPS[:3]:
    c = edge_sha(op)
    prev = step(prev, c)
    links.append({"content_sha256": c.hex(), "chain_hash": prev.hex()})
chain = {"gateway_id": GATEWAY, "chain_hash_0": h0.hex(), "ops": [OPS[i][0] for i in range(3)],
         "links": links}

# (h) empreintes différentes, vérifiées ici
assert edge_sha(H_WITH) != edge_sha(H_WITHOUT)
decision_pair = {"name": "h_decision", "with_decision": H_WITH, "without_decision": H_WITHOUT,
                 "sha_with": edge_sha(H_WITH).hex(), "sha_without": edge_sha(H_WITHOUT).hex()}

# (j) refus : edge_seq = 2^53, négatif, non entier (écrit en JSON, jamais haché)
rejected = [{"name": "j_edge_seq_2_pow_53", "op": base(1, 2 ** 53, "PURCHASE", amount=1, currency="XOF")},
            {"name": "j_edge_seq_negative", "op": base(1, -1, "PURCHASE", amount=1, currency="XOF")},
            {"name": "j_edge_seq_fraction", "op": base(1, 1.5, "PURCHASE", amount=1, currency="XOF")}]
for r in rejected:
    try:
        edge_content(r["op"])
    except ValueError:
        pass
    else:
        raise AssertionError("refus attendu pour " + r["name"])

# (k) charge utile de signature d'un lot : JCS(lot sans `signature`), staff_token_audit présent et absent
BATCH_NO_AUDIT = {
    "batch_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "edge_gateway_id": GATEWAY,
    "ledger_id": "44444444-5555-4666-8777-888888888888", "epoch": 3, "edge_seq_from": 1, "edge_seq_to": 3,
    "prev_chain_hash": h0.hex(), "last_chain_hash": links[-1]["chain_hash"],
    "operations": [B1, B2, B3], "signature": "MEUCIQDfake+signature/base64==",
}
BATCH_AUDIT = {**BATCH_NO_AUDIT,
               "staff_token_audit": [{"jti": "tok-1", "staff_id": "S-77", "used_at": "2026-12-12T08:01:00Z"}]}
BATCH_UNKNOWN = {**BATCH_AUDIT, "champ_inconnu_é": {"z": 1, "a": [True, None, "x"]}}
payloads = []
for name, b in (("k_without_staff_token_audit", BATCH_NO_AUDIT), ("k_with_staff_token_audit", BATCH_AUDIT),
                ("k_unknown_batch_field", BATCH_UNKNOWN)):
    body = {k: v for k, v in b.items() if k != "signature"}
    payloads.append({"name": name, "batch": b, "payload_canonical": jcs(body),
                     "payload_sha256": sha(jcs(body)).hex()})
assert payloads[0]["payload_sha256"] != payloads[1]["payload_sha256"]
assert payloads[1]["payload_sha256"] != payloads[2]["payload_sha256"]

out = {
    "genesis": genesis_cases,
    "ops": ops,
    "chain": chain,
    "decision_pair": decision_pair,
    "rejected": rejected,
    "signature_payloads": payloads,
}
with open("vectors.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
    f.write("\n")
