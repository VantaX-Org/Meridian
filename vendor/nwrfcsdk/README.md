# SAP NW RFC SDK

This directory is where the customer-supplied **SAP NetWeaver RFC SDK** goes
before building the API/worker images with `INSTALL_PYRFC=true`.

The SDK is SAP-licensed binary software — Meridian cannot ship it, and it must
not be committed to this repository. Only customers with an SAP licence can
obtain it from the SAP Support Portal (`SAP NW RFC SDK 7.50` or later, Linux
x86_64 build matching the image's glibc).

## Setup

1. Download the SDK archive from the SAP Support Portal.
2. Extract it so this directory contains `lib/` and `include/`, e.g.:
   ```
   vendor/nwrfcsdk/
   ├── lib/
   │   ├── libsapnwrfc.so
   │   ├── libicudata.so.50
   │   └── ...
   └── include/
       └── ...
   ```
3. Build with the flag enabled:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.build.yml build --build-arg INSTALL_PYRFC=true
   # or, if using an .env-driven build:
   echo "INSTALL_PYRFC=true" >> .env
   docker compose -f docker-compose.yml -f docker-compose.build.yml build
   ```

Set `SAP_CONNECTOR=rfc` in `.env` (already the default) to use it. See
`docs/sap-connector.md` for the full backend list.

If this directory is left empty, the image builds normally without RFC
support — `SAP_CONNECTOR=rfc` will then fail at connect-time with
`pyrfc_not_installed`, and `mock`/`odata`/cloud connectors are unaffected.
