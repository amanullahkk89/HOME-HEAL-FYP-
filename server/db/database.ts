import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../security.ts';
import type {
  ApprovedService,
  HospitalSettings,
  LanguageCode,
  NurseMatchingCandidate,
  OfferStatus,
  RequestStatus,
  UserRole,
  VerificationStatus,
} from '../../shared/domain.ts';

export interface UserRecord {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string;
  role: UserRole;
  preferredLanguage: LanguageCode;
  isActive: boolean;
  createdAt: string;
}

export interface CredentialDocRecord {
  id: number;
  userId: number;
  userName?: string;
  userEmail?: string;
  role: 'nurse' | 'doctor';
  documentType: string;
  storageProvider: 'firebase_storage' | 'local_private_vault';
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sha256Checksum: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  reviewedBy: number | null;
  reviewedAt: string | null;
  reviewNotes: string;
  uploadedAt: string;
}

export interface ServiceRequestRecord {
  id: number;
  requestCode: string;
  patientId: number;
  patientName: string;
  patientPhone: string;
  serviceId: number;
  serviceCode: string;
  serviceName: string;
  serviceNameUr: string;
  serviceCategory: string;
  assignedNurseId: number | null;
  assignedNurseName: string | null;
  assignedNursePhone: string | null;
  assignedNurseLat: number | null;
  assignedNurseLng: number | null;
  assignedNurseLocationConsent: boolean;
  assignedNurseLocationUpdatedAt: string | null;
  status: RequestStatus;
  patientAddress: string;
  patientLat: number;
  patientLng: number;
  patientLocationConsent: boolean;
  patientLocationConsentAt: string;
  preferredTimeWindow: string;
  patientNotes: string;
  assistantDraftUsed: boolean;
  cancellationReason: string | null;
  createdAt: string;
  acceptedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface RequestOfferRecord {
  id: number;
  requestId: number;
  nurseId: number;
  haversineDistanceKm: number;
  rankOrder: number;
  offerStatus: OfferStatus;
  respondedAt: string | null;
  createdAt: string;
  requestCode?: string;
  serviceId?: number;
  serviceName?: string;
  serviceCategory?: string;
  patientAddress?: string;
  patientLat?: number;
  patientLng?: number;
  preferredTimeWindow?: string;
  patientNotes?: string;
  requestStatus?: RequestStatus;
}

export interface RequestMessageRecord {
  id: number;
  requestId: number;
  senderId: number;
  senderName: string;
  senderRole: 'patient' | 'nurse';
  body: string;
  clientMsgId: string | null;
  createdAt: string;
}

export interface NotificationRecord {
  id: number;
  userId: number;
  requestId: number | null;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  fcmDispatched: boolean;
  createdAt: string;
}

export interface AuditLogRecord {
  id: number;
  actorId: number | null;
  actorName: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadataJson: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export class HomeHealDatabase {
  public readonly db: DatabaseSync;
  public readonly privateVaultDir: string;

  constructor(dbPath: string, privateVaultDir: string) {
    const dir = path.dirname(dbPath);
    if (dbPath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(privateVaultDir)) {
      fs.mkdirSync(privateVaultDir, { recursive: true });
    }
    this.privateVaultDir = path.resolve(privateVaultDir);
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.initSchema();
    this.seedIfEmpty();
  }

  public runInTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hospital_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hospital_name TEXT NOT NULL,
        department_name TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        phone TEXT NOT NULL,
        support_email TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        service_radius_km REAL NOT NULL CHECK (service_radius_km > 0),
        location_freshness_seconds INTEGER NOT NULL CHECK (location_freshness_seconds >= 30),
        operating_hours TEXT NOT NULL,
        emergency_notice TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('patient', 'nurse', 'doctor', 'admin')),
        preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'ur', 'roman_ur')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS patient_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        date_of_birth TEXT,
        default_address TEXT NOT NULL DEFAULT '',
        default_lat REAL,
        default_lng REAL,
        emergency_contact_name TEXT NOT NULL DEFAULT '',
        emergency_contact_phone TEXT NOT NULL DEFAULT '',
        mobility_notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approved_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_ur TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        description_ur TEXT NOT NULL,
        estimated_duration_mins INTEGER NOT NULL DEFAULT 30,
        preparation_notes TEXT NOT NULL,
        requires_prescription_note INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nurse_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        license_number TEXT NOT NULL UNIQUE,
        specialization TEXT NOT NULL,
        years_experience INTEGER NOT NULL DEFAULT 1,
        verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'under_review', 'approved', 'rejected')),
        verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        verified_at TEXT,
        verification_notes TEXT NOT NULL DEFAULT '',
        is_available INTEGER NOT NULL DEFAULT 0,
        is_online INTEGER NOT NULL DEFAULT 0,
        location_consent_granted INTEGER NOT NULL DEFAULT 0,
        location_consent_at TEXT,
        current_lat REAL,
        current_lng REAL,
        location_updated_at TEXT,
        fcm_token TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nurse_service_capabilities (
        nurse_id INTEGER NOT NULL REFERENCES nurse_profiles(user_id) ON DELETE CASCADE,
        service_id INTEGER NOT NULL REFERENCES approved_services(id) ON DELETE CASCADE,
        PRIMARY KEY (nurse_id, service_id)
      );

      CREATE TABLE IF NOT EXISTS doctor_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        pmdc_license TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        specialty TEXT NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'under_review', 'approved', 'rejected')),
        verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        verified_at TEXT,
        verification_notes TEXT NOT NULL DEFAULT '',
        availability_status TEXT NOT NULL DEFAULT 'on_duty' CHECK (availability_status IN ('on_duty', 'on_call', 'off_duty')),
        coordination_notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS credential_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('nurse', 'doctor')),
        document_type TEXT NOT NULL,
        storage_provider TEXT NOT NULL DEFAULT 'local_private_vault' CHECK (storage_provider IN ('firebase_storage', 'local_private_vault')),
        storage_path TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        sha256_checksum TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TEXT,
        review_notes TEXT NOT NULL DEFAULT '',
        uploaded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_code TEXT NOT NULL UNIQUE,
        patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        service_id INTEGER NOT NULL REFERENCES approved_services(id) ON DELETE RESTRICT,
        assigned_nurse_id INTEGER REFERENCES nurse_profiles(user_id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'En Route', 'Arrived', 'Completed', 'Cancelled', 'Rejected')),
        patient_address TEXT NOT NULL,
        patient_lat REAL NOT NULL,
        patient_lng REAL NOT NULL,
        patient_location_consent INTEGER NOT NULL CHECK (patient_location_consent = 1),
        patient_location_consent_at TEXT NOT NULL,
        preferred_time_window TEXT NOT NULL,
        patient_notes TEXT NOT NULL DEFAULT '',
        assistant_draft_used INTEGER NOT NULL DEFAULT 0,
        cancellation_reason TEXT,
        cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        en_route_at TEXT,
        arrived_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT
      );

      -- Partial unique index: prevents any nurse from holding two concurrent active visits at DB level
      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_nurse_visit
        ON service_requests(assigned_nurse_id)
        WHERE assigned_nurse_id IS NOT NULL AND status IN ('Accepted', 'En Route', 'Arrived');

      CREATE TABLE IF NOT EXISTS request_offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        nurse_id INTEGER NOT NULL REFERENCES nurse_profiles(user_id) ON DELETE CASCADE,
        haversine_distance_km REAL NOT NULL,
        rank_order INTEGER NOT NULL,
        offer_status TEXT NOT NULL DEFAULT 'offered' CHECK (offer_status IN ('offered', 'accepted', 'declined', 'expired', 'superseded')),
        responded_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (request_id, nurse_id)
      );

      CREATE TABLE IF NOT EXISTS request_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_role TEXT NOT NULL CHECK (sender_role IN ('patient', 'nurse')),
        body TEXT NOT NULL,
        client_msg_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (request_id, client_msg_id)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id INTEGER REFERENCES service_requests(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        fcm_dispatched INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        metadata_json TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private seedIfEmpty(): void {
    const existingHospital = this.db.prepare('SELECT id FROM hospital_settings WHERE id = 1').get();
    if (existingHospital) return;

    const nowIso = new Date().toISOString();
    const freshMinus2Min = new Date(Date.now() - 120_000).toISOString();
    const freshMinus3Min = new Date(Date.now() - 180_000).toISOString();
    const completedCreated = new Date(Date.now() - 86_400_000).toISOString();
    const completedDone = new Date(Date.now() - 82_800_000).toISOString();
    const demoPassHash = hashPassword('HomeHeal@2026');

    this.runInTransaction(() => {
      this.db.prepare(`
        INSERT INTO hospital_settings (
          id, hospital_name, department_name, address, city, phone, support_email,
          latitude, longitude, service_radius_km, location_freshness_seconds,
          operating_hours, emergency_notice, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'East-City Hospital',
        'Home Healthcare Coordination Unit',
        '14 Shahrah-e-Quaid, East City Sector F-8',
        'Islamabad',
        '+92-51-555-0190',
        'homeheal@eastcityhospital.example',
        33.7077,
        73.0501,
        18.0,
        900,
        '07:00 - 22:00 Daily',
        'HomeHeal supports scheduled, hospital-approved home nursing visits only. For acute emergencies, chest pain, severe bleeding, or breathing distress, call 1122 or visit East-City Hospital Emergency immediately.',
        nowIso,
      );

      const services = [
        {
          code: 'SVC-INJ-01',
          name: 'Intramuscular & IV Injection Administration',
          nameUr: 'انٹرا مسکولر اور آئی وی انجیکشن',
          category: 'Injections',
          description: 'Scheduled administration of hospital-prescribed intramuscular or intravenous injections by a verified East-City Hospital nurse.',
          descriptionUr: 'ایسٹ سٹی ہسپتال کی تصدیق شدہ نرس کے ذریعے تجویز کردہ انجیکشن کی محفوظ فراہمی۔',
          mins: 25,
          prep: 'Keep your East-City Hospital prescription slip and prescribed ampoules ready before nurse arrival.',
          rx: 1,
        },
        {
          code: 'SVC-IVD-02',
          name: 'IV Drip Setup & Infusion Monitoring',
          nameUr: 'آئی وی ڈرپ سیٹ اپ اور نگرانی',
          category: 'Infusion Care',
          description: 'Sterile intravenous cannula placement, prescribed fluid drip setup, and 45-minute vital sign observation at home.',
          descriptionUr: 'گھر پر جراثیم سے پاک آئی وی کینولا، ڈرپ سیٹ اپ اور 45 منٹ کی بنیادی نگرانی۔',
          mins: 55,
          prep: 'Ensure prescribed IV fluids, infusion set, and a clean seated or resting area are available.',
          rx: 1,
        },
        {
          code: 'SVC-WND-03',
          name: 'Post-Surgical Wound Dressing & Care',
          nameUr: 'سرجری کے بعد زخم کی ڈریسنگ',
          category: 'Wound Care',
          description: 'Aseptic wound inspection, sterile saline cleansing, dressing replacement, and healing documentation.',
          descriptionUr: 'جراثیم سے پاک صفائی، نئی ڈریسنگ اور زخم کی حالت کا اندراج۔',
          mins: 40,
          prep: 'Do not remove the existing bandage prior to nurse arrival unless instructed by your surgeon.',
          rx: 0,
        },
        {
          code: 'SVC-CAT-04',
          name: 'Foley Catheter Care & Sterile Flush',
          nameUr: 'کیتھیٹر کی دیکھ بھال اور صفائی',
          category: 'Specialized Nursing',
          description: 'Routine catheter hygiene, drainage bag replacement, and sterile normal-saline irrigation per hospital protocol.',
          descriptionUr: 'کیتھیٹر کی صفائی، بیگ کی تبدیلی اور ہسپتال کے اصولوں کے مطابق دیکھ بھال۔',
          mins: 35,
          prep: 'Have spare sterile drainage bags and prescribed supplies accessible.',
          rx: 1,
        },
        {
          code: 'SVC-VIT-05',
          name: 'Post-Discharge Vitals & Glucose Check',
          nameUr: 'بلڈ پریشر، نبض اور شوگر کی جانچ',
          category: 'Monitoring',
          description: 'Blood pressure, pulse oximetry, temperature, respiratory rate, and capillary blood glucose check with coordination note.',
          descriptionUr: 'بلڈ پریشر، آکسیجن، درجہ حرارت اور شوگر کا معائنہ اور ریکارڈ۔',
          mins: 25,
          prep: 'Rest quietly for 10 minutes prior to blood pressure measurement.',
          rx: 0,
        },
      ];

      const insertSvc = this.db.prepare(`
        INSERT INTO approved_services (
          code, name, name_ur, category, description, description_ur,
          estimated_duration_mins, preparation_notes, requires_prescription_note, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      for (const s of services) {
        insertSvc.run(s.code, s.name, s.nameUr, s.category, s.description, s.descriptionUr, s.mins, s.prep, s.rx, nowIso, nowIso);
      }

      const insertUser = this.db.prepare(`
        INSERT INTO users (email, password_hash, full_name, phone, role, preferred_language, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      // 1: Admin
      const adminId = Number(insertUser.run('admin@eastcity.org', demoPassHash, 'Tariq Mahmood', '+92-300-5550101', 'admin', 'en', nowIso, nowIso).lastInsertRowid);
      // 2: Doctor
      const doctorId = Number(insertUser.run('dr.sara@eastcity.org', demoPassHash, 'Dr. Sara Khan', '+92-300-5550102', 'doctor', 'en', nowIso, nowIso).lastInsertRowid);
      // 3: Nurse Ayesha (Approved, Online, Fresh GPS near F-7/F-8)
      const nurse1Id = Number(insertUser.run('nurse.ayesha@eastcity.org', demoPassHash, 'Nurse Ayesha Siddiqui', '+92-300-5550103', 'nurse', 'en', nowIso, nowIso).lastInsertRowid);
      // 4: Nurse Bilal (Approved, Online, Fresh GPS near G-9)
      const nurse2Id = Number(insertUser.run('nurse.bilal@eastcity.org', demoPassHash, 'Nurse Bilal Ahmed', '+92-300-5550104', 'nurse', 'roman_ur', nowIso, nowIso).lastInsertRowid);
      // 5: Nurse Zainab (Pending Verification — for Admin verification flow demo)
      const nurse3Id = Number(insertUser.run('nurse.pending@eastcity.org', demoPassHash, 'Nurse Zainab Raza', '+92-300-5550105', 'nurse', 'ur', nowIso, nowIso).lastInsertRowid);
      // 6: Patient Ali
      const patient1Id = Number(insertUser.run('patient.ali@example.com', demoPassHash, 'Ali Hassan', '+92-321-5550201', 'patient', 'en', nowIso, nowIso).lastInsertRowid);
      // 7: Patient Fatima
      const patient2Id = Number(insertUser.run('patient.fatima@example.com', demoPassHash, 'Fatima Noor', '+92-321-5550202', 'patient', 'ur', nowIso, nowIso).lastInsertRowid);

      // Patient profiles
      const insertPatientProfile = this.db.prepare(`
        INSERT INTO patient_profiles (user_id, date_of_birth, default_address, default_lat, default_lng, emergency_contact_name, emergency_contact_phone, mobility_notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertPatientProfile.run(patient1Id, '1978-04-12', 'House 22, Street 9, Sector F-7/2, Islamabad', 33.7215, 73.0568, 'Sana Hassan', '+92-321-5550299', 'Post-discharge knee surgery recovery, ground floor access.', nowIso);
      insertPatientProfile.run(patient2Id, '1965-09-03', 'Apartment 4B, Kohsar Lane, Sector F-6/3, Islamabad', 33.7294, 73.0764, 'Usman Noor', '+92-321-5550288', 'Elevator access available; ring bell twice.', nowIso);

      // Doctor profile
      this.db.prepare(`
        INSERT INTO doctor_profiles (user_id, pmdc_license, department, specialty, verification_status, verified_by, verified_at, verification_notes, availability_status, coordination_notes, updated_at)
        VALUES (?, ?, ?, ?, 'approved', ?, ?, 'PMDC registry verified.', 'on_duty', 'Monitoring East-City post-surgical & infusion home care queue.', ?)
      `).run(doctorId, 'PMDC-48219-P', 'Internal Medicine & Transitional Care', 'Post-Discharge Coordination', adminId, nowIso, nowIso);

      // Nurse profiles
      const insertNurseProfile = this.db.prepare(`
        INSERT INTO nurse_profiles (
          user_id, license_number, specialization, years_experience,
          verification_status, verified_by, verified_at, verification_notes,
          is_available, is_online, location_consent_granted, location_consent_at,
          current_lat, current_lng, location_updated_at, fcm_token, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertNurseProfile.run(
        nurse1Id, 'PNC-RN-77410', 'Infusion & Post-Surgical Nursing', 6,
        'approved', adminId, nowIso, 'Pakistan Nursing Council license & East-City badge verified.',
        1, 1, 1, nowIso,
        33.7152, 73.0528, freshMinus2Min, 'fcm-demo-nurse-ayesha', nowIso,
      );
      insertNurseProfile.run(
        nurse2Id, 'PNC-RN-81204', 'Acute Injections & Wound Care', 4,
        'approved', adminId, nowIso, 'Verified East-City outpatient float nurse.',
        1, 1, 1, nowIso,
        33.6942, 73.0285, freshMinus3Min, 'fcm-demo-nurse-bilal', nowIso,
      );
      insertNurseProfile.run(
        nurse3Id, 'PNC-RN-90331', 'Geriatric & Catheter Care', 3,
        'pending', null, null, 'Awaiting Hospital Administrator credential verification.',
        0, 0, 0, null,
        33.7095, 73.0490, null, null, nowIso,
      );

      // Nurse capabilities
      const insertCap = this.db.prepare('INSERT INTO nurse_service_capabilities (nurse_id, service_id) VALUES (?, ?)');
      for (const svcId of [1, 2, 3, 4, 5]) insertCap.run(nurse1Id, svcId);
      for (const svcId of [1, 2, 3, 5]) insertCap.run(nurse2Id, svcId);
      for (const svcId of [1, 3, 4, 5]) insertCap.run(nurse3Id, svcId);

      // Private credential evidence files (real files in private vault, outside public dir)
      const createDemoEvidenceFile = (filename: string, label: string): { storagePath: string; checksum: string } => {
        const targetPath = path.join(this.privateVaultDir, filename);
        const content = `EAST-CITY HOSPITAL HOMEHEAL CREDENTIAL EVIDENCE\n${label}\nIssued for FYDP demonstration verification.\n`;
        fs.writeFileSync(targetPath, content, 'utf8');
        const checksum = crypto.createHash('sha256').update(content).digest('hex');
        return { storagePath: filename, checksum };
      };

      const ev1 = createDemoEvidenceFile('cred_ayesha_pnc.txt', 'Nurse Ayesha Siddiqui - PNC-RN-77410 - Verified');
      const ev2 = createDemoEvidenceFile('cred_bilal_pnc.txt', 'Nurse Bilal Ahmed - PNC-RN-81204 - Verified');
      const ev3 = createDemoEvidenceFile('cred_zainab_pnc.txt', 'Nurse Zainab Raza - PNC-RN-90331 - Pending Review');
      const ev4 = createDemoEvidenceFile('cred_sara_pmdc.txt', 'Dr. Sara Khan - PMDC-48219-P - Verified');

      const insertCred = this.db.prepare(`
        INSERT INTO credential_documents (
          user_id, role, document_type, storage_provider, storage_path, original_filename,
          mime_type, sha256_checksum, review_status, reviewed_by, reviewed_at, review_notes, uploaded_at
        ) VALUES (?, ?, ?, 'local_private_vault', ?, ?, 'text/plain', ?, ?, ?, ?, ?, ?)
      `);
      insertCred.run(nurse1Id, 'nurse', 'PNC Registered Nurse License', ev1.storagePath, 'pnc_license_ayesha.txt', ev1.checksum, 'approved', adminId, nowIso, 'Verified against PNC registry.', nowIso);
      insertCred.run(nurse2Id, 'nurse', 'PNC Registered Nurse License', ev2.storagePath, 'pnc_license_bilal.txt', ev2.checksum, 'approved', adminId, nowIso, 'Verified against PNC registry.', nowIso);
      insertCred.run(nurse3Id, 'nurse', 'PNC Registered Nurse License', ev3.storagePath, 'pnc_license_zainab.txt', ev3.checksum, 'pending', null, null, 'Pending hospital admin review.', nowIso);
      insertCred.run(doctorId, 'doctor', 'PMDC Medical License', ev4.storagePath, 'pmdc_license_sara.txt', ev4.checksum, 'approved', adminId, nowIso, 'Verified.', nowIso);

      // Historical completed visit for Patient Ali + Nurse Ayesha
      const completedReqId = Number(
        this.db.prepare(`
          INSERT INTO service_requests (
            request_code, patient_id, service_id, assigned_nurse_id, status,
            patient_address, patient_lat, patient_lng, patient_location_consent, patient_location_consent_at,
            preferred_time_window, patient_notes, assistant_draft_used,
            created_at, accepted_at, en_route_at, arrived_at, completed_at
          ) VALUES (?, ?, ?, ?, 'Completed', ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?, ?, ?)
        `).run(
          'HH-2026-1001',
          patient1Id,
          3,
          nurse1Id,
          'House 22, Street 9, Sector F-7/2, Islamabad',
          33.7215,
          73.0568,
          completedCreated,
          '10:00 - 11:00',
          'Post-operative knee incision dressing change.',
          completedCreated,
          completedCreated,
          completedCreated,
          completedDone,
          completedDone,
        ).lastInsertRowid,
      );

      this.db.prepare(`
        INSERT INTO request_offers (request_id, nurse_id, haversine_distance_km, rank_order, offer_status, responded_at, created_at)
        VALUES (?, ?, 0.793, 1, 'accepted', ?, ?)
      `).run(completedReqId, nurse1Id, completedCreated, completedCreated);

      // Initial coordination notifications & audit entries
      const insertNotif = this.db.prepare(`
        INSERT INTO notifications (user_id, request_id, type, title, body, is_read, fcm_dispatched, created_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?)
      `);
      insertNotif.run(patient1Id, completedReqId, 'request_completed', 'Visit HH-2026-1001 Completed', 'Nurse Ayesha Siddiqui completed your Post-Surgical Wound Dressing visit.', completedDone);
      insertNotif.run(doctorId, completedReqId, 'coordination_notice', 'Post-Surgical Home Visit Completed', 'East-City HomeHeal completed visit HH-2026-1001 (Post-Surgical Wound Dressing) for patient Ali Hassan.', completedDone);
      insertNotif.run(adminId, null, 'verification_pending', 'Staff Credential Awaiting Review', 'Nurse Zainab Raza (PNC-RN-90331) submitted credentials for Hospital Administrator verification.', nowIso);

      this.db.prepare(`
        INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, metadata_json, ip_address, created_at)
        VALUES (?, 'admin', 'SYSTEM_SEED_INITIALIZED', 'hospital_settings', '1', ?, '127.0.0.1', ?)
      `).run(adminId, JSON.stringify({ hospital: 'East-City Hospital', services: 5 }), nowIso);
    });
  }

  public getHospitalSettings(): HospitalSettings {
    const row = this.db.prepare('SELECT * FROM hospital_settings WHERE id = 1').get() as Record<string, unknown>;
    return {
      id: Number(row.id),
      hospitalName: String(row.hospital_name),
      departmentName: String(row.department_name),
      address: String(row.address),
      city: String(row.city),
      phone: String(row.phone),
      supportEmail: String(row.support_email),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      serviceRadiusKm: Number(row.service_radius_km),
      locationFreshnessSeconds: Number(row.location_freshness_seconds),
      operatingHours: String(row.operating_hours),
      emergencyNotice: String(row.emergency_notice),
    };
  }

  public getApprovedServices(includeInactive = false): ApprovedService[] {
    const sql = includeInactive
      ? 'SELECT * FROM approved_services ORDER BY id ASC'
      : 'SELECT * FROM approved_services WHERE is_active = 1 ORDER BY id ASC';
    const rows = this.db.prepare(sql).all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      nameUr: String(r.name_ur),
      category: String(r.category),
      description: String(r.description),
      descriptionUr: String(r.description_ur),
      estimatedDurationMins: Number(r.estimated_duration_mins),
      preparationNotes: String(r.preparation_notes),
      requiresPrescriptionNote: Boolean(r.requires_prescription_note),
      isActive: Boolean(r.is_active),
    }));
  }

  public getUserByEmail(email: string): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapUser(row);
  }

  public getUserById(id: number): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapUser(row);
  }

  private mapUser(row: Record<string, unknown>): UserRecord {
    return {
      id: Number(row.id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      fullName: String(row.full_name),
      phone: String(row.phone),
      role: row.role as UserRole,
      preferredLanguage: row.preferred_language as LanguageCode,
      isActive: Boolean(row.is_active),
      createdAt: String(row.created_at),
    };
  }

  public getNurseMatchingCandidates(): NurseMatchingCandidate[] {
    const nurses = this.db.prepare(`
      SELECT np.*, u.full_name, u.is_active
      FROM nurse_profiles np
      JOIN users u ON u.id = np.user_id
      WHERE u.is_active = 1
    `).all() as Array<Record<string, unknown>>;

    const caps = this.db.prepare('SELECT nurse_id, service_id FROM nurse_service_capabilities').all() as Array<Record<string, unknown>>;
    const activeCounts = this.db.prepare(`
      SELECT assigned_nurse_id, COUNT(*) as cnt
      FROM service_requests
      WHERE assigned_nurse_id IS NOT NULL AND status IN ('Accepted', 'En Route', 'Arrived')
      GROUP BY assigned_nurse_id
    `).all() as Array<Record<string, unknown>>;

    const capMap = new Map<number, number[]>();
    for (const c of caps) {
      const nid = Number(c.nurse_id);
      const list = capMap.get(nid) ?? [];
      list.push(Number(c.service_id));
      capMap.set(nid, list);
    }

    const activeMap = new Map<number, number>();
    for (const a of activeCounts) {
      activeMap.set(Number(a.assigned_nurse_id), Number(a.cnt));
    }

    return nurses.map((n) => {
      const uid = Number(n.user_id);
      return {
        nurseId: uid,
        fullName: String(n.full_name),
        verificationStatus: n.verification_status as VerificationStatus,
        capableServiceIds: capMap.get(uid) ?? [],
        isAvailable: Boolean(n.is_available),
        isOnline: Boolean(n.is_online),
        locationConsentGranted: Boolean(n.location_consent_granted),
        currentLat: n.current_lat === null ? null : Number(n.current_lat),
        currentLng: n.current_lng === null ? null : Number(n.current_lng),
        locationUpdatedAt: n.location_updated_at === null ? null : String(n.location_updated_at),
        activeAssignmentCount: activeMap.get(uid) ?? 0,
      };
    });
  }

  public logAudit(params: {
    actorId: number | null;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, metadata_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.actorId,
      params.actorRole,
      params.action,
      params.targetType,
      params.targetId,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.ipAddress ?? '127.0.0.1',
      new Date().toISOString(),
    );
  }

  public createNotification(params: {
    userId: number;
    requestId?: number | null;
    type: string;
    title: string;
    body: string;
    fcmDispatched?: boolean;
  }): NotificationRecord {
    const nowIso = new Date().toISOString();
    const res = this.db.prepare(`
      INSERT INTO notifications (user_id, request_id, type, title, body, is_read, fcm_dispatched, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      params.userId,
      params.requestId ?? null,
      params.type,
      params.title,
      params.body,
      params.fcmDispatched ? 1 : 0,
      nowIso,
    );
    return {
      id: Number(res.lastInsertRowid),
      userId: params.userId,
      requestId: params.requestId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      isRead: false,
      fcmDispatched: Boolean(params.fcmDispatched),
      createdAt: nowIso,
    };
  }
}
