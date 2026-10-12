"""Job messages must not carry U+00B7; the separator is a plain ASCII pipe."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["workers/tasks/run_checks.py", "api/routes/versions.py", "api/routes/simulation.py"]


def test_job_message_sources_have_no_middle_dot():
    assert FILES
    for rel in FILES:
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "·" not in src, rel
        assert "\\u00b7" not in src.lower(), rel


def test_rendered_messages_use_pipe():
    row = ("x", None, "SAP-A", "v3")
    msg = f"Fix simulation{f' | {row[2]}' if row[2] else ''}"
    assert "·" not in msg and msg == "Fix simulation | SAP-A"
