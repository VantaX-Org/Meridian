#!/usr/bin/env python3
"""Fix all instances of SET app.tenant_id = :tid to use proper PostgreSQL syntax."""

import re
import glob

# Find all Python files with the problematic pattern
pattern = 'SET app\\.tenant_id = :tid"\\), {"tid":'
replacement_pattern = r'SET app\.tenant_id = :tid"), {"tid":'

files_with_pattern = []
for root_pattern in [
    "**/*.py",
]:
    for filepath in glob.glob(root_pattern, recursive=True):
        # Skip venv and node_modules
        if "venv" in filepath or "node_modules" in filepath or ".git" in filepath:
            continue
        
        try:
            with open(filepath, "r") as f:
                content = f.read()
            
            if 'SET app.tenant_id = :tid") {"tid":' in content or \
               'SET app.tenant_id = :tid"), {"tid":' in content:
                files_with_pattern.append(filepath)
        except:
            pass

print(f"Found {len(files_with_pattern)} files to fix")

for filepath in files_with_pattern:
    with open(filepath, "r") as f:
        content = f.read()
    
    # Replace the pattern - need to be careful with string literals
    # Pattern: await db.execute(text(f\"SET app.tenant_id TO '{str(tenant.id)}'\" ))
    # Should become: await db.execute(text(f"SET app.tenant_id TO '{str(tenant.id)}'"))
    
    # Pattern for async: await db.execute(text(f"SET app.tenant_id TO '{str(
    new_content = content
    
    # Replace async version
    new_content = re.sub(
        r'await db\.execute\(text\("SET app\.tenant_id = :tid"\), \{"tid": str\(([^)]+)\)\}\)',
        r"await db.execute(text(f\"SET app.tenant_id TO '{str(\1)}'\" ))",
        new_content
    )
    
    # Replace sync version
    new_content = re.sub(
        r'session\.execute\(text\("SET app\.tenant_id = :tid"\), \{"tid": str\(([^)]+)\)\}\)',
        r"session.execute(text(f\"SET app.tenant_id TO '{str(\1)}'\" ))",
        new_content
    )
    
    # Replace sync version without str()
    new_content = re.sub(
        r'session\.execute\(text\("SET app\.tenant_id = :tid"\), \{"tid": ([^}]+)\}\)',
        r"session.execute(text(f\"SET app.tenant_id TO '{str(\1)}'\" ))",
        new_content
    )
    
    if new_content != content:
        with open(filepath, "w") as f:
            f.write(new_content)
        print(f"Fixed: {filepath}")
    else:
        print(f"No changes: {filepath}")

print("Done!")
