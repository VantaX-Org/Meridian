"""Task 11: Decouple LLM_KEK from JWT_SECRET for API key encryption.

Implements cryptographic separation of concerns:
  - JWT_SECRET: Only for signing admin JWTs
  - LLM_KEK: Only for encrypting LLM API keys

This migration is a no-op at the database level but documents the architecture change.
Existing encrypted keys (if using jwt_secret) can be manually rotated using the
new api/utils/crypto.py module with the LLM_KEK environment variable.

Migration notes:
  1. Set LLM_KEK environment variable before deploying
  2. Optionally re-encrypt existing llm_config.api_key_encrypted values with new key
  3. JWT_SECRET remains unchanged (used only for admin auth)

Revision ID: 035
Revises: 034
Create Date: 2026-04-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No schema changes. Documentation only."""
    # Ensure llm_config column exists (added in migration 034)
    # Future: Could add a migration helper to re-encrypt keys if desired
    pass


def downgrade() -> None:
    """No-op downgrade."""
    pass
