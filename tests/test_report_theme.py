"""PRINT_TOKENS must equal the :root custom properties in report.css."""
import re
from pathlib import Path

from api.services.report_theme import PRINT_TOKENS

CSS = Path("templates/assets/report.css").read_text()


def test_print_tokens_match_css_root():
    root = re.search(r":root\s*\{(.*?)\}", CSS, re.S).group(1)
    css = {k: v.upper() for k, v in re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6});", root)}
    for key, value in PRINT_TOKENS.items():
        assert css[key.replace("_", "-")] == value.upper(), key


def test_no_raw_hex_outside_root():
    body = re.sub(r":root\s*\{.*?\}", "", CSS, flags=re.S)
    assert not re.search(r"#[0-9A-Fa-f]{6}\b", body)
