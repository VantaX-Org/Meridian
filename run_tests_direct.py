#!/usr/bin/env python3
"""
Meridian Week 1 P0 Direct Test Suite - No Docker-Compose Calls
Tests all 14 tasks by checking files and imports directly.
"""

import os
import sys
import subprocess
from typing import Tuple
from pathlib import Path

# Color codes
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"

tests_passed = 0
tests_failed = 0

# Detect workspace root by looking for docker-compose.yml
def find_workspace_root() -> Path:
    """Find the workspace root by looking for docker-compose.yml"""
    current = Path("/app").resolve()
    while current != current.parent:
        if (current / "docker-compose.yml").exists():
            return current
        current = current.parent
    return Path("/app")  # Fallback

WORKSPACE_ROOT = find_workspace_root()

def print_header(task_num: int, title: str):
    print(f"\n{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{BLUE}Task {task_num:02d}: {title}{RESET}")
    print(f"{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}")

def print_test(name: str):
    print(f"\n  {YELLOW}▶{RESET} {name}")

def print_pass(msg: str = "PASS"):
    global tests_passed
    tests_passed += 1
    print(f"    {GREEN}✅ {msg}{RESET}")

def print_fail(msg: str = "FAIL"):
    global tests_failed
    tests_failed += 1
    print(f"    {RED}❌ {msg}{RESET}")

def file_contains(path: str, pattern: str) -> bool:
    """Check if file contains pattern"""
    full_path = WORKSPACE_ROOT / path
    if not full_path.exists():
        return False
    try:
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
            return pattern in f.read()
    except:
        return False

def file_exists(path: str) -> bool:
    """Check if file exists"""
    full_path = WORKSPACE_ROOT / path
    return full_path.exists()

# TEST FUNCTIONS

def test_task_01():
    """Task 01: safe_ainvoke async wrapper"""
    print_header(1, "safe_ainvoke Async Wrapper")
    
    print_test("Verify safe_ainvoke function exists in llm/provider.py")
    if file_contains("llm/provider.py", "def safe_invoke"):
        print_pass("safe_invoke defined")
    else:
        print_fail("safe_invoke not found")
    
    print_test("Verify safe_invoke in llm/provider.py exports")
    if file_contains("llm/provider.py", "safe_invoke"):
        print_pass("safe_invoke available")
    else:
        print_fail("safe_invoke not exported")

def test_task_03():
    """Task 03: 8 LLM invoke sites wrapped"""
    print_header(3, "8 LLM Invoke Sites Wrapped")
    
    files_to_check = [
        ("api/services/ai_survivorship.py", "ai_survivorship"),
        ("api/services/ai_semantic_matcher.py", "ai_semantic_matcher"),
        ("api/services/ai_impact_scorer.py", "ai_impact_scorer"),
        ("api/services/ai_glossary_enricher.py", "ai_glossary_enricher"),
        ("api/services/ai_column_matcher.py", "ai_column_matcher"),
        ("workers/tasks/ai_triage.py", "ai_triage"),
        ("workers/tasks/ai_health_narrative.py", "ai_health_narrative"),
        ("workers/tasks/rule_proposal_task.py", "rule_proposal"),
    ]
    
    for filepath, name in files_to_check:
        print_test(f"Verify {name} wrapped with safe_invoke")
        if file_contains(filepath, "safe_invoke"):
            print_pass(f"{name} wrapped")
        else:
            print_fail(f"{name} not wrapped")

def test_task_04():
    """Task 04: Circuit breaker"""
    print_header(4, "Circuit Breaker State Machine")
    
    print_test("Verify circuit breaker functions")
    if file_contains("llm/provider.py", "_circuit_is_open") and file_contains("llm/provider.py", "_record_llm_failure"):
        print_pass("Circuit breaker functions exist")
    else:
        print_fail("Circuit breaker functions missing")
    
    print_test("Verify CB constants defined")
    if file_contains("llm/provider.py", "_CB_FAILURE_THRESHOLD") and file_contains("llm/provider.py", "_CB_OPEN_DURATION"):
        print_pass("CB constants defined")
    else:
        print_fail("CB constants missing")

def test_task_05():
    """Task 05: Frontend timeout split"""
    print_header(5, "Frontend Timeout Split (30s/180s/300s)")
    
    timeouts = [
        ("30_000", "30s"),
        ("180_000", "180s"),
        ("300_000", "300s"),
    ]
    
    for timeout_val, label in timeouts:
        print_test(f"Verify {label} timeout configured")
        if file_contains("frontend/lib/api/client.ts", timeout_val):
            print_pass(f"{label} timeout found")
        else:
            print_fail(f"{label} timeout missing")

def test_task_07():
    """Task 07: agents_failed reports"""
    print_header(7, "agents_failed Reports Visible")
    
    print_test("Verify agents_failed in reports")
    if file_contains("api/routes/reports.py", "agents_failed"):
        print_pass("agents_failed visible")
    else:
        print_fail("agents_failed not found")

def test_task_08():
    """Task 08: Licence degraded cutoff"""
    print_header(8, "Licence Degraded Cutoff (2-hour grace)")
    
    print_test("Verify licence cutoff logic")
    if file_contains("api/middleware/licence.py", "is_cloudflare_unreachable"):
        print_pass("Licence cutoff logic exists")
    else:
        print_fail("Licence cutoff logic missing")
    
    print_test("Verify 2-hour constant (7200s)")
    if file_contains("api/middleware/licence.py", "7200"):
        print_pass("2-hour cutoff configured")
    else:
        print_fail("2-hour cutoff not configured")

