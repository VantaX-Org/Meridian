// Field lists for the data collection form in fixture mode. Generated from
// api/services/change_requests.form_fields (DDIC metadata plus rule values),
// trimmed to a few fields per object. Do not invent fields here.

export const REQUEST_FORMS: Record<string, unknown> = {
 "material": {
  "object": "material",
  "key_field": "MARA.MATNR",
  "fields": [
   {
    "field": "MARA.MTART",
    "table": "MARA",
    "name": "MTART",
    "label": "Material type",
    "table_label": "General Material Data",
    "type": "CHAR",
    "length": 4,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T134",
    "check_table_label": "Material Types",
    "values": [
     {
      "value": "FERT",
      "label": "Finished product"
     },
     {
      "value": "HALB",
      "label": "Semifinished product"
     },
     {
      "value": "ROH",
      "label": "Raw materials"
     },
     {
      "value": "HAWA",
      "label": "Trading goods"
     },
     {
      "value": "ERSA",
      "label": "Spare parts"
     }
    ],
    "values_source": "check_table",
    "rules": 2
   },
   {
    "field": "MARA.MBRSH",
    "table": "MARA",
    "name": "MBRSH",
    "label": "Industry sector",
    "table_label": "General Material Data",
    "type": "CHAR",
    "length": 1,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T137",
    "check_table_label": "Industries for materials",
    "values": [
     {
      "value": "A",
      "label": "Plant engineering and construction"
     },
     {
      "value": "C",
      "label": "Chemical industry"
     },
     {
      "value": "M",
      "label": "Mechanical engineering"
     },
     {
      "value": "P",
      "label": "Pharmaceutical"
     },
     {
      "value": "V",
      "label": "Retail"
     }
    ],
    "values_source": "rule",
    "rules": 2
   },
   {
    "field": "MARA.MEINS",
    "table": "MARA",
    "name": "MEINS",
    "label": "Base Unit of Measure",
    "table_label": "General Material Data",
    "type": "UNIT",
    "length": 3,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T006",
    "check_table_label": "Units of Measurement",
    "values": [],
    "values_source": null,
    "rules": 2
   },
   {
    "field": "MAKT.MAKTX",
    "table": "MAKT",
    "name": "MAKTX",
    "label": "Material description",
    "table_label": "Material Descriptions",
    "type": "CHAR",
    "length": 40,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 13
   },
   {
    "field": "MAKT.SPRAS",
    "table": "MAKT",
    "name": "SPRAS",
    "label": "Language Key",
    "table_label": "Material Descriptions",
    "type": "LANG",
    "length": 1,
    "decimals": 0,
    "key": true,
    "required": true,
    "check_table": "T002",
    "check_table_label": "Language Keys (Component BC-I18)",
    "values": [],
    "values_source": null,
    "rules": 1
   },
   {
    "field": "MARA.MATKL",
    "table": "MARA",
    "name": "MATKL",
    "label": "Material Group",
    "table_label": "General Material Data",
    "type": "CHAR",
    "length": 9,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": "T023",
    "check_table_label": "Material Groups",
    "values": [],
    "values_source": null,
    "rules": 2
   },
   {
    "field": "MARC.WERKS",
    "table": "MARC",
    "name": "WERKS",
    "label": "Plant",
    "table_label": "Plant Data for Material",
    "type": "CHAR",
    "length": 4,
    "decimals": 0,
    "key": true,
    "required": true,
    "check_table": "T001W",
    "check_table_label": "Plants/Branches",
    "values": [],
    "values_source": null,
    "rules": 3
   },
   {
    "field": "MARA.BRGEW",
    "table": "MARA",
    "name": "BRGEW",
    "label": "Gross weight",
    "table_label": "General Material Data",
    "type": "QUAN",
    "length": 13,
    "decimals": 3,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 2
   },
   {
    "field": "MARA.GEWEI",
    "table": "MARA",
    "name": "GEWEI",
    "label": "Weight Unit",
    "table_label": "General Material Data",
    "type": "UNIT",
    "length": 3,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": "T006",
    "check_table_label": "Units of Measurement",
    "values": [
     {
      "value": "KG",
      "label": "Kilogram"
     },
     {
      "value": "G",
      "label": "Gram"
     },
     {
      "value": "LB",
      "label": "Pound"
     },
     {
      "value": "OZ",
      "label": "Ounce"
     },
     {
      "value": "T",
      "label": "Metric ton"
     },
     {
      "value": "TO",
      "label": "Metric ton (alternate)"
     }
    ],
    "values_source": "rule",
    "rules": 2
   }
  ]
 },
 "customer": {
  "object": "customer",
  "key_field": "KNA1.KUNNR",
  "fields": [
   {
    "field": "KNA1.KTOKD",
    "table": "KNA1",
    "name": "KTOKD",
    "label": "Customer Account Group",
    "table_label": "General Data in Customer Master",
    "type": "CHAR",
    "length": 4,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T077D",
    "check_table_label": "Customer account groups",
    "values": [],
    "values_source": null,
    "rules": 1
   },
   {
    "field": "KNA1.LAND1",
    "table": "KNA1",
    "name": "LAND1",
    "label": "Country Key",
    "table_label": "General Data in Customer Master",
    "type": "CHAR",
    "length": 3,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T005",
    "check_table_label": "Countries",
    "values": [],
    "values_source": null,
    "rules": 2
   },
   {
    "field": "KNA1.NAME1",
    "table": "KNA1",
    "name": "NAME1",
    "label": "Name 1",
    "table_label": "General Data in Customer Master",
    "type": "CHAR",
    "length": 35,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 5
   },
   {
    "field": "KNB1.AKONT",
    "table": "KNB1",
    "name": "AKONT",
    "label": "Reconciliation Account in General Ledger",
    "table_label": "Customer Master (Company Code)",
    "type": "CHAR",
    "length": 10,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "SKB1",
    "check_table_label": "G/L account master (company code)",
    "values": [],
    "values_source": null,
    "rules": 3
   },
   {
    "field": "ADRC.CITY1",
    "table": "ADRC",
    "name": "CITY1",
    "label": "City",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 40,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 1
   },
   {
    "field": "ADRC.POST_CODE1",
    "table": "ADRC",
    "name": "POST_CODE1",
    "label": "City postal code",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 10,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 0
   }
  ]
 },
 "vendor": {
  "object": "vendor",
  "key_field": "LFA1.LIFNR",
  "fields": [
   {
    "field": "LFA1.KTOKK",
    "table": "LFA1",
    "name": "KTOKK",
    "label": "Vendor account group",
    "table_label": "Vendor Master (General Section)",
    "type": "CHAR",
    "length": 4,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T077K",
    "check_table_label": "Vendor account groups",
    "values": [],
    "values_source": null,
    "rules": 6
   },
   {
    "field": "LFA1.LAND1",
    "table": "LFA1",
    "name": "LAND1",
    "label": "Country Key",
    "table_label": "Vendor Master (General Section)",
    "type": "CHAR",
    "length": 3,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T005",
    "check_table_label": "Countries",
    "values": [],
    "values_source": null,
    "rules": 5
   },
   {
    "field": "LFA1.NAME1",
    "table": "LFA1",
    "name": "NAME1",
    "label": "Name 1",
    "table_label": "Vendor Master (General Section)",
    "type": "CHAR",
    "length": 35,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 2
   },
   {
    "field": "LFB1.AKONT",
    "table": "LFB1",
    "name": "AKONT",
    "label": "Reconciliation Account in General Ledger",
    "table_label": "Vendor Master (Company Code)",
    "type": "CHAR",
    "length": 10,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "SKB1",
    "check_table_label": "G/L account master (company code)",
    "values": [],
    "values_source": null,
    "rules": 4
   },
   {
    "field": "ADRC.CITY1",
    "table": "ADRC",
    "name": "CITY1",
    "label": "City",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 40,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 0
   },
   {
    "field": "ADRC.POST_CODE1",
    "table": "ADRC",
    "name": "POST_CODE1",
    "label": "City postal code",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 10,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 0
   }
  ]
 },
 "business_partner": {
  "object": "business_partner",
  "key_field": "BUT000.PARTNER",
  "fields": [
   {
    "field": "BUT000.TYPE",
    "table": "BUT000",
    "name": "TYPE",
    "label": "Business partner category",
    "table_label": "BP: General data I",
    "type": "CHAR",
    "length": 1,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": null,
    "check_table_label": null,
    "values": [
     {
      "value": "1",
      "label": "Person"
     },
     {
      "value": "2",
      "label": "Organization"
     },
     {
      "value": "3",
      "label": "Group"
     }
    ],
    "values_source": "domain",
    "rules": 5
   },
   {
    "field": "BUT000.NAME_ORG1",
    "table": "BUT000",
    "name": "NAME_ORG1",
    "label": "Name 1 of organization",
    "table_label": "BP: General data I",
    "type": "CHAR",
    "length": 40,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 3
   },
   {
    "field": "ADRC.COUNTRY",
    "table": "ADRC",
    "name": "COUNTRY",
    "label": "Country Key",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 3,
    "decimals": 0,
    "key": false,
    "required": true,
    "check_table": "T005",
    "check_table_label": "Countries",
    "values": [],
    "values_source": null,
    "rules": 2
   },
   {
    "field": "ADRC.CITY1",
    "table": "ADRC",
    "name": "CITY1",
    "label": "City",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 40,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 1
   },
   {
    "field": "ADRC.POST_CODE1",
    "table": "ADRC",
    "name": "POST_CODE1",
    "label": "City postal code",
    "table_label": "Addresses (Business Address Services)",
    "type": "CHAR",
    "length": 10,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": null,
    "check_table_label": null,
    "values": [],
    "values_source": null,
    "rules": 1
   },
   {
    "field": "BUT000.BU_GROUP",
    "table": "BUT000",
    "name": "BU_GROUP",
    "label": "Business Partner Grouping",
    "table_label": "BP: General data I",
    "type": "CHAR",
    "length": 4,
    "decimals": 0,
    "key": false,
    "required": false,
    "check_table": "TB001",
    "check_table_label": "BP groupings",
    "values": [],
    "values_source": null,
    "rules": 2
   }
  ]
 }
};
