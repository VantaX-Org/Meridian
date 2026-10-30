"""connect_sap_system hands the system's read_function and extraction_path to the RFC connector."""

from api.services.connectivity_manager import connect_sap_system


def test_rfc_connection_carries_the_read_settings(monkeypatch):
    seen = []

    class Fake:
        def connect(self, params):
            seen.append(params)

    monkeypatch.setattr("sap.get_connector", lambda: Fake())
    connect_sap_system("ecc", {"host": "h", "client": "100", "sysnr": "00", "user": "u", "password": "p",
                               "read_function": "BBP_RFC_READ_TABLE", "extraction_path": "odp"})
    assert (seen[0].read_function, seen[0].extraction_path) == ("BBP_RFC_READ_TABLE", "odp")
    connect_sap_system("ecc", {"host": "h", "client": "100", "sysnr": "00", "user": "u", "password": "p"})
    assert (seen[1].read_function, seen[1].extraction_path) == ("", "")
