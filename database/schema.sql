-- ============================================================================
-- WIJNA SRAWUNG (MEAL CONNECT) — Skema Database MySQL Lengkap
-- Kompatibel dengan MySQL 8.0+ / MariaDB 10.5+ (hPanel Hostinger / Cloud SQL)
-- Non-Destructive (CREATE TABLE IF NOT EXISTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  username VARCHAR(128) NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NULL,
  role VARCHAR(64) NOT NULL,
  role_title VARCHAR(255) NULL,
  department VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  account_status VARCHAR(64) DEFAULT 'Aktif',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  password_updated_at VARCHAR(64) NULL,
  permissions_json LONGTEXT NULL,
  last_login_at VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_users_email (email),
  INDEX idx_users_username (username),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programs (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255) NULL,
  folder_url TEXT NULL,
  description TEXT NULL,
  donor VARCHAR(255) NULL,
  pic_id VARCHAR(128) NULL,
  pic_name VARCHAR(255) NULL,
  start_date VARCHAR(32) NULL,
  end_date VARCHAR(32) NULL,
  total_budget DECIMAL(18, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(16) DEFAULT 'IDR',
  status VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_programs_status (status),
  INDEX idx_programs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outcomes (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  program_id VARCHAR(128) NOT NULL,
  code VARCHAR(64) NULL,
  outcome_number VARCHAR(64) NULL,
  name TEXT NOT NULL,
  title TEXT NULL,
  description TEXT NULL,
  pic_id VARCHAR(128) NULL,
  pic_name VARCHAR(255) NULL,
  status VARCHAR(64) NULL,
  budget_allocated DECIMAL(18, 2) DEFAULT 0,
  indicators_json LONGTEXT NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_outcomes_program_id (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outputs (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  program_id VARCHAR(128) NULL,
  outcome_id VARCHAR(128) NOT NULL,
  code VARCHAR(64) NULL,
  output_number VARCHAR(64) NULL,
  name TEXT NOT NULL,
  title TEXT NULL,
  description TEXT NULL,
  pic_id VARCHAR(128) NULL,
  pic_name VARCHAR(255) NULL,
  status VARCHAR(64) NULL,
  budget_allocated DECIMAL(18, 2) DEFAULT 0,
  indicators_json LONGTEXT NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_outputs_outcome_id (outcome_id),
  INDEX idx_outputs_program_id (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  program_id VARCHAR(128) NULL,
  outcome_id VARCHAR(128) NULL,
  output_id VARCHAR(128) NOT NULL,
  code VARCHAR(64) NULL,
  activity_number VARCHAR(64) NULL,
  name TEXT NOT NULL,
  title TEXT NULL,
  description TEXT NULL,
  anticipated_inputs TEXT NULL,
  planned_participants_breakdown TEXT NULL,
  pic_id VARCHAR(128) NULL,
  pic_name VARCHAR(255) NULL,
  start_date VARCHAR(32) NULL,
  end_date VARCHAR(32) NULL,
  status VARCHAR(64) NULL,
  budget_allocated DECIMAL(18, 2) DEFAULT 0,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_activities_output_id (output_id),
  INDEX idx_activities_program_id (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sub_activities (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  program_id VARCHAR(128) NULL,
  outcome_id VARCHAR(128) NULL,
  output_id VARCHAR(128) NULL,
  activity_id VARCHAR(128) NOT NULL,
  code VARCHAR(64) NULL,
  name TEXT NOT NULL,
  title TEXT NULL,
  description TEXT NULL,
  pic_name VARCHAR(255) NULL,
  start_date VARCHAR(32) NULL,
  end_date VARCHAR(32) NULL,
  status VARCHAR(64) NULL,
  budget_allocated DECIMAL(18, 2) DEFAULT 0,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_sub_activities_activity_id (activity_id),
  INDEX idx_sub_activities_program_id (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tors (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  tor_number VARCHAR(128) NULL,
  title VARCHAR(500) NOT NULL,
  program_id VARCHAR(128) NULL,
  outcome_id VARCHAR(128) NULL,
  output_id VARCHAR(128) NULL,
  activity_id VARCHAR(128) NULL,
  sub_activity_id VARCHAR(128) NULL,
  created_by_user_id VARCHAR(128) NULL,
  created_by_name VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  activity_status VARCHAR(64) NULL,
  current_stage INT DEFAULT 1,
  budget_requested DECIMAL(18, 2) NULL,
  budget_approved DECIMAL(18, 2) NULL,
  budget_actual_spent DECIMAL(18, 2) NULL,
  start_date VARCHAR(32) NULL,
  end_date VARCHAR(32) NULL,
  location VARCHAR(255) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_tors_program_id (program_id),
  INDEX idx_tors_activity_id (activity_id),
  INDEX idx_tors_status (status),
  INDEX idx_tors_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_records (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  tor_id VARCHAR(128) NOT NULL,
  stage VARCHAR(64) NULL,
  approver_user_id VARCHAR(128) NULL,
  approver_name VARCHAR(255) NULL,
  role VARCHAR(64) NULL,
  action VARCHAR(64) NULL,
  notes TEXT NULL,
  timestamp VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_approval_records_tor_id (tor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_advances (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  ca_number VARCHAR(128) NULL,
  tor_id VARCHAR(128) NULL,
  program_id VARCHAR(128) NULL,
  activity_id VARCHAR(128) NULL,
  requester_user_id VARCHAR(128) NULL,
  requester_name VARCHAR(255) NULL,
  total_amount DECIMAL(18, 2) DEFAULT 0,
  realized_amount DECIMAL(18, 2) NULL,
  status VARCHAR(128) NULL,
  report_approval_status VARCHAR(128) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_cash_advances_tor_id (tor_id),
  INDEX idx_cash_advances_program_id (program_id),
  INDEX idx_cash_advances_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_advance_summaries (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  tor_id VARCHAR(128) NOT NULL,
  approval_status VARCHAR(128) NULL,
  total_approved_advance DECIMAL(18, 2) DEFAULT 0,
  total_realized_amount DECIMAL(18, 2) DEFAULT 0,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_ca_summaries_tor_id (tor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_minutes (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  document_number VARCHAR(128) NULL,
  tor_id VARCHAR(128) NULL,
  activity_id VARCHAR(128) NULL,
  title VARCHAR(500) NULL,
  meeting_date VARCHAR(32) NULL,
  location VARCHAR(255) NULL,
  created_by_user_id VARCHAR(128) NULL,
  status VARCHAR(128) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_meeting_minutes_tor_id (tor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_documentations (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  document_number VARCHAR(128) NULL,
  tor_id VARCHAR(128) NULL,
  program_id VARCHAR(128) NULL,
  activity_title VARCHAR(500) NULL,
  story_topic TEXT NULL,
  updated_by_user_id VARCHAR(128) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_activity_docs_tor_id (tor_id),
  INDEX idx_activity_docs_program_id (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS output_raci_records (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  output_id VARCHAR(128) NOT NULL,
  outcome_id VARCHAR(128) NULL,
  program_id VARCHAR(128) NULL,
  responsible_user_id VARCHAR(128) NULL,
  accountable_user_id VARCHAR(128) NULL,
  accountable_finance_user_id VARCHAR(128) NULL,
  status VARCHAR(128) NULL,
  approved_by_user_id VARCHAR(128) NULL,
  approved_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_output_raci_program_id (program_id),
  INDEX idx_output_raci_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_monitoring_records (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  activity_id VARCHAR(128) NOT NULL,
  output_id VARCHAR(128) NULL,
  outcome_id VARCHAR(128) NULL,
  program_id VARCHAR(128) NULL,
  status VARCHAR(128) NULL,
  updated_by_user_id VARCHAR(128) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_act_mon_program_id (program_id),
  INDEX idx_act_mon_activity_id (activity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitoring_reports (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  tor_id VARCHAR(128) NULL,
  program_id VARCHAR(128) NULL,
  outcome_id VARCHAR(128) NULL,
  output_id VARCHAR(128) NULL,
  activity_id VARCHAR(128) NULL,
  cash_advance_id VARCHAR(128) NULL,
  tool_id VARCHAR(64) NULL,
  tool_name VARCHAR(255) NULL,
  responsible_user_id VARCHAR(128) NULL,
  status VARCHAR(64) NULL,
  monitoring_date VARCHAR(32) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_mon_reports_tor_id (tor_id),
  INDEX idx_mon_reports_program_id (program_id),
  INDEX idx_mon_reports_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_hub_items (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  category_code VARCHAR(64) NOT NULL,
  source_tor_id VARCHAR(128) NULL,
  source_entity_id VARCHAR(128) NULL,
  program_id VARCHAR(128) NULL,
  reference_number VARCHAR(128) NULL,
  title VARCHAR(500) NULL,
  status VARCHAR(64) NULL,
  responsible_user_id VARCHAR(128) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_apv_hub_category (category_code),
  INDEX idx_apv_hub_tor_id (source_tor_id),
  INDEX idx_apv_hub_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS program_budgets (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  program_id VARCHAR(128) NULL,
  program_name VARCHAR(255) NULL,
  fiscal_year INT NULL,
  total_program_budget DECIMAL(18, 2) DEFAULT 0,
  annual_approved_budget DECIMAL(18, 2) DEFAULT 0,
  budget_approval_status VARCHAR(64) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_prog_budgets_program_id (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS participants (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  participant_type VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  gender VARCHAR(32) NULL,
  organization_or_group VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  village_or_city VARCHAR(255) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_participants_name (name),
  INDEX idx_participants_type (participant_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_records (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  record_date VARCHAR(32) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  user_name VARCHAR(255) NULL,
  record_type VARCHAR(64) DEFAULT 'ATTENDANCE',
  clock_in_time VARCHAR(64) NULL,
  clock_out_time VARCHAR(64) NULL,
  total_work_hours DECIMAL(8, 2) DEFAULT 0,
  is_outside_work_location TINYINT(1) DEFAULT 0,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_attendance_user_date (user_id, record_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  tor_id VARCHAR(128) NULL,
  user_id VARCHAR(128) NULL,
  user_name VARCHAR(255) NULL,
  user_role VARCHAR(64) NULL,
  action VARCHAR(255) NOT NULL,
  details TEXT NULL,
  timestamp VARCHAR(64) NOT NULL,
  raw_json LONGTEXT NOT NULL,
  INDEX idx_audit_logs_timestamp (timestamp),
  INDEX idx_audit_logs_tor_id (tor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_kv_store (
  store_key VARCHAR(128) NOT NULL PRIMARY KEY,
  store_value LONGTEXT NOT NULL,
  updated_at VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