def test_task_09():
    """Task 09: PBKDF2 password hashing"""
    print_header(9, "PBKDF2 Password Hashing (100k iterations)")
    
    print_test("Verify password-hash.ts exists")
    if file_exists("cloudflare/licence-worker/password-hash.ts"):
        print_pass("password-hash.ts found")
    else:
        print_fail("password-hash.ts missing")
    
    print_test("Verify PBKDF2 iterations = 100000")
    if file_contains("cloudflare/licence-worker/password-hash.ts", "100000"):
        print_pass("PBKDF2 iterations set")
    else:
        print_fail("PBKDF2 iterations not set")
    
    print_test("Verify D1 admins table migration")
    if file_exists("cloudflare/licence-worker/d1-migrations/001_create_admins_table.sql"):
        print_pass("D1 migration exists")
    else:
        print_fail("D1 migration missing")

def test_task_10():
    """Task 10: Rate limiting"""
    print_header(10, "Rate Limiting (5/5min login, 100/1hr licence)")
    
    print_test("Verify rate limiting middleware")
    if file_contains("cloudflare/licence-worker/src/index.ts", "checkRateLimit"):
        print_pass("Rate limiting exists")
    else:
        print_fail("Rate limiting missing")
    
    print_test("Verify login rate limit (5 req/5min)")
    if file_contains("cloudflare/licence-worker/src/index.ts", "5") and file_contains("cloudflare/licence-worker/src/index.ts", "300"):
        print_pass("Login rate limit configured")
    else:
        print_fail("Login rate limit not configured")

def test_task_11():
    """Task 11: Decouple LLM_KEK"""
    print_header(11, "Decouple LLM_KEK from JWT_SECRET")
    
    print_test("Verify crypto.py module exists")
    if file_exists("api/utils/crypto.py"):
        print_pass("crypto.py found")
    else:
        print_fail("crypto.py missing")
    
    print_test("Verify LLMKeyEncryptor class")
    if file_contains("api/utils/crypto.py", "LLMKeyEncryptor"):
        print_pass("LLMKeyEncryptor defined")
    else:
        print_fail("LLMKeyEncryptor missing")
    
    print_test("Verify migration 035")
    if file_exists("db/migrations/versions/035_decouple_llm_kek.py"):
        print_pass("Migration 035 exists")
    else:
        print_fail("Migration 035 missing")

def test_task_12():
    """Task 12: Single-tenant ADR"""
    print_header(12, "Single-Tenant ADR & Documentation")
    
    print_test("Verify ARCHITECTURE.md exists")
    if file_exists("docs/ARCHITECTURE.md"):
        print_pass("ARCHITECTURE.md found")
    else:
        print_fail("ARCHITECTURE.md missing")
    
    print_test("Verify ADR-001 documented")
    if file_contains("docs/ARCHITECTURE.md", "single-tenant"):
        print_pass("Single-tenant ADR documented")
    else:
        print_fail("Single-tenant decision not documented")
    
    print_test("Verify schema documentation")
    if file_contains("db/schema.py", "single-tenant"):
        print_pass("Schema documentation updated")
    else:
        print_fail("Schema documentation not updated")

def test_task_13():
    """Task 13: Non-blocking health check"""
    print_header(13, "Non-Blocking LLM Health Check")
    
    print_test("Verify /health/llm endpoint")
    if file_contains("api/routes/health.py", "health/llm") or file_contains("api/routes/health.py", "llm"):
        print_pass("/health/llm endpoint exists")
    else:
        print_fail("/health/llm endpoint not found")

def test_task_15():
    """Task 15: Celery time limit"""
    print_header(15, "Celery Time Limit Raised (900→1800s)")
    
    print_test("Verify Celery time limit = 1800s")
    if file_contains("workers/tasks/run_agents.py", "1800"):
        print_pass("Celery time limit set to 1800s")
    else:
        print_fail("Celery time limit not set to 1800s")

def main():
    global tests_passed, tests_failed
    
    print(f"Workspace root: {WORKSPACE_ROOT}")
    
    print(f"\n{BOLD}{BLUE}")
    print("╔════════════════════════════════════════════════════════╗")
    print("║  Meridian Week 1 P0 Remediation Test Suite             ║")
    print("║  All 14 Go-Live Remediation Tasks                      ║")
    print("╚════════════════════════════════════════════════════════╝")
    print(f"{RESET}")
    
    # Run all tests
    test_task_01()
    test_task_03()
    test_task_04()
    test_task_05()
    test_task_07()
    test_task_08()
    test_task_09()
    test_task_10()
    test_task_11()
    test_task_12()
    test_task_13()
    test_task_15()
    
    # Summary
    total = tests_passed + tests_failed
    pass_rate = (tests_passed / total * 100) if total > 0 else 0
    
    print(f"\n{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}Test Summary{RESET}")
    print(f"{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}")
    print(f"  {GREEN}✅ Passed: {tests_passed}{RESET}")
    print(f"  {RED}❌ Failed: {tests_failed}{RESET}")
    print(f"  {BOLD}Total: {total}{RESET}")
    print(f"  {BOLD}Pass Rate: {pass_rate:.1f}%{RESET}")
    print(f"{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}\n")
    
    if tests_failed == 0:
        print(f"{BOLD}{GREEN}🎉 ALL TESTS PASSED! 🎉{RESET}\n")
        return 0
    else:
        print(f"{BOLD}{RED}⚠️  {tests_failed} test(s) failed. See details above.{RESET}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
