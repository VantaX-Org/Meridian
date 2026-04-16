# LLM Configuration

Meridian supports three LLM provider modes. The LLM is used only for
reasoning about findings — all data quality checks are deterministic
Python functions that never involve the LLM.

## Provider Modes

### 1. Local Ollama (default)

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://llm:11434
OLLAMA_MODEL=llama3.1:70b
```

- Fully local — no data leaves your server
- Requires NVIDIA GPU with sufficient VRAM
- Best for production deployments with strict data sovereignty requirements

**GPU Requirements by Model:**

| Model | VRAM Required | Quality | Speed |
|---|---|---|---|
| llama3.1:70b | 40+ GB | Best | Slower |
| llama3.1:8b | 8 GB | Good | Fast |
| mistral:7b | 8 GB | Good | Fast |

### 2. Ollama Cloud

```bash
LLM_PROVIDER=ollama_cloud
OLLAMA_API_KEY=<your API key from ollama.com/settings/keys>
OLLAMA_MODEL=deepseek-v3.1:671b-cloud
OLLAMA_BASE_URL=https://ollama.com
```

- Cloud API — no local GPU needed
- Finding summaries (not raw data) are sent to the Ollama Cloud API
- Good for development, testing, and deployments without GPU
- Available cloud models: deepseek-v3.1:671b-cloud, qwen3-coder:480b-cloud, gpt-oss:120b-cloud

### 3. Anthropic (Claude)

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=<your API key>
```

- Uses Claude Sonnet for highest quality reasoning
- Finding summaries (not raw data) are sent to the Anthropic API
- Best quality remediation suggestions
- Requires customer approval for external API usage

## Switching Providers

To switch after initial deployment:

1. Edit `.env` and change `LLM_PROVIDER` and related keys
2. Restart the API and worker:
   ```bash
   docker compose restart api worker
   ```

## What the LLM Sees

The LLM never sees raw SAP data. It receives only structured finding
summaries like:

```json
{
  "check_id": "BP001",
  "module": "business_partner",
  "severity": "critical",
  "affected_count": 1523,
  "total_count": 45000,
  "pass_rate": 96.6
}
```

From these summaries, it generates:
- Root cause analysis
- SAP-specific remediation steps
- Migration readiness assessments
