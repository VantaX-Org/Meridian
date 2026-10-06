"""Fictional material master extract for Material 360 tests and the visual-regression mocks."""
import pandas as pd

A, B, C, D, E = "000000000000000101", "000000000000000102", "000000000000000103", "000000000000000104", "000000000000000105"


def tables() -> dict[str, pd.DataFrame]:
    mara = [
        dict(MATNR=A, MTART="HALB", MATKL="1000", MEINS="EA", VPSTA="KCVEDPALB", BISMT="", MFRPN="", MFRNR="", LVORM=""),
        dict(MATNR=B, MTART="HALB", MATKL="1000", MEINS="EA", VPSTA="KCVEDPALB", BISMT="", MFRPN="", MFRNR="", LVORM=""),
        dict(MATNR=C, MTART="HALB", MATKL="1000", MEINS="EA", VPSTA="KCVEDPALB", BISMT="", MFRPN="", MFRNR="", LVORM=""),
        dict(MATNR=D, MTART="HALB", MATKL="1000", MEINS="EA", VPSTA="KCVEDPALB", BISMT="", MFRPN="", MFRNR="", LVORM=""),
        dict(MATNR=E, MTART="HALB", MATKL="2000", MEINS="EA", VPSTA="KCVEDPALB", BISMT="", MFRPN="", MFRNR="", LVORM=""),
    ]
    makt = [dict(MATNR=A, SPRAS="E", MAKTX="Hydraulic pump seal kit 50mm"),
            dict(MATNR=B, SPRAS="E", MAKTX="Gasket flange old pattern"),
            dict(MATNR=C, SPRAS="E", MAKTX="Gasket flange new pattern"),
            dict(MATNR=D, SPRAS="E", MAKTX="Seal kit pump hydraulic 50mm"),
            dict(MATNR=E, SPRAS="E", MAKTX="Wiper blade standard")]
    marc = [dict(MATNR=A, WERKS=w, PSTAT="EDPALB", MMSTA="", KZAUS="", AUSDT="", NFMAT="", DISMM="PD", LVORM="")
            for w in ("1000", "2000")]
    # A is discontinued in 3000 -> B, and B follows on to A there (two-link loop)
    marc += [dict(MATNR=A, WERKS="3000", PSTAT="EDPALB", MMSTA="", KZAUS="X", AUSDT="2026-12-31", NFMAT=B, DISMM="PD", LVORM="")]
    # B discontinued in 1000 -> C, C -> B (loop)
    marc += [dict(MATNR=B, WERKS="1000", PSTAT="EDPALB", MMSTA="", KZAUS="X", AUSDT="2026-06-30", NFMAT=C, DISMM="PD", LVORM=""),
             dict(MATNR=C, WERKS="1000", PSTAT="EDPALB", MMSTA="", KZAUS="X", AUSDT="2026-09-30", NFMAT=B, DISMM="PD", LVORM=""),
             dict(MATNR=B, WERKS="3000", PSTAT="EDPALB", MMSTA="", KZAUS="X", AUSDT="2026-12-31", NFMAT=A, DISMM="PD", LVORM=""),
             dict(MATNR=D, WERKS="1000", PSTAT="EDPALB", MMSTA="", KZAUS="", AUSDT="", NFMAT="", DISMM="PD", LVORM=""),
             dict(MATNR=E, WERKS="1000", PSTAT="EDPALB", MMSTA="", KZAUS="", AUSDT="", NFMAT="", DISMM="PD", LVORM="")]
    mvke = [dict(MATNR=A, VKORG="2000", VTWEG="10", VMSTA="", LVORM=""),
            dict(MATNR=B, VKORG="2000", VTWEG="10", VMSTA="", LVORM=""),
            dict(MATNR=C, VKORG="2000", VTWEG="10", VMSTA="", LVORM=""),
            dict(MATNR=D, VKORG="3000", VTWEG="10", VMSTA="", LVORM=""),
            dict(MATNR=E, VKORG="2000", VTWEG="10", VMSTA="", LVORM=""),
            dict(MATNR=E, VKORG="3000", VTWEG="10", VMSTA="", LVORM="")]  # A has no sales view for org 3000
    mean = [dict(MATNR=A, MEINH="EA", EAN11="5901234123457", EANTP="HE"),
            dict(MATNR=D, MEINH="EA", EAN11="5901234123457", EANTP="HE")]  # shared EAN
    mbew = [dict(MATNR=A, BWKEY="1000", BWTAR="", BKLAS="3000", VPRSV="S", LVORM=""),
            dict(MATNR=E, BWKEY="1000", BWTAR="", BKLAS="3000", VPRSV="S", LVORM="")]
    t134 = [dict(MTART="HALB", PSTAT="KCVEDPALB"), ]
    stpo = [dict(STLNR="00000001", STLKN="10", IDNRK=B, NFGRP="", LKENZ="", KZNFP="", NFEAG="")]
    mast = [dict(MATNR=A, WERKS="1000", STLNR="00000001")]
    f = pd.DataFrame
    return {"MARA": f(mara), "MAKT": f(makt), "MARC": f(marc), "MVKE": f(mvke), "MEAN": f(mean), "MBEW": f(mbew),
            "MARD": f([]), "MLGN": f([]), "MARM": f([dict(MATNR=A, MEINH="EA", UMREZ="1", UMREN="1")]),
            "T134": f(t134), "STPO": f(stpo), "MAST": f(mast)}
