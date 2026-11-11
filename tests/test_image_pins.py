"""Meridian images in Helm and the updater overlay are pinned to a release, and releases carry SBOMs (D-32)."""
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def test_helm_meridian_images_pinned_to_a_release_tag():
    v = yaml.safe_load((ROOT / "helm/meridian/values.yaml").read_text())
    for ref in (v["image"]["api"], v["image"]["frontend"], v["storage"]["image"]):
        assert re.fullmatch(r"ghcr\.io/vantax-org/meridian-[a-z]+:v\d+\.\d+\.\d+", ref), ref


def test_updater_follows_the_pinned_release():
    svc = yaml.safe_load((ROOT / "docker/docker-compose.updater.yml").read_text())["services"]["updater"]
    assert svc["image"] == "ghcr.io/vantax-org/meridian-updater:${MERIDIAN_VERSION:-latest}"


def test_release_attaches_api_and_frontend_sboms():
    jobs = yaml.safe_load((ROOT / ".github/workflows/build-and-deploy.yml").read_text())["jobs"]
    for job in ("build-api", "build-frontend"):
        sbom = [s for s in jobs[job]["steps"] if s.get("uses", "").startswith("anchore/sbom-action@")]
        assert len(sbom) == 1 and re.search(r"@[0-9a-f]{40}$", sbom[0]["uses"])
    run = next(s["run"] for s in jobs["release"]["steps"] if s.get("name") == "Create GitHub Release")
    assert "sbom/*.cdx.json" in run
