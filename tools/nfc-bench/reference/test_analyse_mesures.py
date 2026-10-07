"""Tests de analyse_mesures.py sur un CSV synthétique (colonnes = kCsvColumns de nfc_bench.dart)."""
import csv
import os
import tempfile
import unittest

import analyse_mesures as am

COLUMNS = [
    "session_id", "phone_label", "manufacturer", "model", "sdk", "condition", "lot", "note",
    "type", "seq", "wall_ms", "uid", "atqa", "sak", "techs", "presence_delay_ms",
    "transceive_timeout_ms", "outcome", "failed_step", "error_kind", "nak_code",
    "tag_present_after_error", "gesture_id", "attempt", "major", "minor", "key_index", "counter",
    "token_hash", "total_ms", "t_connect_ms", "t_get_version_ms", "t_read_header_ms", "t_pwd_lookup_ms",
    "t_pwd_auth_ms", "t_read_body_ms", "t_check_crc_ms", "t_incr_cnt_ms", "t_read_cnt_ms",
    "t_read_sig_ms", "t_hash_ms", "dwell_ms", "ok", "pages_4_10", "pwd", "pack", "version", "error",
]


def row(seq, gesture, attempt, outcome, total, lot="V1", cond="C1-poignet"):
    r = dict.fromkeys(COLUMNS, "")
    r.update(session_id="S1", phone_label="P1", condition=cond, lot=lot, type="tap", seq=seq,
             uid=f"04{seq:012x}", wall_ms=str(seq * 3000),
             gesture_id=gesture, attempt=attempt, outcome=outcome)
    if outcome == "OK":
        r.update(total_ms=f"{total:.3f}", t_pwd_auth_ms="5.0", dwell_ms="400")
    return r


