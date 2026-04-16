#!/usr/bin/env python3
"""Fix all parameterized SET app.tenant_id statements across the API."""

import os
import re

def fix_file(filepath):
    """Fix parameterized SET statements in a file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Pattern: await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(variable)})
    # Replace with: await db.execute(text(f"SET app.tenant_id = '{str(variable)}'"))
    pattern = r'await db\.execute\(text\("SET app\.tenant_id = :tid"\), \{"tid": str\(([^)]+)\)\}\)'
    replacement = r'await db.execute(text(f"SET app.tenant_id = \'{str(\1)}\'"))'
    
    new_content = re.sub(pattern, replacement, content)
    
    # Also fix sync sessions: conn.execute(text("SET app.tenant_id = :tid"), {"tid": str(variable)})
    # Replace with: conn.execute(text(f"SET app.tenant_id = '{str(variable)}'"))
    pattern_sync = r'conn\.execute\(text\("SET app\.tenant_id = :tid"\), \{"tid": str\(([^)]+)\)\}\)'
    replacement_sync = r'conn.execute(text(f"SET app.tenant_id = \'{str(\1)}\'"))'
    
    new_content = re.sub(pattern_sync, replacement_sync, new_content)
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

# Fix all Python files in api/routes
routes_dir = 'api/routes'
if os.path.exists(routes_dir):
    for filename in os.listdir(routes_dir):
        if filename.endswith('.py'):
            filepath = os.path.join(routes_dir, filename)
            if fix_file(filepath):
                print(f'✓ Fixed {filename}')

# Fix api/services/z_object_intelligence/persistence.py
persistence_file = 'api/services/z_object_intelligence/persistence.py'
if os.path.exists(persistence_file):
    if fix_file(persistence_file):
        print(f'✓ Fixed persistence.py')

# Fix api/utils/llm_logger.py
llm_logger_file = 'api/utils/llm_logger.py'
if os.path.exists(llm_logger_file):
    if fix_file(llm_logger_file):
        print(f'✓ Fixed llm_logger.py')

# Fix agents/orchestrator.py (if still needed)
orchestrator_file = 'agents/orchestrator.py'
if os.path.exists(orchestrator_file):
    if fix_file(orchestrator_file):
        print(f'✓ Fixed orchestrator.py')

print("All SET app.tenant_id statements have been fixed!")
