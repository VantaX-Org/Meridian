# SAP authorisation role template: read-only extraction

A PFCG role for the RFC user Meridian connects with (ECC, S/4HANA on-premise,
EWM). It grants reading only: no change authorisations, no dialog logon. Copy it
into a role such as `Z_MERIDIAN_READ`, generate the profile and assign it to a
**system** or **communication** user (SU01 user type B or C).

Meridian reads SAP data along one of three paths, chosen per system on its
connection settings (`extraction_path`, see "Choosing the extraction path"
below):

| Path | What the role needs |
|---|---|
| Table reader (`table_reader`, the default) | `S_RFC` for one table reader and `S_TABU_NAM` / `S_TABU_DIS` for the tables |
| ODP (`odp`, or `auto`) | `S_RFC` for function group `RODPS_REPL` and the ODP authorisations below; the table reader only for tables no ODP provider covers |
| OData (`odata`, S/4HANA on premise) | `S_SERVICE` for the Gateway services and the back-end authorisations of those APIs; no table reads |

For the table reader, Meridian reads tables through one of three read-only
function modules. Grant the one your Basis team accepts; the connector uses
whichever is set (see "Choosing the table reader" below).

| Reader | Work area | Notes |
|---|---|---|
| `/BODS/RFC_READ_TABLE2` | up to 30,000 bytes per row | Shipped with the SAP Data Services / ODP support packages. A wide table (MARA, MARC) reads in one pass instead of column groups. |
| `BBP_RFC_READ_TABLE` | 512 bytes per row | Same interface as `RFC_READ_TABLE`; sites that refuse `RFC_READ_TABLE` by name sometimes allow it. Wide tables are read in column groups. |
| `RFC_READ_TABLE` | 512 bytes per row | The default. Wide tables are read in column groups and joined on the key. |

## Authorisation objects

### S_RFC: remote function calls

`ACTVT = 16` (execute). Grant by function module (`RFC_TYPE = FUNC`, available
on current kernels) so nothing else in the function groups is opened:

| `RFC_NAME` (`RFC_TYPE = FUNC`) | Used for |
|---|---|
| `RFC_PING` | connection test |
| `RFC_SYSTEM_INFO` | release, system ID, discovery |
| `DDIF_FIELDINFO_GET` | field definitions of the tables read (discovery) |
| `RFC_GET_FUNCTION_INTERFACE`, `RFC_METADATA_GET` | interface metadata the RFC library reads before each call |
| `EM_GET_NUMBER_OF_ENTRIES` | row counts, to prove an unfiltered extraction is complete (optional: without it the count check is skipped) |
| **one reader:** `/BODS/RFC_READ_TABLE2`, `BBP_RFC_READ_TABLE` or `RFC_READ_TABLE` | table reads |
| `RFC_FUNCTION_SEARCH` | finds which reader exists (`read_function = auto`), whether the ODP functions exist (`extraction_path = auto`), and is used by the vendor write-back pre-check; grant it in the read role |
| `RODPS_REPL_ODP_GET_DETAIL`, `RODPS_REPL_ODP_OPEN`, `RODPS_REPL_ODP_FETCH`, `RODPS_REPL_ODP_CLOSE` | only with `extraction_path = odp` or `auto` (function group `RODPS_REPL`) |

Where the kernel only supports `RFC_TYPE = FUGR`, grant the function groups
instead: `SYST` (RFC_PING), `SRFC` (RFC_SYSTEM_INFO), `SDTX` (RFC_READ_TABLE),
`SDIFRUNTIME` (DDIF_FIELDINFO_GET), `RFC1` and `RFC_METADATA` (interface
metadata). For `/BODS/RFC_READ_TABLE2`, `BBP_RFC_READ_TABLE`,
`EM_GET_NUMBER_OF_ENTRIES` and `RFC_FUNCTION_SEARCH`, read the function group
from SE37 (Attributes tab) on your system: it depends on the component and
release that delivered the module, so it is not listed here.

