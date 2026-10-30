# SAP authorisation role template: read-only extraction

A PFCG role for the RFC user Meridian connects with (ECC, S/4HANA on-premise,
EWM). It grants reading only: no change authorisations, no dialog logon. Copy it
into a role such as `Z_MERIDIAN_READ`, generate the profile and assign it to a
**system** or **communication** user (SU01 user type B or C).

Meridian reads tables through one of three read-only function modules. Grant the
one your Basis team accepts; the connector uses whichever is set (see "Choosing
the table reader" below).

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
| `RFC_FUNCTION_SEARCH` | only with `read_function = auto`, to find which reader exists (optional) |

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

If your policy requires `S_TABU_DIS`, grant `ACTVT = 03` with the authorisation
groups (`DICBERCLS`) of exactly those tables (SE54 or table TDDAT shows each
table's group).

### S_TCODE, S_DEVELOP, change objects: none

Grant no transaction codes (the user does not log on in dialog), no `S_DEVELOP`,
and no change activity (`ACTVT = 01`, `02`, `06`) on any object. With this role
Meridian cannot change SAP data: corrections leave as export files (LSMW / BAPI
input / CSV) that your own process loads.

## Live write-back is a separate role

Live write-back (off by default, `MERIDIAN_LIVE_WRITEBACK_ENABLED`) needs change
authorisations and must be a **separate** role on a **separate** user, approved
by its own process. It calls `BAPI_MATERIAL_SAVEDATA`, `BAPI_BUPA_CENTRAL_CHANGE`,
`BAPI_BUPA_ADDRESS_CHANGE`, `BAPI_CUSTOMER_CHANGEFROMDATA1`,
`BAPI_TRANSACTION_COMMIT` and `BAPI_TRANSACTION_ROLLBACK`, and needs the
application objects those BAPIs check (for example `M_MATE_STA`, `M_MATE_WRK`,
`B_BUPA_GRP`, `B_BUPA_RLT`, `F_KNA1_BUK`, `V_KNA1_VKO`, each with change
activity). Do not add these to the read-only role.

## Choosing the table reader

Per connection, `SAPConnectionParams.read_function`; per deployment, the
`MERIDIAN_RFC_READ_FUNCTION` setting in `.env`:

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
