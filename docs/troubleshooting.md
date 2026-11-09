# Troubleshooting

## Common Issues

### "LLM connection failed"

**Symptoms:** Health endpoint shows `llm_connected: false`, agent tasks fail.

**Solutions:**
- The customer stack has no language model container unless the overlay `docker/docker-compose.customer.ollama.yml` is used. Its service is `ollama`, so `OLLAMA_BASE_URL` in `docker/.env` must be `http://ollama:11434`. A provider set in Administration overrides the environment (see [llm-configuration.md](llm-configuration.md)).
- Verify the Ollama container is running: `docker compose -f docker/docker-compose.customer.yml -f docker/docker-compose.customer.ollama.yml ps ollama`
- Check GPU driver: `nvidia-smi`
- Verify model is pulled: `docker compose -f docker/docker-compose.customer.yml -f docker/docker-compose.customer.ollama.yml exec ollama ollama list`
- Check Ollama logs: `docker compose -f docker/docker-compose.customer.yml -f docker/docker-compose.customer.ollama.yml logs ollama`

### "Licence invalid"

**Symptoms:** API returns 402, dashboard shows "Licence expired".

**Solutions:**
- Verify `MERIDIAN_LICENCE_KEY` (online) or `MERIDIAN_LICENCE_TOKEN` (offline) in `docker/.env`; see runbook 6 in [sustain/runbooks.md](sustain/runbooks.md#6-check-or-renew-the-meridian-licence)
- Check outbound connectivity: `curl -s https://licence.meridian.vantax.co.za/status?key=YOUR_KEY`
- Visit [portal.meridian.vantax.co.za](https://portal.meridian.vantax.co.za) to check licence status
- For air-gapped: use `MERIDIAN_LICENCE_TOKEN`; a missing network gives `offline_grace` for `MERIDIAN_LICENCE_OFFLINE_GRACE_DAYS`

### "Database migration failed"

**Symptoms:** `alembic upgrade head` errors during install/update.

**Solutions:**
- Check `DB_PASSWORD` matches between `.env` and the running Postgres container
- Verify Postgres is running: `docker compose -f docker/docker-compose.customer.yml ps db`
- Check Postgres logs: `docker compose -f docker/docker-compose.customer.yml logs db`
- Try connecting manually: `docker compose -f docker/docker-compose.customer.yml exec db psql -U meridian -d meridian`

### "Analysis stuck in running"

**Symptoms:** Version status stays `running` indefinitely.

**Solutions:**
- Check Celery worker status: `docker compose -f docker/docker-compose.customer.yml ps worker`
- Check worker logs: `docker compose -f docker/docker-compose.customer.yml logs worker`
- Verify Redis connectivity: `docker compose -f docker/docker-compose.customer.yml exec redis redis-cli ping`
- Restart workers: `docker compose -f docker/docker-compose.customer.yml restart worker`

### "PDF not generated"

**Symptoms:** Report shows complete but no PDF download available.

**Solutions:**
- Check worker logs for WeasyPrint errors: `docker compose -f docker/docker-compose.customer.yml logs worker | grep -i weasyprint`
- Verify object storage is healthy: `docker compose -f docker/docker-compose.customer.yml ps storage` (Garage; the stack reaches it as `minio:9000`)
- Check its setup log: `docker compose -f docker/docker-compose.customer.yml logs storage | grep '^storage:'` — the last line should be `storage: ready`

### "Upload fails with 422"

**Symptoms:** CSV upload returns validation error.

**Solutions:**
- Check the error response for missing column names
- Verify your CSV columns match the expected format for the module
- Check column mapping in `checks/rules/{module}/column_map.yaml`
- Ensure the file is under 100 MB

### "Services won't start"

**Symptoms:** `docker compose -f docker/docker-compose.customer.yml up` fails or containers keep restarting.

**Solutions:**
- Check available disk space: `df -h`
- Check available memory: `free -h`
- Check Docker logs: `docker compose -f docker/docker-compose.customer.yml logs`
- Verify port availability: `ss -tlnp | grep -E ':(80|443) '` (only nginx publishes ports; api and frontend have no host port)
- Check for conflicting containers: `docker ps`

## Diagnostic Commands

```bash
# Service status
docker compose -f docker/docker-compose.customer.yml ps

# Full health check
./scripts/healthcheck.sh

# API logs
docker compose -f docker/docker-compose.customer.yml logs api --tail 100

# Worker logs
docker compose -f docker/docker-compose.customer.yml logs worker --tail 100

# Database connectivity
docker compose -f docker/docker-compose.customer.yml exec db psql -U meridian -d meridian -c "SELECT count(*) FROM tenants;"

# Redis connectivity
docker compose -f docker/docker-compose.customer.yml exec redis redis-cli ping

# Object storage (Garage) status
docker compose -f docker/docker-compose.customer.yml exec storage curl -fsS http://127.0.0.1:3903/health

# Ollama model list
docker compose -f docker/docker-compose.customer.yml -f docker/docker-compose.customer.ollama.yml exec ollama ollama list
```

## Getting Help

- Check the API health endpoint: `curl -s http://127.0.0.1/health | python3 -m json.tool` (through nginx)
- Review full logs: `docker compose -f docker/docker-compose.customer.yml logs > meridian-logs.txt 2>&1`
- Contact support with the health endpoint output and relevant log excerpts
