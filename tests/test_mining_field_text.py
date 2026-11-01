"""Mined fields carry their dictionary text, read from the tables of their own object; an unknown field carries none."""

from api.routes.mining import field_text


def test_field_text_bare_and_qualified_names():
    assert field_text("PLIFZ", "material_master") == "Planned delivery time (days)"
    assert field_text("MARA.BRGEW", None) == "Gross weight"
    assert field_text("ZZUNKNOWN", "material_master") is None
    assert field_text(None, "material_master") is None


def test_field_text_reads_the_objects_own_tables():
    assert field_text("NAME1", "sd_customer_master") == "Customer name 1"
    assert field_text("NAME1", None) is None
