"""requirements.lock pins every package requirements.txt names, inside requirements.txt's range.

CI and the Docker images install `-r requirements.txt -c requirements.lock`. A constraints file
only pins what it lists, so a package added to requirements.txt but not to the lock would resolve
fresh again; a floor raised past the lock's pin would make pip fail. Rerun
scripts/lock-requirements.sh after editing requirements.txt.
"""

from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]
CI_EXTRAS = ["pytest>=8.0.0", "pytest-asyncio>=0.24.0"]  # what unit-tests.yml and rls-tests.yml add


def _lines(path: Path) -> list[str]:
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def _lock() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in _lines(ROOT / "requirements.lock"):
        name, sep, version = line.partition("==")
        assert sep and version and not any(c in version for c in "<>=!~;, "), f"not an exact pin: {line!r}"
        key = canonicalize_name(name)
        assert key not in pins, f"{name} pinned twice in requirements.lock"
        pins[key] = version
    return pins


def test_lock_pins_every_requirement_within_its_range() -> None:
    pins = _lock()
    problems = []
    for line in _lines(ROOT / "requirements.txt") + CI_EXTRAS:
        req = Requirement(line)
        key = canonicalize_name(req.name)
        if key not in pins:
            problems.append(f"{req.name}: missing from requirements.lock")
        elif not req.specifier.contains(pins[key], prereleases=True):
            problems.append(f"{req.name}: lock pins {pins[key]}, requirements.txt wants {req.specifier}")
    assert not problems, "rerun scripts/lock-requirements.sh:\n" + "\n".join(problems)
