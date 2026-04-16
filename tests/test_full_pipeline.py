"""Full end-to-end pipeline test: upload CSV → run checks → verify findings."""

import io
import time

import httpx
import pytest

from tests.fixtures.synthetic_sap_data import generate_business_partner

API_BASE = "http://localhost:8000"
TIMEOUT = 120


@pytest.mark.skipif(
    not __import__("os").environ.get("MERIDIAN_INTEGRATION"),
    reason="Integration test — set MERIDIAN_INTEGRATION=1 to run",
)
def test_full_pipeline():
    """Upload synthetic BP data, wait for checks, verify findings and DQS."""
    # Step 1: Generate synthetic BP data
    df = generate_business_partner(1000)
    print(f"\nGenerated {len(df)} synthetic BP rows")

    # Step 2: Save as CSV
    csv_buffer = io.BytesIO()
    df.to_csv(csv_buffer, index=False)
    csv_bytes = csv_buffer.getvalue()

    # Step 3: Upload to API
    with httpx.Client(base_url=API_BASE, timeout=30) as client:
        response = client.post(
            "/api/v1/upload",
            files={"file": ("business_partner.csv", csv_bytes, "text/csv")},
            data={"module": "business_partner"},
        )
        assert response.status_code == 200, f"Upload failed: {response.text}"
        upload_result = response.json()
        version_id = upload_result["version_id"]
        print(f"Upload successful: version_id={version_id}")

        # Step 4: Poll for completion
        start = time.time()
        status = "pending"
        # Wait for checks to complete (status transitions: pending → running → complete → agents_running → agents_complete/agents_failed)
        terminal_statuses = {"complete", "agents_complete", "agents_failed", "failed"}
        while status not in terminal_statuses and (time.time() - start) < TIMEOUT:
            time.sleep(2)
            resp = client.get(f"/api/v1/versions/{version_id}/status")
            assert resp.status_code == 200
            status = resp.json()["status"]
            print(f"  Status: {status} ({int(time.time() - start)}s)")

        # Accept "complete" (checks done, agents not yet started) or "agents_complete" or "agents_failed"
        # The check engine itself must succeed — agents may fail in test env (no LLM available)
        assert status in ("complete", "agents_complete", "agents_failed"), (
            f"Pipeline did not complete within {TIMEOUT}s — status: {status}"
        )

        # Step 5: Fetch critical findings
        resp = client.get(f"/api/v1/findings?version_id={version_id}&severity=critical")
        assert resp.status_code == 200
        findings_data = resp.json()
        critical_findings = findings_data["findings"]

        # Step 6: Assert critical findings exist
        assert len(critical_findings) > 0, "Expected critical findings from dirty data"
        for f in critical_findings:
            assert f["severity"] == "critical"
            assert f["pass_rate"] is not None

        # Check pass_rate < 100 for at least one critical finding
        has_failing = any(f["pass_rate"] < 100 for f in critical_findings)
        assert has_failing, "Expected at least one critical finding with pass_rate < 100"

        # Step 7: Check DQS composite score
        resp = client.get(f"/api/v1/versions/{version_id}")
        assert resp.status_code == 200
        version_detail = resp.json()
        dqs_summary = version_detail.get("dqs_summary", {})
        assert "business_partner" in dqs_summary, "Expected business_partner in DQS summary"

        bp_dqs = dqs_summary["business_partner"]
        composite = bp_dqs.get("composite_score", 100)
        assert composite < 85, f"Expected DQS < 85 due to critical failures, got {composite}"

        # Step 8: Print summary
        all_resp = client.get(f"/api/v1/findings?version_id={version_id}&limit=200")
        all_findings = all_resp.json()["findings"]

        severity_counts = {}
        for f in all_findings:
            sev = f["severity"]
            severity_counts[sev] = severity_counts.get(sev, 0) + 1

        print("\n=== Pipeline Test Summary ===")
        print(f"Total checks run: {len(all_findings)}")
        print(f"Findings by severity: {severity_counts}")
        print(f"DQS composite score (business_partner): {composite}")
        print(f"Critical findings: {len(critical_findings)}")
        print(f"Capped: {bp_dqs.get('capped', False)}")
        print(f"Cap reason: {bp_dqs.get('cap_reason', 'N/A')}")
        print("=============================\n")


if __name__ == "__main__":
    test_full_pipeline()
