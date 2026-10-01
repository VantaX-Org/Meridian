*&---------------------------------------------------------------------*
*& Meridian payroll totals — READ-ONLY, RFC-enabled
*&
*& Returns, per payroll result Meridian names (PERNR + SEQNR from
*& HRPY_RGDIR), the totals of selected wage types from the results table
*& (RT) of the international payroll cluster. Nothing is written. Payroll
*& clusters cannot be read with RFC_READ_TABLE; this function is the only
*& custom object Meridian needs. Installation: docs/payroll-rfc.md.
*&
*& Function group : ZMERIDIAN        Processing type: Remote-enabled module
*& Authorization  : P_PCLX (RELID of the country cluster, AUTHC = R) is
*&                  checked per employee; employees the caller may not read
*&                  are skipped and counted in EV_SKIPPED.
*&---------------------------------------------------------------------*
FUNCTION z_meridian_payroll_totals.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  EXPORTING
*"     VALUE(EV_SKIPPED) TYPE I
*"  TABLES
*"      IT_RESULTS STRUCTURE ZMERIDIAN_S_RGKEY
*"      IT_WAGETYPES STRUCTURE ZMERIDIAN_S_LGART OPTIONAL
*"      ET_TOTALS STRUCTURE ZMERIDIAN_PAYRT
*"----------------------------------------------------------------------
  DATA: lt_rgdir  TYPE STANDARD TABLE OF pc261,
        ls_rgdir  TYPE pc261,
        ls_key    TYPE zmeridian_s_rgkey,
        ls_result TYPE pay99_result,
        ls_rt     TYPE pc207,
        ls_total  TYPE zmeridian_payrt,
        lv_molga  TYPE molga,
        lv_relid  TYPE relid_pcl,
        lv_pernr  TYPE pernr_d,
        lr_lgart  TYPE RANGE OF lgart,
        ls_lgart  LIKE LINE OF lr_lgart.

  CLEAR: et_totals[], ev_skipped.
  " default: total gross, bank transfer, amount paid, claim
  IF it_wagetypes[] IS INITIAL.
    ls_lgart-sign = 'I'. ls_lgart-option = 'EQ'.
    ls_lgart-low = '/101'. APPEND ls_lgart TO lr_lgart.
    ls_lgart-low = '/559'. APPEND ls_lgart TO lr_lgart.
    ls_lgart-low = '/560'. APPEND ls_lgart TO lr_lgart.
    ls_lgart-low = '/561'. APPEND ls_lgart TO lr_lgart.
  ELSE.
    LOOP AT it_wagetypes.
      ls_lgart-sign = 'I'. ls_lgart-option = 'EQ'. ls_lgart-low = it_wagetypes-lgart.
      APPEND ls_lgart TO lr_lgart.
    ENDLOOP.
  ENDIF.

  SORT it_results BY pernr seqnr.
  LOOP AT it_results INTO ls_key.
    IF ls_key-pernr <> lv_pernr.          " new employee: directory + cluster id + authority
      lv_pernr = ls_key-pernr.
      CLEAR: lt_rgdir, lv_molga, lv_relid.
      CALL FUNCTION 'CU_READ_RGDIR'
        EXPORTING  persnr          = lv_pernr
        IMPORTING  molga           = lv_molga
        TABLES     in_rgdir        = lt_rgdir
        EXCEPTIONS no_record_found = 1
                   OTHERS          = 2.
      IF sy-subrc = 0.
        SELECT SINGLE relid FROM t500l INTO lv_relid WHERE molga = lv_molga.
      ENDIF.
      IF lv_relid IS NOT INITIAL.
        AUTHORITY-CHECK OBJECT 'P_PCLX' ID 'RELID' FIELD lv_relid ID 'AUTHC' FIELD 'R'.
        IF sy-subrc <> 0.
          CLEAR lv_relid.
        ENDIF.
      ENDIF.
    ENDIF.
    IF lv_relid IS INITIAL.
      ev_skipped = ev_skipped + 1.
      CONTINUE.
    ENDIF.
    READ TABLE lt_rgdir INTO ls_rgdir WITH KEY seqnr = ls_key-seqnr.
    IF sy-subrc <> 0.
      ev_skipped = ev_skipped + 1.
      CONTINUE.
    ENDIF.
    CLEAR ls_result.
    CALL FUNCTION 'PYXX_READ_PAYROLL_RESULT'
      EXPORTING  clusterid               = lv_relid
                 employeenumber          = lv_pernr
                 sequencenumber          = ls_key-seqnr
                 read_only_international = 'X'
      CHANGING   payroll_result          = ls_result
      EXCEPTIONS OTHERS                  = 1.
    IF sy-subrc <> 0.
      ev_skipped = ev_skipped + 1.
      CONTINUE.
    ENDIF.
    LOOP AT ls_result-inter-rt INTO ls_rt WHERE lgart IN lr_lgart.
      CLEAR ls_total.
      ls_total-pernr = lv_pernr.
      ls_total-seqnr = ls_key-seqnr.
      ls_total-fpper = ls_rgdir-fpper.
      ls_total-inper = ls_rgdir-inper.
      ls_total-paydt = ls_rgdir-paydt.
      ls_total-lgart = ls_rt-lgart.
      ls_total-betrg = ls_rt-betrg.
      ls_total-anzhl = ls_rt-anzhl.
      ls_total-waers = ls_result-inter-versc-waers.
      COLLECT ls_total INTO et_totals.     " RT can split a wage type: sum per result and wage type
    ENDLOOP.
  ENDLOOP.
ENDFUNCTION.

*&---------------------------------------------------------------------*
*& DDIC structures (SE11, package of your choice, no table maintenance)
*&
*& ZMERIDIAN_S_RGKEY  PERNR  PERNR_D        personnel number
*&                    SEQNR  CDSEQ          sequence number of the result
*& ZMERIDIAN_S_LGART  LGART  LGART          wage type
*& ZMERIDIAN_PAYRT    PERNR  PERNR_D        personnel number
*&                    SEQNR  CDSEQ          sequence number of the result
*&                    FPPER  FAPER          for-period
*&                    INPER  IPERI          in-period
*&                    PAYDT  PAY_DATE       payment date
*&                    LGART  LGART          wage type
*&                    BETRG  MAXBT          amount   (reference field WAERS)
*&                    ANZHL  PRANZ          number
*&                    WAERS  WAERS          currency
*&---------------------------------------------------------------------*
