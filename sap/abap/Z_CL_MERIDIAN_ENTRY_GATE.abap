*&---------------------------------------------------------------------*
*& Meridian entry gate client — shared by the point-of-entry samples
*&
*& Posts ONE candidate record to the Meridian data quality firewall
*& (POST /api/v1/dq-firewall/validate) and turns the answer into a
*& decision. The firewall returns verdict "block" (a critical rule
*& fails) or "pass"; a record that passes can still carry failing rules
*& of lower severity, and those are shown as a warning, never a block.
*& Nothing is written to SAP. Setup: docs/point-of-entry.md.
*&
*& Prerequisites
*&  - SM59 HTTP destination (type G) to the Meridian host, TLS on. The
*&    API key goes in the destination as header Authorization:
*&    "Bearer mk_..." (a key scoped to the firewall, see the doc).
*&  - TVARVC parameter ZMERIDIAN_GATE_FAILMODE: OPEN (default) lets the
*&    save through when Meridian cannot be reached, CLOSED blocks it.
*&  - Message class ZMERIDIAN, 001 (block) and 002 (warn), both with
*&    one variable &1 (create in SE91, text "&1").
*& Authorization: none beyond the user's own; the call is made by the
*& SAP work process, not by the user.
*&---------------------------------------------------------------------*
CLASS zcl_meridian_entry_gate DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_field,
             name  TYPE string,   " TABLE.FIELD as the rule packs name it, e.g. MARA.MATNR
             value TYPE string,
           END OF ty_field,
           tt_field TYPE STANDARD TABLE OF ty_field WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_failure,
             rule_id     TYPE string,
             description TYPE string,
             field       TYPE string,
             severity    TYPE string,
           END OF ty_failure,
           tt_failure TYPE STANDARD TABLE OF ty_failure WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_record,
             index    TYPE i,
             verdict  TYPE string,
             failures TYPE tt_failure,
           END OF ty_record,
           tt_record TYPE STANDARD TABLE OF ty_record WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_answer,
             verdict TYPE string,
             records TYPE tt_record,
           END OF ty_answer.
    CONSTANTS: c_destination TYPE rfcdest VALUE 'MERIDIAN_FIREWALL',
               c_timeout     TYPE i VALUE 5.   " seconds; a save must not wait longer
    "! Returns abap_true when the save must stop. et_text holds one line per failing rule.
    CLASS-METHODS check
      IMPORTING iv_module TYPE string
                it_fields TYPE tt_field
      EXPORTING ev_block  TYPE abap_bool
                et_text   TYPE string_table.
ENDCLASS.

CLASS zcl_meridian_entry_gate IMPLEMENTATION.
  METHOD check.
    DATA: lo_client TYPE REF TO if_http_client,
          lv_json   TYPE string,
          lv_body   TYPE string,
          lv_mode   TYPE tvarvc-low,
          ls_answer TYPE ty_answer.
    CLEAR: ev_block, et_text.

    SELECT SINGLE low FROM tvarvc INTO lv_mode
      WHERE name = 'ZMERIDIAN_GATE_FAILMODE' AND type = 'P' AND numb = '0000'.
    IF lv_mode IS INITIAL.
      lv_mode = 'OPEN'.
    ENDIF.

    " request body: {"module": "...", "records": [ {"TABLE.FIELD": "value", ...} ]}
    lv_json = |{ '{"module":"' }{ iv_module }{ '","records":[{' }|.
    LOOP AT it_fields INTO DATA(ls_field).
      IF sy-tabix > 1.
        lv_json = lv_json && ','.
      ENDIF.
      lv_json = lv_json && |"{ ls_field-name }":"{ escape( val = ls_field-value format = cl_abap_format=>e_json_string ) }"|.
    ENDLOOP.
    lv_json = lv_json && '}]}'.

    cl_http_client=>create_by_destination(
      EXPORTING destination = c_destination
      IMPORTING client = lo_client
      EXCEPTIONS OTHERS = 1 ).
    IF sy-subrc <> 0.
      ev_block = COND #( WHEN lv_mode = 'CLOSED' THEN abap_true ELSE abap_false ).
      APPEND |Meridian could not be reached ({ lv_mode } mode).| TO et_text.
      RETURN.
    ENDIF.
    lo_client->request->set_method( if_http_request=>co_request_method_post ).
    lo_client->request->set_header_field( name = 'Content-Type' value = 'application/json' ).
    lo_client->request->set_cdata( lv_json ).
    lo_client->send( EXPORTING timeout = c_timeout EXCEPTIONS OTHERS = 1 ).
    IF sy-subrc = 0.
      lo_client->receive( EXCEPTIONS OTHERS = 1 ).
    ENDIF.
    DATA(lv_status) = 0.
    lo_client->response->get_status( IMPORTING code = lv_status ).
    lv_body = lo_client->response->get_cdata( ).
    lo_client->close( ).

    IF sy-subrc <> 0 OR lv_status <> 200.
      " timeout, 401/403 (bad key), 422 (unknown field) or 5xx: the firewall gave no verdict
      ev_block = COND #( WHEN lv_mode = 'CLOSED' THEN abap_true ELSE abap_false ).
      APPEND |Meridian gave no verdict (HTTP { lv_status }, { lv_mode } mode).| TO et_text.
      RETURN.
    ENDIF.

    /ui2/cl_json=>deserialize( EXPORTING json = lv_body pretty_name = /ui2/cl_json=>pretty_mode-low_case
                               CHANGING data = ls_answer ).
    ev_block = xsdbool( ls_answer-verdict = 'block' ).
    LOOP AT ls_answer-records INTO DATA(ls_rec).
      LOOP AT ls_rec-failures INTO DATA(ls_fail).
        APPEND |{ ls_fail-rule_id } { ls_fail-field }: { ls_fail-description }| TO et_text.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