The payroll totals extraction (optional, `docs/payroll-rfc.md`) adds one
customer function module, `Z_MERIDIAN_PAYROLL_TOTALS`.

### S_TABU_NAM (preferred) or S_TABU_DIS: table reads

`ACTVT = 03` (display) only. Prefer `S_TABU_NAM` with the exact table names over
`S_TABU_DIS` authorisation groups, which open every table in a group.

The table list per module is in `docs/sap-connector.md` (section "S_TABU_DIS /
S_TABU_NAM"). Grant the tables of the modules you extract, plus:

- data dictionary (discovery): `DD01L DD02L DD02T DD03L DD04L DD05S DD07L TADIR CVERS`
- organisational structure: `T001 T001K T001L T001W T024E TKA01 TVKO`
- change documents, if delta extraction or root cause is used: `CDHDR CDPOS`
- vendor write-back pre-check (read before a vendor change is proposed): `CVI_VEND_LINK BUT000 BUT020 BUT0BK LFA1`

If your policy requires `S_TABU_DIS`, grant `ACTVT = 03` with the authorisation
groups (`DICBERCLS`) of exactly those tables (SE54 or table TDDAT shows each
table's group).

### S_TCODE, S_DEVELOP, change objects: none

Grant no transaction codes (the user does not log on in dialog), no `S_DEVELOP`,
and no change activity (`ACTVT = 01`, `02`, `06`) on any object. With this role
Meridian cannot change SAP data: corrections leave as export files (LSMW / BAPI
input / CSV) that your own process loads.

## ODP extraction

With `extraction_path = odp` (or `auto` where the functions exist) Meridian
reads the classic extractors (context `SAPI`: `0MATERIAL_ATTR`,
`0MAT_PLANT_ATTR`, `0CUSTOMER_ATTR`, `0VENDOR_ATTR`, `0GL_ACCOUNT_ATTR`) and,
on S/4HANA, released CDS views with an extraction annotation (context
`ABAP_CDS`: `I_Product`, `I_Customer`, `I_Supplier`, `I_BusinessPartner`).
Full extraction only: no delta initialisation is requested. The provider list
and the table fields each one carries are in `sap/odp_mappings.yaml`.

| Object | Fields | Notes |
|---|---|---|
| `S_RFC` | `RFC_TYPE = FUGR`, `RFC_NAME = RODPS_REPL`, `ACTVT = 16`; or the four `RODPS_REPL_ODP_*` modules with `RFC_TYPE = FUNC` | plus `RFC_GET_FUNCTION_INTERFACE`: Meridian reads each function's interface before calling it |
| `S_RO_OSOA` | DataSource (`OLTPSOURCE`) the extractors above, application component (`OSOAAPCO`) as needed, `OSOAPART = DATA` (or `DEFINITION` for the field list), `ACTVT = 03` | SAPI extractors. Confirm the fields and values in SU24 for `RODPS_REPL_ODP_OPEN` on your release. |
| `S_RS_ODP` (where your release has it) | ODP context and name, display | Confirm in SU24/SE37: the object and its fields depend on the release and the SAP_BW component level. |
| The CDS views' own access controls | the authorisation objects the view's DCL checks (for `I_Customer` and `I_Supplier` the business partner and customer/vendor objects), display only | `ABAP_CDS` only. Confirm per view in SU24 or the view's access control (SE11 / ADT). |
| Subscriber type | `MERIDIAN_ODP_SUBSCRIBER_TYPE` (default `RODPS_REPL_TEST`) | Shows in ODQMON. Agree the value with the Basis team. |

Before using the ODP RFC interface in production, read SAP Note 3255746 with
your SAP account team: it restricts the use of the RODPS_REPL RFC modules by
customer and third-party applications, and names ODP over OData as SAP's
supported alternative. Where that note applies to you, choose the OData path
below or keep the table reader.

## OData through the SAP Gateway (S/4HANA on premise)

With `extraction_path = odata` Meridian reads the released APIs your Gateway
exposes (`API_BUSINESS_PARTNER`, `API_PRODUCT_SRV`,
`API_GLACCOUNTINCHARTOFACCOUNTS_SRV`; activate them in `/IWFND/MAINT_SERVICE`).
GET requests only. The role needs:

- `S_SERVICE` for each of those services (add them to the role menu as
  "Authorization Default" `TADIR Service` objects, `IWSG` and `IWSV`, and PFCG
  fills in the hashed service names),
- the back-end display authorisations those APIs check (for example
  `B_BUPA_GRP` and `B_BUPA_RLT` for business partners, `M_MATE_STA` and
  `M_MATE_WRK` for products, `F_SKA1_KTP` for G/L accounts), `ACTVT = 03`
  only. Confirm the list in SU24 for each service on your release.

No `S_TABU_*` and no table reader is needed on this path.

## Live write-back is a separate role

Live write-back (off by default, `MERIDIAN_LIVE_WRITEBACK_ENABLED`) needs change
authorisations and must be a **separate** role on a **separate** user, approved
by its own process. It is needed only when live write-back is turned on; the
read-only role above stays as it is. It calls `BAPI_MATERIAL_SAVEDATA`,
`BAPI_BUPA_CENTRAL_CHANGE`, `BAPI_BUPA_ADDRESS_CHANGE`,
`BAPI_BUPA_BANKDETAIL_CHANGE`, `BAPI_CUSTOMER_CHANGEFROMDATA1`,
`BAPI_TRANSACTION_COMMIT` and `BAPI_TRANSACTION_ROLLBACK`, and needs the
application objects those BAPIs check (for example `M_MATE_STA`, `M_MATE_WRK`,
`B_BUPA_GRP`, `B_BUPA_RLT`, `F_KNA1_BUK`, `V_KNA1_VKO`, each with change
activity). Do not add these to the read-only role.

## Choosing the extraction path

Per system, on its connection settings (Extraction path; stored in
`sap_systems.extraction_path`); per deployment, `MERIDIAN_EXTRACTION_PATH` in
`.env` for systems that have none:

| Value | Path |
|---|---|
| `table_reader` (default) | every table through the table reader |
| `odp` | every table an ODP provider maps reads through ODP, even when the provider lacks some fields the rules need (those fields are listed per table and their rules are not evaluable); the other tables use the table reader |
| `auto` | ODP for a table when the `RODPS_REPL_ODP_*` functions exist (probed with `RFC_FUNCTION_SEARCH`) and a provider carries every field the rules need; the table reader otherwise |
| `odata` | S/4HANA on premise only: the Gateway's released APIs, with the system's user and password (or OAuth client credentials) and its client as `sap-client` |

ODP reads a provider in full, so a table read with a date window, a scope or
by parent keys always uses the table reader. Each table's line in the
extraction (the job's Tables list and the Basis home) says which path read it.

## Choosing the table reader

Per system, on its connection settings (Table reader; stored in
`sap_systems.read_function`); per deployment, the `MERIDIAN_RFC_READ_FUNCTION`
setting in `.env`:

| Value | Reader |
|---|---|
| `RFC_READ_TABLE` (default) | `RFC_READ_TABLE` |
| `/BODS/RFC_READ_TABLE2` | the Data Services reader |
| `BBP_RFC_READ_TABLE` | the SRM reader |
| `auto` | probes `RFC_FUNCTION_SEARCH` for `/BODS/RFC_READ_TABLE2`, then `BBP_RFC_READ_TABLE`; falls back to `RFC_READ_TABLE` when neither exists or the search is not authorised |

The extracted DataFrame is the same whichever reader is used.

## Check the role

With the user and role in place, run Systems → system → Test connection, then
an extraction of one module. A table the user may not read shows as `failed`
on the system's Coverage tab with SAP's message. `SU53` on the SAP side shows
the last failed authorisation check of the user.
