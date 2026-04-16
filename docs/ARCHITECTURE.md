# Architecture Decision Record: Single-Tenant Deployment Model

**Status:** ACCEPTED  
**Decision Date:** 2026-04-15  
**Revised:** 2026-04-20  

---

## Context

Meridian is deployed as a **single-tenant application instance per customer environment**. Each customer receives their own Docker Compose stack with:
- Dedicated FastAPI backend
- Dedicated PostgreSQL database
- Dedicated Celery workers
- All SAP data, analysis results, and reports remain within the customer's own infrastructure

This decision was made to:
1. Ensure complete **data residency compliance** (SAP data never leaves customer premises)
2. Simplify **security and RBAC** (no tenant isolation layer needed in application code)
3. Eliminate **data leakage risks** (no cross-tenant table joins, no shared compute resources)
4. Support **air-gapped deployments** (customers with no external connectivity)

---

## Decision

**Meridian uses a single-tenant-per-deployment architecture.**

### What this means:

1. **One database per deployment**
   - PostgreSQL schema contains only one `tenants` table row (the customer's tenant)
   - No `tenant_id` filtering on queries (historical — no longer needed)
   - RLS policies exist for defense-in-depth but are redundant in single-tenant context

2. **One Cloudflare account per customer** (for licence and optional control plane)
   - Licence key is issued per customer
   - Admin portal in Meridian HQ is used for tenant management, not per-deployment

3. **No multi-tenant platform**
   - Meridian is NOT a multi-tenant SaaS platform
   - It is a customer-hosted data quality engine that can be deployed many times

### Architecture boundaries:

```
┌────────────────────────────────────┐
│  Cloudflare (Meridian HQ Control)  │  Optional: Licence validation, billing
│         (Never sees SAP data)       │  
└────────────────────────────────────┘
             ↓ (Licence key only)
┌────────────────────────────────────┐
│  Customer Environment (Closed Box)  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Meridian Deployment         │  │
│  │  (Single-tenant instance)    │  │
│  │                              │  │
│  │  - FastAPI backend           │  │
│  │  - PostgreSQL database       │  │
│  │  - Celery workers            │  │
│  │  - All SAP data stays inside │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

---

## Implementation

### Database schema

- **tenants table**: Single row (the customer)
- **All other tables**: Implicitly scoped to that one tenant
- **No tenant_id column required** on most tables (historical design artifact)

Example:
```sql
SELECT * FROM findings;  -- Returns only findings for the one deployed tenant
-- (No WHERE tenant_id = ... needed)
```

### Application code

- **FastAPI**: Uses `request.state.tenant_id` for audit trails, but no access control depends on it
- **Celery workers**: No tenant context needed (single customer per environment)
- **Database RLS**: Implemented at `app.tenant_id` session variable level for defense-in-depth, but not strictly required

### Security implications

- **✅ Simpler**: No accidental cross-tenant data leaks possible
- **✅ Compliant**: All regulations requiring data residency are satisfied
- **✅ Testable**: Easier to reason about access control (no multi-tenant edge cases)
- **✅ Scalable**: Can run 1000+ independent deployments without a central database

---

## Alternatives considered

1. **Multi-tenant SaaS platform** (rejected)
   - Would require complex RLS, audit trails, and isolation testing
   - Would violate data residency requirements (SAP data in cloud provider's DB)
   - Higher operational overhead for Meridian team

2. **Hybrid model** (rejected)
   - Some customers in cloud, some on-premises
   - Adds complexity to licensing, deployment, and security compliance

---

## Consequences

### Positive

- **Data residency**: Customers retain full control of their data
- **Compliance**: Meets all regulatory requirements (GDPR, SOX, industry-specific)
- **Security**: Eliminates cross-tenant access vectors entirely
- **Simplicity**: Application code can be simpler (no multi-tenant abstractions)

### Negative

- **Scale**: Cannot run a shared infrastructure at massive scale (but not required for this product)
- **Shared features**: Cannot share infrastructure between customers (by design)
- **Centralized mgmt**: Requires separate Meridian HQ control plane (built separately on Cloudflare)

---

## Deployment checklist

When deploying Meridian for a new customer:

- [ ] Generate customer-specific Docker Compose stack
- [ ] Provision unique PostgreSQL database (or managed RDS instance)
- [ ] Issue unique licence key via Meridian HQ
- [ ] Deploy FastAPI + Celery + Frontend stack
- [ ] Confirm SAP connectivity (RFC / OData)
- [ ] Verify no data escapes to external systems (use network policies)
- [ ] Set up customer's backup/recovery procedures
- [ ] Document customer's air-gapped connectivity (if applicable)

---

## Related documentation

- [Deployment guide](deployment.md)
- [SAP Connector guide](sap-connector.md)
- [Cloudflare control plane architecture](../cloudflare/README.md)
- [Security model](SECURITY.md)

---

## Revision history

| Date | Change |
|------|--------|
| 2026-04-15 | Initial ADR (single-tenant decision) |
| 2026-04-20 | Clarified multi-tenant vs multi-deployment distinction |
