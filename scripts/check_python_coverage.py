#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Python coverage JSON against minimum thresholds.")
    parser.add_argument("report_path", help="Path to a coverage JSON report.")
    parser.add_argument("--lines", type=float, required=True, help="Minimum line coverage percentage.")
    parser.add_argument("--branches", type=float, required=True, help="Minimum branch coverage percentage.")
    args = parser.parse_args()

    report_path = Path(args.report_path)
    payload = json.loads(report_path.read_text())
    totals = payload.get("totals", {})

    line_pct = float(totals.get("percent_statements_covered", 0.0))
    branch_pct = float(totals.get("percent_branches_covered", 100.0 if totals.get("num_branches", 0) == 0 else 0.0))

    print(f"Python coverage: lines {line_pct:.2f}% (min {args.lines:.2f}%), branches {branch_pct:.2f}% (min {args.branches:.2f}%)")

    failures = []
    if line_pct < args.lines:
        failures.append(f"line coverage {line_pct:.2f}% is below {args.lines:.2f}%")
    if branch_pct < args.branches:
        failures.append(f"branch coverage {branch_pct:.2f}% is below {args.branches:.2f}%")

    if failures:
        for failure in failures:
            print(f"Coverage gate failed: {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
