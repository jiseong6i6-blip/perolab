"""Download the whole Perovskite Database (Perovskite Database Project, the NOMAD successor) as CSV.

In a terminal:
    cd ~/Downloads            # the folder holding this file
    python3 fetch_perovskite_db.py --test      # first fetch 20 entries to check it works
    python3 fetch_perovskite_db.py             # everything (about 50,000 entries, may take tens of minutes)

Output:
    perovskite_db.jsonl   partial download (if interrupted, running again resumes)
    perovskite_db.csv     final table (one cell per row, column names e.g. perovskite_band_gap, jv_default_PCE, stability_PCE_T80)

Requirements: Python 3.8 or newer only (nothing else to install).
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request

SCHEMA = "perovskite_solar_cell_database.schema.PerovskiteSolarCell"
# public NOMAD servers. The develop/staging front ends use the same data. If the first server has 0 entries, try the next
APIS = [
    "https://nomad-lab.eu/prod/v1/api/v1",
    "https://nomad-lab.eu/prod/v1/develop/api/v1",
    "https://nomad-lab.eu/prod/v1/staging/api/v1",
]
# sections inside one cell record (same as the column groups of the original database)
SECTIONS = ["ref", "cell", "module", "substrate", "etl", "perovskite", "perovskite_deposition", "htl",
            "backcontact", "add", "encapsulation", "jv", "stabilised", "eqe", "stability", "outdoor"]
JSONL, CSVF, STATE = "perovskite_db.jsonl", "perovskite_db.csv", "perovskite_db.state.json"


def post(url, body, tries=6):
    data = json.dumps(body).encode()
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            wait = 5 * 2 ** k
            print(f"  request failed ({e}); retrying in {wait} s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit("Cannot reach the server. Check the internet connection or run again later (what was downloaded is kept).")


def query_body(page_size, after=None):
    body = {
        "owner": "visible",
        "query": {"section_defs.definition_qualified_name": SCHEMA},
        "pagination": {"page_size": page_size},
        "required": {"data": "*", "metadata": {"entry_id": "*", "upload_create_time": "*"}},
    }
    if after:
        body["pagination"]["page_after_value"] = after
    return body


def flatten(archive):
    """Flatten one cell record into a row named 'section_field'. List values are joined with ' | '."""
    row = {"entry_id": (archive.get("metadata") or {}).get("entry_id")}
    data = archive.get("data") or {}
    for sec in SECTIONS:
        s = data.get(sec)
        if not isinstance(s, dict):
            continue
        for k, v in s.items():
            if k.startswith("m_"):
                continue
            if isinstance(v, (dict,)):
                v = json.dumps(v, ensure_ascii=False)
            elif isinstance(v, list):
                v = " | ".join(json.dumps(x, ensure_ascii=False) if isinstance(x, (dict, list)) else str(x) for x in v)
            row[f"{sec}_{k}"] = v
    return row


def pick_api():
    for api in APIS:
        r = post(api + "/entries/query", {"owner": "visible", "query": {"section_defs.definition_qualified_name": SCHEMA},
                                           "pagination": {"page_size": 0}})
        total = (r.get("pagination") or {}).get("total", 0)
        print(f"{api}: {total} entries")
        if total:
            return api, total
    raise SystemExit("No server returned data. Please report this message as an issue.")


def to_csv():
    cols, rows = [], 0
    seen = set()
    with open(JSONL, encoding="utf-8") as f:
        for line in f:
            for k in json.loads(line):
                if k not in seen:
                    seen.add(k); cols.append(k)
    with open(JSONL, encoding="utf-8") as f, open(CSVF, "w", newline="", encoding="utf-8") as out:
        w = csv.DictWriter(out, fieldnames=cols)
        w.writeheader()
        for line in f:
            w.writerow(json.loads(line)); rows += 1
    print(f"done: {CSVF} ({rows} rows × {len(cols)} columns, {os.path.getsize(CSVF) / 1e6:.0f} MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="fetch only 20 entries as a test")
    ap.add_argument("--page", type=int, default=200, help="entries per request")
    a = ap.parse_args()

    api, total = pick_api()
    state = json.load(open(STATE)) if os.path.exists(STATE) and not a.test else {"after": None, "done": 0}
    if a.test:
        for p in (JSONL, STATE):
            if os.path.exists(p): os.remove(p)
    page = 20 if a.test else a.page
    t0 = time.time()
    with open(JSONL, "a", encoding="utf-8") as f:
        while True:
            r = post(api + "/entries/archive/query", query_body(page, state["after"]))
            items = r.get("data") or []
            for it in items:
                f.write(json.dumps(flatten(it.get("archive") or {}), ensure_ascii=False) + "\n")
            state["done"] += len(items)
            state["after"] = (r.get("pagination") or {}).get("next_page_after_value")
            f.flush()
            if not a.test:
                json.dump(state, open(STATE, "w"))
            el = time.time() - t0
            print(f"  {state['done']}/{total}  ({el / 60:.1f} min)")
            if a.test or not items or not state["after"]:
                break
    to_csv()
    if a.test:
        print("Test succeeded. Run without --test to download everything.")
    elif os.path.exists(STATE):
        os.remove(STATE)


if __name__ == "__main__":
    main()
