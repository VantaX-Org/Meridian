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

## Enabling the `rfc` backend (pyrfc + SAP NW RFC SDK)

`pyrfc` and the SAP NW RFC SDK are **not** in the prebuilt `ghcr.io` images —
the SDK is SAP-licensed binary software and cannot be redistributed. To use
`SAP_CONNECTOR=rfc` against a real ECC/S/4HANA-on-prem/eWMS system, you must
build the images yourself with the SDK supplied:

1. Obtain the SAP NW RFC SDK from the SAP Support Portal (requires an SAP
   licence) and extract it into `vendor/nwrfcsdk/` so it contains `lib/` and
   `include/`. See `vendor/nwrfcsdk/README.md`.
2. Build with `INSTALL_PYRFC=true`:
   ```bash
   echo "INSTALL_PYRFC=true" >> .env
   docker compose -f docker-compose.yml -f docker-compose.build.yml build api worker
   docker compose up -d
   ```

Without this, `SAP_CONNECTOR=rfc` will connect to nothing — `RFCConnector`
raises `pyrfc_not_installed` on every `connect()` call, and
`POST /api/v1/systems/{id}/test` will report `"PyRFC is not installed"`.
`mock`, `odata`, and the cloud connectors (`successfactors`, `concur`,
`ariba`, `s4hana_cloud`) don't need the SDK and work in the prebuilt images.

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
