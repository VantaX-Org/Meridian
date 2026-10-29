"""Comments with @mentions, watches, per-event subscriptions and a person's activity (migration 104).

GET    /api/v1/comments?target_kind=&target_id=   the comments on one record, rule, batch, contract, wave or object
POST   /api/v1/comments                            add one; each mentioned user gets a ``mention`` notification and
                                                   the target's watchers a ``comment`` one
DELETE /api/v1/comments/{id}                       the author (or a user administrator) removes it (soft delete)
GET    /api/v1/comments/mentions/unread            {count}: unread mention notifications of the caller (inbox badge)
GET    /api/v1/watches?target_kind=&target_id=     {watching, events} for the caller on one target
GET    /api/v1/watches/mine                        every target the caller watches
PUT    /api/v1/watches                             watch a target for some events (empty list = every watch event)
DELETE /api/v1/watches?target_kind=&target_id=     stop watching
GET    /api/v1/me/subscriptions                    every event kind with the caller's choice (or its default)
PUT    /api/v1/me/subscriptions                    {event: bool, ...}
GET    /api/v1/people/{user_id}/activity           the audit trail of one person: their own, or anyone's with
                                                   view_audit or manage_users

Everything is tenant-scoped (RLS + tenant_id in every query) and needs ``view``; writes are audited.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import collab
from api.services.notifications import create_notification
from api.services.rbac import (
    _get_user_role,
    current_user_id,
    current_user_label,
    has_permission,
    require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["collaboration"], dependencies=[Depends(require_permission("view"))])


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    return str(tenant.id)


def _me(request: Request) -> str:
    uid = current_user_id(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in to comment, watch or subscribe.")
    return uid


def _kind(kind: str, allowed: tuple[str, ...]) -> str:
    if kind not in allowed:
        raise HTTPException(status_code=422, detail=f"target_kind must be one of {', '.join(allowed)}")
    return kind


# ── comments ──────────────────────────────────────────────────────────────────


class CommentIn(BaseModel):
    target_kind: str
    target_id: str = Field(min_length=1, max_length=400)
    body: str = Field(min_length=1, max_length=4000)
    mentions: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class CommentOut(BaseModel):
    id: str
    target_kind: str
    target_id: str
    body: str
    author_id: str
    author_label: str
    mentions: list[str]
    created_at: datetime
    mine: bool = False


class CommentsOut(BaseModel):
    target_kind: str
    target_id: str
    comments: list[CommentOut]


def _comment(r, me: str | None) -> CommentOut:
    return CommentOut(id=str(r["id"]), target_kind=r["target_kind"], target_id=r["target_id"], body=r["body"],
                      author_id=r["author_id"], author_label=r["author_label"], mentions=list(r["mentions"] or []),
                      created_at=r["created_at"], mine=me is not None and r["author_id"] == me)


@router.get("/comments", response_model=CommentsOut)
async def list_comments(request: Request, target_kind: str = Query(...), target_id: str = Query(..., max_length=400),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The live comments on one target, oldest first."""
    _kind(target_kind, collab.COMMENT_KINDS)
    t = await _rls(db, tenant)
    rows = (await db.execute(text(
        "SELECT id, target_kind, target_id, body, author_id, author_label, mentions, created_at FROM comments "
        "WHERE tenant_id = CAST(:t AS uuid) AND target_kind = :k AND target_id = :i AND deleted_at IS NULL "
        "ORDER BY created_at, id"), {"t": t, "k": target_kind, "i": target_id})).mappings().all()
    me = current_user_id(request)
    return {"target_kind": target_kind, "target_id": target_id, "comments": [_comment(r, me) for r in rows]}


async def _mentioned(db: AsyncSession, t: str, ids: list[str], tokens: list[str]) -> list[tuple[str, str]]:
    """Active users of the tenant named by id, or by an @handle equal to their e-mail's local part. (id, name)."""
    if not ids and not tokens:
        return []
    rows = (await db.execute(text(
        "SELECT id::text, COALESCE(name, email) FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
        "AND (id = ANY(CAST(:ids AS uuid[])) OR lower(split_part(email, '@', 1)) = ANY(:tok)) ORDER BY id"),
        {"t": t, "ids": ids, "tok": [x.lower() for x in tokens]})).fetchall()
    return [(r[0], r[1]) for r in rows]


