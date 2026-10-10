"""Render every PDF report from the generic fixtures in tests/pdf_fixtures.py.

    python scripts/render_report_previews.py [out_dir]

Writes <name>.pdf plus <name>-1.png / <name>-2.png (needs pdftoppm) used as
the previews in docs/report-previews/.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import pdf_reports as pr  # noqa: E402
from tests import pdf_fixtures as fx  # noqa: E402


def contexts() -> dict[str, tuple[str, dict]]:
    kw = {"tenant_name": fx.TENANT, "generated_at": fx.GENERATED}
    return {
        "analysis": ("analysis_report.html", pr.analysis_context(fx.V2, fx.FINDINGS2, system=fx.SYSTEM, **kw)),
        "extraction": ("extraction_report.html", pr.extraction_context(fx.V2, system=fx.SYSTEM, **kw)),
        "cleaning": ("cleaning_report.html", pr.cleaning_context(fx.CLEANING, **kw)),
        "comparison": ("comparison_report.html", pr.comparison_context(
            fx.V1, fx.V2, fx.FINDINGS1, fx.FINDINGS2, record_diff=fx.RECORD_DIFF, system=fx.SYSTEM, **kw)),
        "executive": ("executive_report.html", pr.executive_context(
            fx.REPORT_JSON, fx.SUPPLEMENTARY, fx.V2, fx.FINDINGS2, system=fx.SYSTEM, **kw)),
        "object": ("object_report.html", pr.object_context(
            "material_master", fx.V2["dqs_summary"]["material_master"],
            [f for f in fx.FINDINGS2 if f["module"] == "material_master"], fx.SAMPLES,
            system=fx.SYSTEM, **kw)),
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "docs/report-previews"
    os.makedirs(out, exist_ok=True)
    for name, (template, ctx) in contexts().items():
        pdf = os.path.join(out, f"{name}.pdf")
        with open(pdf, "wb") as fh:
            fh.write(pr.render(template, ctx))
        if shutil.which("pdftoppm"):
            subprocess.run(["pdftoppm", "-png", "-r", "80", "-f", "1", "-l", "2", pdf, os.path.join(out, name)], check=True)
        print(pdf)
