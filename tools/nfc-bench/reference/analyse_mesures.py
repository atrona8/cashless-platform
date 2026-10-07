"""
Analyse des CSV exportés par le banc (format : PROTOCOLE_TERRAIN.md §9). Stdlib seule.

    python3 analyse_mesures.py mesures/*.csv            # tableau Markdown sur la sortie standard
    python3 analyse_mesures.py --par-telephone mesures/*.csv

Conventions de lot (colonne « lot ») : préfixe V = bracelets valides, X = hors format,
K = clones. Les faux rejets ne se comptent que sur les lots V ; sur X et K on attend 100 % de rejet.

Verdict (ADR-39, PROTOCOLE_TERRAIN.md §8) : « recommandé » (p95 ≤ 300 ms, p99 ≤ 500 ms, échecs
≤ 2 %), « toléré » (p95 ≤ 500 ms, p99 ≤ 800 ms, échecs ≤ 5 %), sinon « refusé ». Un tableau final
donne le niveau de chaque téléphone. Le verdict porte sur la séquence de paiement (ADR-59) : la
séquence mesurée sans GET_VERSION, READ_SIG compris. Les p95/p99 de la séquence complète mesurée
sont donnés à titre d'information.
"""
from __future__ import annotations

import argparse
import csv
import math
import re
import sys
from collections import defaultdict

STEPS = ["connect", "get_version", "read_header", "pwd_lookup", "pwd_auth", "read_body",
         "check_crc", "incr_cnt", "read_cnt", "read_sig", "hash"]

# Critères d'ADR-39 (PROTOCOLE_TERRAIN.md §8) : deux niveaux par téléphone.
# Chaque niveau : p95 total_ms, p99 total_ms, échec au premier essai (lots V).
TIERS = [
    ("recommandé", {"p95": 300.0, "p99": 500.0, "echec": 0.02}),
    ("toléré", {"p95": 500.0, "p99": 800.0, "echec": 0.05}),
]
REFUSE = "refusé"
# Critères communs aux deux niveaux (tout écart → refusé).
TAG_LOST_MAX = 0.01
# Conditions informatives, hors règle du §8 (comparaison de réglages).
INFORMATIVE_CONDITIONS = {"C11"}
# Échantillon : en dessous de 300 gestes, ou dans la zone grise d'un seuil (entre 2/3 et 4/3 du
# seuil, soit 4 à 8 échecs / 300 pour 2 % et 10 à 20 / 300 pour 5 %) → prolonger à 600 gestes.
MIN_GESTES = 300
LONG_GESTES = 600

# Compatibilité (anciens noms)
P95_TOTAL_MAX_MS = TIERS[0][1]["p95"]
FIRST_TRY_FAIL_MAX = TIERS[0][1]["echec"]

