"""
Meridian database schema for single-tenant deployments.

ARCHITECTURE: Single-tenant per deployment
  - Each customer gets their own PostgreSQL database instance
  - The tenants table contains ONE row (the customer's tenant record)
  - No multi-tenant isolation logic needed in application code
  - RLS policies exist for defense-in-depth (app.tenant_id session variable)
  
See: docs/ARCHITECTURE.md for detailed design rationale.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy import Float


class Base(DeclarativeBase):
    pass


class Tenant(Base):
    """Meridian customer tenant (single row per deployment).
    
    In single-tenant architecture, this table contains exactly one row:
    the customer who owns this deployed instance.
    """
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    licensed_modules = Column(ARRAY(Text), nullable=False, server_default="{}")
    dqs_weights = Column(JSONB, nullable=True)
    alert_thresholds = Column(JSONB, nullable=True)
    stripe_customer_id = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    jwt_secret = Column(Text, nullable=True)
    default_role = Column(Text, nullable=True, server_default="analyst")
    llm_config = Column(JSONB, nullable=True)

    versions = relationship("AnalysisVersion", back_populates="tenant")
    findings = relationship("Finding", back_populates="tenant")
    users = relationship("User", back_populates="tenant")
    notifications = relationship("Notification", back_populates="tenant")


class AnalysisVersion(Base):
    __tablename__ = "analysis_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    run_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    label = Column(Text, nullable=True)
    dqs_summary = Column(JSONB, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    status = Column(
        String(20), nullable=False, server_default="pending"
    )

    config_match_summary = Column(JSONB, nullable=True)

    tenant = relationship("Tenant", back_populates="versions")
    findings = relationship("Finding", back_populates="version")
    config_matches = relationship("ConfigMatch", back_populates="version")


class Finding(Base):
    __tablename__ = "findings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    module = Column(Text, nullable=False)
    check_id = Column(Text, nullable=False)
    severity = Column(Text, nullable=False)
    dimension = Column(Text, nullable=False)
    affected_count = Column(Integer, nullable=False, server_default="0")
    total_count = Column(Integer, nullable=False, server_default="0")
    pass_rate = Column(Numeric, nullable=True)
    details = Column(JSONB, nullable=True)
    remediation_text = Column(Text, nullable=True)
    rule_context = Column(JSONB, nullable=True)
    value_fix_map = Column(JSONB, nullable=True)
    record_fixes = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    version = relationship("AnalysisVersion", back_populates="findings")
    tenant = relationship("Tenant", back_populates="findings")

    __table_args__ = (
        UniqueConstraint("version_id", "check_id", "tenant_id", name="uq_findings_version_check_tenant"),
        Index("ix_findings_tenant_version", "tenant_id", "version_id"),
        Index("ix_findings_tenant_module_severity", "tenant_id", "module", "severity"),
    )


class ConfigMatch(Base):
    __tablename__ = "config_matches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    module = Column(Text, nullable=False)
    check_id = Column(Text, nullable=False)
    record_key = Column(Text, nullable=True)
    field = Column(Text, nullable=True)
    actual_value = Column(Text, nullable=True)
    std_rule_expectation = Column(Text, nullable=True)
    classification = Column(Text, nullable=False)
    config_evidence = Column(Text, nullable=True)
    recommended_action = Column(Text, nullable=True)
    sap_tcode = Column(Text, nullable=True)
    fix_priority = Column(Integer, nullable=True, server_default="2")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    version = relationship("AnalysisVersion", back_populates="config_matches")

    __table_args__ = (
        Index("ix_config_matches_version", "version_id", "tenant_id"),
        Index("ix_config_matches_classification", "tenant_id", "classification"),
        Index("ix_config_matches_module", "tenant_id", "module"),
    )


class Report(Base):
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_versions.id"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    report_json = Column(JSONB, nullable=True)
    pdf_path = Column(Text, nullable=True)
    generated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        Index("ix_reports_tenant_version", "tenant_id", "version_id"),
    )


class CleaningRule(Base):
    __tablename__ = "cleaning_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_type = Column(Text, nullable=False)
    category = Column(Text, nullable=False)  # dedup|standardisation|enrichment|validation|lifecycle
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    detection_logic = Column(Text, nullable=True)
    correction_logic = Column(Text, nullable=True)
    risk_level = Column(Text, nullable=False, server_default="medium")
    automation_level = Column(Text, nullable=False, server_default="single_approval")
    approval_required = Column(Boolean, nullable=False, server_default="true")
    is_active = Column(Boolean, nullable=False, server_default="true")
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class CleaningQueue(Base):
    __tablename__ = "cleaning_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("cleaning_rules.id"), nullable=True)
    object_type = Column(Text, nullable=False)
    status = Column(Text, nullable=False, server_default="detected")
    confidence = Column(Numeric, nullable=True)
    record_key = Column(Text, nullable=False)
    record_data_before = Column(JSONB, nullable=True)
    record_data_after = Column(JSONB, nullable=True)
    survivor_key = Column(Text, nullable=True)
    merge_preview = Column(JSONB, nullable=True)
    priority = Column(Integer, nullable=False, server_default="50")
    assigned_to = Column(UUID(as_uuid=True), nullable=True)
    detected_at = Column(DateTime(timezone=True), server_default=text("now()"))
    approved_by = Column(UUID(as_uuid=True), nullable=True)
    applied_at = Column(DateTime(timezone=True), nullable=True)
    rollback_deadline = Column(DateTime(timezone=True), nullable=True)
    batch_id = Column(UUID(as_uuid=True), nullable=True)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_cleaning_queue_tenant_status", "tenant_id", "status"),
        Index("ix_cleaning_queue_tenant_object", "tenant_id", "object_type"),
    )


class CleaningAudit(Base):
    __tablename__ = "cleaning_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    queue_id = Column(UUID(as_uuid=True), ForeignKey("cleaning_queue.id"), nullable=False)
    rule_id = Column(UUID(as_uuid=True), nullable=True)
    action = Column(Text, nullable=False)
    actor_id = Column(UUID(as_uuid=True), nullable=True)
    actor_name = Column(Text, nullable=True)
    record_key = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False)
    data_before = Column(JSONB, nullable=True)
    data_after = Column(JSONB, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_cleaning_audit_tenant_queue", "tenant_id", "queue_id"),
    )


class DedupCandidate(Base):
    __tablename__ = "dedup_candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    object_type = Column(Text, nullable=False)
    record_key_a = Column(Text, nullable=False)
    record_key_b = Column(Text, nullable=False)
    match_score = Column(Numeric, nullable=False)
    match_method = Column(Text, nullable=False)
    match_fields = Column(JSONB, nullable=True)
    status = Column(Text, nullable=False, server_default="pending")
    survivor_key = Column(Text, nullable=True)
    merged_at = Column(DateTime(timezone=True), nullable=True)
    merged_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_dedup_candidates_tenant_object", "tenant_id", "object_type"),
    )


class CleaningMetric(Base):
    __tablename__ = "cleaning_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period = Column(Text, nullable=False)
    period_type = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False)
    detected = Column(Integer, nullable=False, server_default="0")
    recommended = Column(Integer, nullable=False, server_default="0")
    approved = Column(Integer, nullable=False, server_default="0")
    rejected = Column(Integer, nullable=False, server_default="0")
    applied = Column(Integer, nullable=False, server_default="0")
    verified = Column(Integer, nullable=False, server_default="0")
    rolled_back = Column(Integer, nullable=False, server_default="0")
    auto_approved = Column(Integer, nullable=False, server_default="0")
    avg_review_hours = Column(Numeric, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", "period_type", "object_type", name="uq_cleaning_metrics_tenant_period"),
    )


class StewardMetric(Base):
    __tablename__ = "steward_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    period = Column(Text, nullable=False)
    items_processed = Column(Integer, nullable=False, server_default="0")
    items_approved = Column(Integer, nullable=False, server_default="0")
    items_rejected = Column(Integer, nullable=False, server_default="0")
    items_applied = Column(Integer, nullable=False, server_default="0")
    total_review_hours = Column(Numeric, nullable=False, server_default="0")
    exceptions_resolved = Column(Integer, nullable=False, server_default="0")
    dqs_impact = Column(Numeric, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


# ── Phase B: Exception management ────────────────────────────────────────────


class Exception_(Base):
    __tablename__ = "exceptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    type = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    severity = Column(Text, nullable=False)
    status = Column(Text, nullable=False, server_default="open")
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    source_system = Column(Text, nullable=True)
    source_reference = Column(Text, nullable=True)
    affected_records = Column(JSONB, nullable=True)
    estimated_impact_zar = Column(Numeric, nullable=True)
    assigned_to = Column(UUID(as_uuid=True), nullable=True)
    escalation_tier = Column(Integer, nullable=False, server_default="1")
    sla_deadline = Column(DateTime(timezone=True), nullable=True)
    root_cause_category = Column(Text, nullable=True)
    resolution_type = Column(Text, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    linked_finding_id = Column(UUID(as_uuid=True), ForeignKey("findings.id"), nullable=True)
    linked_cleaning_id = Column(UUID(as_uuid=True), ForeignKey("cleaning_queue.id"), nullable=True)
    billing_tier = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)

    comments = relationship("ExceptionComment", back_populates="exception")

    __table_args__ = (
        Index("ix_exceptions_tenant_status", "tenant_id", "status"),
        Index("ix_exceptions_tenant_type", "tenant_id", "type"),
        Index("ix_exceptions_tenant_severity", "tenant_id", "severity"),
        Index("ix_exceptions_sla_deadline", "sla_deadline"),
    )


class ExceptionComment(Base):
    __tablename__ = "exception_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exception_id = Column(UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    user_name = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    exception = relationship("Exception_", back_populates="comments")

    __table_args__ = (
        Index("ix_exception_comments_exception", "exception_id"),
    )


class ExceptionRule(Base):
    __tablename__ = "exception_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    rule_type = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False)
    condition = Column(Text, nullable=False)
    severity = Column(Text, nullable=False)
    auto_assign_to = Column(UUID(as_uuid=True), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="false")
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_exception_rules_tenant", "tenant_id"),
    )


class ExceptionBilling(Base):
    __tablename__ = "exception_billing"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period = Column(Text, nullable=False)
    tier1_count = Column(Integer, nullable=False, server_default="0")
    tier2_count = Column(Integer, nullable=False, server_default="0")
    tier3_count = Column(Integer, nullable=False, server_default="0")
    tier4_count = Column(Integer, nullable=False, server_default="0")
    tier1_amount = Column(Numeric, nullable=False, server_default="0")
    tier2_amount = Column(Numeric, nullable=False, server_default="0")
    tier3_amount = Column(Numeric, nullable=False, server_default="0")
    tier4_amount = Column(Numeric, nullable=False, server_default="0")
    base_fee = Column(Numeric, nullable=False, server_default="8000")
    total_amount = Column(Numeric, nullable=False, server_default="0")
    stripe_invoice_id = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_exception_billing_tenant_period"),
    )


# ── Phase C: Analytics ───────────────────────────────────────────────────────


class DqsHistory(Base):
    __tablename__ = "dqs_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    module_id = Column(Text, nullable=False)
    dqs_score = Column(Numeric, nullable=False)
    completeness = Column(Numeric, nullable=True)
    accuracy = Column(Numeric, nullable=True)
    consistency = Column(Numeric, nullable=True)
    timeliness = Column(Numeric, nullable=True)
    uniqueness = Column(Numeric, nullable=True)
    validity = Column(Numeric, nullable=True)
    finding_count = Column(Integer, nullable=False, server_default="0")
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_dqs_history_tenant_module_recorded", "tenant_id", "module_id", "recorded_at"),
    )


class ImpactRecord(Base):
    __tablename__ = "impact_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=False)
    category = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    annual_risk_zar = Column(Numeric, nullable=False, server_default="0")
    mitigated_zar = Column(Numeric, nullable=False, server_default="0")
    finding_count = Column(Integer, nullable=False, server_default="0")
    calculation_method = Column(Text, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_impact_records_tenant_version", "tenant_id", "version_id"),
    )


class CostAvoidance(Base):
    __tablename__ = "cost_avoidance"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period = Column(Text, nullable=False)
    subscription_cost_zar = Column(Numeric, nullable=False, server_default="0")
    risk_mitigated_zar = Column(Numeric, nullable=False, server_default="0")
    exceptions_value_zar = Column(Numeric, nullable=False, server_default="0")
    cleaning_value_zar = Column(Numeric, nullable=False, server_default="0")
    cumulative_roi_multiple = Column(Numeric, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", name="uq_cost_avoidance_tenant_period"),
    )


# ── Phase D: Contracts ──────────────────────────────────────────────────────


class Contract(Base):
    __tablename__ = "contracts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    producer = Column(Text, nullable=False)
    consumer = Column(Text, nullable=False)
    schema_contract = Column(JSONB, nullable=True)
    quality_contract = Column(JSONB, nullable=True)
    freshness_contract = Column(JSONB, nullable=True)
    volume_contract = Column(JSONB, nullable=True)
    status = Column(Text, nullable=False, server_default="draft")
    created_by = Column(UUID(as_uuid=True), nullable=True)
    approved_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    activated_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    compliance_history = relationship("ContractComplianceHistory", back_populates="contract")

    __table_args__ = (
        Index("ix_contracts_tenant_status", "tenant_id", "status"),
    )


class ContractComplianceHistory(Base):
    __tablename__ = "contract_compliance_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id"), nullable=False)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=True)
    completeness_actual = Column(Numeric, nullable=True)
    accuracy_actual = Column(Numeric, nullable=True)
    consistency_actual = Column(Numeric, nullable=True)
    timeliness_actual = Column(Numeric, nullable=True)
    uniqueness_actual = Column(Numeric, nullable=True)
    validity_actual = Column(Numeric, nullable=True)
    overall_compliant = Column(Boolean, nullable=False, server_default="false")
    violations = Column(JSONB, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    contract = relationship("Contract", back_populates="compliance_history")

    __table_args__ = (
        Index("ix_contract_compliance_tenant_contract_recorded", "tenant_id", "contract_id", "recorded_at"),
    )


# ── Phase F: RBAC & Notifications ─────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    clerk_user_id = Column(Text, nullable=True, unique=True)
    email = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    role = Column(Text, nullable=False, server_default="analyst")
    permissions = Column(JSONB, nullable=True)
    password_hash = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true")
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    tenant = relationship("Tenant", back_populates="users")
    notifications = relationship("Notification", back_populates="user")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    type = Column(Text, nullable=False)  # finding|cleaning|exception|approval|digest|warning
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    link = Column(Text, nullable=True)
    is_read = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    tenant = relationship("Tenant", back_populates="notifications")
    user = relationship("User", back_populates="notifications")

    __table_args__ = (
        Index("ix_notifications_tenant_user_read_created", "tenant_id", "user_id", "is_read", "created_at"),
    )


# ── Phase H: MDM Sync Engine & AI Foundation ────────────────────────────────


class SAPSystem(Base):
    __tablename__ = "sap_systems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    # RFC fields (nullable for cloud-only systems)
    host = Column(Text, nullable=True)
    client = Column(Text, nullable=True)
    sysnr = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    environment = Column(Text, nullable=False, server_default="DEV")
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    # Multi-system type support
    system_type = Column(Text, nullable=False, server_default="ecc")
    # Values: ecc, s4hana_onprem, s4hana_cloud, successfactors, concur, ariba, ewm, fieldglass, btp

    # Cloud-specific connection fields
    base_url = Column(Text, nullable=True)
    company_id = Column(Text, nullable=True)
    auth_type = Column(Text, nullable=True)  # basic, oauth2_client_credentials, oauth2_saml, api_key
    client_id_encrypted = Column(Text, nullable=True)
    client_secret_encrypted = Column(Text, nullable=True)
    token_url = Column(Text, nullable=True)
    api_key_encrypted = Column(Text, nullable=True)

    # Health tracking
    last_health_check = Column(DateTime(timezone=True), nullable=True)
    health_status = Column(Text, server_default="unknown")  # healthy, degraded, unreachable, auth_failed, unknown
    health_message = Column(Text, nullable=True)
    consecutive_failures = Column(Integer, server_default="0")

    # Config sync tracking
    config_last_synced_at = Column(DateTime(timezone=True), nullable=True)
    config_sync_status = Column(Text, server_default="never")  # never, syncing, synced, failed

    credentials = relationship("SystemCredential", back_populates="system", cascade="all, delete-orphan")
    sync_profiles = relationship("SyncProfile", back_populates="system", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_sap_systems_tenant", "tenant_id"),
    )


class SystemCredential(Base):
    __tablename__ = "system_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False)
    encrypted_password = Column(Text, nullable=False)
    key_version = Column(Integer, nullable=False, server_default="1")

    system = relationship("SAPSystem", back_populates="credentials")

    __table_args__ = (
        Index("ix_system_credentials_system", "system_id", unique=True),
    )


class SyncProfile(Base):
    __tablename__ = "sync_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False)
    domain = Column(Text, nullable=False)
    tables = Column(ARRAY(Text), nullable=False, server_default="{}")
    schedule_cron = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, server_default="true")
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    ai_anomaly_baseline = Column(JSONB, nullable=True)

    # Module-aware sync (Phase 033)
    modules = Column(ARRAY(Text), server_default="{}", nullable=True)
    sync_type = Column(Text, server_default="data", nullable=True)  # data, config, both
    extraction_mode = Column(Text, server_default="full", nullable=True)  # full, delta, sample
    max_rows = Column(Integer, server_default="0", nullable=True)  # 0 = unlimited

    system = relationship("SAPSystem", back_populates="sync_profiles")
    runs = relationship("SyncRun", back_populates="profile", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_sync_profiles_tenant", "tenant_id"),
        Index("ix_sync_profiles_system", "system_id"),
    )


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("sync_profiles.id", ondelete="CASCADE"), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    rows_extracted = Column(Integer, nullable=False, server_default="0")
    findings_delta = Column(Integer, nullable=False, server_default="0")
    golden_records_updated = Column(Integer, nullable=False, server_default="0")
    status = Column(Text, nullable=False, server_default="running")
    error_detail = Column(Text, nullable=True)
    ai_quality_score = Column(Float, nullable=True)
    anomaly_flags = Column(JSONB, nullable=True)

    profile = relationship("SyncProfile", back_populates="runs")

    __table_args__ = (
        Index("ix_sync_runs_tenant", "tenant_id"),
        Index("ix_sync_runs_profile", "profile_id"),
        Index("ix_sync_runs_tenant_status", "tenant_id", "status"),
    )


class AIFeedbackLog(Base):
    __tablename__ = "ai_feedback_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    queue_item_id = Column(UUID(as_uuid=True), nullable=False)
    steward_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    ai_recommendation = Column(Text, nullable=False)
    steward_decision = Column(Text, nullable=False)
    correction_reason = Column(Text, nullable=True)
    domain = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_ai_feedback_log_tenant", "tenant_id"),
    )


class AIProposedRule(Base):
    __tablename__ = "ai_proposed_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    domain = Column(Text, nullable=False)
    proposed_rule = Column(JSONB, nullable=False)
    rationale = Column(Text, nullable=False)
    supporting_correction_count = Column(Integer, nullable=False, server_default="0")
    status = Column(Text, nullable=False, server_default="pending")
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_ai_proposed_rules_tenant", "tenant_id"),
        Index("ix_ai_proposed_rules_tenant_status", "tenant_id", "status"),
    )


# ── Phase I: Golden Records ──────────────────────────────────────────────────


class MasterRecord(Base):
    __tablename__ = "master_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    domain = Column(Text, nullable=False)
    sap_object_key = Column(Text, nullable=False)
    golden_fields = Column(JSONB, nullable=False, server_default="{}")
    source_contributions = Column(JSONB, nullable=False, server_default="{}")
    overall_confidence = Column(Float, nullable=False, server_default="0.0")
    status = Column(Text, nullable=False, server_default="candidate")
    promoted_at = Column(DateTime(timezone=True), nullable=True)
    promoted_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    history = relationship("MasterRecordHistory", back_populates="master_record", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_master_records_tenant_domain_key", "tenant_id", "domain", "sap_object_key", unique=True),
        Index("ix_master_records_tenant_status", "tenant_id", "status"),
    )


class MasterRecordHistory(Base):
    __tablename__ = "master_record_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    master_record_id = Column(UUID(as_uuid=True), ForeignKey("master_records.id", ondelete="CASCADE"), nullable=False)
    changed_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    changed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    change_type = Column(Text, nullable=False)
    previous_fields = Column(JSONB, nullable=True)
    new_fields = Column(JSONB, nullable=True)
    ai_was_involved = Column(Boolean, nullable=False, server_default="false")
    ai_recommendation_accepted = Column(Boolean, nullable=True)

    master_record = relationship("MasterRecord", back_populates="history")

    __table_args__ = (
        Index("ix_master_record_history_tenant", "tenant_id"),
        Index("ix_master_record_history_record", "master_record_id"),
    )


class SurvivorshipRule(Base):
    __tablename__ = "survivorship_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    domain = Column(Text, nullable=False)
    field = Column(Text, nullable=False)
    rule_type = Column(Text, nullable=False, server_default="most_recent")
    trusted_sources = Column(ARRAY(Text), nullable=True)
    weight = Column(Integer, nullable=False, server_default="50")
    active = Column(Boolean, nullable=False, server_default="true")
    ai_inferred = Column(Boolean, nullable=False, server_default="false")

    __table_args__ = (
        Index("ix_survivorship_rules_tenant_domain", "tenant_id", "domain"),
    )


class LLMAuditLog(Base):
    __tablename__ = "llm_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    service_name = Column(Text, nullable=False)
    called_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    model_version = Column(Text, nullable=False)
    prompt_hash = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=False, server_default="0")
    latency_ms = Column(Integer, nullable=False, server_default="0")
    success = Column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        Index("ix_llm_audit_log_tenant", "tenant_id"),
        Index("ix_llm_audit_log_tenant_service", "tenant_id", "service_name"),
    )


# ── Phase J: Match & Merge Engine ────────────────────────────────────────────


class MatchRule(Base):
    __tablename__ = "match_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    domain = Column(Text, nullable=False)
    field = Column(Text, nullable=False)
    match_type = Column(Text, nullable=False)
    weight = Column(Integer, nullable=False, server_default="50")
    threshold = Column(Float, nullable=False, server_default="0.8")
    active = Column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        Index("ix_match_rules_tenant_domain", "tenant_id", "domain"),
    )


class MatchScore(Base):
    __tablename__ = "match_scores"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    candidate_a_key = Column(Text, nullable=False)
    candidate_b_key = Column(Text, nullable=False)
    domain = Column(Text, nullable=False)
    total_score = Column(Float, nullable=False)
    field_scores = Column(JSONB, nullable=False, server_default="{}")
    ai_semantic_score = Column(Float, nullable=True)
    auto_action = Column(Text, nullable=False)
    reviewed_by = Column(UUID(as_uuid=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_match_scores_tenant_domain", "tenant_id", "domain"),
        Index("ix_match_scores_tenant_action", "tenant_id", "auto_action"),
    )


# ── Phase K: Business Glossary ──────────────────────────────────────────────


class GlossaryTerm(Base):
    __tablename__ = "glossary_terms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    domain = Column(Text, nullable=False)
    sap_table = Column(Text, nullable=False)
    sap_field = Column(Text, nullable=False)
    technical_name = Column(Text, nullable=False)
    business_name = Column(Text, nullable=False)
    business_definition = Column(Text, nullable=True)
    why_it_matters = Column(Text, nullable=True)
    sap_impact = Column(Text, nullable=True)
    approved_values = Column(JSONB, nullable=True)
    mandatory_for_s4hana = Column(Boolean, nullable=False, server_default="false")
    rule_authority = Column(Text, nullable=True)
    data_steward_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_cycle_days = Column(Integer, nullable=False, server_default="90")
    last_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(Text, nullable=False, server_default="active")
    ai_drafted = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    term_rules = relationship("GlossaryTermRule", back_populates="term", cascade="all, delete-orphan")
    change_logs = relationship("GlossaryChangeLog", back_populates="term", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "sap_table", "sap_field", name="uq_glossary_terms_tenant_table_field"),
        Index("ix_glossary_terms_tenant_domain", "tenant_id", "domain"),
    )


class GlossaryTermRule(Base):
    __tablename__ = "glossary_term_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    term_id = Column(UUID(as_uuid=True), ForeignKey("glossary_terms.id", ondelete="CASCADE"), nullable=False)
    rule_id = Column(Text, nullable=False)
    domain = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    term = relationship("GlossaryTerm", back_populates="term_rules")

    __table_args__ = (
        UniqueConstraint("tenant_id", "term_id", "rule_id", name="uq_glossary_term_rules_tenant_term_rule"),
        Index("ix_glossary_term_rules_tenant_term", "tenant_id", "term_id"),
    )


class StewardshipQueueItem(Base):
    __tablename__ = "stewardship_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    item_type = Column(Text, nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=False)
    domain = Column(Text, nullable=False)
    priority = Column(Integer, nullable=False, server_default="3")
    due_at = Column(DateTime(timezone=True), nullable=True)
    assigned_to = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(Text, nullable=False, server_default="open")
    sla_hours = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    ai_recommendation = Column(Text, nullable=True)
    ai_confidence = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_stewardship_queue_priority", "tenant_id", "status", "priority", "due_at"),
    )


class GlossaryChangeLog(Base):
    __tablename__ = "glossary_change_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    term_id = Column(UUID(as_uuid=True), ForeignKey("glossary_terms.id", ondelete="CASCADE"), nullable=False)
    changed_by = Column(Text, nullable=False)
    changed_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    field_changed = Column(Text, nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    change_reason = Column(Text, nullable=True)

    term = relationship("GlossaryTerm", back_populates="change_logs")

    __table_args__ = (
        Index("ix_glossary_change_log_tenant", "tenant_id"),
        Index("ix_glossary_change_log_term", "term_id"),
    )


# ── Phase N: MDM Governance Metrics ──────────────────────────────────────────


class MdmMetric(Base):
    """Daily MDM health snapshot per tenant. RLS on tenant_id."""
    __tablename__ = "mdm_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    snapshot_date = Column(Date, nullable=False)
    domain = Column(Text, nullable=True)
    golden_record_count = Column(Integer, nullable=False, server_default="0")
    golden_record_coverage_pct = Column(Float, nullable=False, server_default="0.0")
    avg_match_confidence = Column(Float, nullable=False, server_default="0.0")
    steward_sla_compliance_pct = Column(Float, nullable=False, server_default="0.0")
    source_consistency_pct = Column(Float, nullable=False, server_default="0.0")
    mdm_health_score = Column(Float, nullable=False, server_default="0.0")
    backlog_count = Column(Integer, nullable=False, server_default="0")
    sync_coverage_pct = Column(Float, nullable=False, server_default="0.0")
    ai_narrative = Column(Text, nullable=True)
    ai_projected_score = Column(Float, nullable=True)
    ai_risk_flags = Column(JSONB, nullable=True)

    __table_args__ = (
        Index("ix_mdm_metrics_tenant_date", "tenant_id", "snapshot_date"),
    )


class RelationshipType(Base):
    """Reference table of known SAP cross-domain relationship types. No RLS — shared data."""
    __tablename__ = "relationship_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_table = Column(Text, nullable=False)
    to_table = Column(Text, nullable=False)
    relationship_type = Column(Text, nullable=False, unique=True)
    description = Column(Text, nullable=True)


class RecordRelationship(Base):
    """Cross-domain relationships between master records. RLS on tenant_id."""
    __tablename__ = "record_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    from_domain = Column(Text, nullable=False)
    from_key = Column(Text, nullable=False)
    to_domain = Column(Text, nullable=False)
    to_key = Column(Text, nullable=False)
    relationship_type = Column(Text, nullable=False)
    sap_link_table = Column(Text, nullable=True)
    discovered_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    active = Column(Boolean, nullable=False, server_default="true")
    ai_inferred = Column(Boolean, nullable=False, server_default="false")
    ai_confidence = Column(Float, nullable=True)
    impact_score = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "from_domain", "from_key", "to_domain", "to_key", "relationship_type",
            name="uq_record_relationships_pair",
        ),
        Index("ix_record_relationships_tenant", "tenant_id"),
        Index("ix_record_relationships_from", "tenant_id", "from_domain", "from_key"),
        Index("ix_record_relationships_to", "tenant_id", "to_domain", "to_key"),
    )


# ── Connectivity & Config Impact ──────────────────────────────────────────────


class ConfigImpactResult(Base):
    __tablename__ = "config_impact_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    feature = Column(Text, nullable=False)
    system = Column(Text, nullable=False)
    status = Column(Text, nullable=False)  # blocked, degraded, ok
    blocking_findings = Column(JSONB, server_default="[]")
    total_affected_records = Column(Integer, server_default="0")
    blocked_transactions = Column(JSONB, server_default="[]")
    opportunity_cost_summary = Column(Text, nullable=True)
    cross_system_dependencies = Column(JSONB, server_default="{}")
    spro_context = Column(JSONB, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("version_id", "tenant_id", "feature", name="uq_config_impact_version_feature"),
        Index("ix_config_impact_results_tenant", "tenant_id"),
        Index("ix_config_impact_results_version", "version_id", "tenant_id"),
    )


class ConfigSnapshot(Base):
    __tablename__ = "config_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False)
    module = Column(Text, nullable=False)
    config_table = Column(Text, nullable=False)
    config_data = Column(JSONB, nullable=False, server_default="[]")
    record_count = Column(Integer, server_default="0")
    source = Column(Text, nullable=False, server_default="live")  # live or baseline
    synced_at = Column(DateTime(timezone=True), server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "system_id", "module", "config_table", name="uq_config_snapshots_key"),
        Index("ix_config_snapshots_tenant_system", "tenant_id", "system_id"),
        Index("ix_config_snapshots_module", "tenant_id", "module"),
    )


class SystemModuleMap(Base):
    __tablename__ = "system_module_map"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False)
    module = Column(Text, nullable=False)
    enabled = Column(Boolean, server_default="true")
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_status = Column(Text, nullable=True)
    row_count = Column(Integer, server_default="0")
    config_synced = Column(Boolean, server_default="false")

    __table_args__ = (
        UniqueConstraint("tenant_id", "system_id", "module", name="uq_system_module_map_key"),
        Index("ix_system_module_map_tenant", "tenant_id"),
        Index("ix_system_module_map_system", "tenant_id", "system_id"),
    )


class RecordHash(Base):
    __tablename__ = "record_hashes"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, primary_key=True)
    module = Column(Text, nullable=False, primary_key=True)
    record_key = Column(Text, nullable=False, primary_key=True)
    row_hash = Column(Text, nullable=False)
    version_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (
        Index("ix_record_hashes_version", "tenant_id", "version_id"),
    )


class RecordFix(Base):
    """Dedicated table for per-record fix tracking.
    
    Replaces the JSONB record_fixes array on findings rows.
    One row per failing SAP record with status tracking,
    assignment, and fix metadata.
    """
    __tablename__ = "record_fixes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id"), nullable=False)
    check_id = Column(Text, nullable=False)
    module = Column(Text, nullable=False)
    record_id = Column(Text, nullable=False)
    id_field = Column(Text, nullable=True)
    field = Column(Text, nullable=True)
    invalid_value = Column(Text, nullable=True)
    suggested_value = Column(Text, nullable=True)
    fix_instruction = Column(Text, nullable=True)
    sql_statement = Column(Text, nullable=True)
    severity = Column(Text, server_default="medium")
    status = Column(Text, server_default="open")  # open, in_progress, fixed, rejected
    assigned_to = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=True)
    fixed_at = Column(DateTime(timezone=True), nullable=True)

    version = relationship("AnalysisVersion")
    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_record_fixes_version_check", "version_id", "check_id"),
        Index("ix_record_fixes_version_status", "version_id", "status"),
        Index("ix_record_fixes_tenant", "tenant_id"),
    )
