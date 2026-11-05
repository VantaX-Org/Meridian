"""Read-only access to a customer's non-SAP SQL database (Postgres via the installed psycopg2).

Trust boundary, in the order a request meets it:
  1. the host is resolved here and every address checked (``resolve_safe``): loopback, link-local (which covers the
     169.254.169.254 cloud metadata address), multicast, reserved, unspecified and the other well-known metadata
     addresses are refused. The connection then goes to the address that was checked (``hostaddr``), so a DNS answer
     that changes between the check and the connect cannot redirect it;
  2. the session is read only (BEGIN READ ONLY) with a statement timeout and an idle-in-transaction timeout;
  3. a query must be one SELECT or WITH statement (``check_single_select``);
  4. at most MAX_ROWS rows are fetched, through a server-side cursor so the API process never holds more.

Private ranges (10/8, 172.16/12, 192.168/16) are allowed on purpose: a customer's database normally lives there.
The password is decrypted by the caller for the one connection and is never logged or put in an error.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import uuid
from decimal import Decimal
from typing import Any

import pandas as pd
import psycopg2
from psycopg2 import sql

MAX_ROWS = 100_000
STATEMENT_TIMEOUT_MS = 60_000
CONNECT_TIMEOUT_S = 10
SSL_MODES = ("disable", "require", "verify-ca", "verify-full")

# not covered by is_link_local / is_loopback: the IPv6 EC2 metadata address and the Alibaba one
_BLOCKED_NETS = tuple(ipaddress.ip_network(n) for n in ("fd00:ec2::/32", "100.100.100.200/32"))


class ExternalDbError(Exception):
    """A refusal or failure that is safe to show the admin. ``code`` is machine readable."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved
            or any(ip in n for n in _BLOCKED_NETS))


def resolve_safe(host: str, port: int) -> str:
    """The address to connect to; raises ExternalDbError when the host cannot be resolved or any address is refused."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise ExternalDbError("host_unresolvable", "The host name could not be resolved.")
    addrs = [ipaddress.ip_address(str(i[4][0]).split("%")[0]) for i in infos]
    if not addrs:
        raise ExternalDbError("host_unresolvable", "The host name could not be resolved.")
    if any(_blocked(a) for a in addrs):
        raise ExternalDbError("host_blocked", "That address is not allowed (loopback, link-local or metadata).")
    return str(addrs[0])


# comments, string literals, quoted identifiers and dollar-quoted strings; blanked before the statement is inspected
_MASK = re.compile(r"--[^\n]*|/\*.*?\*/|'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|\$([A-Za-z_]*)\$.*?\$\1\$", re.S)


def check_single_select(query: str) -> str:
    """The query without a trailing semicolon, or ExternalDbError unless it is exactly one SELECT/WITH statement."""
    if not query or not query.strip():
        raise ExternalDbError("query_empty", "The query is empty.")
    masked = _MASK.sub(" ", query).strip()
    if masked.endswith(";"):
        masked = masked[:-1].rstrip()
        query = query.rstrip().rstrip(";").rstrip()
    if ";" in masked:
        raise ExternalDbError("query_multiple", "Only one statement is allowed.")
    if any(tok in masked for tok in ("'", '"', "/*", "*/", "--")):
        raise ExternalDbError("query_unbalanced", "The query has an unterminated quote or comment.")
    if not re.match(r"(?i)(select|with)\b", masked):
        raise ExternalDbError("query_not_select", "Only a SELECT query is allowed.")
    return query


def _connect(conn: dict[str, Any], password: str):
    addr = resolve_safe(conn["host"], conn["port"])
    try:
        c = psycopg2.connect(
            host=conn["host"], hostaddr=addr, port=conn["port"], dbname=conn["database"], user=conn["username"],
            password=password, sslmode=conn["ssl_mode"], connect_timeout=CONNECT_TIMEOUT_S,
            application_name="meridian-source",
            options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout={STATEMENT_TIMEOUT_MS}",
        )
    except psycopg2.OperationalError:
        # the libpq message can carry the address; the admin gets a fixed sentence
        raise ExternalDbError("connect_failed", "Could not connect. Check host, port, database, user, password and SSL mode.")
    c.set_session(readonly=True, autocommit=False)
    return c


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dict, list)):
        return json.dumps(v, default=str)
    if isinstance(v, (uuid.UUID, bytes, memoryview)):
        return str(v)
    return v


def _run(conn: dict[str, Any], password: str, build_query, limit: int) -> tuple[list[str], list[tuple], bool]:
    c = _connect(conn, password)
    try:
        with c.cursor(name="meridian_src") as cur:
            cur.itersize = 2000
            try:
                cur.execute(build_query())
                rows = cur.fetchmany(limit + 1)
            except psycopg2.errors.QueryCanceled:
                raise ExternalDbError("timeout", f"The query ran longer than {STATEMENT_TIMEOUT_MS // 1000} seconds.")
            except psycopg2.Error as e:
                msg = (e.diag.message_primary or "").strip()[:200] if e.diag else ""
                raise ExternalDbError("query_failed", f"The database refused the query: {msg}" if msg else "The query failed.")
            cols = [d[0] for d in (cur.description or [])]
        truncated = len(rows) > limit
        return cols, rows[:limit], truncated
    finally:
        c.rollback()
        c.close()


def table_query(schema: str, table: str):
    return lambda: sql.SQL("SELECT * FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table))


def fetch(conn: dict[str, Any], password: str, *, table: tuple[str, str] | None, query: str | None,
          limit: int = MAX_ROWS) -> tuple[pd.DataFrame, bool]:
    """Rows of the chosen table or single SELECT as a DataFrame, and whether the row cap cut them off."""
    if bool(table) == bool(query):
        raise ExternalDbError("source_choice", "Choose either a table or a query.")
    if table:
        build = table_query(*table)
    else:
        text_ = check_single_select(query or "")
        build = lambda: sql.SQL(text_)  # noqa: E731
    cols, rows, truncated = _run(conn, password, build, min(limit, MAX_ROWS))
    if len(set(cols)) != len(cols):
        raise ExternalDbError("duplicate_columns", "The result has two columns with the same name; alias one of them.")
    df = pd.DataFrame([tuple(_plain(v) for v in r) for r in rows], columns=cols)
    return df, truncated


def list_tables(conn: dict[str, Any], password: str) -> list[dict[str, str]]:
    q = ("SELECT table_schema, table_name, table_type FROM information_schema.tables "
         "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%' "
         "ORDER BY 1, 2 LIMIT 2000")
    _, rows, _ = _run(conn, password, lambda: sql.SQL(q), 2000)
    return [{"schema": r[0], "name": r[1], "kind": "view" if r[2] == "VIEW" else "table"} for r in rows]


def ping(conn: dict[str, Any], password: str) -> None:
    _run(conn, password, lambda: sql.SQL("SELECT 1"), 1)
