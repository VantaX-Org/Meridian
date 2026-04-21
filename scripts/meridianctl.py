#!/usr/bin/env python3
"""Meridian Control Plane CLI (meridianctl) — airgap deployment management.

Usage:
    meridianctl system status           # Show system health
    meridianctl worker start <lane>    # Start worker in specified lane (fast|full|all)
    meridianctl worker stop <lane>     # Stop worker in specified lane
    meridianctl worker status <lane>   # Show worker status
    meridianctl config show            # Show current config
    meridianctl config validate        # Validate configuration
    meridianctl licence status         # Show licence status
    meridianctl export metrics          # Export metrics snapshot
    meridianctl health check           # Run full health check
    meridianctl version                # Show version info

Two-Lane Architecture:
    fast  — low-latency path (checks, extraction, delta analysis)
    full  — deep analysis path (mining, agents, enrichment)
    all   — both lanes running

Airgap Features:
    - No external API calls
    - Embedded LLM (Ollama bundled)
    - Offline licence validation
    - Local metrics only

For WS6 from Meridian v3.0 spec §5.
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

VERSION = "1.0.0"
AIRGAP_MODE = True  # Always True — this is airgap CLI


# ── Colour helpers ──────────────────────────────────────────────────────────

class Colors:
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"


def colored(text: str, color: str) -> str:
    return f"{color}{text}{Colors.RESET}"


# ── Version command ──────────────────────────────────────────────────────────

def cmd_version(args):
    """Show version information."""
    print(f"Meridian Control Plane CLI v{VERSION}")
    print(f"Airgap Mode: {colored('ENABLED', Colors.GREEN)}")
    print(f"Python: {sys.version.split()[0]}")
    
    # Try to get git info
    try:
        git_sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()
        print(f"Git SHA: {git_sha}")
    except Exception:
        pass
    
    return 0


# ── Worker management ────────────────────────────────────────────────────────

def cmd_worker_start(args):
    """Start workers in specified lane(s)."""
    lane = args.lane
    
    valid_lanes = ["fast", "full", "all"]
    if lane not in valid_lanes:
        print(colored(f"Invalid lane: {lane}", Colors.RED))
        print(f"Valid lanes: {', '.join(valid_lanes)}")
        return 1
    
    lanes_to_start = ["fast", "full"] if lane == "all" else [lane]
    
    for l in lanes_to_start:
        print(f"Starting {l} worker lane...")
        try:
            # Set lane environment variable
            env = os.environ.copy()
            env["WORKER_LANE"] = l
            
            # Start worker via docker compose or direct subprocess
            if os.path.exists("docker-compose.yml") or os.path.exists("docker-compose.dev.yml"):
                compose_files = ["-f", "docker-compose.yml"]
                if os.path.exists("docker-compose.dev.yml"):
                    compose_files.extend(["-f", "docker-compose.dev.yml"])
                
                subprocess.run([
                    "docker", "compose", *compose_files,
                    "up", "-d", f"worker-{l}"
                ], env=env, check=True)
            else:
                # Direct subprocess for testing
                cmd = ["python", "-m", "celery", "-A", "workers.celery_app", "worker"]
                subprocess.Popen(cmd, env={**env, "WORKER_LANE": l})
            
            print(colored(f"  {l} worker started", Colors.GREEN))
            
        except subprocess.CalledProcessError as e:
            print(colored(f"  Failed to start {l} worker: {e}", Colors.RED))
            return 1
        except Exception as e:
            print(colored(f"  Error starting {l} worker: {e}", Colors.RED))
            return 1
    
    print(colored(f"All requested lanes started", Colors.GREEN))
    return 0


def cmd_worker_stop(args):
    """Stop workers in specified lane(s)."""
    lane = args.lane
    
    valid_lanes = ["fast", "full", "all"]
    if lane not in valid_lanes:
        print(colored(f"Invalid lane: {lane}", Colors.RED))
        print(f"Valid lanes: {', '.join(valid_lanes)}")
        return 1
    
    lanes_to_stop = ["fast", "full"] if lane == "all" else [lane]
    
    for l in lanes_to_stop:
        print(f"Stopping {l} worker lane...")
        try:
            if os.path.exists("docker-compose.yml") or os.path.exists("docker-compose.dev.yml"):
                subprocess.run([
                    "docker", "compose", "stop", f"worker-{l}"
                ], check=True)
            else:
                # Find and kill celery workers for this lane
                subprocess.run([
                    "pkill", "-f", f"WORKER_LANE={l}"
                ])
            
            print(colored(f"  {l} worker stopped", Colors.YELLOW))
            
        except subprocess.CalledProcessError:
            print(colored(f"  Failed to stop {l} worker", Colors.RED))
            return 1
    
    print(colored(f"All requested lanes stopped", Colors.YELLOW))
    return 0


def cmd_worker_status(args):
    """Show worker status for specified lane(s)."""
    lane = args.lane
    
    valid_lanes = ["fast", "full", "all"]
    if lane not in valid_lanes:
        print(colored(f"Invalid lane: {lane}", Colors.RED))
        print(f"Valid lanes: {', '.join(valid_lanes)}")
        return 1
    
    lanes_to_check = ["fast", "full"] if lane == "all" else [lane]
    
    print(f"Worker Status — Lane: {lane}")
    print("=" * 40)
    
    all_ok = True
    for l in lanes_to_check:
        try:
            if os.path.exists("docker-compose.yml") or os.path.exists("docker-compose.dev.yml"):
                result = subprocess.run([
                    "docker", "compose", "ps", f"worker-{l}"
                ], capture_output=True, text=True)
                
                if "Up" in result.stdout:
                    status = colored("RUNNING", Colors.GREEN)
                elif "Exit" in result.stdout:
                    status = colored("STOPPED", Colors.RED)
                    all_ok = False
                else:
                    status = colored("UNKNOWN", Colors.YELLOW)
                    all_ok = False
            else:
                # Check for running processes
                result = subprocess.run([
                    "pgrep", "-f", f"WORKER_LANE={l}"
                ], capture_output=True)
                
                if result.returncode == 0:
                    status = colored("RUNNING", Colors.GREEN)
                else:
                    status = colored("STOPPED", Colors.RED)
                    all_ok = False
            
            print(f"  {l:8s}: {status}")
            
        except Exception as e:
            print(f"  {l:8s}: {colored('ERROR', Colors.RED)} ({e})")
            all_ok = False
    
    return 0 if all_ok else 1


# ── System commands ──────────────────────────────────────────────────────────

def cmd_system_status(args):
    """Show full system status."""
    print(f"Meridian System Status — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)
    
    # Airgap mode indicator
    print(f"Airgap Mode: {colored('ENABLED', Colors.GREEN)}")
    
    # Docker containers (if available)
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            containers = []
            for line in result.stdout.strip().split("\n"):
                if line:
                    try:
                        containers.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            
            print(f"\nContainers ({len(containers)}):")
            for c in containers:
                name = c.get("Service", c.get("Name", ""))
                state = c.get("State", "unknown")
                if state == "running":
                    status = colored("UP", Colors.GREEN)
                elif state == "exited":
                    status = colored("DOWN", Colors.RED)
                else:
                    status = colored(state.upper(), Colors.YELLOW)
                print(f"  {name:20s}: {status}")
    except Exception:
        pass
    
    # Worker status
    print(f"\nWorkers:")
    cmd_worker_status(argparse.Namespace(lane="all"))
    
    # Redis connection
    try:
        import redis
        r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        r.ping()
        print(f"\nRedis: {colored('CONNECTED', Colors.GREEN)}")
    except Exception:
        print(f"\nRedis: {colored('DISCONNECTED', Colors.RED)}")
    
    # Postgres connection
    try:
        from sqlalchemy import create_engine, text
        db_url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
        if db_url:
            engine = create_engine(db_url.replace("+asyncpg", "").replace("postgresql+asyncpg", "postgresql"))
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print(f"Postgres: {colored('CONNECTED', Colors.GREEN)}")
    except Exception:
        print(f"Postgres: {colored('DISCONNECTED', Colors.RED)}")
    
    print()
    return 0


def cmd_health_check(args):
    """Run full health check."""
    print("Running Health Check...")
    print("=" * 40)
    
    all_pass = True
    
    # 1. Check all systems connectivity
    print("\n1. Connectivity Check:")
    try:
        from workers.tasks.run_health_check import check_all_systems
        # Run synchronously for CLI
        result = check_all_systems.delay() if False else None  # Skip async for now
        
        # Simple connectivity test
        import redis
        r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        r.ping()
        print(f"   Redis: {colored('OK', Colors.GREEN)}")
    except Exception as e:
        print(f"   Redis: {colored('FAIL', Colors.RED)} ({e})")
        all_pass = False
    
    # 2. Check database
    print("\n2. Database Check:")
    try:
        from sqlalchemy import create_engine, text
        db_url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
        if db_url:
            engine = create_engine(db_url.replace("+asyncpg", "").replace("postgresql+asyncpg", "postgresql"))
            with engine.connect() as conn:
                result = conn.execute(text("SELECT COUNT(*) FROM tenants"))
                count = result.scalar()
            print(f"   Postgres: {colored('OK', Colors.GREEN)} (tenants: {count})")
    except Exception as e:
        print(f"   Postgres: {colored('FAIL', Colors.RED)} ({e})")
        all_pass = False
    
    # 3. Check MinIO
    print("\n3. Storage Check:")
    try:
        from minio import Minio
        client = Minio(
            endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
            access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
            secret_key=os.getenv("MINIO_SECRET_KEY", ""),
            secure=False,
        )
        buckets = client.list_buckets()
        bucket_names = [b.name for b in buckets]
        print(f"   MinIO: {colored('OK', Colors.GREEN)} (buckets: {', '.join(bucket_names[:5])})")
    except Exception as e:
        print(f"   MinIO: {colored('FAIL', Colors.RED)} ({e})")
        all_pass = False
    
    # Summary
    print("\n" + "=" * 40)
    if all_pass:
        print(colored("Health Check: PASSED", Colors.GREEN))
        return 0
    else:
        print(colored("Health Check: FAILED", Colors.RED))
        return 1


# ── Config commands ────────────────────────────────────────────────────────────

def cmd_config_show(args):
    """Show current configuration."""
    print("Meridian Configuration")
    print("=" * 40)
    
    config_vars = [
        "DATABASE_URL",
        "REDIS_URL",
        "MINIO_ENDPOINT",
        "MINIO_BUCKET_UPLOADS",
        "WORKER_LANE",
        "LLM_PROVIDER",
        "LLM_MODEL",
        "AIRGAP_MODE",
    ]
    
    for var in config_vars:
        value = os.getenv(var, "(not set)")
        if "KEY" in var or "SECRET" in var:
            value = "(set)" if value else "(not set)"
        print(f"  {var:30s}: {value}")
    
    return 0


def cmd_config_validate(args):
    """Validate configuration."""
    print("Validating Configuration...")
    print("=" * 40)
    
    errors = []
    warnings = []
    
    # Check required vars
    required = ["DATABASE_URL", "REDIS_URL"]
    for var in required:
        if not os.getenv(var):
            errors.append(f"Missing required: {var}")
    
    # Check optional vars
    optional = ["LLM_PROVIDER", "MINIO_ENDPOINT"]
    for var in optional:
        if not os.getenv(var):
            warnings.append(f"Optional not set: {var}")
    
    # Validate worker lane
    lane = os.getenv("WORKER_LANE", "all")
    valid = ["fast", "full", "all"]
    if lane not in valid:
        errors.append(f"Invalid WORKER_LANE: {lane}")
    
    # Report
    for e in errors:
        print(colored(f"  ERROR: {e}", Colors.RED))
    for w in warnings:
        print(colored(f"  WARNING: {w}", Colors.YELLOW))
    
    if not errors and not warnings:
        print(colored("  Configuration valid", Colors.GREEN))
        return 0
    elif not errors:
        return 0
    else:
        return 1


# ── Licence commands ──────────────────────────────────────────────────────────

def cmd_licence_status(args):
    """Show licence status."""
    print("Licence Status")
    print("=" * 40)
    print(f"Mode: {colored('AIRGAP (Offline)', Colors.GREEN)}")
    print("Note: In airgap mode, licence validation is performed locally.")
    print("      No external API calls are made.")
    
    # Check local licence cache
    try:
        from sqlalchemy import create_engine, text
        db_url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
        if db_url:
            engine = create_engine(db_url.replace("+asyncpg", ""))
            with engine.connect() as conn:
                result = conn.execute(text("SELECT * FROM licence_cache LIMIT 1"))
                row = result.fetchone()
                if row:
                    print(f"Licence cache: {colored('ACTIVE', Colors.GREEN)}")
                else:
                    print(f"Licence cache: {colored('EMPTY', Colors.YELLOW)}")
    except Exception:
        pass
    
    return 0


# ── Export commands ──────────────────────────────────────────────────────────

def cmd_export_metrics(args):
    """Export metrics snapshot."""
    print("Exporting Metrics Snapshot...")
    print("=" * 40)
    
    metrics = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "airgap_mode": True,
        "version": VERSION,
    }
    
    # Collect metrics from Redis
    try:
        import redis
        r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        
        # Dashboard cache metrics
        keys = r.keys("dashboard:*")
        metrics["dashboard_cache_entries"] = len(keys)
        
    except Exception:
        pass
    
    # Output
    output_file = args.output or f"metrics-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    
    with open(output_file, "w") as f:
        json.dump(metrics, f, indent=2)
    
    print(f"Exported to: {output_file}")
    print(json.dumps(metrics, indent=2))
    
    return 0


# ── Main CLI ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="meridianctl",
        description="Meridian Control Plane CLI — airgap deployment management",
    )
    parser.add_argument("--version", action="version", version=f"meridianctl {VERSION}")
    
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Version
    subparsers.add_parser("version", help="Show version information")
    
    # Worker subcommands
    worker_parser = subparsers.add_parser("worker", help="Worker management")
    worker_sub = worker_parser.add_subparsers(dest="worker_cmd")
    
    worker_start = worker_sub.add_parser("start", help="Start worker lane")
    worker_start.add_argument("lane", choices=["fast", "full", "all"], help="Lane to start")
    
    worker_stop = worker_sub.add_parser("stop", help="Stop worker lane")
    worker_stop.add_argument("lane", choices=["fast", "full", "all"], help="Lane to stop")
    
    worker_status = worker_sub.add_parser("status", help="Show worker status")
    worker_status.add_argument("lane", choices=["fast", "full", "all"], help="Lane to check")
    
    # System
    subparsers.add_parser("system", help="System status").add_subparsers()
    subparsers.add_parser("system status", help="Show system status")
    
    # Health
    subparsers.add_parser("health", help="Run health check")
    subparsers.add_parser("health check", help="Run full health check")
    
    # Config
    config_parser = subparsers.add_parser("config", help="Configuration management")
    config_sub = config_parser.add_subparsers(dest="config_cmd")
    
    config_sub.add_parser("show", help="Show current configuration")
    config_sub.add_parser("validate", help="Validate configuration")
    
    # Licence
    subparsers.add_parser("licence", help="Licence management")
    subparsers.add_parser("licence status", help="Show licence status")
    
    # Export
    export_parser = subparsers.add_parser("export", help="Export data")
    export_sub = export_parser.add_subparsers(dest="export_cmd")
    
    export_metrics = export_sub.add_parser("metrics", help="Export metrics snapshot")
    export_metrics.add_argument("-o", "--output", help="Output file path")
    
    args = parser.parse_args()
    
    # Route commands
    commands = {
        "version": cmd_version,
        "worker": {
            "start": cmd_worker_start,
            "stop": cmd_worker_stop,
            "status": cmd_worker_status,
        },
        "system status": cmd_system_status,
        "health check": cmd_health_check,
        "config": {
            "show": cmd_config_show,
            "validate": cmd_config_validate,
        },
        "licence status": cmd_licence_status,
        "export metrics": cmd_export_metrics,
    }
    
    if args.command == "worker":
        return commands["worker"][args.worker_cmd](args)
    elif args.command == "config":
        return commands["config"][args.config_cmd](args)
    elif args.command == "export":
        return commands["export metrics"](args)
    elif args.command in commands:
        return commands[args.command](args)
    else:
        parser.print_help()
        return 0 if args.command is None else 1


if __name__ == "__main__":
    sys.exit(main() or 0)
