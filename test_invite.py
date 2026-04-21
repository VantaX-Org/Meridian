import requests
import json
import time

API_URL = "http://localhost:8000/api/v1"

# Login
print("[1] Logging in...")
login_resp = requests.post(f"{API_URL}/auth/login", json={
    "email": "admin@meridian.local",
    "password": "admin123"
})
print(f"    Status: {login_resp.status_code}")

if login_resp.status_code != 200:
    print(f"    Error: {login_resp.text}")
    exit(1)

token = login_resp.json()["access_token"]
print(f"    Token: {token[:30]}...")

# Invite user
print("\n[2] Inviting user...")
invite_resp = requests.post(
    f"{API_URL}/users/invite",
    json={
        "email": "newuser@example.com",
        "name": "New Test User",
        "role": "analyst"
    },
    headers={"Authorization": f"Bearer {token}"}
)
print(f"    Status: {invite_resp.status_code}")
print(f"    Response: {invite_resp.json()}")

print("\n[3] Waiting for worker to process email...")
time.sleep(3)

print("\n[4] Checking worker logs...")
import subprocess
logs = subprocess.check_output([
    "docker", "compose", "logs", "worker", "--tail=30"
], text=True)

# Look for email-related messages
for line in logs.split('\n'):
    if any(x in line.lower() for x in ['email', 'graph', 'send', 'error', 'newuser']):
        print(f"    {line}")
