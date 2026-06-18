-- One-off ops script: widen the "Luketest" tenant to a full enterprise
-- entitlement (all 29 modules, all menu items, all gating features).
-- Run:  wrangler d1 execute meridian-licence --remote --file=_widen-luketest-tenant.sql -y
UPDATE tenants
SET
  enabled_modules = '["business_partner","material_master","fi_gl","accounts_payable","accounts_receivable","asset_accounting","mm_purchasing","plant_maintenance","production_planning","sd_customer_master","sd_sales_orders","employee_central","compensation","benefits","payroll_integration","performance_goals","succession_planning","recruiting_onboarding","learning_management","time_attendance","ewms_stock","ewms_transfer_orders","batch_management","mdg_master_data","grc_compliance","fleet_management","transport_management","wm_interface","cross_system_integration"]',
  enabled_menu_items = '["dashboard","findings","versions","analytics","import","sync","reports","stewardship","contracts","rules_engine","field_mapping","licence","ask_meridian","export","user_management","settings"]',
  features = '{"ask_meridian":true,"export_reports":true,"run_sync":true,"cleaning":true,"exceptions":true,"analytics":true,"contracts":true,"notifications":true,"mdm":true,"ai_features":true,"field_mapping_self_service":true,"max_users":20}',
  updated_at = datetime('now')
WHERE id = 'f7cd9a99b91d17a160db425d86f706a4';

SELECT id, company_name, tier, status, expiry_date, enabled_modules, enabled_menu_items, features
FROM tenants
WHERE id = 'f7cd9a99b91d17a160db425d86f706a4';
