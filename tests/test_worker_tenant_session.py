from sqlalchemy import create_engine, event, text

from workers.db import tenant_session


def test_tenant_is_set_again_after_commit():
    # after a commit the session may get another pooled connection: every transaction must set the tenant
    engine = create_engine("sqlite://")
    seen = []

    @event.listens_for(engine, "connect")
    def _fn(dbapi, _):
        dbapi.create_function("set_config", 3, lambda k, v, local: seen.append((k, v)) or v)

    with tenant_session(engine, "t1") as session:
        session.execute(text("SELECT 1"))
        session.commit()
        session.execute(text("SELECT 1"))
    assert seen == [("app.tenant_id", "t1")] * 2
