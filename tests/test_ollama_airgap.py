"""The bundled Tier-2 Ollama must have no route to the internet.

The customer stack bakes the model into the image, so Ollama never needs to pull
anything at runtime. It therefore runs on an `internal: true` Docker network with
no NAT/egress: a compromised or curious model process cannot call out, and the
deployment cannot be fingerprinted by outbound traffic. The API and worker — the
only services that call the LLM — are dual-homed so they can still reach it.
"""

from __future__ import annotations

from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parents[1]
CUSTOMER = _ROOT / "docker" / "docker-compose.customer.yml"
OLLAMA = _ROOT / "docker" / "docker-compose.customer.ollama.yml"

LLM_NET = "meridian-llm"


def _load(path: Path) -> dict:
    # {{MODEL_TAG}} is a bare scalar, so the file is valid YAML as-is.
    return yaml.safe_load(path.read_text())


def test_llm_network_is_internal() -> None:
    """The LLM network exists and is declared internal (no egress)."""
    nets = _load(CUSTOMER).get("networks", {})
    assert LLM_NET in nets, f"{LLM_NET} network not declared in {CUSTOMER.name}"
    assert nets[LLM_NET].get("internal") is True, f"{LLM_NET} must be internal: true"


def test_ollama_only_on_the_internal_network() -> None:
    """Bundled Ollama sits only on the internal network — never on an egress bridge."""
    ollama = _load(OLLAMA)["services"]["ollama"]
    assert ollama.get("networks") == [LLM_NET], ollama.get("networks")


def test_llm_callers_are_dual_homed() -> None:
    """API and worker reach Ollama, so they must also be on the internal network."""
    svcs = _load(CUSTOMER)["services"]
    for name in ("api", "worker"):
        assert LLM_NET in svcs[name]["networks"], f"{name} cannot reach {LLM_NET}"


def test_baked_model_not_masked_by_a_volume() -> None:
    """No named volume over /root/.ollama: it would mask the image-baked model and
    force a runtime `ollama pull`, which an internal network cannot satisfy."""
    ollama = _load(OLLAMA)["services"]["ollama"]
    mounts = ollama.get("volumes", [])
    assert not any(":/root/.ollama" in m for m in mounts), mounts


def test_deploy_script_never_pulls_the_model() -> None:
    """On the air-gapped net `ollama pull` would hang on the registry. The baked
    model is always present, so the deploy script must verify, never pull."""
    deploy = (_ROOT / "scripts" / "meridian-deploy.sh").read_text()
    assert "ollama pull" not in deploy, "deploy script still runs `ollama pull`"


def test_only_llm_callers_share_the_internal_network() -> None:
    """Internal obfuscation: no peer container can probe Ollama's API shape.
    Only the LLM callers (api, worker) may sit on the LLM network; a compromised
    nginx/frontend/db must have no route to fingerprint the model service."""
    allowed = {"api", "worker"}  # ollama itself lives in the overlay, not here
    for name, svc in _load(CUSTOMER)["services"].items():
        if LLM_NET in (svc.get("networks") or []):
            assert name in allowed, f"{name} must not be on {LLM_NET}"


def test_ollama_image_strips_identifying_labels() -> None:
    """`docker inspect` on the baked image must not advertise the LLM runtime
    through inherited OCI labels. The Dockerfile overrides them to neutral."""
    df = (_ROOT / "docker" / "Dockerfile.ollama").read_text().lower()
    assert "label" in df, "Dockerfile.ollama does not neutralise inherited labels"
    assert "ollama" not in _label_values(df), "image labels still name the runtime"


def _label_values(dockerfile_lower: str) -> str:
    """The values of every LABEL line, joined — the part `docker inspect` shows."""
    out = []
    for line in dockerfile_lower.splitlines():
        s = line.strip()
        if s.startswith("label "):
            out.append(s[len("label "):])
    return " ".join(out)
