"""Column matching endpoint — detects SAP module and maps uploaded columns to TABLE.FIELD."""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.deps import Tenant, get_tenant
from api.services.ai_column_matcher import detect_module_and_match

router = APIRouter(prefix="/api/v1", tags=["upload"])
logger = logging.getLogger("meridian.upload_match")


class MatchRequest(BaseModel):
    headers: list[str]
    sample_rows: list[list[str]]
    filename: str
    module_hint: str | None = None


class ColumnMappingItem(BaseModel):
    source_column: str
    target_field: str | None
    confidence: float
    is_required: bool
    match_type: str


class MatchResponse(BaseModel):
    detected_module: str
    module_confidence: float
    module_label: str
    mappings: list[ColumnMappingItem]
    unmapped_required: list[str]
    available_modules: list[dict[str, str]]


@router.post("/upload/match", response_model=MatchResponse)
async def match_columns(
    body: MatchRequest,
    tenant: Tenant = Depends(get_tenant),
):
    """Detect SAP module and map CSV/Excel columns to expected TABLE.FIELD format.

    Deterministic matching (exact, alias, short-name) runs first.
    LLM is only called for remaining unmatched columns.
    """
    logger.info(
        f"Column match request: tenant={tenant.id} headers={len(body.headers)} "
        f"filename={body.filename} hint={body.module_hint}"
    )

    result = detect_module_and_match(
        headers=body.headers,
        sample_rows=body.sample_rows,
        filename=body.filename,
        module_hint=body.module_hint,
    )

    logger.info(
        f"Column match result: module={result['detected_module']} "
        f"confidence={result['module_confidence']} "
        f"mapped={sum(1 for m in result['mappings'] if m['target_field'])} "
        f"unmapped_required={len(result['unmapped_required'])}"
    )

    return result
