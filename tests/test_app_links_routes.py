"""Every fixed address in api/services/app_links.py opens a real page of the web app (a folder under frontend/app/(app))."""

from pathlib import Path

import pytest

from api.services import app_links

APP = Path(__file__).resolve().parents[1] / "frontend" / "app" / "(app)"
FIXED = {k: v for k, v in vars(app_links).items() if k.isupper() and isinstance(v, str) and v.startswith("/")}


@pytest.mark.parametrize("name", sorted(FIXED))
def test_fixed_link_has_a_page(name: str) -> None:
    path = FIXED[name].split("?")[0].strip("/")
    assert (APP / path / "page.tsx").is_file(), f"{name} = {FIXED[name]} has no page under frontend/app/(app)"


def test_fitness_drop_opens_the_process_screen() -> None:
    assert app_links.PROCESSES == "/mdm/processes"


def test_system_tabs_in_links_exist_on_the_system_screen() -> None:
    import re

    root = Path(__file__).resolve().parents[1]
    screen = (root / "frontend" / "ui" / "screens" / "systems" / "System.tsx").read_text()
    tabs = set(re.findall(r'"(\w+)"', re.search(r"const TABS = \[([^\]]*)\]", screen).group(1)))
    used = set(re.findall(r'app_links\.system\([^)]*?,\s*"(\w+)"\)', (root / "api" / "services" / "attention.py").read_text()))
    assert used and used <= tabs, f"tabs {used - tabs} are not on the system screen"
