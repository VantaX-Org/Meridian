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

## Cloud deployment — AWS

Meridian ships as a Docker Compose stack (`db`, `redis`, `minio`, `api`,
`worker`, `beat`, `frontend`, and an optional `ollama` under the
`llm-bundled` profile). It runs unchanged on a single EC2 instance, or you
can offload the stateful services to AWS managed equivalents.

### Pattern A — Single EC2 (Docker Compose as shipped)

Closest to the delivered package: one VM, one `docker compose up -d`.

| Tier | Instance | vCPU / RAM | Notes |
|---|---|---|---|
| Cloud LLM (Tier 1 / 1.5) — recommended | `m6i.2xlarge` | 8 / 32 GB | Matches "Recommended" spec, no GPU |
| Minimum (cloud LLM) | `m6i.xlarge` | 4 / 16 GB | Matches "Minimum" spec |
| Local LLM (Tier 2, `LLM_PROVIDER=ollama`) | `g6e.4xlarge` (1× L40S, 48 GB VRAM) or `g5.12xlarge` (4× A10G, 96 GB VRAM) | — | Required only if data residency forbids any external LLM call |

- **OS**: Ubuntu 22.04 LTS AMI.
- **Storage**: 500 GB `gp3` EBS (≥3,000 IOPS) for the Docker volumes
  (`db_data`, `redis_data`, `minio_data`, and `ollama_data` ~40 GB for the
  `llama3.1:70b` weights on Tier 2).
- **Networking**: place in a private subnet; only outbound NAT is needed
  (see Network section). Expose port 3000 to the workstation network via a
  security group or an ALB; the API is internal-only in the Compose stack.

> On AWS, prefer a cloud LLM (`LLM_PROVIDER=anthropic` or `ollama_cloud`) and
> skip the GPU instance entirely — Tier 2 GPU instances cost ~$3–8/hr.

### Pattern B — EC2 + managed services (production-grade)

Run the application containers on EC2 or ECS Fargate and replace the
stateful containers with managed AWS services:

| Compose service | AWS managed equivalent | Suggested size |
|---|---|---|
| `db` (postgres:16 + RLS) | RDS for PostgreSQL 16, Multi-AZ | `db.m6i.large`, 100 GB gp3 |
| `redis` (redis:7) | ElastiCache for Redis 7 | `cache.t4g.medium` |
| `minio` | S3 bucket (S3-compatible API) | standard bucket |
| `api` + `frontend` + `worker` + `beat` | EC2 `m6i.xlarge`, or Fargate tasks | api 4 vCPU/16 GB; worker task 2 vCPU/8 GB |

RLS tenant isolation relies on `SET app.tenant_id` per session — RDS
PostgreSQL supports this with no change; ensure `DATABASE_URL` targets RDS
with SSL enabled.

### Pattern C — EKS (Helm chart in `helm/meridian/`)

The chart provisions api (2 replicas), worker (HPA 2–10), frontend (1), and
StatefulSets for postgres/redis/minio. Per-pod resource **requests** are
small (api `100m`/`256Mi`, worker `200m`/`512Mi`, frontend `100m`/`256Mi`),
so node sizing is driven by replica count, not per-pod load.

- **Cluster**: EKS with a managed node group of 2–3× `m6i.xlarge`.
- **Storage**: EBS CSI driver (`gp3`) for the StatefulSet PVCs
  (postgres 50 Gi, redis 5 Gi, minio 100 Gi per `values.yaml`).
- **Ingress**: enable `ingress.yaml` behind an ALB via the AWS Load Balancer
  Controller.
- **LLM**: `values.yaml` defaults to bundled Ollama with `llama3.1:70b`
  (16–64 Gi, GPU enabled) — schedule `deployment-llm` on a `g6e`/`g5` GPU
  node, **or** set the provider to a cloud LLM and disable that deployment.

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
