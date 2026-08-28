#!/usr/bin/env python3
"""Merge per-worker k6 load-test-report.json files into one aggregate gate report."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def weighted_avg(reports: list[dict], key: str) -> float | None:
    pairs = [
        (float(r[key]), int(r.get("iterations") or 0))
        for r in reports
        if r.get(key) is not None
    ]
    if not pairs:
        return None
    weight = sum(w for _, w in pairs) or len(pairs)
    return sum(v * w for v, w in pairs) / weight


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: load-test-aggregate-reports.py report1.json [report2.json ...]", file=sys.stderr)
        return 2

    paths = [Path(p) for p in sys.argv[1:]]
    reports: list[dict] = []
    for path in paths:
        if not path.is_file():
            print(f"missing report: {path}", file=sys.stderr)
            return 1
        reports.append(json.loads(path.read_text()))

    fail_rates = [float(r["http_req_failed_rate"]) for r in reports if r.get("http_req_failed_rate") is not None]
    p95s = [float(r["http_req_duration_p95"]) for r in reports if r.get("http_req_duration_p95") is not None]
    p99s = [float(r["http_req_duration_p99"]) for r in reports if r.get("http_req_duration_p99") is not None]

    aggregate = {
        "profile": reports[0].get("profile"),
        "targetVus": sum(int(r.get("targetVus") or 0) for r in reports),
        "workers": len(reports),
        "http_req_failed_rate": max(fail_rates) if fail_rates else None,
        "http_req_failed_rate_weighted": weighted_avg(reports, "http_req_failed_rate"),
        "http_req_duration_p95": weighted_avg(reports, "http_req_duration_p95"),
        "http_req_duration_p95_max": max(p95s) if p95s else None,
        "http_req_duration_p99": weighted_avg(reports, "http_req_duration_p99"),
        "http_req_duration_p99_max": max(p99s) if p99s else None,
        "iterations": sum(int(r.get("iterations") or 0) for r in reports),
        "worker_reports": reports,
    }

    print(json.dumps(aggregate, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