def percentile(values: list[float], q: float) -> float | None:
    """Percentile par interpolation linéaire (méthode « linear » de numpy)."""
    if not values:
        return None
    v = sorted(values)
    pos = (len(v) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def _f(x: str) -> float | None:
    return float(x) if x not in ("", None) else None


def load(paths: list[str]) -> list[dict]:
    rows = []
    for p in paths:
        with open(p, newline="", encoding="utf-8") as fh:
            rows += [r for r in csv.DictReader(fh) if r.get("type") == "tap"]
    return rows


def lot_kind(lot: str) -> str:
    return (lot or "?")[:1].upper()


def summarize(rows: list[dict], check_p99: bool = True) -> dict:
    valid = [r for r in rows if lot_kind(r["lot"]) == "V"]
    special = [r for r in rows if lot_kind(r["lot"]) in ("X", "K")]
    ok = [r for r in valid if r["outcome"] == "OK"]

    # Gestes : première tentative de chaque (session, gesture_id)
    first = {}
    for r in valid:
        key = (r["session_id"], r["gesture_id"])
        if str(r["attempt"]) == "1" and key not in first:
            first[key] = r
    n_g = len(first)
    k_first = sum(1 for r in first.values() if r["outcome"] != "OK")
    n_lost = sum(1 for r in valid if r["outcome"] == "TAG_LOST")
    crc_false = sum(1 for r in valid if r["outcome"] == "CRC_MISMATCH")
    rejected_special = sum(1 for r in special if r["outcome"] != "OK")

    full = [_f(r["total_ms"]) for r in ok if _f(r["total_ms"]) is not None]
    # Séquence de paiement (ADR-59) : la séquence mesurée sans GET_VERSION ; READ_SIG en fait partie.
    totals = [t - (_f(r.get("t_get_version_ms", "")) or 0.0)
              for r in ok if (t := _f(r["total_ms"])) is not None]
    s = {
        "n_taps": len(valid), "n_gestes": n_g, "ok": len(ok),
        "echec_1er": k_first / n_g if n_g else None, "echec_1er_ic": wilson(k_first, n_g),
        "k_echec_1er": k_first,
        "tag_lost": n_lost / len(valid) if valid else None,
        "faux_rejets_crc": crc_false,
        "special_n": len(special), "special_rejetes": rejected_special,
        "p50": percentile(totals, .50), "p95": percentile(totals, .95), "p99": percentile(totals, .99),
        "p95_complet": percentile(full, .95), "p99_complet": percentile(full, .99),
        "steps_p95": {st: percentile([v for r in ok if (v := _f(r.get(f"t_{st}_ms", ""))) is not None], .95)
                      for st in STEPS},
    }
    dwell = [v for r in ok if (v := _f(r.get("dwell_ms", ""))) is not None]
    s["dwell_p05"] = percentile(dwell, .05)
    s["doubles"] = double_reads(ok)
    s["verdict"] = verdict(s, check_p99=check_p99)
    return s


DOUBLE_READ_WINDOW_MS = 1500


def double_reads(ok_rows: list[dict]) -> int:
    """Deux lectures OK du même UID à moins de DOUBLE_READ_WINDOW_MS dans une session :
    risque de double débit (rebond du poignet, presence-check trop court)."""
    last: dict[tuple, float] = {}
    n = 0
    for r in sorted(ok_rows, key=lambda r: (r["session_id"], _f(r.get("wall_ms", "")) or 0)):
        t = _f(r.get("wall_ms", ""))
        if t is None:
            continue
        k = (r["session_id"], r["uid"])
        if k in last and t - last[k] < DOUBLE_READ_WINDOW_MS:
            n += 1
        last[k] = t
    return n


def condition_code(condition: str) -> str:
    """« C1-poignet » → « C1 » ; libellé libre → libellé entier."""
    m = re.match(r"\s*(C\d+)", condition or "", re.I)
    return m.group(1).upper() if m else (condition or "?")


def is_required(condition: str) -> bool:
    return condition_code(condition) not in INFORMATIVE_CONDITIONS


def _tier_failures(s: dict, limits: dict, check_p99: bool) -> list[str]:
    fails = []
    if s["p95"] is None or s["p95"] > limits["p95"]:
        fails.append("p95")
    if check_p99 and (s["p99"] is None or s["p99"] > limits["p99"]):
        fails.append("p99")
    if s["echec_1er"] > limits["echec"]:
        fails.append("échec 1er essai")
    return fails


def _grey_zone(s: dict) -> bool:
    n, rate = s["n_gestes"], s["echec_1er"]
    if n < MIN_GESTES:
        return True
    return n < LONG_GESTES and any(2 * lim["echec"] / 3 <= rate <= 4 * lim["echec"] / 3 for _, lim in TIERS)


def verdict(s: dict, check_p99: bool = True) -> str:
    """« recommandé », « toléré » ou « refusé (motifs) » selon les deux niveaux d'ADR-39.
    check_p99=False : p99 non jugé (verdict par condition, le p99 se juge sur le téléphone, §8)."""
    if not s["n_gestes"]:
        if s["special_n"]:      # C10 : lots X/K seuls
            return ("recommandé" if s["special_rejetes"] == s["special_n"]
                    else REFUSE + " (clone/hors-format accepté)")
        return "—"
    common = []
    if s["tag_lost"] > TAG_LOST_MAX:
        common.append("TagLost")
    if s["faux_rejets_crc"]:
        common.append("faux rejet CRC")
    if s["special_n"] and s["special_rejetes"] != s["special_n"]:
        common.append("clone/hors-format accepté")
    if s["doubles"]:
        common.append("double lecture")
    if common:
        return REFUSE + " (" + ", ".join(common) + ")"
    last_fails: list[str] = []
    for name, limits in TIERS:
        last_fails = _tier_failures(s, limits, check_p99)
        if not last_fails:
            return name + (" (à confirmer : prolonger à 600 gestes)" if _grey_zone(s) else "")
    return REFUSE + " (" + ", ".join(last_fails) + ")"


def tier_rank(v: str) -> int:
    """0 = recommandé, 1 = toléré, 2 = refusé ou indéterminé."""
    for i, (name, _) in enumerate(TIERS):
        if v.startswith(name):
            return i
    return len(TIERS)


def phone_verdict(rows: list[dict]) -> tuple[str, list[str]]:
    """Règle unique du §8 : le niveau du téléphone est le plus bas obtenu dans les conditions
    exigées (toutes sauf les informatives), p95 et échecs jugés par condition, p99 jugé sur
    l'ensemble des taps des conditions exigées. Renvoie (verdict, conditions limitantes)."""
    req = [r for r in rows if is_required(r["condition"])]
    by_cond = defaultdict(list)
    for r in req:
        by_cond[condition_code(r["condition"])].append(r)
    worst, limiting = 0, []
    for c, rs in sorted(by_cond.items()):
        rk = tier_rank(verdict(summarize(rs), check_p99=False))
        if rk > worst:
            worst, limiting = rk, [c]
        elif rk == worst and rk > 0:
            limiting.append(c)
    pooled = summarize(req)
    if pooled["p99"] is not None:
        p99_rank = next((i for i, (_, lim) in enumerate(TIERS) if pooled["p99"] <= lim["p99"]), len(TIERS))
    else:
        p99_rank = len(TIERS)
    if p99_rank > worst:
        worst, limiting = p99_rank, ["p99 global"]
    elif p99_rank == worst and worst > 0:
        limiting.append("p99 global")
    name = TIERS[worst][0] if worst < len(TIERS) else REFUSE
    return name, limiting

def fmt(v, unit="", pct=False):
    if v is None:
        return "–"
    return f"{v:.1%}" if pct else f"{v:.0f}{unit}"


def report(rows: list[dict], by_phone_only: bool = False) -> str:
    groups = defaultdict(list)
    for r in rows:
        groups[(r["phone_label"],) if by_phone_only else (r["phone_label"], r["condition"])].append(r)
    head = ("| Téléphone | Condition | taps | p50 | p95 | p99 | échec 1er (IC95) | TagLost | CRC faux | "
            "X/K rejetés | doubles | présence p05 | p95/p99 séquence complète | Verdict |")
    out = [head, "|" + "---|" * (head.count("|") - 1)]
    for key in sorted(groups):
        # Par condition : p99 affiché mais jugé sur le téléphone (§8) ; par téléphone : p99 jugé.
        s = summarize(groups[key], check_p99=by_phone_only)
        lo, hi = s["echec_1er_ic"]
        out.append(
            f"| {key[0]} | {key[1] if len(key) > 1 else 'toutes'} | {s['n_taps']} | {fmt(s['p50'], ' ms')} | "
            f"{fmt(s['p95'], ' ms')} | {fmt(s['p99'], ' ms')} | "
            f"{fmt(s['echec_1er'], pct=True)} [{lo:.1%}–{hi:.1%}] | {fmt(s['tag_lost'], pct=True)} | "
            f"{s['faux_rejets_crc']} | {s['special_rejetes']}/{s['special_n']} | {s['doubles']} | "
            f"{fmt(s['dwell_p05'], ' ms')} | {fmt(s['p95_complet'])}/{fmt(s['p99_complet'], ' ms')} | "
            f"{s['verdict']} |")
    phones = defaultdict(list)
    for r in rows:
        phones[r["phone_label"]].append(r)
    out += ["", "| Téléphone | Niveau (ADR-39, §8) | Limité par |", "|---|---|---|"]
    for ph in sorted(phones):
        v, lim = phone_verdict(phones[ph])
        out.append(f"| {ph} | {v} | {', '.join(lim) or '–'} |")
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+")
    ap.add_argument("--par-telephone", action="store_true")
    a = ap.parse_args(argv)
    print(report(load(a.csv), a.par_telephone))


if __name__ == "__main__":
    sys.exit(main())
