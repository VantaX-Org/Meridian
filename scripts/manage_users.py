#!/usr/bin/env python3
"""Meridian user management CLI.

Usage (from host):
    docker compose exec api python scripts/manage_users.py create \
        --email admin@company.com \
        --name "Admin User" \
        --password "SecureP@ss123" \
        --role admin

    docker compose exec api python scripts/manage_users.py list

    docker compose exec api python scripts/manage_users.py reset-password \
        --email admin@company.com \
        --password "NewP@ss456"

    docker compose exec api python scripts/manage_users.py deactivate \
        --email admin@company.com
"""

import argparse
import os
import sys
import uuid
from datetime import datetime, timezone

# Add project root to path so imports work inside the container
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001"
VALID_ROLES = {"admin", "manager", "viewer", "analyst", "steward", "approver", "auditor", "ai_reviewer"}


def get_engine():
    db_url = os.environ.get("DATABASE_URL_SYNC", "")
    if not db_url:
        db_url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
    if not db_url:
        print("ERROR: DATABASE_URL_SYNC not set", file=sys.stderr)
        sys.exit(1)
    return create_engine(db_url)


def ensure_tenant(conn):
    """Ensure the dev tenant exists."""
    conn.execute(text("SET app.tenant_id = :tid"), {"tid": str(DEV_TENANT_ID)})
    row = conn.execute(
        text("SELECT id FROM tenants WHERE id = :tid"),
        {"tid": DEV_TENANT_ID},
    ).fetchone()
    if not row:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, licensed_modules) "
                "VALUES (:tid, 'Default Tenant', ARRAY['business_partner','material_master','fi_gl'])"
            ),
            {"tid": DEV_TENANT_ID},
        )
        conn.commit()


def ensure_jwt_secret(conn):
    """Ensure the tenant has a jwt_secret. Generate one if missing."""
    from api.services.local_auth import generate_jwt_secret

    row = conn.execute(
        text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
        {"tid": DEV_TENANT_ID},
    ).fetchone()
    if not row or not row[0]:
        secret = generate_jwt_secret()
        conn.execute(
            text("UPDATE tenants SET jwt_secret = :secret WHERE id = :tid"),
            {"secret": secret, "tid": DEV_TENANT_ID},
        )
        conn.commit()


def cmd_create(args):
    from api.services.local_auth import hash_password

    if args.role not in VALID_ROLES:
        print(f"ERROR: Invalid role '{args.role}'. Valid: {', '.join(sorted(VALID_ROLES))}", file=sys.stderr)
        sys.exit(1)

    engine = get_engine()
    with engine.connect() as conn:
        ensure_tenant(conn)
        ensure_jwt_secret(conn)

        # Check if user already exists
        existing = conn.execute(
            text("SELECT id, email FROM users WHERE email = :email AND tenant_id = :tid"),
            {"email": args.email, "tid": DEV_TENANT_ID},
        ).fetchone()
        if existing:
            print(f"ERROR: User '{args.email}' already exists (id: {existing[0]})", file=sys.stderr)
            sys.exit(1)

        user_id = str(uuid.uuid4())
        pw_hash = hash_password(args.password)
        name = args.name or args.email.split("@")[0]

        conn.execute(
            text("""
                INSERT INTO users (id, tenant_id, email, name, role, password_hash, is_active, created_at)
                VALUES (:id, :tid, :email, :name, :role, :pw, true, :now)
            """),
            {
                "id": user_id,
                "tid": DEV_TENANT_ID,
                "email": args.email,
                "name": name,
                "role": args.role,
                "pw": pw_hash,
                "now": datetime.now(timezone.utc),
            },
        )
        conn.commit()
        print(f"User created: {args.email} (role: {args.role}, id: {user_id})")


def cmd_list(args):
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text("SET app.tenant_id = :tid"), {"tid": str(DEV_TENANT_ID)})
        rows = conn.execute(
            text("""
                SELECT id, email, name, role, is_active, last_login, created_at
                FROM users WHERE tenant_id = :tid
                ORDER BY created_at ASC
            """),
            {"tid": DEV_TENANT_ID},
        ).fetchall()

        if not rows:
            print("No users found.")
            return

        print(f"{'Email':<35} {'Name':<20} {'Role':<10} {'Active':<8} {'Last Login'}")
        print("-" * 100)
        for r in rows:
            last_login = r[5].strftime("%Y-%m-%d %H:%M") if r[5] else "Never"
            active = "Yes" if r[4] else "No"
            print(f"{r[1]:<35} {r[2]:<20} {r[3]:<10} {active:<8} {last_login}")


def cmd_reset_password(args):
    from api.services.local_auth import hash_password

    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text("SET app.tenant_id = :tid"), {"tid": str(DEV_TENANT_ID)})
        row = conn.execute(
            text("SELECT id FROM users WHERE email = :email AND tenant_id = :tid"),
            {"email": args.email, "tid": DEV_TENANT_ID},
        ).fetchone()
        if not row:
            print(f"ERROR: User '{args.email}' not found", file=sys.stderr)
            sys.exit(1)

        pw_hash = hash_password(args.password)
        conn.execute(
            text("UPDATE users SET password_hash = :pw WHERE id = :uid"),
            {"pw": pw_hash, "uid": row[0]},
        )
        conn.commit()
        print(f"Password reset for: {args.email}")


def cmd_deactivate(args):
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text("SET app.tenant_id = :tid"), {"tid": str(DEV_TENANT_ID)})
        result = conn.execute(
            text("UPDATE users SET is_active = false WHERE email = :email AND tenant_id = :tid RETURNING id"),
            {"email": args.email, "tid": DEV_TENANT_ID},
        ).fetchone()
        if not result:
            print(f"ERROR: User '{args.email}' not found", file=sys.stderr)
            sys.exit(1)
        conn.commit()
        print(f"User deactivated: {args.email}")


def main():
    parser = argparse.ArgumentParser(description="Meridian user management")
    sub = parser.add_subparsers(dest="command", required=True)

    # create
    p_create = sub.add_parser("create", help="Create a new user")
    p_create.add_argument("--email", required=True)
    p_create.add_argument("--password", required=True)
    p_create.add_argument("--name", default="")
    p_create.add_argument("--role", default="admin", choices=sorted(VALID_ROLES))

    # list
    sub.add_parser("list", help="List all users")

    # reset-password
    p_reset = sub.add_parser("reset-password", help="Reset a user's password")
    p_reset.add_argument("--email", required=True)
    p_reset.add_argument("--password", required=True)

    # deactivate
    p_deact = sub.add_parser("deactivate", help="Deactivate a user")
    p_deact.add_argument("--email", required=True)

    args = parser.parse_args()
    {"create": cmd_create, "list": cmd_list, "reset-password": cmd_reset_password, "deactivate": cmd_deactivate}[args.command](args)


if __name__ == "__main__":
    main()
