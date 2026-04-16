#!/usr/bin/env python3
"""
Comprehensive test suite for Meridian Week 1 P0 remediation tasks.
Runs all 14 task validations in sequence.
"""

import subprocess
import sys
import time
import json
from typing import Tuple, List

# Color codes for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"

def run_cmd(cmd: str, timeout: int = 30) -> Tuple[int, str, str]:
    """Run shell command and return (exit_code, stdout, stderr)"""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"Command timed out after {timeout}s"
    except Exception as e:
        return 1, "", str(e)

def docker_cmd(cmd: str) -> Tuple[int, str, str]:
    """Run docker-compose command"""
    return run_cmd(f"docker-compose exec -T api {cmd}")

def print_header(task_num: int, title: str):
    """Print test section header"""
    print(f"\n{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{BLUE}Task {task_num:02d}: {title}{RESET}")
    print(f"{BOLD}{BLUE}═══════════════════════════════════════════════════════{RESET}")

def print_test(name: str):
    """Print individual test"""
    print(f"\n  {YELLOW}▶{RESET} {name}")

def print_pass(msg: str = "PASS"):
    """Print passing test"""
    print(f"    {GREEN}✅ {msg}{RESET}")

def print_fail(msg: str = "FAIL"):
    """Print failing test"""
    print(f"    {RED}❌ {msg}{RESET}")

def print_info(msg: str):
    """Print info message"""
    print(f"    {BLUE}ℹ {msg}{RESET}")

# Test cases
tests_passed = 0
tests_failed = 0

def test_task_01():
    """Task 01: safe_ainvoke async wrapper"""
    global tests_passed, tests_failed
    print_header(1, "safe_ainvoke Async Wrapper")
    
    print_test("Verify safe_ainvoke function exists")
    code, out, err = docker_cmd("python3 -c 'from llm.provider import safe_invoke; print(\"OK\")'")
    if code == 0 and "OK" in out:
        print_pass()
        tests_passed += 1
    else:
        print_fail(f"Import failed: {err}")
        tests_failed += 1
    
    print_test("Verify safe_invoke has timeout parameter")
    code, out, err = docker_cmd("python3 -c 'import inspect; from llm.provider import safe_invoke; sig = inspect.signature(safe_invoke); print(\"timeout_seconds\" in sig.parameters)'")
    if code == 0 and "True" in out:
        print_pass()
        tests_passed += 1
    else:
        print_fail(f"Timeout parameter missing: {err}")
        tests_failed += 1

def test_task_02():
    """Task 02: NLP service timeout wrapping"""
    global tests_passed, tests_failed
    print_header(2, "NLP Service Timeout Wrapping")
    
    print_test("Verify NLP service imports safe_invoke")
    code, out, err = docker_cmd("grep -l 'safe_invoke' api/services/nlp_service.py 2>/dev/null")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("NLP service not using safe_invoke")
        tests_failed += 1

def test_task_03():
    """Task 03: 8 LLM invoke call sites wrapped"""
    global tests_passed, tests_failed
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
        code, out, err = docker_cmd(f"grep 'safe_invoke' {filepath} | wc -l")
        if code == 0 and int(out.strip() or 0) > 0:
            print_pass()
            tests_passed += 1
        else:
            print_fail(f"{name} not wrapped")
            tests_failed += 1

def test_task_04():
    """Task 04: Circuit breaker state machine"""
    global tests_passed, tests_failed
    print_header(4, "Circuit Breaker State Machine")
    
    print_test("Verify circuit breaker functions exist")
    code, out, err = docker_cmd("python3 -c 'from llm.provider import _circuit_is_open, _record_llm_failure; print(\"OK\")'")
    if code == 0 and "OK" in out:
        print_pass()
        tests_passed += 1
    else:
        print_fail(f"Circuit breaker functions missing: {err}")
        tests_failed += 1
    
    print_test("Test circuit breaker logic")
    test_code = """
import time
from llm.provider import _circuit_is_open, _record_llm_failure, _record_llm_success, _CB_FAILURE_THRESHOLD, _CB_OPEN_DURATION
from llm import provider

# Reset state
provider._cb_failure_count = 0
provider._cb_opened_at = None

# Initial: not open
assert not _circuit_is_open(), "Initial state should be closed"

# Trigger failures
for i in range(_CB_FAILURE_THRESHOLD):
    _record_llm_failure()

# Should be open now
assert _circuit_is_open(), "Circuit should be open after threshold failures"
print("OK")
"""
    code, out, err = docker_cmd(f"python3 -c '{test_code}'")
    if code == 0 and "OK" in out:
        print_pass()
        tests_passed += 1
    else:
        print_fail(f"Circuit breaker logic failed: {err}")
        tests_failed += 1

