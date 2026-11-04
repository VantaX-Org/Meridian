*&---------------------------------------------------------------------*
*& Meridian point of entry — customer master (XD01 / XD02, or BP)
*&
*& This sample is a plain form that you call from the customer master
*& check enhancement you use. It deliberately names no BAdI: choose the
*& enhancement spot with your SAP basis team (for XD01/XD02 the customer
*& master save has a check enhancement in the customer-vendor
*& integration; on S/4HANA the same data is saved through business
*& partner transaction BP). Call PERFORM meridian_customer_check at the
*& point where the screen data is complete and a message can still stop
*& the save.
*&
*& Fields sent are ones the sd_customer_master rule pack reads:
*& KNA1.KUNNR, KNA1.NAME1, KNA1.LAND1, KNA1.STCD1, KNA1.KTOKD,
*& KNA1.ORT01, KNB1.ZTERM.
*& Requires Z_CL_MERIDIAN_ENTRY_GATE. Setup: docs/point-of-entry.md.
*&---------------------------------------------------------------------*
FORM meridian_customer_check USING is_kna1 TYPE kna1 is_knb1 TYPE knb1.
  DATA: lt_fields TYPE zcl_meridian_entry_gate=>tt_field,
        lt_text   TYPE string_table,
        lv_block  TYPE abap_bool.

  lt_fields = VALUE #(
    ( name = 'KNA1.KUNNR' value = is_kna1-kunnr )
    ( name = 'KNA1.NAME1' value = is_kna1-name1 )
    ( name = 'KNA1.LAND1' value = is_kna1-land1 )
    ( name = 'KNA1.STCD1' value = is_kna1-stcd1 )
    ( name = 'KNA1.KTOKD' value = is_kna1-ktokd )
    ( name = 'KNA1.ORT01' value = is_kna1-ort01 )
    ( name = 'KNB1.ZTERM' value = is_knb1-zterm ) ).

  zcl_meridian_entry_gate=>check(
    EXPORTING iv_module = 'sd_customer_master' it_fields = lt_fields
    IMPORTING ev_block = lv_block et_text = lt_text ).

  LOOP AT lt_text INTO DATA(lv_line).
    IF lv_block = abap_true.
      MESSAGE e001(zmeridian) WITH lv_line.
    ELSE.
      MESSAGE w002(zmeridian) WITH lv_line.
    ENDIF.
  ENDLOOP.
ENDFORM.