@router.post("/comments", response_model=CommentOut, status_code=201)
async def add_comment(body: CommentIn, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    _kind(body.target_kind, collab.COMMENT_KINDS)
    me = _me(request)
    text_ = body.body.strip()
    if not text_:
        raise HTTPException(status_code=422, detail="Write something before posting.")
    t = await _rls(db, tenant)
    named = await _mentioned(db, t, [str(i) for i in body.mentions], collab.mention_tokens(text_))
    label = current_user_label()
    row = (await db.execute(text("""
        INSERT INTO comments (tenant_id, target_kind, target_id, body, author_id, author_label, mentions)
        VALUES (CAST(:t AS uuid), :k, :i, :b, :a, :al, CAST(:m AS text[]))
        RETURNING id, target_kind, target_id, body, author_id, author_label, mentions, created_at"""),
        {"t": t, "k": body.target_kind, "i": body.target_id, "b": text_, "a": me, "al": label,
         "m": [u for u, _ in named]})).mappings().one()
    link = collab.link_for(body.target_kind, body.target_id)
    snippet = text_ if len(text_) <= 140 else text_[:139] + "…"
    told = {me}
    for uid, _name in named:
        if uid in told:
            continue
        told.add(uid)
        await create_notification(t, uid, "mention", f"{label} mentioned you", snippet, link, db)
    watchers = (await db.execute(text("""
        SELECT DISTINCT w.user_id, s.enabled FROM watches w
          LEFT JOIN notification_subscriptions s ON s.tenant_id = w.tenant_id AND s.user_id = w.user_id
                                                AND s.event = 'comment'
         WHERE w.tenant_id = CAST(:t AS uuid) AND w.target_kind = :k AND w.target_id = :i
           AND ('comment' = ANY(w.events) OR cardinality(w.events) = 0)"""),
        {"t": t, "k": body.target_kind, "i": body.target_id})).fetchall()
    for uid, enabled in watchers:
        if uid in told or not collab.wants("comment", enabled):
            continue
        told.add(uid)
        await create_notification(t, uid, "comment", f"{label} commented on something you watch", snippet, link, db)
    await write_audit(db, tenant.id, request, "comment.create", f"comment:{body.target_kind}", body.target_id, None,
                      {"id": str(row["id"]), "mentions": [u for u, _ in named]})
    await db.commit()
    return _comment(row, me)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(comment_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)):
    me = _me(request)
    t = await _rls(db, tenant)
    row = (await db.execute(text("SELECT author_id, target_kind, target_id FROM comments WHERE id = :c "
                                 "AND tenant_id = CAST(:t AS uuid) AND deleted_at IS NULL"),
                            {"c": comment_id, "t": t})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found")
    if row[0] != me and not has_permission(await _get_user_role(tenant, db, request), "manage_users"):
        raise HTTPException(status_code=403, detail="Only the author can remove a comment.")
    await db.execute(text("UPDATE comments SET deleted_at = now() WHERE id = :c AND tenant_id = CAST(:t AS uuid)"),
                     {"c": comment_id, "t": t})
    await write_audit(db, tenant.id, request, "comment.delete", f"comment:{row[1]}", row[2], {"id": str(comment_id)}, None)
    await db.commit()
    return Response(status_code=204)


@router.get("/comments/mentions/unread")
async def unread_mentions(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    me = current_user_id(request)
    if not me:
        return {"count": 0}
    t = await _rls(db, tenant)
    n = (await db.execute(text("SELECT count(*) FROM notifications WHERE tenant_id = CAST(:t AS uuid) "
                               "AND user_id = CAST(:u AS uuid) AND type = 'mention' AND NOT is_read"),
                          {"t": t, "u": me})).scalar()
    return {"count": int(n or 0)}


# ── watches ───────────────────────────────────────────────────────────────────


class WatchIn(BaseModel):
    target_kind: str
    target_id: str = Field(min_length=1, max_length=400)
    events: list[str] = Field(default_factory=list, max_length=len(collab.WATCH_EVENTS))


class WatchOut(BaseModel):
    target_kind: str
    target_id: str
    watching: bool
    events: list[str] = []


@router.get("/watches", response_model=WatchOut)
async def get_watch(request: Request, target_kind: str = Query(...), target_id: str = Query(..., max_length=400),
                    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    _kind(target_kind, collab.TARGET_KINDS)
    me = current_user_id(request)
    if not me:
        return {"target_kind": target_kind, "target_id": target_id, "watching": False, "events": []}
    t = await _rls(db, tenant)
    ev = (await db.execute(text("SELECT events FROM watches WHERE tenant_id = CAST(:t AS uuid) AND user_id = :u "
                                "AND target_kind = :k AND target_id = :i"),
                           {"t": t, "u": me, "k": target_kind, "i": target_id})).scalar()
    return {"target_kind": target_kind, "target_id": target_id, "watching": ev is not None, "events": list(ev or [])}


@router.get("/watches/mine")
async def my_watches(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    me = _me(request)
    t = await _rls(db, tenant)
    rows = (await db.execute(text("SELECT target_kind, target_id, events, created_at FROM watches "
                                  "WHERE tenant_id = CAST(:t AS uuid) AND user_id = :u ORDER BY created_at DESC"),
                             {"t": t, "u": me})).mappings().all()
    return {"watches": [{"target_kind": r["target_kind"], "target_id": r["target_id"], "events": list(r["events"] or []),
                         "created_at": r["created_at"]} for r in rows]}


@router.put("/watches", response_model=WatchOut)
async def put_watch(body: WatchIn, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)):
    _kind(body.target_kind, collab.TARGET_KINDS)
    bad = sorted(set(body.events) - set(collab.WATCH_EVENTS))
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown events: {', '.join(bad)}")
    me = _me(request)
    t = await _rls(db, tenant)
    await db.execute(text("""
        INSERT INTO watches (tenant_id, user_id, target_kind, target_id, events)
        VALUES (CAST(:t AS uuid), :u, :k, :i, CAST(:e AS text[]))
        ON CONFLICT (tenant_id, user_id, target_kind, target_id) DO UPDATE SET events = EXCLUDED.events"""),
        {"t": t, "u": me, "k": body.target_kind, "i": body.target_id, "e": sorted(set(body.events))})
    await write_audit(db, tenant.id, request, "watch.start", f"watch:{body.target_kind}", body.target_id, None,
                      {"events": sorted(set(body.events))})
    await db.commit()
    return {"target_kind": body.target_kind, "target_id": body.target_id, "watching": True, "events": sorted(set(body.events))}


@router.delete("/watches", status_code=204)
async def delete_watch(request: Request, target_kind: str = Query(...), target_id: str = Query(..., max_length=400),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    _kind(target_kind, collab.TARGET_KINDS)
    me = _me(request)
    t = await _rls(db, tenant)
    gone = (await db.execute(text("DELETE FROM watches WHERE tenant_id = CAST(:t AS uuid) AND user_id = :u "
                                  "AND target_kind = :k AND target_id = :i"),
                             {"t": t, "u": me, "k": target_kind, "i": target_id})).rowcount
    if gone:
        await write_audit(db, tenant.id, request, "watch.stop", f"watch:{target_kind}", target_id, None, None)
    await db.commit()
    return Response(status_code=204)


# ── subscriptions ─────────────────────────────────────────────────────────────


class SubscriptionOut(BaseModel):
    event: str
    label: str
    enabled: bool
    default: bool


@router.get("/me/subscriptions")
async def my_subscriptions(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    me = _me(request)
    t = await _rls(db, tenant)
    chosen = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT event, enabled FROM notification_subscriptions WHERE tenant_id = CAST(:t AS uuid) AND user_id = :u"),
        {"t": t, "u": me})).fetchall()}
    return {"events": [SubscriptionOut(event=e, label=label, enabled=collab.wants(e, chosen.get(e)), default=d)
                       for e, (label, d) in collab.EVENTS.items()]}


@router.put("/me/subscriptions")
async def put_subscriptions(body: dict[str, bool], request: Request, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)):
    bad = sorted(set(body) - set(collab.EVENTS))
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown events: {', '.join(bad)}")
    me = _me(request)
    t = await _rls(db, tenant)
    for event, on in body.items():
        await db.execute(text("""
            INSERT INTO notification_subscriptions (tenant_id, user_id, event, enabled)
            VALUES (CAST(:t AS uuid), :u, :e, :on)
            ON CONFLICT (tenant_id, user_id, event) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()"""),
            {"t": t, "u": me, "e": event, "on": bool(on)})
    await write_audit(db, tenant.id, request, "subscriptions.update", "user", me, None, body)
    await db.commit()
    return await my_subscriptions(request, db, tenant)


# ── a person's activity ───────────────────────────────────────────────────────


@router.get("/people/{user_id}/activity")
async def person_activity(user_id: uuid.UUID, request: Request, limit: int = Query(30, ge=1, le=200),
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """What one person changed, newest first, from audit_log. Your own trail is always yours to read; anyone else's
    needs view_audit or manage_users."""
    me = current_user_id(request)
    if str(user_id) != me:
        role = await _get_user_role(tenant, db, request)
        if not (has_permission(role, "view_audit") or has_permission(role, "manage_users")):
            raise HTTPException(status_code=403, detail={"detail": "forbidden", "resource": "audit", "action": "view",
                                                         "request_access": True})
    t = await _rls(db, tenant)
    rows = (await db.execute(text(
        "SELECT id, action, entity_type, entity_id, method, path, status_code, created_at FROM audit_log "
        "WHERE tenant_id = CAST(:t AS uuid) AND actor_user_id = :u ORDER BY created_at DESC LIMIT :n"),
        {"t": t, "u": user_id, "n": limit})).mappings().all()
    return {"user_id": str(user_id), "entries": [{**dict(r), "id": str(r["id"])} for r in rows]}
