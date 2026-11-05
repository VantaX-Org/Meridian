"""Type-check ratchet (PC-10): fail on any mypy error not in scripts/mypy_baseline.txt.

Usage: python scripts/mypy_ratchet.py            check (CI)
       python scripts/mypy_ratchet.py --update   rewrite the baseline (only ever to shrink it)

Errors are keyed on file, error code and message, not line number, so unrelated edits that shift
lines do not trip the gate. Duplicates are counted: a second identical error in a file is new.
"""
import subprocess
import sys
from collections import Counter
from pathlib import Path

BASELINE = Path(__file__).with_name("mypy_baseline.txt")


def current() -> Counter:
    run = subprocess.run([sys.executable, "-m", "mypy", "--no-error-summary", "--show-error-codes",
                          "--no-pretty"], capture_output=True, text=True)
    keys = Counter()
    for line in run.stdout.splitlines():
        parts = line.split(":", 2)
        if len(parts) == 3 and " error: " in line:
            keys[f"{parts[0]}:{parts[2].strip()}"] += 1
        elif line.strip() and ": note:" not in line and not line.startswith(" "):
            sys.exit(f"mypy output not understood (crash or config error?): {line}")
    # mypy exits 0 clean, 1 with errors, 2 on a crash or bad config; those speak on stderr, with stdout empty.
    if run.returncode not in (0, 1) or (run.returncode == 1 and not keys):
        sys.exit(f"mypy did not finish (exit {run.returncode}): {run.stderr.strip()[-500:]}")
    return keys


def main() -> int:
    now = current()
    if "--update" in sys.argv:
        BASELINE.write_text("".join(f"{k}\n" for k in sorted(now.elements())))
        print(f"baseline written: {sum(now.values())} errors")
        return 0
    base = Counter(BASELINE.read_text().splitlines())
    new = now - base
    fixed = base - now
    if new:
        print(f"{sum(new.values())} NEW type error(s) not in the baseline:")
        for k in sorted(new.elements()):
            print("  " + k)
        return 1
    print(f"OK: {sum(now.values())} errors, all in the baseline.")
    if fixed:
        print(f"{sum(fixed.values())} baseline error(s) are fixed: run with --update to shrink the baseline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
