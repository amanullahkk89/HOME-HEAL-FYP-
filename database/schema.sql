-- HomeHeal — East-City Hospital
-- Complete MySQL 8.0 Schema (Single-Hospital Home Healthcare Assistance System)
-- Preserves all FYDP-I ER relationships, role constraints, location consents,
-- credential verification, transactional request lifecycle, and duplicate-assignment prevention.

CREATE DATABASE IF NOT EXISTS homeheal_east_city
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE homeheal_east_city;

CREATE TABLE IF NOT EXISTS hospital_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  hospital_name VARCHAR(160) NOT NULL DEFAULT 'East-City Hospital',
  department_name VARCHAR(160) NOT NULL DEFAULT 'Home Healthcare Coordination Unit',
  address VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  support_email VARCHAR(160) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  service_radius_km DECIMAL(6, 2) NOT NULL DEFAULT 15.00,
  location_freshness_seconds INT UNSIGNED NOT NULL DEFAULT 300,
  operating_hours VARCHAR(120) NOT NULL DEFAULT '07:00 - 22:00 Daily',
  emergency_notice TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_single_hospital CHECK (id = 1),
  CONSTRAINT chk_positive_radius CHECK (service_radius_km > 0),
  CONSTRAINT chk_positive_freshness CHECK (location_freshness_seconds >= 30)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  role ENUM('patient', 'nurse', 'doctor', 'admin') NOT NULL,
  preferred_language ENUM('en', 'ur', 'roman_ur') NOT NULL DEFAULT 'en',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  date_of_birth DATE NULL,
  default_address VARCHAR(255) NOT NULL DEFAULT '',
  default_lat DECIMAL(10, 7) NULL,
  default_lng DECIMAL(10, 7) NULL,
  emergency_contact_name VARCHAR(160) NOT NULL DEFAULT '',
  emergency_contact_phone VARCHAR(40) NOT NULL DEFAULT '',
  mobility_notes VARCHAR(500) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_patient_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS approved_services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  name_ur VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  description_ur TEXT NOT NULL,
  estimated_duration_mins SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  preparation_notes TEXT NOT NULL,
  requires_prescription_note TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS nurse_profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  license_number VARCHAR(80) NOT NULL UNIQUE,
  specialization VARCHAR(160) NOT NULL,
  years_experience TINYINT UNSIGNED NOT NULL DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  verified_by BIGINT UNSIGNED NULL,
  verified_at TIMESTAMP NULL,
  verification_notes VARCHAR(500) NOT NULL DEFAULT '',
  is_available TINYINT(1) NOT NULL DEFAULT 0,
  is_online TINYINT(1) NOT NULL DEFAULT 0,
  location_consent_granted TINYINT(1) NOT NULL DEFAULT 0,
  location_consent_at TIMESTAMP NULL,
  current_lat DECIMAL(10, 7) NULL,
  current_lng DECIMAL(10, 7) NULL,
  location_updated_at TIMESTAMP NULL,
  fcm_token VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_nurse_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nurse_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_nurse_eligibility (verification_status, is_available, is_online, location_consent_granted)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS nurse_service_capabilities (
  nurse_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (nurse_id, service_id),
  CONSTRAINT fk_cap_nurse FOREIGN KEY (nurse_id) REFERENCES nurse_profiles(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_cap_service FOREIGN KEY (service_id) REFERENCES approved_services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  pmdc_license VARCHAR(80) NOT NULL UNIQUE,
  department VARCHAR(120) NOT NULL,
  specialty VARCHAR(160) NOT NULL,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  verified_by BIGINT UNSIGNED NULL,
  verified_at TIMESTAMP NULL,
  verification_notes VARCHAR(500) NOT NULL DEFAULT '',
  availability_status ENUM('on_duty', 'on_call', 'off_duty') NOT NULL DEFAULT 'on_duty',
  coordination_notes VARCHAR(500) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_doctor_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_doctor_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS credential_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('nurse', 'doctor') NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  storage_provider ENUM('firebase_storage', 'local_private_vault') NOT NULL DEFAULT 'local_private_vault',
  storage_path VARCHAR(255) NOT NULL,
  original_filename VARCHAR(180) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  sha256_checksum CHAR(64) NOT NULL,
  review_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  review_notes VARCHAR(500) NOT NULL DEFAULT '',
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cred_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cred_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cred_user (user_id, review_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_code VARCHAR(32) NOT NULL UNIQUE,
  patient_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  assigned_nurse_id BIGINT UNSIGNED NULL,
  status ENUM('Pending', 'Accepted', 'En Route', 'Arrived', 'Completed', 'Cancelled', 'Rejected') NOT NULL DEFAULT 'Pending',
  -- Generated guard column: prevents a nurse from holding two concurrent active visits
  active_nurse_guard BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('Accepted', 'En Route', 'Arrived') THEN assigned_nurse_id
      ELSE NULL
    END
  ) STORED,
  patient_address VARCHAR(255) NOT NULL,
  patient_lat DECIMAL(10, 7) NOT NULL,
  patient_lng DECIMAL(10, 7) NOT NULL,
  patient_location_consent TINYINT(1) NOT NULL,
  patient_location_consent_at TIMESTAMP NOT NULL,
  preferred_time_window VARCHAR(80) NOT NULL,
  patient_notes VARCHAR(600) NOT NULL DEFAULT '',
  assistant_draft_used TINYINT(1) NOT NULL DEFAULT 0,
  cancellation_reason VARCHAR(300) NULL,
  cancelled_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP NULL,
  en_route_at TIMESTAMP NULL,
  arrived_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  CONSTRAINT fk_req_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_req_service FOREIGN KEY (service_id) REFERENCES approved_services(id) ON DELETE RESTRICT,
  CONSTRAINT fk_req_nurse FOREIGN KEY (assigned_nurse_id) REFERENCES nurse_profiles(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_req_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_patient_consent CHECK (patient_location_consent = 1),
  UNIQUE KEY uq_active_nurse_assignment (active_nurse_guard),
  INDEX idx_req_patient (patient_id, status),
  INDEX idx_req_nurse (assigned_nurse_id, status),
  INDEX idx_req_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS request_offers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  nurse_id BIGINT UNSIGNED NOT NULL,
  haversine_distance_km DECIMAL(7, 3) NOT NULL,
  rank_order SMALLINT UNSIGNED NOT NULL,
  offer_status ENUM('offered', 'accepted', 'declined', 'expired', 'superseded') NOT NULL DEFAULT 'offered',
  responded_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_offer_request FOREIGN KEY (request_id) REFERENCES service_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_nurse FOREIGN KEY (nurse_id) REFERENCES nurse_profiles(user_id) ON DELETE CASCADE,
  UNIQUE KEY uq_request_nurse_offer (request_id, nurse_id),
  INDEX idx_offer_nurse_status (nurse_id, offer_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS request_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  sender_role ENUM('patient', 'nurse') NOT NULL,
  body VARCHAR(1000) NOT NULL,
  client_msg_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_request FOREIGN KEY (request_id) REFERENCES service_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_request_client_msg (request_id, client_msg_id),
  INDEX idx_msg_request_time (request_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(500) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  fcm_dispatched TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_request FOREIGN KEY (request_id) REFERENCES service_requests(id) ON DELETE SET NULL,
  INDEX idx_notif_user_read (user_id, is_read, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NULL,
  actor_role VARCHAR(32) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  metadata_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_action_time (action, created_at)
) ENGINE=InnoDB;
