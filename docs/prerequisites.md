# Prerequisites

## Operating System

- Ubuntu 22.04 LTS or later (recommended)
- RHEL 8+ / Rocky Linux 8+
- Debian 12+
- Any Linux distribution with Docker support

## Software Requirements

| Software | Minimum Version | Check Command |
|---|---|---|
| Docker | 24.0.0 | `docker version` |
| Docker Compose | 2.20.0 (v2 plugin) | `docker compose version` |
| curl | any | `curl --version` |

## Hardware — Minimum

| Resource | Minimum | Notes |
|---|---|---|
| CPU | 4 cores | 8+ recommended for concurrent analysis |
| RAM | 16 GB | 32 GB recommended if running local LLM |
| Disk | 100 GB SSD | Model weights (~40 GB) + data storage |

## Hardware — Recommended

| Resource | Recommended |
|---|---|
| CPU | 8 cores |
| RAM | 32 GB |
| Disk | 500 GB NVMe SSD |
| GPU | NVIDIA with 48+ GB VRAM (A6000, A100, H100) |

## GPU (only required for `LLM_PROVIDER=ollama`)

- NVIDIA GPU with driver >= 525
- nvidia-container-toolkit installed
- Docker configured with NVIDIA runtime

To verify GPU access:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

If you do not have a GPU, set `LLM_PROVIDER=ollama_cloud` or
`LLM_PROVIDER=anthropic` in `.env` to use a cloud LLM provider instead.

## Network

| Destination | Purpose | When |
|---|---|---|
| `licence.meridian.vantax.co.za` (443) | Licence validation | Startup + every 24h |
| `ghcr.io` (443) | Docker image pulls | Install + updates only |

No inbound ports are required from the internet.

The following ports must be accessible from user workstations on the local network:

| Port | Service |
|---|---|
| 3000 | Dashboard (Next.js) |
| 8000 | API (FastAPI) |

For air-gapped environments, see [air-gapped-deployment.md](air-gapped-deployment.md).
