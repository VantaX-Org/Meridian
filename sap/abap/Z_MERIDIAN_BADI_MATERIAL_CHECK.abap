*&---------------------------------------------------------------------*
*& Meridian point of entry — material master (MM01 / MM02)
*&
*& Implementation of the standard BAdI BADI_MATERIAL_CHECK, method
*& CHECK_DATA, which SAP calls when a material is saved in MM01 and
*& MM02. Sends the material to the Meridian firewall and:
*&   verdict "block" (a critical rule fails)  -> error message, no save
*&   verdict "pass" with failing lower rules  -> warning, save goes on
*&   verdict "pass" and no failures           -> silent
*& Fields sent are ones the material_master rule pack reads (MARA.MATNR,
*& MARA.MTART, MARA.MEINS, MARA.MATKL, MARA.GEWEI, MAKT.MAKTX).
*& A field that the pack does not read is refused by the firewall (422),
*& which the client treats as "no verdict" (fail mode, see the class).
*&
*& CHECK BEFORE ACTIVATING: the importing parameters of CHECK_DATA
*& differ by release. Open BADI_MATERIAL_CHECK in SE18, read the
*& signature of IF_EX_BADI_MATERIAL_CHECK~CHECK_DATA and map the
*& structures it hands you (the general-data and description structures)
*& where the sample uses WMARA and WMAKT. Everything else is as is.
*& Requires Z_CL_MERIDIAN_ENTRY_GATE. Setup: docs/point-of-entry.md.
*&---------------------------------------------------------------------*
METHOD if_ex_badi_material_check~check_data.
  DATA: lt_fields TYPE zcl_meridian_entry_gate=>tt_field,
        lt_text   TYPE string_table,
        lv_block  TYPE abap_bool.

  " Map from the structures the method gives you (adapt to the SE18 signature).
  lt_fields = VALUE #(
    ( name = 'MARA.MATNR' value = wmara-matnr )
    ( name = 'MARA.MTART' value = wmara-mtart )
    ( name = 'MARA.MEINS' value = wmara-meins )
    ( name = 'MARA.MATKL' value = wmara-matkl )
    ( name = 'MARA.GEWEI' value = wmara-gewei )
    ( name = 'MAKT.MAKTX' value = wmakt-maktx ) ).

  zcl_meridian_entry_gate=>check(
    EXPORTING iv_module = 'material_master' it_fields = lt_fields
              iv_duplicates = abap_true   " opt-in duplicate search; drop this line to leave it off
    IMPORTING ev_block = lv_block et_text = lt_text ).

  CHECK lt_text IS NOT INITIAL.
  LOOP AT lt_text INTO DATA(lv_line).
    IF lv_block = abap_true.
      MESSAGE e001(zmeridian) WITH lv_line.   " stops the save
    ELSE.
      MESSAGE w002(zmeridian) WITH lv_line.   " warns, save continues
    ENDIF.
  ENDLOOP.
ENDMETHOD.