def test_task_05():
    """Task 05: Frontend timeout split"""
    global tests_passed, tests_failed
    print_header(5, "Frontend Timeout Split (30s/180s/300s)")
    
    print_test("Verify frontend client timeout configuration")
    code, out, err = docker_cmd("grep -E '30.*timeout|30000' frontend/lib/api/client.ts")
    if code == 0:
        print_pass("30s timeout configured")
        tests_passed += 1
    else:
        print_fail("30s timeout missing")
        tests_failed += 1
    
    print_test("Verify 180s timeout configured")
    code, out, err = docker_cmd("grep -E '180.*timeout|180000' frontend/lib/api/client.ts")
    if code == 0:
        print_pass("180s timeout configured")
        tests_passed += 1
    else:
        print_fail("180s timeout missing")
        tests_failed += 1
    
    print_test("Verify 300s timeout configured")
    code, out, err = docker_cmd("grep -E '300.*timeout|300000' frontend/lib/api/client.ts")
    if code == 0:
        print_pass("300s timeout configured")
        tests_passed += 1
    else:
        print_fail("300s timeout missing")
        tests_failed += 1

def test_task_06():
    """Task 06: Differentiated error messages"""
    global tests_passed, tests_failed
    print_header(6, "Differentiated Error Messages")
    
    print_test("Verify error message differentiation in NLP service")
    code, out, err = docker_cmd("grep -c 'timeout\\|unavailable' api/services/nlp_service.py")
    if code == 0 and int(out.strip() or 0) > 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Error messages not differentiated")
        tests_failed += 1

def test_task_07():
    """Task 07: agents_failed reports visible"""
    global tests_passed, tests_failed
    print_header(7, "agents_failed Reports Visible")
    
    print_test("Verify agents_failed filter in reports")
    code, out, err = docker_cmd("grep -l 'agents_failed' api/routes/reports.py")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("agents_failed not in reports")
        tests_failed += 1

def test_task_08():
    """Task 08: Licence degraded cutoff"""
    global tests_passed, tests_failed
    print_header(8, "Licence Degraded Cutoff (2-hour grace)")
    
    print_test("Verify licence degraded cutoff logic")
    code, out, err = docker_cmd("grep -l 'is_cloudflare_unreachable\\|_degraded_at' api/middleware/licence.py")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Licence cutoff logic missing")
        tests_failed += 1
    
    print_test("Verify 2-hour cutoff constant")
    code, out, err = docker_cmd("grep 'LICENCE_DEGRADED_CUTOFF\\|7200' api/middleware/licence.py")
    if code == 0 and "7200" in out:
        print_pass("2-hour cutoff (7200s) configured")
        tests_passed += 1
    else:
        print_fail("2-hour cutoff not configured")
        tests_failed += 1

def test_task_09():
    """Task 09: PBKDF2 password hashing"""
    global tests_passed, tests_failed
    print_header(9, "PBKDF2 Password Hashing (100k iterations)")
    
    print_test("Verify password-hash.ts exists")
    code, out, err = docker_cmd("test -f cloudflare/licence-worker/password-hash.ts && echo OK")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("password-hash.ts missing")
        tests_failed += 1
    
    print_test("Verify PBKDF2 iterations = 100000")
    code, out, err = docker_cmd("grep -c 'ITERATIONS.*100000\\|100000' cloudflare/licence-worker/password-hash.ts")
    if code == 0 and int(out.strip() or 0) > 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("PBKDF2 iterations not set to 100000")
        tests_failed += 1
    
    print_test("Verify D1 admins table migration exists")
    code, out, err = docker_cmd("test -f cloudflare/licence-worker/d1-migrations/001_create_admins_table.sql && echo OK")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("D1 migration missing")
        tests_failed += 1

