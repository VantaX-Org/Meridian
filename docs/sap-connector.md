# SAP Connector Configuration

Meridian uses a pluggable SAP connector layer. The backend is selected via the
`SAP_CONNECTOR` environment variable.

## Available backends

| Value | Library | GPU/SDK Required | Notes |
|---|---|---|---|
| `rfc` | pyrfc + SAP NW RFC SDK | SAP NW RFC SDK | Default. Supports ECC and S/4HANA on-premise. |
| `ctypes` | SAP NW RFC SDK (direct) | SAP NW RFC SDK | PyRFC-free. Community implementation. |
| `odata` | pyodata | None | S/4HANA Cloud Public Edition. Requires OData services enabled. |
| `mock` | None | None | In-memory mock for testing without a real SAP system. |

## Switching backends

Edit `.env`:
```
SAP_CONNECTOR=rfc   # or ctypes, odata, mock
```

Then restart:
```bash
docker compose restart api worker
```

## Adding a new backend

1. Create `sap/<backend>.py` implementing all methods of `sap.base.SAPConnector`
2. Add an `elif backend == "<backend>":` branch in `sap/__init__.py`
3. No other files require changes

## Interface contract

All backends must implement:
- `connect(params: SAPConnectionParams) -> None`
- `read_table(table, fields, where, max_rows) -> pd.DataFrame`
- `execute_bapi(call: BAPICall) -> dict`
- `ping() -> bool`
- `close() -> None`
