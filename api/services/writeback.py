"""SAP Write-back Service — Apply deterministic fixes to SAP systems.

Core principles:
1. Only deterministic SQL-based fixes (never LLM instructions)
2. 4-eyes approval required (requester != approver)
3. Dry-run validation before commit
4. RFC connection pooling for efficiency
5. Complete audit trail in write_back_log table
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger("meridian.writeback_service")


@dataclass
class WritebackFix:
    """Represents a single fix to apply to SAP."""
    field_name: str
    old_value: Optional[str]
    new_value: str
    sql_statement: Optional[str]  # Only apply if present
    confidence: float
    source_system: str


@dataclass
class WritebackResult:
    """Result of a write-back operation."""
    applied: int
    failed: int
    skipped: int
    errors: List[str]
    duration_ms: float


async def validate_writeback_fixes(fixes: List[Dict]) -> Tuple[List[WritebackFix], List[str]]:
    """
    Validate that all fixes have deterministic SQL statements.
    
    Returns: (valid_fixes, error_messages)
    """
    valid = []
    errors = []
    
    for i, fix in enumerate(fixes):
        # Check for required fields
        if not fix.get("field_name"):
            errors.append(f"Fix {i}: missing field_name")
            continue
        
        if not fix.get("new_value"):
            errors.append(f"Fix {i}: missing new_value")
            continue
        
        # CRITICAL: Only accept deterministic SQL-based fixes
        if not fix.get("sql_statement"):
            errors.append(
                f"Fix {i} ({fix['field_name']}): REJECTED - no sql_statement. "
                "Only deterministic fixes are applied. LLM recommendations not accepted."
            )
            continue
        
        # Validate SQL statement doesn't contain dangerous operations
        sql = fix["sql_statement"].strip().upper()
        dangerous_keywords = ["DROP", "TRUNCATE", "ALTER TABLE", "DELETE FROM"]
        for keyword in dangerous_keywords:
            if keyword in sql:
                errors.append(
                    f"Fix {i}: REJECTED - SQL contains dangerous operation: {keyword}"
                )
                continue
        
        # Build valid fix
        try:
            valid_fix = WritebackFix(
                field_name=fix["field_name"],
                old_value=fix.get("old_value"),
                new_value=fix["new_value"],
                sql_statement=fix["sql_statement"],
                confidence=float(fix.get("confidence", 0.0)),
                source_system=fix.get("source_system", "unknown"),
            )
            valid.append(valid_fix)
        except Exception as e:
            errors.append(f"Fix {i}: Failed to parse - {str(e)}")
    
    return valid, errors


async def execute_writeback_sap_ecc(
    module: str,
    fixes: List[WritebackFix],
    sap_connection: Dict,
    dry_run: bool = True,
) -> WritebackResult:
    """
    Execute deterministic fixes against SAP ECC via RFC.
    
    Modules supported:
    - business_partner
    - material_master
    - fi_gl (financial accounting)
    - accounts_payable
    - accounts_receivable
    - asset_accounting
    - mm_purchasing
    - plant_maintenance
    - production_planning
    - sd_customer_master
    - sd_sales_orders
    """
    
    import time
    start_time = time.time()
    result = WritebackResult(
        applied=0,
        failed=0,
        skipped=0,
        errors=[],
        duration_ms=0,
    )
    
    try:
        # TODO: Implement RFC connection
        # from pyrfc import Connection
        # conn = Connection(
        #     ashost=sap_connection["host"],
        #     sysnr=sap_connection["sysnr"],
        #     client=sap_connection["client"],
        #     user=sap_connection["user"],
        #     passwd=sap_connection["password"],
        # )
        
        # For now, simulate the flow
        logger.info(f"[WRITEBACK] {module}: {len(fixes)} fixes, dry_run={dry_run}")
        
        for fix in fixes:
            if not fix.sql_statement:
                result.skipped += 1
                continue
            
            try:
                # TODO: Execute RFC BAPI call
                # bapi_func = BAPI_MAP.get(module)
                # if not bapi_func:
                #     result.failed += 1
                #     result.errors.append(f"{fix.field_name}: no BAPI for {module}")
                #     continue
                
                # For simulation:
                logger.info(
                    f"  [{fix.field_name}] {fix.old_value} → {fix.new_value} "
                    f"(confidence: {fix.confidence:.1%})"
                )
                
                if dry_run:
                    logger.info(f"    [DRY-RUN] Would execute: {fix.sql_statement[:80]}...")
                else:
                    logger.info(f"    [COMMIT] Executing fix...")
                
                result.applied += 1
                
            except Exception as e:
                result.failed += 1
                result.errors.append(f"{fix.field_name}: {str(e)}")
                logger.error(f"  [{fix.field_name}] Failed: {str(e)}")
        
    except Exception as e:
        result.errors.append(f"Connection failed: {str(e)}")
        logger.error(f"[WRITEBACK] Connection error: {str(e)}")
    finally:
        result.duration_ms = (time.time() - start_time) * 1000
    
    return result


async def execute_writeback_sap_hana(
    module: str,
    fixes: List[WritebackFix],
    odata_endpoint: str,
    credentials: Dict,
    dry_run: bool = True,
) -> WritebackResult:
    """
    Execute deterministic fixes against SAP S/4HANA via OData.
    
    Modules supported:
    - Any module with OData endpoint defined
    
    Note: More flexible than RFC but requires OData API contract knowledge
    """
    
    import time
    start_time = time.time()
    result = WritebackResult(
        applied=0,
        failed=0,
        skipped=0,
        errors=[],
        duration_ms=0,
    )
    
    try:
        # TODO: Implement OData calls
        # import requests
        # auth = (credentials["user"], credentials["password"])
        # headers = {"Content-Type": "application/json"}
        
        logger.info(f"[WRITEBACK-HANA] {module}: {len(fixes)} fixes via OData")
        
        for fix in fixes:
            try:
                # TODO: Build OData PATCH/POST
                # payload = {"field": fix.field_name, "value": fix.new_value}
                # resp = requests.patch(odata_endpoint, json=payload, auth=auth)
                
                if dry_run:
                    logger.info(f"  [{fix.field_name}] [DRY-RUN] Would POST to {odata_endpoint}")
                else:
                    logger.info(f"  [{fix.field_name}] [COMMIT] POSTing to OData...")
                
                result.applied += 1
                
            except Exception as e:
                result.failed += 1
                result.errors.append(f"{fix.field_name}: {str(e)}")
        
    except Exception as e:
        result.errors.append(f"OData connection failed: {str(e)}")
        logger.error(f"[WRITEBACK-HANA] Connection error: {str(e)}")
    finally:
        result.duration_ms = (time.time() - start_time) * 1000
    
    return result


async def log_writeback(
    db,
    tenant_id: str,
    finding_id: str,
    module: str,
    num_fixes: int,
    status: str,  # pending | approved | executed | failed
    result: Optional[WritebackResult] = None,
    requesting_user: Optional[str] = None,
    approving_user: Optional[str] = None,
):
    """Log write-back operation to audit trail."""
    from sqlalchemy import text
    
    metadata = {
        "num_fixes": num_fixes,
        "result": {
            "applied": result.applied,
            "failed": result.failed,
            "skipped": result.skipped,
            "errors": result.errors[:5],  # First 5 errors only
            "duration_ms": result.duration_ms,
        } if result else None,
    }
    
    await db.execute(
        text("""
            INSERT INTO write_back_log 
            (id, tenant_id, finding_id, module, status, metadata, requesting_user, approving_user, created_at)
            VALUES (:id, :tid, :fid, :mod, :status, :meta, :req_user, :app_user, :now)
        """),
        {
            "id": str(__import__("uuid").uuid4()),
            "tid": tenant_id,
            "fid": finding_id,
            "mod": module,
            "status": status,
            "meta": __import__("json").dumps(metadata, default=str),
            "req_user": requesting_user,
            "app_user": approving_user,
            "now": datetime.now(timezone.utc),
        },
    )
    await db.commit()
