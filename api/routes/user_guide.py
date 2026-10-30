"""The user guide as a PDF, for every signed-in user (the help panel shows the same chapters)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from api.server_error import server_failure
from api.deps import Tenant, get_tenant
from api.services import user_guide

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["docs"])


@router.get("/docs/user-guide.pdf")
async def user_guide_pdf(tenant: Tenant = Depends(get_tenant)) -> Response:  # noqa: ARG001 - sign-in only
    try:
        pdf = await asyncio.to_thread(user_guide.build_pdf)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The user guide is not installed.") from None
    except Exception:
        raise server_failure("The user guide could not be generated.", log=logger, what="user_guide") from None
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="meridian_user_guide.pdf"'})
