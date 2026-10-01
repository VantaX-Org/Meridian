# Troubleshooting

## Common Issues

### "LLM connection failed"

**Symptoms:** Health endpoint shows `llm_connected: false`, agent tasks fail.

**Solutions:**
- Check `OLLAMA_BASE_URL` in `.env` (default: `http://llm:11434`)
- Verify the Ollama container is running: `docker compose ps llm`
- Check GPU driver: `nvidia-smi`
- Verify model is pulled: `docker compose exec llm ollama list`
- Check Ollama logs: `docker compose logs llm`

### "Licence invalid"

**Symptoms:** API returns 402, dashboard shows "Licence expired".

**Solutions:**
- Verify `LICENCE_KEY` in `.env`
- Check outbound connectivity: `curl -s https://licence.meridian.vantax.co.za/status?key=YOUR_KEY`
- Visit [portal.meridian.vantax.co.za](https://portal.meridian.vantax.co.za) to check licence status
- For air-gapped: verify `LICENCE_FILE` path and JSON format

### "Database migration failed"

**Symptoms:** `alembic upgrade head` errors during install/update.

**Solutions:**
- Check `DB_PASSWORD` matches between `.env` and the running Postgres container
- Verify Postgres is running: `docker compose ps db`
- Check Postgres logs: `docker compose logs db`
- Try connecting manually: `docker compose exec db psql -U vantax -d vantax`

### "Analysis stuck in running"

**Symptoms:** Version status stays `running` indefinitely.

**Solutions:**
- Check Celery worker status: `docker compose ps worker`
- Check worker logs: `docker compose logs worker`
- Verify Redis connectivity: `docker compose exec redis redis-cli ping`
- Restart workers: `docker compose restart worker`

### "PDF not generated"

**Symptoms:** Report shows complete but no PDF download available.

**Solutions:**
- Check worker logs for WeasyPrint errors: `docker compose logs worker | grep -i weasyprint`
- Verify object storage is healthy: `docker compose ps storage` (Garage; the stack reaches it as `minio:9000`)
- Check its setup log: `docker compose logs storage | grep '^storage:'` — the last line should be `storage: ready`

### "Upload fails with 422"

**Symptoms:** CSV upload returns validation error.

**Solutions:**
- Check the error response for missing column names
- Verify your CSV columns match the expected format for the module
- Check column mapping in `checks/rules/{module}/column_map.yaml`
- Ensure the file is under 100 MB

### "Services won't start"

**Symptoms:** `docker compose up` fails or containers keep restarting.

**Solutions:**
- Check available disk space: `df -h`
- Check available memory: `free -h`
- Check Docker logs: `docker compose logs`
- Verify port availability: `ss -tlnp | grep -E '(8000|3000)'`
- Check for conflicting containers: `docker ps`

## Diagnostic Commands

```bash
# Service status
docker compose ps

# Full health check
./scripts/healthcheck.sh

# API logs
docker compose logs api --tail 100

# Worker logs
docker compose logs worker --tail 100

# Database connectivity
docker compose exec db psql -U vantax -d vantax -c "SELECT count(*) FROM tenants;"

# Redis connectivity
docker compose exec redis redis-cli ping

# Object storage (Garage) status
docker compose exec storage curl -fsS http://127.0.0.1:3903/health

# Ollama model list
docker compose exec llm ollama list
```

## Getting Help

- Check the API health endpoint: `curl http://localhost:8000/health | python3 -m json.tool`
- Review full logs: `docker compose logs > vantax-logs.txt 2>&1`
- Contact support with the health endpoint output and relevant log excerpts
