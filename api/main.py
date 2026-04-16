import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.routes.health import router as health_router
from api.routes.upload import router as upload_router
from api.routes.upload_match import router as upload_match_router
from api.routes.versions import router as versions_router
from api.routes.findings import router as findings_router
from api.routes.analyse import router as analyse_router
from api.routes.analysis_status import router as analysis_status_router
from api.routes.reports import router as reports_router
from api.routes.settings import router as settings_router
from api.routes.llm_settings import router as llm_settings_router
from api.routes.connect import router as connect_router
from api.routes.writeback import router as writeback_router
from api.routes.cleaning import router as cleaning_router
from api.routes.exceptions import router as exceptions_router
from api.routes.analytics import router as analytics_router
from api.routes.contracts import router as contracts_router
from api.routes.notifications import router as notifications_router
from api.routes.users import router as users_router
from api.routes.systems import router as systems_router
from api.routes.master_records import router as master_records_router
from api.routes.ai_feedback import router as ai_feedback_router
from api.routes.match_rules import router as match_rules_router
from api.routes.glossary import router as glossary_router
from api.routes.relationships import router as relationships_router
from api.routes.stewardship import router as stewardship_router
from api.routes.mdm_metrics import router as mdm_metrics_router
from api.routes.sync_trigger import router as sync_trigger_router
from api.routes.rules import router as rules_router
from api.routes.field_mappings import router as field_mappings_router
from api.routes.licence import router as licence_router
from api.routes.config_matches import router as config_matches_router
from api.routes.config_intelligence import router as config_intelligence_router
from api.routes.z_object_intelligence import router as z_object_intelligence_router
from api.routes.connectivity import router as connectivity_router
from api.routes.spro_config import router as spro_config_router
from api.routes.config_impact import router as config_impact_router
from api.routes.business_process import router as business_process_router
from api.routes.events import router as events_router

logger = logging.getLogger("meridian")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Meridian API starting")
    logger.info(f"LLM_PROVIDER: {settings.llm_provider}")
    logger.info(f"LICENCE_KEY: {'set' if settings.licence_key else 'not set'}")

    # Test LLM connection
    try:
        from llm.provider import test_llm_connection

        if test_llm_connection():
            logger.info("LLM connection: OK")
        else:
            logger.warning("LLM connection: FAILED — check LLM_PROVIDER config")
    except Exception as e:
        logger.warning(f"LLM connection: FAILED — {e}")

    # Ensure MinIO buckets exist
    try:
        from api.services.storage import ensure_buckets

        ensure_buckets()
        logger.info("MinIO buckets: OK")
    except Exception as e:
        logger.warning(f"MinIO bucket init failed: {e}")

    # Ensure dev tenant exists (local dev mode only)
    if settings.auth_mode == "local":
        try:
            from sqlalchemy import text
            from api.deps import engine, async_session_factory

            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT id FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001'")
                )
                if not result.scalar():
                    await session.execute(
                        text(
                            "INSERT INTO tenants (id, name, licensed_modules) "
                            "VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Tenant', "
                            "ARRAY['business_partner','material_master','fi_gl','accounts_payable',"
                            "'accounts_receivable','asset_accounting','mm_purchasing','plant_maintenance',"
                            "'production_planning','sd_customer_master','sd_sales_orders',"
                            "'employee_central','compensation','benefits','payroll_integration',"
                            "'performance_goals','succession_planning','recruiting_onboarding',"
                            "'learning_management','time_attendance',"
                            "'ewms_stock','ewms_transfer_orders','batch_management','mdg_master_data',"
                            "'grc_compliance','fleet_management','transport_management','wm_interface',"
                            "'cross_system_integration'])"
                        )
                    )
                    await session.commit()
                    logger.info("Dev tenant created")
                else:
                    logger.info("Dev tenant exists")

                # Ensure jwt_secret exists on the dev tenant for local auth
                secret_row = await session.execute(
                    text("SELECT jwt_secret FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001'")
                )
                if not secret_row.scalar():
                    from api.services.local_auth import generate_jwt_secret
                    await session.execute(
                        text(
                            "UPDATE tenants SET jwt_secret = :secret WHERE id = '00000000-0000-0000-0000-000000000001'"
                        ),
                        {"secret": generate_jwt_secret()},
                    )
                    await session.commit()
                    logger.info("Dev tenant jwt_secret generated")

                # Ensure at least one admin user exists for local auth
                user_count = await session.execute(
                    text("SELECT COUNT(*) FROM users WHERE tenant_id = '00000000-0000-0000-0000-000000000001'")
                )
                if user_count.scalar() == 0:
                    import uuid as _uuid
                    from api.services.local_auth import hash_password
                    default_pw = hash_password("admin")
                    await session.execute(
                        text(
                            "INSERT INTO users (id, tenant_id, email, name, role, password_hash, is_active) "
                            "VALUES (:id, '00000000-0000-0000-0000-000000000001', "
                            "'admin@meridian.local', 'Admin', 'admin', :pw, true)"
                        ),
                        {"id": str(_uuid.uuid4()), "pw": default_pw},
                    )
                    await session.commit()
                    logger.info("Default admin user created: admin@meridian.local / admin")
        except Exception as e:
            logger.warning(f"Dev tenant init failed: {e}")

    yield


app = FastAPI(title="Meridian API", version="1.0.0", lifespan=lifespan)

# Security headers middleware
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if "server" in response.headers:
            del response.headers["server"]
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Gzip compression for large JSON responses
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS — permissive because API port is internal-only (not publicly exposed).
# All browser traffic goes through the Next.js same-origin proxy on :3000.
_cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if _cors_origins else ["*"],
    allow_credentials=bool(_cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Licence middleware — checks /api/v1/* routes
from api.middleware.licence import LicenceMiddleware
from api.middleware.tenant import TenantMiddleware

app.add_middleware(LicenceMiddleware)
# Tenant middleware — resolves tenant_id and sets Postgres RLS context
app.add_middleware(TenantMiddleware)

# Local auth middleware — JWT verification when AUTH_MODE=local
if settings.auth_mode == "local":
    from api.middleware.local_auth import LocalAuthMiddleware
    app.add_middleware(LocalAuthMiddleware)

# Register routers
app.include_router(health_router)
app.include_router(upload_router)
app.include_router(upload_match_router)
app.include_router(versions_router)
app.include_router(findings_router)
app.include_router(analyse_router)
app.include_router(analysis_status_router)
app.include_router(reports_router)
app.include_router(settings_router)
app.include_router(llm_settings_router)
app.include_router(connect_router)
app.include_router(writeback_router)
app.include_router(cleaning_router)
app.include_router(exceptions_router)
app.include_router(analytics_router)
app.include_router(contracts_router)
app.include_router(notifications_router)
app.include_router(users_router)
app.include_router(systems_router)
app.include_router(master_records_router)
app.include_router(ai_feedback_router)
app.include_router(match_rules_router)
app.include_router(glossary_router)
app.include_router(relationships_router)
app.include_router(stewardship_router)
app.include_router(mdm_metrics_router)
app.include_router(sync_trigger_router)
app.include_router(rules_router)
app.include_router(field_mappings_router)
app.include_router(licence_router)
app.include_router(config_matches_router)
app.include_router(config_intelligence_router)
app.include_router(z_object_intelligence_router)
app.include_router(connectivity_router)
app.include_router(spro_config_router)
app.include_router(config_impact_router)
app.include_router(business_process_router)
app.include_router(events_router)

from api.routes.auth import router as auth_router
app.include_router(auth_router)
