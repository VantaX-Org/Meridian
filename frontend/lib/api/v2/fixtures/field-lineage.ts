/**
 * Fixture for GET /lineage/fields: the material master field lineage as the service builds it from the repo's ECC
 * dictionary and rule packs (tables, fields, check tables and rule ids are real dictionary and rule-pack names; the two
 * glossary terms are synthetic). Other objects answer with no tables, as the service does for an object it does not
 * extract.
 */
import type { FieldLineage } from "../field-lineage";

export const NONE_FIELD_LINEAGE = Symbol("none-field-lineage");

const MATERIAL = {
  "module": "material_master",
  "system_type": "ecc",
  "release": "ecc6",
  "tables": [
    {
      "table": "MARA",
      "text": "General Material Data",
      "in_dictionary": true,
      "fields": [
        {
          "field": "MATNR",
          "in_dictionary": true,
          "text": "Material Number",
          "data_element": "MATNR",
          "domain": "MATNR",
          "type": "CHAR",
          "length": 18,
          "key": true,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 18,
          "rule_ids": [
            "MM001",
            "MM002",
            "MM138",
            "MM226"
          ]
        },
        {
          "field": "MTART",
          "in_dictionary": true,
          "text": "Material type",
          "data_element": "MTART",
          "domain": "MTART",
          "type": "CHAR",
          "length": 4,
          "key": false,
          "check_table": "T134",
          "check_field": "MTART",
          "check_table_text": "Material Types",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [
            "Material type"
          ],
          "rule_count": 15,
          "rule_ids": [
            "MM003",
            "MM140",
            "MM305",
            "MM554"
          ]
        },
        {
          "field": "MBRSH",
          "in_dictionary": true,
          "text": "Industry sector",
          "data_element": "MBRSH",
          "domain": "MBRSH",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": "T137",
          "check_field": "MBRSH",
          "check_table_text": "Industries for materials",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 3,
          "rule_ids": [
            "MM005",
            "MM006",
            "S4M112"
          ]
        },
        {
          "field": "MATKL",
          "in_dictionary": true,
          "text": "Material Group",
          "data_element": "MATKL",
          "domain": "MATKL",
          "type": "CHAR",
          "length": 9,
          "key": false,
          "check_table": "T023",
          "check_field": "MATKL",
          "check_table_text": "Material Groups",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 5,
          "rule_ids": [
            "MM007",
            "MM141",
            "PUR146",
            "S4M114"
          ]
        },
        {
          "field": "MEINS",
          "in_dictionary": true,
          "text": "Base Unit of Measure",
          "data_element": "MEINS",
          "domain": "MEINS",
          "type": "UNIT",
          "length": 3,
          "key": false,
          "check_table": "T006",
          "check_field": "MSEHI",
          "check_table_text": "Units of Measurement",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 21,
          "rule_ids": [
            "MM008",
            "MM142",
            "MM150",
            "MM457"
          ]
        },
        {
          "field": "BRGEW",
          "in_dictionary": true,
          "text": "Gross weight",
          "data_element": "BRGEW",
          "domain": "MENG13",
          "type": "QUAN",
          "length": 13,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 7,
          "rule_ids": [
            "MM015",
            "MM041",
            "MM159",
            "MM225"
          ]
        },
        {
          "field": "NTGEW",
          "in_dictionary": true,
          "text": "Net weight",
          "data_element": "NTGEW",
          "domain": "MENG13",
          "type": "QUAN",
          "length": 13,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 6,
          "rule_ids": [
            "MM014",
            "MM041",
            "MM159",
            "MM319"
          ]
        },
        {
          "field": "GEWEI",
          "in_dictionary": true,
          "text": "Weight Unit",
          "data_element": "GEWEI",
          "domain": "MEINS",
          "type": "UNIT",
          "length": 3,
          "key": false,
          "check_table": "T006",
          "check_field": "MSEHI",
          "check_table_text": "Units of Measurement",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 6,
          "rule_ids": [
            "MM016",
            "MM159",
            "MM225",
            "MM604"
          ]
        },
        {
          "field": "VOLUM",
          "in_dictionary": true,
          "text": "Volume",
          "data_element": "VOLUM",
          "domain": "MENG13",
          "type": "QUAN",
          "length": 13,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 7,
          "rule_ids": [
            "MM160",
            "MM319",
            "MM605",
            "MM608"
          ]
        },
        {
          "field": "VOLEH",
          "in_dictionary": true,
          "text": "Volume unit",
          "data_element": "VOLEH",
          "domain": "MEINS",
          "type": "UNIT",
          "length": 3,
          "key": false,
          "check_table": "T006",
          "check_field": "MSEHI",
          "check_table_text": "Units of Measurement",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 6,
          "rule_ids": [
            "MM017",
            "MM160",
            "MM605",
            "MM608"
          ]
        },
        {
          "field": "BISMT",
          "in_dictionary": true,
          "text": "Old material number",
          "data_element": "BISMT",
          "domain": "BISMT",
          "type": "CHAR",
          "length": 18,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM334"
          ]
        },
        {
          "field": "PRDHA",
          "in_dictionary": true,
          "text": "Product Hierarchy",
          "data_element": "PRODH_D",
          "domain": "PRODH",
          "type": "CHAR",
          "length": 18,
          "key": false,
          "check_table": "T179",
          "check_field": "PRODH",
          "check_table_text": "Materials: Product Hierarchies",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 3,
          "rule_ids": [
            "MM021",
            "MM201",
            "S4M116"
          ]
        }
      ]
    },
    {
      "table": "MAKT",
      "text": "Material Descriptions",
      "in_dictionary": true,
      "fields": [
        {
          "field": "MATNR",
          "in_dictionary": true,
          "text": "Material Number",
          "data_element": "MATNR",
          "domain": "MATNR",
          "type": "CHAR",
          "length": 18,
          "key": true,
          "check_table": "MARA",
          "check_field": "MATNR",
          "check_table_text": "General Material Data",
          "check_delivery_class": null,
          "owner": "material_master",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 2,
          "rule_ids": [
            "MM344",
            "MM448"
          ]
        },
        {
          "field": "SPRAS",
          "in_dictionary": true,
          "text": "Language Key",
          "data_element": "SPRAS",
          "domain": "SPRAS",
          "type": "LANG",
          "length": 1,
          "key": true,
          "check_table": "T002",
          "check_field": "SPRAS",
          "check_table_text": "Language Keys (Component BC-I18)",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM340"
          ]
        },
        {
          "field": "MAKTX",
          "in_dictionary": true,
          "text": "Material description",
          "data_element": "MAKTX",
          "domain": "TEXT40",
          "type": "CHAR",
          "length": 40,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 15,
          "rule_ids": [
            "MM045",
            "MM236",
            "MM341",
            "MM342"
          ]
        },
        {
          "field": "MAKTG",
          "in_dictionary": true,
          "text": "Material description in upper case for matchcodes",
          "data_element": "MAKTG",
          "domain": "CHAR40",
          "type": "CHAR",
          "length": 40,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 2,
          "rule_ids": [
            "MM341",
            "MM342"
          ]
        }
      ]
    },
    {
      "table": "MARC",
      "text": "Plant Data for Material",
      "in_dictionary": true,
      "fields": [
        {
          "field": "MATNR",
          "in_dictionary": true,
          "text": "Material Number",
          "data_element": "MATNR",
          "domain": "MATNR",
          "type": "CHAR",
          "length": 18,
          "key": true,
          "check_table": "MARA",
          "check_field": "MATNR",
          "check_table_text": "General Material Data",
          "check_delivery_class": null,
          "owner": "material_master",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 31,
          "rule_ids": [
            "MM174",
            "MM228",
            "MM235",
            "MM305"
          ]
        },
        {
          "field": "WERKS",
          "in_dictionary": true,
          "text": "Plant",
          "data_element": "WERKS_D",
          "domain": "WERKS",
          "type": "CHAR",
          "length": 4,
          "key": true,
          "check_table": "T001W",
          "check_field": "WERKS",
          "check_table_text": "Plants/Branches",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 40,
          "rule_ids": [
            "MM212",
            "MM228",
            "MM235",
            "MM305"
          ]
        },
        {
          "field": "DISMM",
          "in_dictionary": true,
          "text": "MRP Type",
          "data_element": "DISMM",
          "domain": "DISMM",
          "type": "CHAR",
          "length": 2,
          "key": false,
          "check_table": "T438A",
          "check_field": "DISMM",
          "check_table_text": "MRP Type",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [
            "Planning method"
          ],
          "rule_count": 30,
          "rule_ids": [
            "MM023",
            "MM026",
            "MM087",
            "MM091"
          ]
        },
        {
          "field": "DISPO",
          "in_dictionary": true,
          "text": "MRP controller",
          "data_element": "DISPO",
          "domain": "DISPO",
          "type": "CHAR",
          "length": 3,
          "key": false,
          "check_table": "T024D",
          "check_field": "DISPO",
          "check_table_text": "MRP controllers",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 3,
          "rule_ids": [
            "MM026",
            "MM185",
            "PP029"
          ]
        },
        {
          "field": "DISLS",
          "in_dictionary": true,
          "text": "Lot size (materials planning)",
          "data_element": "DISLS",
          "domain": "DISLS",
          "type": "CHAR",
          "length": 2,
          "key": false,
          "check_table": "T439A",
          "check_field": "DISLS",
          "check_table_text": "MRP Lot Sizes",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 10,
          "rule_ids": [
            "MM085",
            "MM087",
            "MM101",
            "MM171"
          ]
        },
        {
          "field": "BESKZ",
          "in_dictionary": true,
          "text": "Procurement Type",
          "data_element": "BESKZ",
          "domain": "BESKZ",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 4,
          "glossary_terms": [],
          "rule_count": 35,
          "rule_ids": [
            "MM028",
            "MM032",
            "MM083",
            "MM098"
          ]
        },
        {
          "field": "LGPRO",
          "in_dictionary": true,
          "text": "Issue storage location",
          "data_element": "LGPRO",
          "domain": "LGORT",
          "type": "CHAR",
          "length": 4,
          "key": false,
          "check_table": "T001L",
          "check_field": "LGORT",
          "check_table_text": "Storage Locations",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 4,
          "rule_ids": [
            "MM193",
            "MM303",
            "MM723",
            "MM724"
          ]
        },
        {
          "field": "LGFSB",
          "in_dictionary": true,
          "text": "Default storage location for external procurement",
          "data_element": "LGFSB",
          "domain": "LGORT",
          "type": "CHAR",
          "length": 4,
          "key": false,
          "check_table": "T001L",
          "check_field": "LGORT",
          "check_table_text": "Storage Locations",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 3,
          "rule_ids": [
            "MM098",
            "MM194",
            "MM235"
          ]
        },
        {
          "field": "PLIFZ",
          "in_dictionary": true,
          "text": "Planned delivery time in days",
          "data_element": "PLIFZ",
          "domain": "DEC3",
          "type": "DEC",
          "length": 3,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 6,
          "rule_ids": [
            "MM105",
            "MM223",
            "MM234",
            "MM713"
          ]
        },
        {
          "field": "ABCIN",
          "in_dictionary": true,
          "text": "Physical inventory indicator for cycle counting",
          "data_element": "ABCIN",
          "domain": "ABCIN",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": "T159C",
          "check_field": "ABCIN",
          "check_table_text": "Value table for counting cycles in cycle counting",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM031"
          ]
        },
        {
          "field": "AHDIS",
          "in_dictionary": true,
          "text": "MRP relevancy for dependent requirements",
          "data_element": "AHDIS",
          "domain": "AHDIS",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 2,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM744"
          ]
        },
        {
          "field": "ALTSL",
          "in_dictionary": true,
          "text": "Method for Selecting Alternative Bills of Material",
          "data_element": "ALTSL",
          "domain": "ALTSL",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 4,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM177"
          ]
        }
      ]
    },
    {
      "table": "MBEW",
      "text": "Material Valuation",
      "in_dictionary": true,
      "fields": [
        {
          "field": "MATNR",
          "in_dictionary": true,
          "text": "Material Number",
          "data_element": "MATNR",
          "domain": "MATNR",
          "type": "CHAR",
          "length": 18,
          "key": true,
          "check_table": "MARA",
          "check_field": "MATNR",
          "check_table_text": "General Material Data",
          "check_delivery_class": null,
          "owner": "material_master",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 8,
          "rule_ids": [
            "MM425",
            "MM426",
            "MM427",
            "MM519"
          ]
        },
        {
          "field": "BWKEY",
          "in_dictionary": true,
          "text": "Valuation area",
          "data_element": "BWKEY",
          "domain": "BWKEY",
          "type": "CHAR",
          "length": 4,
          "key": true,
          "check_table": "T001K",
          "check_field": "BWKEY",
          "check_table_text": "Valuation area",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 16,
          "rule_ids": [
            "MM035",
            "MM036",
            "MM144",
            "MM213"
          ]
        },
        {
          "field": "VPRSV",
          "in_dictionary": true,
          "text": "Price control indicator",
          "data_element": "VPRSV",
          "domain": "VPRSV",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 2,
          "glossary_terms": [],
          "rule_count": 21,
          "rule_ids": [
            "MM033",
            "MM043",
            "MM127",
            "MM144"
          ]
        },
        {
          "field": "VERPR",
          "in_dictionary": true,
          "text": "Moving Average Price/Periodic Unit Price",
          "data_element": "VERPR",
          "domain": "WERT11V",
          "type": "CURR",
          "length": 11,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 8,
          "rule_ids": [
            "MM127",
            "MM152",
            "MM218",
            "MM229"
          ]
        },
        {
          "field": "STPRS",
          "in_dictionary": true,
          "text": "Standard price",
          "data_element": "STPRS",
          "domain": "WERT11V",
          "type": "CURR",
          "length": 11,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 7,
          "rule_ids": [
            "MM043",
            "MM217",
            "MM218",
            "MM422"
          ]
        },
        {
          "field": "BKLAS",
          "in_dictionary": true,
          "text": "Valuation Class",
          "data_element": "BKLAS",
          "domain": "BKLAS",
          "type": "CHAR",
          "length": 4,
          "key": false,
          "check_table": "T025",
          "check_field": "BKLAS",
          "check_table_text": "Valuation Classes",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 4,
          "rule_ids": [
            "MM035",
            "MM181",
            "MM555",
            "S4R-ML-BKLAS-BLANK-STOCK"
          ]
        },
        {
          "field": "LAEPR",
          "in_dictionary": true,
          "text": "Date of the last price change",
          "data_element": "LAEPR",
          "domain": "DATUM",
          "type": "DATS",
          "length": 8,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM219"
          ]
        },
        {
          "field": "LBKUM",
          "in_dictionary": true,
          "text": "Total Valuated Stock",
          "data_element": "LBKUM",
          "domain": "MENG13V",
          "type": "QUAN",
          "length": 13,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 19,
          "rule_ids": [
            "MM043",
            "MM152",
            "MM153",
            "MM217"
          ]
        },
        {
          "field": "BWPRH",
          "in_dictionary": true,
          "text": "Valuation price based on commercial law: level 1",
          "data_element": "BWPRH",
          "domain": "WERT11",
          "type": "CURR",
          "length": 11,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM820"
          ]
        },
        {
          "field": "BWPRS",
          "in_dictionary": true,
          "text": "Valuation price based on tax law: level 1",
          "data_element": "BWPRS",
          "domain": "WERT11",
          "type": "CURR",
          "length": 11,
          "key": false,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 1,
          "rule_ids": [
            "MM820"
          ]
        },
        {
          "field": "BWTAR",
          "in_dictionary": true,
          "text": "Valuation type",
          "data_element": "BWTAR_D",
          "domain": "BWTAR",
          "type": "CHAR",
          "length": 10,
          "key": true,
          "check_table": null,
          "check_field": null,
          "check_table_text": null,
          "check_delivery_class": null,
          "owner": null,
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 9,
          "rule_ids": [
            "MM155",
            "MM425",
            "MM426",
            "MM427"
          ]
        },
        {
          "field": "BWTTY",
          "in_dictionary": true,
          "text": "Valuation Category",
          "data_element": "BWTTY_D",
          "domain": "BWTTY",
          "type": "CHAR",
          "length": 1,
          "key": false,
          "check_table": "T149",
          "check_field": "BWTTY",
          "check_table_text": "",
          "check_delivery_class": null,
          "owner": "configuration",
          "fixed_values": 0,
          "glossary_terms": [],
          "rule_count": 5,
          "rule_ids": [
            "MM155",
            "MM419",
            "MM816",
            "MM818"
          ]
        }
      ]
    }
  ],
  "totals": {
    "tables": 4,
    "fields": 40,
    "foreign_keys": 21,
    "fields_with_rules": 40,
    "not_in_dictionary": 0,
    "cross_object": 0
  }
} satisfies FieldLineage;

export function fieldLineageRead(path: string, params: Record<string, unknown>): unknown {
  if (path !== "/lineage/fields") return NONE_FIELD_LINEAGE;
  const module = String(params.module ?? "");
  if (module === "material_master") return MATERIAL;
  return {
    module,
    system_type: String(params.system_type ?? "ecc"),
    release: MATERIAL.release,
    tables: [],
    totals: { tables: 0, fields: 0, foreign_keys: 0, fields_with_rules: 0, not_in_dictionary: 0, cross_object: 0 },
  } satisfies FieldLineage;
}
