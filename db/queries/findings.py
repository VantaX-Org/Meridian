import uuid
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import case, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.schema import Finding


class FindingCreate(BaseModel):
    module: str
    check_id: str
    severity: str
    dimension: str
    affected_count: int
    total_count: int
    pass_rate: float | None = None
    details: dict | None = None
    remediation_text: str | None = None
    rule_context: dict | None = None
    value_fix_map: dict | None = None
    record_fixes: list | None = None


async def bulk_insert_findings(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    findings: list[FindingCreate],
) -> int:
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    db_findings = [
        Finding(
            tenant_id=tenant_id,
            version_id=version_id,
            module=f.module,
            check_id=f.check_id,
            severity=f.severity,
            dimension=f.dimension,
            affected_count=f.affected_count,
            total_count=f.total_count,
            pass_rate=f.pass_rate,
            details=f.details,
            remediation_text=f.remediation_text,
            rule_context=f.rule_context,
            value_fix_map=f.value_fix_map,
            record_fixes=f.record_fixes,
        )
        for f in findings
    ]
    db.add_all(db_findings)
    await db.commit()
    return len(db_findings)


async def update_finding_remediation(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    check_id: str,
    version_id: uuid.UUID,
    remediation_text: str,
) -> int:
    """Update a finding's remediation_text field. Returns rows updated."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    result = await db.execute(
        text("""
            UPDATE findings
            SET remediation_text = :remediation_text
            WHERE tenant_id = :tenant_id
              AND version_id = :version_id
              AND check_id = :check_id
        """),
        {
            "remediation_text": remediation_text,
            "tenant_id": str(tenant_id),
            "version_id": str(version_id),
            "check_id": check_id,
        },
    )
    await db.commit()
    return result.rowcount


async def get_findings(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    severity: Optional[str] = None,
    module: Optional[str] = None,
) -> list[Finding]:
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    stmt = select(Finding).where(
        Finding.tenant_id == tenant_id,
        Finding.version_id == version_id,
    )
    if severity:
        stmt = stmt.where(Finding.severity == severity)
    if module:
        stmt = stmt.where(Finding.module == module)
    severity_order = case(
        (Finding.severity == "critical", 1),
        (Finding.severity == "high", 2),
        (Finding.severity == "medium", 3),
        (Finding.severity == "low", 4),
        else_=5,
    )
    stmt = stmt.order_by(severity_order, Finding.pass_rate.asc())
    result = await db.execute(stmt)
    return list(result.scalars().all())
