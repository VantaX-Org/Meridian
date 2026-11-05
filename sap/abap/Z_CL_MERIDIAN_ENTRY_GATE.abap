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
*&  - TVARVC parameter ZMERIDIAN_GATE_HOLD: OFF (default), BLOCKED or
*&    FLAGGED. When not OFF the body carries "hold" and Meridian stages
*&    the candidate as a change request; its answer "save" (stop or go)
*&    then decides ev_block instead of the plain verdict. A record that
*&    an approver released may be saved even when its verdict is block.
*&    NOT RUN ON A LIVE SAP SYSTEM: this part has not been executed.
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
    " Answer of the opt-in duplicate search: the existing record's key and a score, never its values.
    TYPES: BEGIN OF ty_match,
             key   TYPE string,
             score TYPE f,
           END OF ty_match,
           tt_match TYPE STANDARD TABLE OF ty_match WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_dups,
             verdict TYPE string,
             matches TYPE tt_match,
           END OF ty_dups.
    " Hold state of a record (only when hold is on): held, released, rejected, written or not_held.
    TYPES: BEGIN OF ty_hold,
             state      TYPE string,
             request_id TYPE string,
             reason     TYPE string,
             sap_key    TYPE string,
           END OF ty_hold.
    TYPES: BEGIN OF ty_record,
             index      TYPE i,
             verdict    TYPE string,
             failures   TYPE tt_failure,
             duplicates TYPE ty_dups,
             hold       TYPE ty_hold,
           END OF ty_record,
           tt_record TYPE STANDARD TABLE OF ty_record WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_answer,
             verdict TYPE string,
             save    TYPE string,   " stop or go; only present when hold is on
             records TYPE tt_record,
           END OF ty_answer.
    CONSTANTS: c_destination TYPE rfcdest VALUE 'MERIDIAN_FIREWALL',
               c_timeout     TYPE i VALUE 5.   " seconds; a save must not wait longer
    "! Returns abap_true when the save must stop. et_text holds one line per failing rule.
    CLASS-METHODS check
      IMPORTING iv_module TYPE string
                it_fields TYPE tt_field
                iv_duplicates TYPE abap_bool DEFAULT abap_false
      EXPORTING ev_block  TYPE abap_bool
                et_text   TYPE string_table.
ENDCLASS.

CLASS zcl_meridian_entry_gate IMPLEMENTATION.
  METHOD check.
    DATA: lo_client TYPE REF TO if_http_client,
          lv_json   TYPE string,
          lv_body   TYPE string,
          lv_mode   TYPE tvarvc-low,
          lv_hold   TYPE tvarvc-low,
          ls_answer TYPE ty_answer.
    CLEAR: ev_block, et_text.

    SELECT SINGLE low FROM tvarvc INTO lv_mode
      WHERE name = 'ZMERIDIAN_GATE_FAILMODE' AND type = 'P' AND numb = '0000'.
    IF lv_mode IS INITIAL.
      lv_mode = 'OPEN'.
    ENDIF.

    SELECT SINGLE low FROM tvarvc INTO lv_hold
      WHERE name = 'ZMERIDIAN_GATE_HOLD' AND type = 'P' AND numb = '0000'.
    TRANSLATE lv_hold TO UPPER CASE.
    IF lv_hold <> 'BLOCKED' AND lv_hold <> 'FLAGGED'.
      lv_hold = 'OFF'.
    ENDIF.

    " request body: {"module": "...", "records": [ {"TABLE.FIELD": "value", ...} ]}
    lv_json = |{ '{"module":"' }{ iv_module }{ '","records":[{' }|.
    LOOP AT it_fields INTO DATA(ls_field).
      IF sy-tabix > 1.
        lv_json = lv_json && ','.
      ENDIF.
      lv_json = lv_json && |"{ ls_field-name }":"{ escape( val = ls_field-value format = cl_abap_format=>e_json_string ) }"|.
    ENDLOOP.
    lv_json = lv_json && '}]'.
    " opt-in: also look for likely duplicates among existing records; without it the body is as before
    IF iv_duplicates = abap_true.
      lv_json = lv_json && ',"duplicates":true'.
    ENDIF.
    " opt-in: stage the candidate as a change request; without it the body is as before
    IF lv_hold <> 'OFF'.
      TRANSLATE lv_hold TO LOWER CASE.
      lv_json = lv_json && |,"hold":"{ lv_hold }"|.
    ENDIF.
    lv_json = lv_json && '}'.

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
    " with hold on, the save answer overrides the plain verdict (a released record may go on)
    IF ls_answer-save IS NOT INITIAL.
      ev_block = xsdbool( ls_answer-save = 'stop' ).
    ENDIF.
    LOOP AT ls_answer-records INTO DATA(ls_rec).
      LOOP AT ls_rec-failures INTO DATA(ls_fail).
        APPEND |{ ls_fail-rule_id } { ls_fail-field }: { ls_fail-description }| TO et_text.
      ENDLOOP.
      IF ls_rec-hold-state IS NOT INITIAL.
        APPEND |Hold { ls_rec-hold-state } { ls_rec-hold-reason }, request { ls_rec-hold-request_id }{ COND string( WHEN ls_rec-hold-sap_key IS NOT INITIAL THEN | (SAP key { ls_rec-hold-sap_key })| ) }.| TO et_text.
      ENDIF.
      " a duplicate only warns: it is added to the text and never sets ev_block
      LOOP AT ls_rec-duplicates-matches INTO DATA(ls_match).
        APPEND |Likely duplicate of existing record { ls_match-key } (score { ls_match-score DECIMALS = 2 }).| TO et_text.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
