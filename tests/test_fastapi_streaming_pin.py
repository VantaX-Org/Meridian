"""api/routes/audit.py streams a StreamingResponse while reading through the request's get_db session. FastAPI only
keeps a yield dependency open until the response has been sent from 0.118 on (earlier, the session closed before
the stream ran), so every requirements file that installs the API must allow no older FastAPI."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _min_version(line: str) -> tuple[int, ...]:
    m = re.match(r"^fastapi\s*(>=|==|~=)\s*([0-9.]+)", line.strip())
    assert m, line
    return tuple(int(x) for x in m.group(2).split("."))


def test_api_requirements_need_fastapi_0_118_or_newer() -> None:
    for name in ("requirements.txt", "api/requirements.txt"):
        lines = [ln for ln in (ROOT / name).read_text().splitlines() if re.match(r"^fastapi\s*[<>=~]", ln.strip())]
        assert lines, f"{name} names no fastapi version"
        assert all(_min_version(ln) >= (0, 118) for ln in lines), (name, lines)