class TestAnalyse(unittest.TestCase):
    def test_percentile(self):
        self.assertEqual(am.percentile([1, 2, 3, 4, 5], 0.5), 3)
        self.assertAlmostEqual(am.percentile(list(range(1, 101)), 0.95), 95.05)
        self.assertIsNone(am.percentile([], 0.5))

    def test_wilson(self):
        lo, hi = am.wilson(6, 300)
        self.assertAlmostEqual(lo, 0.0092, places=3)
        self.assertAlmostEqual(hi, 0.0429, places=3)

    def test_summary(self):
        rows, seq = [], 0
        # 300 gestes ; 4 échouent au 1er essai (2 TagLost, 1 CRC, 1 AUTH) puis réussissent.
        for g in range(1, 301):
            seq += 1
            if g in (10, 20, 30, 40):
                bad = {10: "TAG_LOST", 20: "TAG_LOST", 30: "CRC_MISMATCH", 40: "AUTH_FAILED"}[g]
                rows.append(row(seq, g, 1, bad, 0))
                seq += 1
                rows.append(row(seq, g, 2, "OK", 150))
            else:
                rows.append(row(seq, g, 1, "OK", 100 + g % 50))
        rows += [row(1000 + i, 1000 + i, 1, "CRC_MISMATCH", 0, lot="X1") for i in range(5)]
        s = am.summarize(rows)
        self.assertEqual(s["n_gestes"], 300)
        self.assertEqual(s["k_echec_1er"], 4)
        self.assertEqual(s["faux_rejets_crc"], 1)
        self.assertEqual(s["special_rejetes"], 5)
        self.assertAlmostEqual(s["tag_lost"], 2 / 304)
        self.assertTrue(s["verdict"].startswith("refusé"))         # faux rejet CRC
        self.assertIn("faux rejet CRC", s["verdict"])

        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "m.csv")
            with open(p, "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, COLUMNS)
                w.writeheader()
                w.writerows(rows)
            txt = am.report(am.load([p]))
            self.assertIn("| P1 | C1-poignet | 304 |", txt)

    def test_double_read(self):
        a, b, c = row(1, 1, 1, "OK", 100), row(2, 2, 1, "OK", 100), row(3, 3, 1, "OK", 100)
        for r, t, u in ((a, 0, "u1"), (b, 900, "u1"), (c, 5000, "u1")):
            r.update(wall_ms=str(t), uid=u)
        self.assertEqual(am.double_reads([a, b, c]), 1)

    @staticmethod
    def _series(n, totals, fails=0, cond="C1-poignet", phone="P1", start=1):
        """n gestes ; les `fails` premiers échouent au 1er essai (AUTH_FAILED) puis réussissent.
        totals(g) → total_ms du tap OK du geste g. UID distincts pour éviter les doubles lectures."""
        rows, seq = [], start * 10000
        for g in range(1, n + 1):
            seq += 1
            gid = start * 10000 + g
            if g <= fails:
                rows.append(row(seq, gid, 1, "AUTH_FAILED", 0, cond=cond))
                seq += 1
                rows.append(row(seq, gid, 2, "OK", totals(g), cond=cond))
            else:
                rows.append(row(seq, gid, 1, "OK", totals(g), cond=cond))
        for r in rows:
            r["phone_label"] = phone
        return rows

    def test_verdict_recommande(self):
        rows = self._series(300, lambda g: 120)
        self.assertEqual(am.summarize(rows)["verdict"], "recommandé")
        # 2 échecs / 300 (0,7 %) : hors zone grise → pas de réserve.
        self.assertEqual(am.summarize(self._series(300, lambda g: 120, fails=2))["verdict"], "recommandé")

    def test_verdict_tolere(self):
        # p95 entre 300 et 500 ms → toléré
        slow = self._series(300, lambda g: 350)
        self.assertEqual(am.summarize(slow)["verdict"], "toléré")
        # échecs 12 / 300 = 4 % (> 2 %, ≤ 5 %) → toléré, zone grise du seuil 5 % → à confirmer
        v = am.summarize(self._series(300, lambda g: 120, fails=12))["verdict"]
        self.assertTrue(v.startswith("toléré"), v)
        self.assertIn("à confirmer", v)

    def test_verdict_tolere_par_p99(self):
        # p95 bon (120 ms) mais 2 % des taps à 600 ms → p99 > 500 → toléré
        rows = self._series(300, lambda g: 600 if g % 50 == 0 else 120)
        s = am.summarize(rows)
        self.assertLessEqual(s["p95"], 300)
        self.assertGreater(s["p99"], 500)
        self.assertEqual(s["verdict"], "toléré")

    def test_verdict_refuse(self):
        v = am.summarize(self._series(300, lambda g: 550))["verdict"]
        self.assertTrue(v.startswith("refusé") and "p95" in v, v)
        v = am.summarize(self._series(300, lambda g: 120, fails=18))["verdict"]  # 6 %
        self.assertTrue(v.startswith("refusé") and "échec 1er essai" in v, v)
        # échec p99 seul : p95 = 120 ms mais 3 % des taps à 900 ms → p99 > 800 → refusé
        rows = self._series(300, lambda g: 900 if g % 33 == 0 else 120)
        s = am.summarize(rows)
        self.assertLessEqual(s["p95"], 300)
        self.assertTrue(s["verdict"].startswith("refusé") and "p99" in s["verdict"], s["verdict"])

    def test_phone_verdict(self):
        # C0 recommandé, C6 toléré (p95 350), C11 informatif lent (ignoré) → téléphone toléré, limité par C6
        rows = (self._series(300, lambda g: 120, cond="C0-table", start=1)
                + self._series(300, lambda g: 350, cond="C6-chaleur", start=2)
                + self._series(150, lambda g: 900, cond="C11-presence-500", start=3))
        v, lim = am.phone_verdict(rows)
        self.assertEqual((v, lim), ("toléré", ["C6"]))
        # Par condition, le p99 n'est pas jugé ; il l'est sur l'ensemble des conditions exigées.
        spikes = self._series(300, lambda g: 700 if g % 25 == 0 else 120, cond="C1-poignet", start=4)
        self.assertEqual(am.summarize(spikes, check_p99=False)["verdict"], "recommandé")
        v, lim = am.phone_verdict(self._series(300, lambda g: 120, cond="C0-table", start=5) + spikes)
        self.assertEqual((v, lim), ("toléré", ["p99 global"]))
        txt = am.report(rows)
        self.assertIn("| P1 | toléré | C6 |", txt)

if __name__ == "__main__":
    unittest.main(verbosity=2)