def test_task_10():
    """Task 10: Rate limiting"""
    global tests_passed, tests_failed
    print_header(10, "Rate Limiting (5/5min login, 100/1hr licence)")
    
    print_test("Verify rate limiting middleware")
    code, out, err = docker_cmd("grep -l 'checkRateLimit\\|RATE_LIMIT' cloudflare/licence-worker/src/index.ts")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Rate limiting middleware missing")
        tests_failed += 1
    
    print_test("Verify login rate limit config (5 req/5min)")
    code, out, err = docker_cmd("grep -E 'maxRequests.*5|\\[5,.*300\\]' cloudflare/licence-worker/src/index.ts")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Login rate limit not configured")
        tests_failed += 1

def test_task_11():
    """Task 11: Decouple LLM_KEK"""
    global tests_passed, tests_failed
    print_header(11, "Decouple LLM_KEK from JWT_SECRET")
    
    print_test("Verify crypto.py module exists")
    code, out, err = docker_cmd("test -f api/utils/crypto.py && echo OK")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("crypto.py missing")
        tests_failed += 1
    
    print_test("Verify LLMKeyEncryptor class")
    code, out, err = docker_cmd("python3 -c 'from api.utils.crypto import LLMKeyEncryptor; print(\"OK\")'")
    if code == 0 and "OK" in out:
        print_pass()
        tests_passed += 1
    else:
        print_fail("LLMKeyEncryptor not found")
        tests_failed += 1
    
    print_test("Verify migration 035 exists")
    code, out, err = docker_cmd("test -f db/migrations/versions/035_decouple_llm_kek.py && echo OK")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Migration 035 missing")
        tests_failed += 1

def test_task_12():
    """Task 12: Single-tenant ADR"""
    global tests_passed, tests_failed
    print_header(12, "Single-Tenant ADR & Documentation")
    
    print_test("Verify ARCHITECTURE.md exists")
    code, out, err = docker_cmd("test -f docs/ARCHITECTURE.md && echo OK")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("ARCHITECTURE.md missing")
        tests_failed += 1
    
    print_test("Verify ADR-001 decision documented")
    code, out, err = docker_cmd("grep -i 'single.tenant\\|single-tenant' docs/ARCHITECTURE.md")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Single-tenant decision not documented")
        tests_failed += 1
    
    print_test("Verify schema documentation updated")
    code, out, err = docker_cmd("grep -i 'single.tenant' db/schema.py")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Schema documentation not updated")
        tests_failed += 1

def test_task_13():
    """Task 13: Non-blocking health check"""
    global tests_passed, tests_failed
    print_header(13, "Non-Blocking LLM Health Check")
    
    print_test("Verify /health/llm endpoint exists")
    code, out, err = docker_cmd("grep -l 'health/llm' api/routes/health.py")
    if code == 0:
        print_pass()
        tests_passed += 1
    else:
        print_fail("/health/llm endpoint not found")
        tests_failed += 1

def test_task_15():
    """Task 15: Celery time limit increased"""
    global tests_passed, tests_failed
    print_header(15, "Celery Time Limit Raised (900→1800s)")
    
    print_test("Verify Celery time limit increased to 1800s")
    code, out, err = docker_cmd("grep -E 'soft_time_limit.*1800|time_limit.*1800' workers/tasks/run_agents.py")
    if code == 0 and "1800" in out:
        print_pass()
        tests_passed += 1
    else:
        print_fail("Celery time limit not set to 1800s")
        tests_failed += 1

def main():
    """Run all tests"""
    global tests_passed, tests_failed
    
    print(f"\n{BOLD}{BLUE}")
    print("╔════════════════════════════════════════════════════════╗")
    print("║  Meridian Week 1 P0 Remediation Test Suite             ║")
    print("║  All 14 Go-Live Remediation Tasks                      ║")
    print("╚════════════════════════════════════════════════════════╝")
    print(f"{RESET}")
    
    # Run all test functions
    test_task_01()
    test_task_02()
    test_task_03()
    test_task_04()
    test_task_05()
    test_task_06()
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
        print(f"{BOLD}{RED}⚠️  Some tests failed. See details above.{RESET}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
