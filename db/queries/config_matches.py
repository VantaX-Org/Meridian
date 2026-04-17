from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession


async def get_config_matches(
    db: AsyncSession,
    version_id: str,
    tenant_id: str,
    module: str | None = None,
    classification: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> list[Row]:
    await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
    query = """
        SELECT * FROM config_matches
        WHERE version_id = :version_id
          AND tenant_id = :tenant_id
    """
    params: dict = {"version_id": version_id, "tenant_id": tenant_id}

    if module is not None:
        query += " AND module = :module"
        params["module"] = module
    if classification is not None:
        query += " AND classification = :classification"
        params["classification"] = classification

    query += " ORDER BY fix_priority ASC, module ASC, check_id ASC"
    query += " LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset

    result = await db.execute(text(query), params)
    return result.fetchall()


async def get_config_match_summary(
    db: AsyncSession,
    version_id: str,
    tenant_id: str,
) -> dict | None:
    await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
    result = await db.execute(
        text("""
            SELECT config_match_summary
            FROM analysis_versions
            WHERE id = :version_id
              AND tenant_id = :tenant_id
        """),
        {"version_id": version_id, "tenant_id": tenant_id},
    )
    row = result.fetchone()
    if row is None:
        return None
    return row[0]


async def get_config_matches_for_export(
    db: AsyncSession,
    version_id: str,
    tenant_id: str,
) -> list[Row]:
    await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
    result = await db.execute(
        text("""
            SELECT * FROM config_matches
            WHERE version_id = :version_id
              AND tenant_id = :tenant_id
            ORDER BY module ASC, fix_priority ASC, classification ASC
        """),
        {"version_id": version_id, "tenant_id": tenant_id},
    )
    return result.fetchall()
