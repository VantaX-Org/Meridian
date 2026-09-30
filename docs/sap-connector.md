# SAP Connector — RFC setup and authorisations

Meridian picks the connector from the system's type (`sap_systems.system_type`):

| System type | Protocol | Library |
|---|---|---|
| `ecc`, `s4hana_onprem`, `ewm` | RFC | PyRFC 3.3.1 + SAP NW RFC SDK |
| `s4hana_cloud` | OData V4 | built in |
| `successfactors` | OData V2 | built in |
| `concur`, `ariba` | REST | built in |

There is no mock connector and no `SAP_CONNECTOR` switch.

## 1. Build RFC support on the host (once, and automatically on every update)

The SAP NW RFC SDK is licensed per customer and PyRFC publishes no Linux
wheel, so the published images cannot contain either. Build them on the host
that holds the SDK:

```bash
# SDK unpacked at /usr/local/sap/nwrfcsdk (lib/libsapnwrfc.so, include/)
sudo bash scripts/build-rfc-overlay.sh            # or --sdk /path/to/nwrfcsdk
sudo bash scripts/update.sh                       # starts api/worker/beat on the RFC images
```

This builds `meridian-api:rfc-local` and `meridian-worker:rfc-local` on top of
the pulled images and writes `docker-compose.rfc.yml` next to the customer
compose file. While that file exists, `scripts/update.sh` rebuilds the overlay
after every pull (and aborts before restarting anything if the rebuild fails),
and `--rollback` restores the previous overlay images too. The updater sidecar
mounts the SDK read-only for the same purpose (set `SAPNWRFC_HOME` in `.env`
if the SDK is not at `/usr/local/sap/nwrfcsdk`).

Check: `docker compose exec worker python -c "import pyrfc; print(pyrfc.__version__)"`.

## 2. SAP user

Create a **System** (type B) or **Communication** (type C) user in the source
client. Meridian only reads from SAP.

### S_RFC — function groups

| Function group | Function modules | Used for |
|---|---|---|
| `SYST` | `RFC_PING` | connection test |
| `SRFC` | `RFC_SYSTEM_INFO` | release, system ID, discovery |
| `SDTX` | `RFC_READ_TABLE` | all table reads |
| `SDIFRUNTIME` | `DDIF_FIELDINFO_GET` | field definitions (discovery) |
| `RFC1`, `RFC_METADATA` | `RFC_GET_FUNCTION_INTERFACE`, `RFC_METADATA_GET` | interface metadata the RFC library reads before calling a module |

`ACTVT = 16`, `RFC_TYPE = FUGR`.

Corrections are delivered as export files (LSMW / BAPI input / CSV) for your
own load tooling. Live BAPI write-back is disabled and not yet supported for
production use — grant no change authorisations.

### S_TABU_DIS / S_TABU_NAM — table reads (`ACTVT = 03`)

Prefer `S_TABU_NAM` with the table list below over broad `S_TABU_DIS` groups.

**Data dictionary (discovery):** `DD01L DD02L DD02T DD03L DD04L DD05S DD07L TADIR CVERS`
plus your customer tables (`Z*`/`Y*`) if their design should be read.

**Organisational structure:** `T001 T001K T001L T001W T024E TKA01 TVKO`

**Module data and check tables** (ECC / S/4HANA on-premise / EWM — the 19 ABAP modules):

```
ADR6 ADRC ANLA ANLB ANLZ BKPF BSEG BUT000 BUT100 CDPOS CRHD DFKKBPTAXNUM EKKO EKPO
EQKT EQUI EQUZ FLEET GRACROLE GRACSODRISK GRACSODRISKT GRACUSERROLE IFLOT IFLOTX ILOA
JEST KNA1 KNB1 KNB5 KNKK KNVV LAGP LFA1 LFB1 LFB5 LFBK LFM1 LQUA LTAK LTAP MAKT MARA
MARC MARD MARM MAST MBEW MCH1 MCHA MCHB MDMA MLGN MLGT MVKE PLKO SKA1 SKAT SKB1 STKO
STPO T003 T004 T006 T023 T042Z T047A T052 T077D T077K T090NA T134 T137 T141 T159C T161
T163 T163K T301 T308 T370K T377P T411 T412 T415S T416 T418 T438A TB001 TINC TPRIO TSAD3
TVAK TVAST TVFS TVLS TVPT TVRO USMD120C USMD1213 VBAK VBAP VBUK VBUP VTTK VTTP
```

Only the tables of the modules you extract are read. A table the user may not
read shows as `failed` on the system's **Coverage** tab (Systems → system →
Coverage) with SAP's message — nothing is guessed in its place.

## 3. Register and discover

Systems → Add system → RFC details (application server, system number,
client, user). On the first successful connection test Meridian reads the
system's own dictionary and configuration (Systems → system). From then on
every check uses this system's field definitions and configured values.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pyrfc not installed` | RFC overlay not built — step 1 |
| `RFC_ERROR_LOGON_FAILURE` | user, password, client or user lock |
| `RFC_ERROR_COMMUNICATION` | host/system number, firewall (port 33NN), or DNS — behind a corporate DNS set `MERIDIAN_DNS_1/2` in `.env` |
| `NOT_AUTHORIZED` / table `failed` on Coverage | missing `S_TABU_DIS`/`S_TABU_NAM` for that table |
