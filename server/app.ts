import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import {
  ACTIVE_VISIT_STATUSES,
  haversineDistanceKm,
  validateRequestTransition,
  type RequestStatus,
  type UserRole,
} from '../shared/domain.ts';
import {
  HomeHealDatabase,
  type AuditLogRecord,
  type CredentialDocRecord,
  type RequestMessageRecord,
  type RequestOfferRecord,
  type ServiceRequestRecord,
} from './db/database.ts';
import { verifyMySqlConnectivity } from './db/mysqlPool.ts';
import {
  hashPassword,
  resolvePrivateStoragePath,
  signAuthToken,
  verifyAuthToken,
  verifyPassword,
  type AuthTokenPayload,
} from './security.ts';
import { generateBoundedAssistantReply, generateSpeechWavBase64 } from './services/aiAssistant.ts';
import {
  dispatchFcmNotification,
  getFirebaseConfigStatus,
  uploadToPrivateFirebaseStorage,
} from './services/firebaseDispatcher.ts';
import { rankNursesForRequest } from './services/matchingClient.ts';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthTokenPayload;
    }
  }
}

function mapServiceRequestRow(
  r: Record<string, unknown>,
  viewerRole: UserRole,
): ServiceRequestRecord {
  const status = String(r.status) as RequestStatus;
  const isActiveVisit = ACTIVE_VISIT_STATUSES.includes(status);
  const nurseConsent = Boolean(r.nurse_location_consent);
  const canShareNurseLocation =
    (viewerRole === 'admin' || isActiveVisit) && nurseConsent;

  return {
    id: Number(r.id),
    requestCode: String(r.request_code),
    patientId: Number(r.patient_id),
    patientName: String(r.patient_name),
    patientPhone: viewerRole === 'doctor' ? 'Protected' : String(r.patient_phone),
    serviceId: Number(r.service_id),
    serviceCode: String(r.service_code),
    serviceName: String(r.service_name),
    serviceNameUr: String(r.service_name_ur),
    serviceCategory: String(r.service_category),
    assignedNurseId: r.assigned_nurse_id === null ? null : Number(r.assigned_nurse_id),
    assignedNurseName: r.assigned_nurse_name === null ? null : String(r.assigned_nurse_name),
    assignedNursePhone:
      r.assigned_nurse_phone === null || viewerRole === 'doctor'
        ? null
        : String(r.assigned_nurse_phone),
    assignedNurseLat:
      canShareNurseLocation && r.nurse_lat !== null ? Number(r.nurse_lat) : null,
    assignedNurseLng:
      canShareNurseLocation && r.nurse_lng !== null ? Number(r.nurse_lng) : null,
    assignedNurseLocationConsent: nurseConsent,
    assignedNurseLocationUpdatedAt:
      canShareNurseLocation && r.nurse_location_updated_at !== null
        ? String(r.nurse_location_updated_at)
        : null,
    status,
    patientAddress:
      viewerRole === 'doctor' ? 'Protected (East-City Service Zone)' : String(r.patient_address),
    patientLat: Number(r.patient_lat),
    patientLng: Number(r.patient_lng),
    patientLocationConsent: Boolean(r.patient_location_consent),
    patientLocationConsentAt: String(r.patient_location_consent_at),
    preferredTimeWindow: String(r.preferred_time_window),
    patientNotes: viewerRole === 'doctor' ? 'Restricted to assigned nurse' : String(r.patient_notes),
    assistantDraftUsed: Boolean(r.assistant_draft_used),
    cancellationReason: r.cancellation_reason === null ? null : String(r.cancellation_reason),
    createdAt: String(r.created_at),
    acceptedAt: r.accepted_at === null ? null : String(r.accepted_at),
    enRouteAt: r.en_route_at === null ? null : String(r.en_route_at),
    arrivedAt: r.arrived_at === null ? null : String(r.arrived_at),
    completedAt: r.completed_at === null ? null : String(r.completed_at),
    cancelledAt: r.cancelled_at === null ? null : String(r.cancelled_at),
  };
}

const REQUEST_SELECT_SQL = `
  SELECT
    sr.*,
    pu.full_name AS patient_name,
    pu.phone AS patient_phone,
    svc.code AS service_code,
    svc.name AS service_name,
    svc.name_ur AS service_name_ur,
    svc.category AS service_category,
    nu.full_name AS assigned_nurse_name,
    nu.phone AS assigned_nurse_phone,
    np.current_lat AS nurse_lat,
    np.current_lng AS nurse_lng,
    np.location_consent_granted AS nurse_location_consent,
    np.location_updated_at AS nurse_location_updated_at
  FROM service_requests sr
  JOIN users pu ON pu.id = sr.patient_id
  JOIN approved_services svc ON svc.id = sr.service_id
  LEFT JOIN users nu ON nu.id = sr.assigned_nurse_id
  LEFT JOIN nurse_profiles np ON np.user_id = sr.assigned_nurse_id
`;

export interface HomeHealAppBundle {
  app: express.Express;
  httpServer: http.Server;
  io: SocketIOServer;
  db: HomeHealDatabase;
}

export function createHomeHealApp(options?: {
  dbPath?: string;
  privateVaultDir?: string;
}): HomeHealAppBundle {
  const dbPath = options?.dbPath ?? process.env.SQLITE_DB_PATH ?? 'storage/homeheal.sqlite';
  const vaultDir = options?.privateVaultDir ?? 'storage/private_credentials';
  const db = new HomeHealDatabase(dbPath, vaultDir);

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  // Socket.IO authentication & room isolation
  io.use((socket, next) => {
    const token =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : '';
    const user = verifyAuthToken(token);
    if (!user) {
      return next(new Error('Unauthorized Socket.IO connection'));
    }
    socket.data.user = user;
    return next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthTokenPayload;
    socket.join(`user:${user.sub}`);
    socket.join(`role:${user.role}`);

    socket.on('request:join', (payload: { requestId?: number }) => {
      const reqId = Number(payload?.requestId);
      if (!Number.isInteger(reqId) || reqId <= 0) return;
      const row = db.db
        .prepare('SELECT id, patient_id, assigned_nurse_id FROM service_requests WHERE id = ?')
        .get(reqId) as { id: number; patient_id: number; assigned_nurse_id: number | null } | undefined;
      if (!row) return;
      const allowed =
        user.role === 'admin' ||
        row.patient_id === user.sub ||
        row.assigned_nurse_id === user.sub;
      if (allowed) {
        socket.join(`request:${reqId}`);
      }
    });

    socket.on('request:leave', (payload: { requestId?: number }) => {
      const reqId = Number(payload?.requestId);
      if (Number.isInteger(reqId) && reqId > 0) {
        socket.leave(`request:${reqId}`);
      }
    });
  });

  function pushUserNotification(params: {
    userId: number;
    requestId?: number | null;
    type: string;
    title: string;
    body: string;
    fcmToken?: string | null;
  }) {
    const notif = db.createNotification({
      userId: params.userId,
      requestId: params.requestId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      fcmDispatched: false,
    });
    io.to(`user:${params.userId}`).emit('notification:new', notif);

    if (params.fcmToken) {
      void dispatchFcmNotification({
        fcmToken: params.fcmToken,
        title: params.title,
        body: params.body,
        data: {
          type: params.type,
          requestId: params.requestId ? String(params.requestId) : '',
        },
      }).then((sent) => {
        if (sent) {
          db.db.prepare('UPDATE notifications SET fcm_dispatched = 1 WHERE id = ?').run(notif.id);
        }
      });
    }
    return notif;
  }

  function requireAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const payload = verifyAuthToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    const user = db.getUserById(payload.sub);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Account is inactive or unavailable.' });
      return;
    }
    req.authUser = payload;
    next();
  }

  function requireRole(...roles: UserRole[]) {
    return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      if (!req.authUser || !roles.includes(req.authUser.role)) {
        res.status(403).json({ error: 'You do not have permission for this action.' });
        return;
      }
      next();
    };
  }

  function buildUserSessionPayload(userId: number) {
    const user = db.getUserById(userId);
    if (!user) return null;

    let profile: Record<string, unknown> = {};
    if (user.role === 'patient') {
      const p = db.db.prepare('SELECT * FROM patient_profiles WHERE user_id = ?').get(user.id) as Record<string, unknown> | undefined;
      if (p) {
        profile = {
          dateOfBirth: p.date_of_birth ?? '',
          defaultAddress: p.default_address ?? '',
          defaultLat: p.default_lat === null ? null : Number(p.default_lat),
          defaultLng: p.default_lng === null ? null : Number(p.default_lng),
          emergencyContactName: p.emergency_contact_name ?? '',
          emergencyContactPhone: p.emergency_contact_phone ?? '',
          mobilityNotes: p.mobility_notes ?? '',
        };
      }
    } else if (user.role === 'nurse') {
      const n = db.db.prepare('SELECT * FROM nurse_profiles WHERE user_id = ?').get(user.id) as Record<string, unknown> | undefined;
      const caps = db.db
        .prepare('SELECT service_id FROM nurse_service_capabilities WHERE nurse_id = ?')
        .all(user.id) as Array<{ service_id: number }>;
      if (n) {
        profile = {
          licenseNumber: n.license_number,
          specialization: n.specialization,
          yearsExperience: Number(n.years_experience),
          verificationStatus: n.verification_status,
          verificationNotes: n.verification_notes,
          isAvailable: Boolean(n.is_available),
          isOnline: Boolean(n.is_online),
          locationConsentGranted: Boolean(n.location_consent_granted),
          locationConsentAt: n.location_consent_at,
          currentLat: n.current_lat === null ? null : Number(n.current_lat),
          currentLng: n.current_lng === null ? null : Number(n.current_lng),
          locationUpdatedAt: n.location_updated_at,
          capableServiceIds: caps.map((c) => Number(c.service_id)),
        };
      }
    } else if (user.role === 'doctor') {
      const d = db.db.prepare('SELECT * FROM doctor_profiles WHERE user_id = ?').get(user.id) as Record<string, unknown> | undefined;
      if (d) {
        profile = {
          pmdcLicense: d.pmdc_license,
          department: d.department,
          specialty: d.specialty,
          verificationStatus: d.verification_status,
          verificationNotes: d.verification_notes,
          availabilityStatus: d.availability_status,
          coordinationNotes: d.coordination_notes,
        };
      }
    }

    const credentials = db.db
      .prepare('SELECT * FROM credential_documents WHERE user_id = ? ORDER BY uploaded_at DESC')
      .all(user.id) as Array<Record<string, unknown>>;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
      },
      profile,
      credentials: credentials.map((c) => ({
        id: Number(c.id),
        documentType: String(c.document_type),
        storageProvider: String(c.storage_provider),
        originalFilename: String(c.original_filename),
        mimeType: String(c.mime_type),
        reviewStatus: String(c.review_status),
        reviewNotes: String(c.review_notes),
        uploadedAt: String(c.uploaded_at),
      })),
    };
  }

  // ---- PUBLIC HEALTH & CONFIG ----

  app.get('/api/health', async (_req, res) => {
    const mysqlStatus = await verifyMySqlConnectivity();
    const firebaseStatus = getFirebaseConfigStatus();
    res.json({
      status: 'ok',
      hospital: 'East-City Hospital',
      database: mysqlStatus,
      firebase: firebaseStatus,
      matchingServiceUrl: process.env.MATCHING_SERVICE_URL || 'in-process-haversine',
    });
  });

  app.get('/api/config/maps-client', (_req, res) => {
    const key =
      process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim() ||
      '';
    res.json({
      apiKey: key,
      mapsConfigured: Boolean(key),
    });
  });

  app.get('/api/hospital', (_req, res) => {
    res.json(db.getHospitalSettings());
  });

  app.get('/api/services', (_req, res) => {
    res.json({ services: db.getApprovedServices(false) });
  });

  app.get('/api/auth/demo-accounts', (_req, res) => {
    const users = db.db
      .prepare('SELECT id, email, full_name, role FROM users WHERE is_active = 1 ORDER BY id ASC')
      .all() as Array<{ id: number; email: string; full_name: string; role: UserRole }>;
    res.json({
      demoPasswordHint: 'HomeHeal@2026',
      accounts: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
      })),
    });
  });

  // ---- AUTHENTICATION ----

  const registerSchema = z.object({
    email: z.string().email().max(190),
    password: z.string().min(8).max(128),
    fullName: z.string().min(2).max(160),
    phone: z.string().min(6).max(40),
    role: z.enum(['patient', 'nurse', 'doctor']),
    preferredLanguage: z.enum(['en', 'ur', 'roman_ur']).optional().default('en'),
    defaultAddress: z.string().max(255).optional(),
    licenseNumber: z.string().max(80).optional(),
    specialization: z.string().max(160).optional(),
    department: z.string().max(120).optional(),
  });

  app.post('/api/auth/register', (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
      return;
    }
    const input = parsed.data;
    if (db.getUserByEmail(input.email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const passHash = hashPassword(input.password);
    const hospital = db.getHospitalSettings();

    try {
      const userId = db.runInTransaction(() => {
        const resInsert = db.db
          .prepare(`
            INSERT INTO users (email, password_hash, full_name, phone, role, preferred_language, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
          `)
          .run(
            input.email.toLowerCase().trim(),
            passHash,
            input.fullName.trim(),
            input.phone.trim(),
            input.role,
            input.preferredLanguage,
            nowIso,
            nowIso,
          );
        const newId = Number(resInsert.lastInsertRowid);

        if (input.role === 'patient') {
          db.db
            .prepare(`
              INSERT INTO patient_profiles (user_id, default_address, default_lat, default_lng, updated_at)
              VALUES (?, ?, ?, ?, ?)
            `)
            .run(
              newId,
              input.defaultAddress?.trim() || `${hospital.city} Sector F-8`,
              hospital.latitude + 0.008,
              hospital.longitude + 0.006,
              nowIso,
            );
        } else if (input.role === 'nurse') {
          const lic = input.licenseNumber?.trim() || `PNC-RN-${10000 + newId}`;
          db.db
            .prepare(`
              INSERT INTO nurse_profiles (
                user_id, license_number, specialization, years_experience,
                verification_status, verification_notes, is_available, is_online,
                location_consent_granted, updated_at
              ) VALUES (?, ?, ?, 1, 'pending', 'Please upload your PNC license for administrator review.', 0, 0, 0, ?)
            `)
            .run(newId, lic, input.specialization?.trim() || 'General Home Nursing', nowIso);
          db.db
            .prepare('INSERT INTO nurse_service_capabilities (nurse_id, service_id) VALUES (?, 1), (?, 5)')
            .run(newId, newId);
        } else if (input.role === 'doctor') {
          const pmdc = input.licenseNumber?.trim() || `PMDC-${50000 + newId}-P`;
          db.db
            .prepare(`
              INSERT INTO doctor_profiles (
                user_id, pmdc_license, department, specialty,
                verification_status, verification_notes, availability_status, updated_at
              ) VALUES (?, ?, ?, ?, 'pending', 'Awaiting Hospital Administrator verification.', 'on_call', ?)
            `)
            .run(
              newId,
              pmdc,
              input.department?.trim() || 'Internal Medicine',
              input.specialization?.trim() || 'Care Coordination',
              nowIso,
            );
        }

        db.logAudit({
          actorId: newId,
          actorRole: input.role,
          action: 'USER_REGISTERED',
          targetType: 'user',
          targetId: String(newId),
          metadata: { email: input.email.toLowerCase(), role: input.role },
          ipAddress: req.ip,
        });

        return newId;
      });

      const session = buildUserSessionPayload(userId);
      const token = signAuthToken({
        id: userId,
        email: input.email.toLowerCase().trim(),
        role: input.role,
        fullName: input.fullName.trim(),
      });
      res.status(201).json({ token, ...session });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to register account.',
      });
    }
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post('/api/auth/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and password are required.' });
      return;
    }
    const user = db.getUserByEmail(parsed.data.email);
    if (!user || !user.isActive || !verifyPassword(parsed.data.password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    db.logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'USER_LOGIN',
      targetType: 'user',
      targetId: String(user.id),
      ipAddress: req.ip,
    });

    const token = signAuthToken({
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    });
    const session = buildUserSessionPayload(user.id);
    res.json({ token, ...session });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const session = buildUserSessionPayload(req.authUser!.sub);
    if (!session) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }
    res.json(session);
  });

  // ---- PATIENT PROFILE ----

  const patientProfileSchema = z.object({
    fullName: z.string().min(2).max(160).optional(),
    phone: z.string().min(6).max(40).optional(),
    preferredLanguage: z.enum(['en', 'ur', 'roman_ur']).optional(),
    defaultAddress: z.string().min(3).max(255).optional(),
    defaultLat: z.number().min(-90).max(90).optional(),
    defaultLng: z.number().min(-180).max(180).optional(),
    emergencyContactName: z.string().max(160).optional(),
    emergencyContactPhone: z.string().max(40).optional(),
    mobilityNotes: z.string().max(500).optional(),
  });

  app.patch('/api/patient/profile', requireAuth, requireRole('patient'), (req, res) => {
    const parsed = patientProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile update.' });
      return;
    }
    const d = parsed.data;
    const nowIso = new Date().toISOString();
    const uid = req.authUser!.sub;

    db.runInTransaction(() => {
      if (d.fullName || d.phone || d.preferredLanguage) {
        db.db
          .prepare(`
            UPDATE users
            SET full_name = COALESCE(?, full_name),
                phone = COALESCE(?, phone),
                preferred_language = COALESCE(?, preferred_language),
                updated_at = ?
            WHERE id = ?
          `)
          .run(d.fullName ?? null, d.phone ?? null, d.preferredLanguage ?? null, nowIso, uid);
      }

      db.db
        .prepare(`
          UPDATE patient_profiles
          SET default_address = COALESCE(?, default_address),
              default_lat = COALESCE(?, default_lat),
              default_lng = COALESCE(?, default_lng),
              emergency_contact_name = COALESCE(?, emergency_contact_name),
              emergency_contact_phone = COALESCE(?, emergency_contact_phone),
              mobility_notes = COALESCE(?, mobility_notes),
              updated_at = ?
          WHERE user_id = ?
        `)
        .run(
          d.defaultAddress ?? null,
          d.defaultLat ?? null,
          d.defaultLng ?? null,
          d.emergencyContactName ?? null,
          d.emergencyContactPhone ?? null,
          d.mobilityNotes ?? null,
          nowIso,
          uid,
        );
    });

    res.json(buildUserSessionPayload(uid));
  });

  // ---- PRIVATE CREDENTIAL EVIDENCE UPLOAD & SECURE DOWNLOAD ----

  const uploadCredentialSchema = z.object({
    documentType: z.string().min(3).max(100),
    originalFilename: z.string().min(3).max(180),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']),
    base64Content: z.string().min(4).max(3_000_000),
  });

  app.post('/api/credentials/upload', requireAuth, requireRole('nurse', 'doctor'), async (req, res) => {
    const parsed = uploadCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credential payload.' });
      return;
    }

    const uid = req.authUser!.sub;
    const role = req.authUser!.role as 'nurse' | 'doctor';
    const { documentType, originalFilename, mimeType, base64Content } = parsed.data;
    const cleanBase64 = base64Content.includes(',') ? base64Content.split(',')[1] : base64Content;
    const fileBytes = Buffer.from(cleanBase64, 'base64');

    if (fileBytes.length === 0 || fileBytes.length > 2 * 1024 * 1024) {
      res.status(400).json({ error: 'Credential file must be non-empty and under 2 MB.' });
      return;
    }

    const checksum = crypto.createHash('sha256').update(fileBytes).digest('hex');
    const ext =
      mimeType === 'application/pdf'
        ? 'pdf'
        : mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/jpeg'
            ? 'jpg'
            : 'txt';
    const storedName = `cred_${role}_${uid}_${Date.now()}.${ext}`;
    const localTarget = resolvePrivateStoragePath(db.privateVaultDir, storedName);
    fs.writeFileSync(localTarget, fileBytes);

    const firebaseUpload = await uploadToPrivateFirebaseStorage({
      objectName: storedName,
      contentType: mimeType,
      bytes: fileBytes,
    });

    const storageProvider = firebaseUpload.uploaded ? 'firebase_storage' : 'local_private_vault';
    const storagePath = firebaseUpload.uploaded ? firebaseUpload.storagePath : storedName;
    const nowIso = new Date().toISOString();

    const docId = db.runInTransaction(() => {
      const insertRes = db.db
        .prepare(`
          INSERT INTO credential_documents (
            user_id, role, document_type, storage_provider, storage_path,
            original_filename, mime_type, sha256_checksum, review_status, review_notes, uploaded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'Submitted for Hospital Administrator verification.', ?)
        `)
        .run(
          uid,
          role,
          documentType.trim(),
          storageProvider,
          storagePath,
          path.basename(originalFilename),
          mimeType,
          checksum,
          nowIso,
        );

      if (role === 'nurse') {
        db.db
          .prepare(`
            UPDATE nurse_profiles
            SET verification_status = CASE WHEN verification_status = 'approved' THEN 'approved' ELSE 'under_review' END,
                updated_at = ?
            WHERE user_id = ?
          `)
          .run(nowIso, uid);
      } else {
        db.db
          .prepare(`
            UPDATE doctor_profiles
            SET verification_status = CASE WHEN verification_status = 'approved' THEN 'approved' ELSE 'under_review' END,
                updated_at = ?
            WHERE user_id = ?
          `)
          .run(nowIso, uid);
      }

      db.logAudit({
        actorId: uid,
        actorRole: role,
        action: 'CREDENTIAL_UPLOADED',
        targetType: 'credential_document',
        targetId: String(insertRes.lastInsertRowid),
        metadata: { documentType, storageProvider, checksum },
        ipAddress: req.ip,
      });

      return Number(insertRes.lastInsertRowid);
    });

    const admins = db.db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all() as Array<{ id: number }>;
    for (const adm of admins) {
      pushUserNotification({
        userId: adm.id,
        type: 'credential_submitted',
        title: 'New Credential Evidence Submitted',
        body: `${req.authUser!.fullName} (${role}) uploaded ${documentType} for verification.`,
      });
    }

    res.status(201).json({
      id: docId,
      storageProvider,
      session: buildUserSessionPayload(uid),
    });
  });

  app.get('/api/credentials/:id/file', requireAuth, (req, res) => {
    const docId = Number(req.params.id);
    const doc = db.db
      .prepare('SELECT * FROM credential_documents WHERE id = ?')
      .get(docId) as Record<string, unknown> | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Credential document not found.' });
      return;
    }

    const viewer = req.authUser!;
    if (viewer.role !== 'admin' && Number(doc.user_id) !== viewer.sub) {
      res.status(403).json({ error: 'Access denied to private credential evidence.' });
      return;
    }

    try {
      const localName = path.basename(String(doc.storage_path));
      const fullPath = resolvePrivateStoragePath(db.privateVaultDir, localName);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'Stored credential file not found on disk.' });
        return;
      }
      res.setHeader('Content-Type', String(doc.mime_type));
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(String(doc.original_filename))}"`);
      res.sendFile(fullPath);
    } catch {
      res.status(400).json({ error: 'Invalid credential storage path.' });
    }
  });

  // ---- NURSE AVAILABILITY & CONSENT-BASED LOCATION ----

  const nurseStatusSchema = z.object({
    isAvailable: z.boolean().optional(),
    isOnline: z.boolean().optional(),
    locationConsentGranted: z.boolean().optional(),
    capableServiceIds: z.array(z.number().int().positive()).optional(),
    currentLat: z.number().min(-90).max(90).optional(),
    currentLng: z.number().min(-180).max(180).optional(),
    fcmToken: z.string().max(255).optional(),
  });

  app.patch('/api/nurse/status', requireAuth, requireRole('nurse'), (req, res) => {
    const parsed = nurseStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid nurse status payload.' });
      return;
    }
    const d = parsed.data;
    const uid = req.authUser!.sub;
    const nowIso = new Date().toISOString();

    const current = db.db.prepare('SELECT * FROM nurse_profiles WHERE user_id = ?').get(uid) as Record<string, unknown> | undefined;
    if (!current) {
      res.status(404).json({ error: 'Nurse profile not found.' });
      return;
    }

    if ((d.isAvailable || d.isOnline) && String(current.verification_status) !== 'approved') {
      res.status(403).json({ error: 'Credentials must be approved by East-City Hospital Administrator before going on duty.' });
      return;
    }

    db.runInTransaction(() => {
      const nextConsent =
        d.locationConsentGranted !== undefined
          ? d.locationConsentGranted
          : Boolean(current.location_consent_granted);

      db.db
        .prepare(`
          UPDATE nurse_profiles
          SET is_available = COALESCE(?, is_available),
              is_online = COALESCE(?, is_online),
              location_consent_granted = ?,
              location_consent_at = CASE WHEN ? = 1 AND location_consent_at IS NULL THEN ? ELSE location_consent_at END,
              current_lat = CASE WHEN ? = 0 THEN NULL ELSE COALESCE(?, current_lat) END,
              current_lng = CASE WHEN ? = 0 THEN NULL ELSE COALESCE(?, current_lng) END,
              location_updated_at = CASE
                WHEN ? = 0 THEN NULL
                WHEN ? IS NOT NULL AND ? IS NOT NULL THEN ?
                ELSE location_updated_at
              END,
              fcm_token = COALESCE(?, fcm_token),
              updated_at = ?
          WHERE user_id = ?
        `)
        .run(
          d.isAvailable === undefined ? null : d.isAvailable ? 1 : 0,
          d.isOnline === undefined ? null : d.isOnline ? 1 : 0,
          nextConsent ? 1 : 0,
          nextConsent ? 1 : 0,
          nowIso,
          nextConsent ? 1 : 0,
          d.currentLat ?? null,
          nextConsent ? 1 : 0,
          d.currentLng ?? null,
          nextConsent ? 1 : 0,
          d.currentLat ?? null,
          d.currentLng ?? null,
          nowIso,
          d.fcmToken ?? null,
          nowIso,
          uid,
        );

      if (d.capableServiceIds) {
        db.db.prepare('DELETE FROM nurse_service_capabilities WHERE nurse_id = ?').run(uid);
        const ins = db.db.prepare('INSERT INTO nurse_service_capabilities (nurse_id, service_id) VALUES (?, ?)');
        for (const sid of d.capableServiceIds) {
          ins.run(uid, sid);
        }
      }

      db.logAudit({
        actorId: uid,
        actorRole: 'nurse',
        action: 'NURSE_STATUS_UPDATED',
        targetType: 'nurse_profile',
        targetId: String(uid),
        metadata: {
          isAvailable: d.isAvailable,
          isOnline: d.isOnline,
          locationConsentGranted: d.locationConsentGranted,
        },
        ipAddress: req.ip,
      });
    });

    res.json(buildUserSessionPayload(uid));
  });

  const nurseLocationSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  });

  app.post('/api/nurse/location', requireAuth, requireRole('nurse'), (req, res) => {
    const parsed = nurseLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
      return;
    }
    const uid = req.authUser!.sub;
    const profile = db.db.prepare('SELECT location_consent_granted FROM nurse_profiles WHERE user_id = ?').get(uid) as { location_consent_granted: number } | undefined;
    if (!profile || !profile.location_consent_granted) {
      res.status(403).json({ error: 'Enable location sharing consent before broadcasting GPS coordinates.' });
      return;
    }

    const nowIso = new Date().toISOString();
    db.db
      .prepare('UPDATE nurse_profiles SET current_lat = ?, current_lng = ?, location_updated_at = ?, updated_at = ? WHERE user_id = ?')
      .run(parsed.data.lat, parsed.data.lng, nowIso, nowIso, uid);

    const activeVisit = db.db
      .prepare("SELECT id, patient_id FROM service_requests WHERE assigned_nurse_id = ? AND status IN ('Accepted', 'En Route', 'Arrived')")
      .get(uid) as { id: number; patient_id: number } | undefined;

    if (activeVisit) {
      const payload = {
        requestId: activeVisit.id,
        nurseId: uid,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        updatedAt: nowIso,
      };
      io.to(`request:${activeVisit.id}`).emit('nurse:location', payload);
      io.to(`user:${activeVisit.patient_id}`).emit('nurse:location', payload);
    }

    res.json({ updatedAt: nowIso, lat: parsed.data.lat, lng: parsed.data.lng });
  });

  // ---- SERVICE REQUESTS & MATCHING LIFECYCLE ----

  const createRequestSchema = z.object({
    serviceId: z.number().int().positive(),
    patientAddress: z.string().min(5).max(255),
    patientLat: z.number().min(-90).max(90),
    patientLng: z.number().min(-180).max(180),
    patientLocationConsent: z.literal(true),
    explicitConfirmation: z.literal(true),
    preferredTimeWindow: z.string().min(3).max(80),
    patientNotes: z.string().max(600).optional().default(''),
    assistantDraftUsed: z.boolean().optional().default(false),
  });

  app.post('/api/requests', requireAuth, requireRole('patient'), async (req, res) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          'Request requires an approved service, home address, explicit location consent, and manual confirmation.',
      });
      return;
    }

    const input = parsed.data;
    const uid = req.authUser!.sub;
    const hospital = db.getHospitalSettings();
    const services = db.getApprovedServices(false);
    const service = services.find((s) => s.id === input.serviceId);
    if (!service) {
      res.status(404).json({ error: 'Selected nursing service is unavailable or inactive.' });
      return;
    }

    const distFromHospital = haversineDistanceKm(
      { lat: hospital.latitude, lng: hospital.longitude },
      { lat: input.patientLat, lng: input.patientLng },
    );
    if (distFromHospital > hospital.serviceRadiusKm) {
      res.status(400).json({
        error: `Selected home location is ${distFromHospital} km from ${hospital.hospitalName}, outside the ${hospital.serviceRadiusKm} km home-visit radius.`,
      });
      return;
    }

    const candidates = db.getNurseMatchingCandidates();
    const matchResult = await rankNursesForRequest({
      candidates,
      serviceId: service.id,
      patientCoords: { lat: input.patientLat, lng: input.patientLng },
      hospital,
    });

    const nowIso = new Date().toISOString();
    const requestCode = `HH-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const created = db.runInTransaction(() => {
      const insertReq = db.db
        .prepare(`
          INSERT INTO service_requests (
            request_code, patient_id, service_id, status,
            patient_address, patient_lat, patient_lng,
            patient_location_consent, patient_location_consent_at,
            preferred_time_window, patient_notes, assistant_draft_used, created_at
          ) VALUES (?, ?, ?, 'Pending', ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `)
        .run(
          requestCode,
          uid,
          service.id,
          input.patientAddress.trim(),
          input.patientLat,
          input.patientLng,
          nowIso,
          input.preferredTimeWindow.trim(),
          input.patientNotes.trim(),
          input.assistantDraftUsed ? 1 : 0,
          nowIso,
        );
      const reqId = Number(insertReq.lastInsertRowid);

      const insOffer = db.db.prepare(`
        INSERT INTO request_offers (request_id, nurse_id, haversine_distance_km, rank_order, offer_status, created_at)
        VALUES (?, ?, ?, ?, 'offered', ?)
      `);
      for (const ranked of matchResult.ranked) {
        insOffer.run(reqId, ranked.nurseId, ranked.haversineDistanceKm, ranked.rankOrder, nowIso);
      }

      db.logAudit({
        actorId: uid,
        actorRole: 'patient',
        action: 'SERVICE_REQUEST_CREATED',
        targetType: 'service_request',
        targetId: String(reqId),
        metadata: {
          requestCode,
          serviceCode: service.code,
          eligibleNursesCount: matchResult.ranked.length,
          matchingEngine: matchResult.engine,
        },
        ipAddress: req.ip,
      });

      return reqId;
    });

    const row = db.db.prepare(`${REQUEST_SELECT_SQL} WHERE sr.id = ?`).get(created) as Record<string, unknown>;
    const patientRequestView = mapServiceRequestRow(row, 'patient');

    // Notify patient
    pushUserNotification({
      userId: uid,
      requestId: created,
      type: 'request_submitted',
      title: `Request ${requestCode} Submitted`,
      body:
        matchResult.ranked.length > 0
          ? `Sent to ${matchResult.ranked.length} eligible East-City nurse(s) ranked by proximity.`
          : 'Submitted to East-City Hospital queue; awaiting an available nurse.',
    });

    // Notify each eligible nurse with offer
    for (const ranked of matchResult.ranked) {
      const nurseRow = db.db
        .prepare('SELECT fcm_token FROM nurse_profiles WHERE user_id = ?')
        .get(ranked.nurseId) as { fcm_token: string | null } | undefined;

      io.to(`user:${ranked.nurseId}`).emit('offer:new', {
        requestId: created,
        requestCode,
        serviceName: service.name,
        haversineDistanceKm: ranked.haversineDistanceKm,
        rankOrder: ranked.rankOrder,
      });

      pushUserNotification({
        userId: ranked.nurseId,
        requestId: created,
        type: 'nurse_offer',
        title: `New Visit Offer (${ranked.haversineDistanceKm.toFixed(2)} km)`,
        body: `${service.name} · ${input.preferredTimeWindow} · Rank #${ranked.rankOrder}`,
        fcmToken: nurseRow?.fcm_token ?? null,
      });
    }

    // Notify doctors & admins for coordination visibility
    const coordUsers = db.db
      .prepare("SELECT id FROM users WHERE role IN ('doctor', 'admin') AND is_active = 1")
      .all() as Array<{ id: number }>;
    for (const cu of coordUsers) {
      pushUserNotification({
        userId: cu.id,
        requestId: created,
        type: 'coordination_new_request',
        title: `New Home Nursing Request ${requestCode}`,
        body: `${service.name} requested (${matchResult.ranked.length} eligible nurse offers dispatched).`,
      });
    }

    io.to('role:admin').emit('request:created', mapServiceRequestRow(row, 'admin'));

    res.status(201).json({
      request: patientRequestView,
      matchingEngine: matchResult.engine,
      offeredNursesCount: matchResult.ranked.length,
    });
  });

  app.get('/api/requests', requireAuth, (req, res) => {
    const viewer = req.authUser!;
    let rows: Array<Record<string, unknown>> = [];

    if (viewer.role === 'patient') {
      rows = db.db
        .prepare(`${REQUEST_SELECT_SQL} WHERE sr.patient_id = ? ORDER BY sr.created_at DESC`)
        .all(viewer.sub) as Array<Record<string, unknown>>;
    } else if (viewer.role === 'nurse') {
      rows = db.db
        .prepare(`
          ${REQUEST_SELECT_SQL}
          WHERE sr.assigned_nurse_id = ?
             OR EXISTS (
               SELECT 1 FROM request_offers ro
               WHERE ro.request_id = sr.id AND ro.nurse_id = ? AND ro.offer_status = 'offered'
             )
          ORDER BY sr.created_at DESC
        `)
        .all(viewer.sub, viewer.sub) as Array<Record<string, unknown>>;
    } else if (viewer.role === 'doctor' || viewer.role === 'admin') {
      rows = db.db
        .prepare(`${REQUEST_SELECT_SQL} ORDER BY sr.created_at DESC`)
        .all() as Array<Record<string, unknown>>;
    }

    const mapped = rows.map((r) => mapServiceRequestRow(r, viewer.role));

    let offers: RequestOfferRecord[] = [];
    if (viewer.role === 'nurse') {
      const offerRows = db.db
        .prepare(`
          SELECT ro.*, sr.request_code, sr.service_id, svc.name AS service_name, svc.category AS service_category,
                 sr.patient_address, sr.patient_lat, sr.patient_lng, sr.preferred_time_window, sr.patient_notes, sr.status AS request_status
          FROM request_offers ro
          JOIN service_requests sr ON sr.id = ro.request_id
          JOIN approved_services svc ON svc.id = sr.service_id
          WHERE ro.nurse_id = ?
          ORDER BY ro.created_at DESC
        `)
        .all(viewer.sub) as Array<Record<string, unknown>>;

      offers = offerRows.map((o) => ({
        id: Number(o.id),
        requestId: Number(o.request_id),
        nurseId: Number(o.nurse_id),
        haversineDistanceKm: Number(o.haversine_distance_km),
        rankOrder: Number(o.rank_order),
        offerStatus: String(o.offer_status) as RequestOfferRecord['offerStatus'],
        respondedAt: o.responded_at === null ? null : String(o.responded_at),
        createdAt: String(o.created_at),
        requestCode: String(o.request_code),
        serviceId: Number(o.service_id),
        serviceName: String(o.service_name),
        serviceCategory: String(o.service_category),
        patientAddress: String(o.patient_address),
        patientLat: Number(o.patient_lat),
        patientLng: Number(o.patient_lng),
        preferredTimeWindow: String(o.preferred_time_window),
        patientNotes: String(o.patient_notes),
        requestStatus: String(o.request_status) as RequestStatus,
      }));
    }

    res.json({ requests: mapped, offers });
  });

  app.get('/api/requests/:id/offers', requireAuth, (req, res) => {
    const reqId = Number(req.params.id);
    const reqRow = db.db
      .prepare('SELECT id, patient_id FROM service_requests WHERE id = ?')
      .get(reqId) as { id: number; patient_id: number } | undefined;
    if (!reqRow) {
      res.status(404).json({ error: 'Request not found.' });
      return;
    }
    const viewer = req.authUser!;
    if (viewer.role !== 'admin' && reqRow.patient_id !== viewer.sub) {
      res.status(403).json({ error: 'Unauthorized to view request offer rankings.' });
      return;
    }

    const offerRows = db.db
      .prepare(`
        SELECT ro.*, u.full_name AS nurse_name
        FROM request_offers ro
        JOIN users u ON u.id = ro.nurse_id
        WHERE ro.request_id = ?
        ORDER BY ro.rank_order ASC
      `)
      .all(reqId) as Array<Record<string, unknown>>;

    res.json({
      offers: offerRows.map((o) => ({
        id: Number(o.id),
        nurseId: Number(o.nurse_id),
        nurseName: String(o.nurse_name),
        haversineDistanceKm: Number(o.haversine_distance_km),
        rankOrder: Number(o.rank_order),
        offerStatus: String(o.offer_status),
        respondedAt: o.responded_at === null ? null : String(o.responded_at),
      })),
    });
  });

  // ---- TRANSACTIONAL CONCURRENCY-SAFE NURSE ACCEPTANCE ----

  app.post('/api/requests/:id/accept', requireAuth, requireRole('nurse'), (req, res) => {
    const reqId = Number(req.params.id);
    const nurseId = req.authUser!.sub;
    const nowIso = new Date().toISOString();

    try {
      const outcome = db.runInTransaction(() => {
        const nurse = db.db
          .prepare('SELECT * FROM nurse_profiles WHERE user_id = ?')
          .get(nurseId) as Record<string, unknown> | undefined;
        if (!nurse) {
          return { code: 404 as const, error: 'Nurse profile not found.' };
        }
        if (String(nurse.verification_status) !== 'approved') {
          return { code: 403 as const, error: 'Nurse credentials are not approved.' };
        }
        if (!nurse.is_available || !nurse.is_online) {
          return { code: 400 as const, error: 'Nurse must be online and available to accept requests.' };
        }
        if (!nurse.location_consent_granted) {
          return { code: 400 as const, error: 'Location sharing consent must be enabled to accept visits.' };
        }

        const activeRow = db.db
          .prepare("SELECT id FROM service_requests WHERE assigned_nurse_id = ? AND status IN ('Accepted', 'En Route', 'Arrived')")
          .get(nurseId) as { id: number } | undefined;
        if (activeRow) {
          return {
            code: 409 as const,
            error: 'You already have an active home visit. Complete it before accepting another request.',
          };
        }

        const targetReq = db.db
          .prepare('SELECT * FROM service_requests WHERE id = ?')
          .get(reqId) as Record<string, unknown> | undefined;
        if (!targetReq) {
          return { code: 404 as const, error: 'Service request not found.' };
        }

        const hasCapability = db.db
          .prepare('SELECT 1 FROM nurse_service_capabilities WHERE nurse_id = ? AND service_id = ?')
          .get(nurseId, Number(targetReq.service_id));
        if (!hasCapability) {
          return { code: 403 as const, error: 'Nurse is not certified for this nursing service.' };
        }

        const transition = validateRequestTransition(
          String(targetReq.status) as RequestStatus,
          'Accepted',
          'nurse',
          false,
          false,
        );
        if (!transition.allowed || targetReq.assigned_nurse_id !== null) {
          return {
            code: 409 as const,
            error: 'This request has already been accepted by another nurse or is no longer Pending.',
          };
        }

        const updateRes = db.db
          .prepare(`
            UPDATE service_requests
            SET assigned_nurse_id = ?,
                status = 'Accepted',
                accepted_at = ?
            WHERE id = ? AND status = 'Pending' AND assigned_nurse_id IS NULL
          `)
          .run(nurseId, nowIso, reqId);

        if (updateRes.changes !== 1) {
          return {
            code: 409 as const,
            error: 'Concurrent acceptance conflict: request was claimed by another nurse.',
          };
        }

        // Update or insert offer record for winning nurse and supersede others
        const existingOffer = db.db
          .prepare('SELECT id FROM request_offers WHERE request_id = ? AND nurse_id = ?')
          .get(reqId, nurseId);
        if (existingOffer) {
          db.db
            .prepare("UPDATE request_offers SET offer_status = 'accepted', responded_at = ? WHERE request_id = ? AND nurse_id = ?")
            .run(nowIso, reqId, nurseId);
        } else {
          db.db
            .prepare("INSERT INTO request_offers (request_id, nurse_id, haversine_distance_km, rank_order, offer_status, responded_at, created_at) VALUES (?, ?, 0, 1, 'accepted', ?, ?)")
            .run(reqId, nurseId, nowIso, nowIso);
        }

        const supersededRows = db.db
          .prepare("SELECT nurse_id FROM request_offers WHERE request_id = ? AND nurse_id <> ? AND offer_status = 'offered'")
          .all(reqId, nurseId) as Array<{ nurse_id: number }>;

        db.db
          .prepare("UPDATE request_offers SET offer_status = 'superseded' WHERE request_id = ? AND nurse_id <> ? AND offer_status = 'offered'")
          .run(reqId, nurseId);

        db.logAudit({
          actorId: nurseId,
          actorRole: 'nurse',
          action: 'REQUEST_ACCEPTED',
          targetType: 'service_request',
          targetId: String(reqId),
          metadata: { requestCode: String(targetReq.request_code), nurseId },
          ipAddress: req.ip,
        });

        return {
          code: 200 as const,
          patientId: Number(targetReq.patient_id),
          requestCode: String(targetReq.request_code),
          supersededNurseIds: supersededRows.map((s) => Number(s.nurse_id)),
        };
      });

      if (outcome.code !== 200) {
        res.status(outcome.code).json({ error: outcome.error });
        return;
      }

      const fullRow = db.db.prepare(`${REQUEST_SELECT_SQL} WHERE sr.id = ?`).get(reqId) as Record<string, unknown>;
      const patientView = mapServiceRequestRow(fullRow, 'patient');
      const nurseView = mapServiceRequestRow(fullRow, 'nurse');
      const adminView = mapServiceRequestRow(fullRow, 'admin');

      io.to(`user:${outcome.patientId}`).emit('request:updated', patientView);
      io.to(`request:${reqId}`).emit('request:updated', patientView);
      io.to('role:admin').emit('request:updated', adminView);

      pushUserNotification({
        userId: outcome.patientId,
        requestId: reqId,
        type: 'request_accepted',
        title: `Nurse Assigned to ${outcome.requestCode}`,
        body: `${req.authUser!.fullName} has accepted your home nursing visit request.`,
      });

      for (const otherNurseId of outcome.supersededNurseIds) {
        io.to(`user:${otherNurseId}`).emit('offer:superseded', {
          requestId: reqId,
          requestCode: outcome.requestCode,
        });
      }

      res.json({ request: nurseView });
    } catch (err) {
      res.status(409).json({
        error:
          err instanceof Error && err.message.includes('UNIQUE')
            ? 'Assignment conflict: nurse already holds an active visit.'
            : 'Unable to accept request due to concurrent update.',
      });
    }
  });

  app.post('/api/requests/:id/decline', requireAuth, requireRole('nurse'), (req, res) => {
    const reqId = Number(req.params.id);
    const nurseId = req.authUser!.sub;
    const nowIso = new Date().toISOString();
    const resUpd = db.db
      .prepare("UPDATE request_offers SET offer_status = 'declined', responded_at = ? WHERE request_id = ? AND nurse_id = ? AND offer_status = 'offered'")
      .run(nowIso, reqId, nurseId);
    if (resUpd.changes === 0) {
      res.status(404).json({ error: 'Active offer not found for this request.' });
      return;
    }
    db.logAudit({
      actorId: nurseId,
      actorRole: 'nurse',
      action: 'OFFER_DECLINED',
      targetType: 'service_request',
      targetId: String(reqId),
      ipAddress: req.ip,
    });
    res.json({ ok: true });
  });

  const statusUpdateSchema = z.object({
    status: z.enum(['En Route', 'Arrived', 'Completed', 'Cancelled', 'Rejected']),
    cancellationReason: z.string().max(300).optional(),
  });

  app.patch('/api/requests/:id/status', requireAuth, (req, res) => {
    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status transition payload.' });
      return;
    }

    const reqId = Number(req.params.id);
    const actor = req.authUser!;
    const nextStatus = parsed.data.status;
    const nowIso = new Date().toISOString();

    const result = db.runInTransaction(() => {
      const target = db.db
        .prepare('SELECT * FROM service_requests WHERE id = ?')
        .get(reqId) as Record<string, unknown> | undefined;
      if (!target) {
        return { code: 404 as const, error: 'Service request not found.' };
      }

      const currentStatus = String(target.status) as RequestStatus;
      const isAssignedNurse = target.assigned_nurse_id !== null && Number(target.assigned_nurse_id) === actor.sub;
      const isRequestPatient = Number(target.patient_id) === actor.sub;

      const check = validateRequestTransition(
        currentStatus,
        nextStatus,
        actor.role,
        isAssignedNurse,
        isRequestPatient,
      );
      if (!check.allowed) {
        return { code: 403 as const, error: check.reason || 'Transition not permitted.' };
      }

      db.db
        .prepare(`
          UPDATE service_requests
          SET status = ?,
              en_route_at = CASE WHEN ? = 'En Route' THEN ? ELSE en_route_at END,
              arrived_at = CASE WHEN ? = 'Arrived' THEN ? ELSE arrived_at END,
              completed_at = CASE WHEN ? = 'Completed' THEN ? ELSE completed_at END,
              cancelled_at = CASE WHEN ? IN ('Cancelled', 'Rejected') THEN ? ELSE cancelled_at END,
              cancellation_reason = CASE WHEN ? IN ('Cancelled', 'Rejected') THEN ? ELSE cancellation_reason END,
              cancelled_by = CASE WHEN ? IN ('Cancelled', 'Rejected') THEN ? ELSE cancelled_by END
          WHERE id = ? AND status = ?
        `)
        .run(
          nextStatus,
          nextStatus,
          nowIso,
          nextStatus,
          nowIso,
          nextStatus,
          nowIso,
          nextStatus,
          nowIso,
          nextStatus,
          parsed.data.cancellationReason?.trim() || (nextStatus === 'Rejected' ? 'Rejected by Hospital Administrator' : 'Cancelled by user'),
          nextStatus,
          actor.sub,
          reqId,
          currentStatus,
        );

      if (nextStatus === 'Cancelled' || nextStatus === 'Rejected') {
        db.db
          .prepare("UPDATE request_offers SET offer_status = 'expired' WHERE request_id = ? AND offer_status = 'offered'")
          .run(reqId);
      }

      db.logAudit({
        actorId: actor.sub,
        actorRole: actor.role,
        action: `REQUEST_STATUS_${nextStatus.toUpperCase().replace(/\s+/g, '_')}`,
        targetType: 'service_request',
        targetId: String(reqId),
        metadata: { from: currentStatus, to: nextStatus },
        ipAddress: req.ip,
      });

      return {
        code: 200 as const,
        patientId: Number(target.patient_id),
        assignedNurseId: target.assigned_nurse_id === null ? null : Number(target.assigned_nurse_id),
        requestCode: String(target.request_code),
      };
    });

    if (result.code !== 200) {
      res.status(result.code).json({ error: result.error });
      return;
    }

    const fullRow = db.db.prepare(`${REQUEST_SELECT_SQL} WHERE sr.id = ?`).get(reqId) as Record<string, unknown>;
    const patientView = mapServiceRequestRow(fullRow, 'patient');
    const adminView = mapServiceRequestRow(fullRow, 'admin');

    io.to(`user:${result.patientId}`).emit('request:updated', patientView);
    io.to(`request:${reqId}`).emit('request:updated', patientView);
    if (result.assignedNurseId) {
      io.to(`user:${result.assignedNurseId}`).emit('request:updated', mapServiceRequestRow(fullRow, 'nurse'));
    }
    io.to('role:admin').emit('request:updated', adminView);

    pushUserNotification({
      userId: result.patientId,
      requestId: reqId,
      type: 'request_progress',
      title: `${result.requestCode}: ${nextStatus}`,
      body:
        nextStatus === 'En Route'
          ? 'Your assigned East-City nurse is now en route to your home.'
          : nextStatus === 'Arrived'
            ? 'Your assigned East-City nurse has arrived at your home.'
            : nextStatus === 'Completed'
              ? 'Your home nursing visit is completed. Thank you for choosing East-City Hospital.'
              : `Your request status changed to ${nextStatus}.`,
    });

    if (result.assignedNurseId && actor.sub !== result.assignedNurseId) {
      pushUserNotification({
        userId: result.assignedNurseId,
        requestId: reqId,
        type: 'request_progress',
        title: `${result.requestCode}: ${nextStatus}`,
        body: `Visit ${result.requestCode} was updated to ${nextStatus}.`,
      });
    }

    if (nextStatus === 'Completed' || nextStatus === 'Cancelled') {
      const doctors = db.db.prepare("SELECT id FROM users WHERE role = 'doctor' AND is_active = 1").all() as Array<{ id: number }>;
      for (const doc of doctors) {
        pushUserNotification({
          userId: doc.id,
          requestId: reqId,
          type: 'coordination_update',
          title: `Visit ${result.requestCode} ${nextStatus}`,
          body: `East-City HomeHeal visit ${result.requestCode} transitioned to ${nextStatus}.`,
        });
      }
    }

    res.json({ request: mapServiceRequestRow(fullRow, actor.role) });
  });

  // ---- SECURE PATIENT–ASSIGNED-NURSE MESSAGING ----

  app.get('/api/requests/:id/messages', requireAuth, (req, res) => {
    const reqId = Number(req.params.id);
    const reqRow = db.db
      .prepare('SELECT id, patient_id, assigned_nurse_id FROM service_requests WHERE id = ?')
      .get(reqId) as { id: number; patient_id: number; assigned_nurse_id: number | null } | undefined;
    if (!reqRow) {
      res.status(404).json({ error: 'Service request not found.' });
      return;
    }

    const viewer = req.authUser!;
    if (viewer.sub !== reqRow.patient_id && viewer.sub !== reqRow.assigned_nurse_id) {
      res.status(403).json({ error: 'Only the patient and assigned nurse may access visit messages.' });
      return;
    }

    const rows = db.db
      .prepare(`
        SELECT rm.*, u.full_name AS sender_name
        FROM request_messages rm
        JOIN users u ON u.id = rm.sender_id
        WHERE rm.request_id = ?
        ORDER BY rm.created_at ASC, rm.id ASC
      `)
      .all(reqId) as Array<Record<string, unknown>>;

    const messages: RequestMessageRecord[] = rows.map((m) => ({
      id: Number(m.id),
      requestId: Number(m.request_id),
      senderId: Number(m.sender_id),
      senderName: String(m.sender_name),
      senderRole: String(m.sender_role) as 'patient' | 'nurse',
      body: String(m.body),
      clientMsgId: m.client_msg_id === null ? null : String(m.client_msg_id),
      createdAt: String(m.created_at),
    }));

    res.json({ messages });
  });

  const messageSchema = z.object({
    body: z.string().trim().min(1).max(1000),
    clientMsgId: z.string().max(64).optional(),
  });

  app.post('/api/requests/:id/messages', requireAuth, (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }
    const reqId = Number(req.params.id);
    const reqRow = db.db
      .prepare('SELECT id, request_code, patient_id, assigned_nurse_id, status FROM service_requests WHERE id = ?')
      .get(reqId) as
      | {
          id: number;
          request_code: string;
          patient_id: number;
          assigned_nurse_id: number | null;
          status: RequestStatus;
        }
      | undefined;

    if (!reqRow) {
      res.status(404).json({ error: 'Service request not found.' });
      return;
    }

    const sender = req.authUser!;
    const isPatient = sender.sub === reqRow.patient_id;
    const isAssignedNurse = sender.sub === reqRow.assigned_nurse_id;
    if (!isPatient && !isAssignedNurse) {
      res.status(403).json({ error: 'Only the patient and assigned nurse can exchange messages.' });
      return;
    }
    if (!reqRow.assigned_nurse_id || !ACTIVE_VISIT_STATUSES.includes(reqRow.status)) {
      res.status(400).json({ error: 'Messaging is active only during an assigned ongoing visit.' });
      return;
    }

    const clientMsgId = parsed.data.clientMsgId || null;
    if (clientMsgId) {
      const existing = db.db
        .prepare(`
          SELECT rm.*, u.full_name AS sender_name
          FROM request_messages rm
          JOIN users u ON u.id = rm.sender_id
          WHERE rm.request_id = ? AND rm.client_msg_id = ?
        `)
        .get(reqId, clientMsgId) as Record<string, unknown> | undefined;
      if (existing) {
        res.status(200).json({
          message: {
            id: Number(existing.id),
            requestId: Number(existing.request_id),
            senderId: Number(existing.sender_id),
            senderName: String(existing.sender_name),
            senderRole: String(existing.sender_role),
            body: String(existing.body),
            clientMsgId: String(existing.client_msg_id),
            createdAt: String(existing.created_at),
          },
          deduplicated: true,
        });
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const senderRole = isPatient ? 'patient' : 'nurse';
    const ins = db.db
      .prepare(`
        INSERT INTO request_messages (request_id, sender_id, sender_role, body, client_msg_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(reqId, sender.sub, senderRole, parsed.data.body, clientMsgId, nowIso);

    const msg: RequestMessageRecord = {
      id: Number(ins.lastInsertRowid),
      requestId: reqId,
      senderId: sender.sub,
      senderName: sender.fullName,
      senderRole,
      body: parsed.data.body,
      clientMsgId,
      createdAt: nowIso,
    };

    io.to(`request:${reqId}`).emit('message:new', msg);
    const recipientId = isPatient ? reqRow.assigned_nurse_id : reqRow.patient_id;
    io.to(`user:${recipientId}`).emit('message:new', msg);
    pushUserNotification({
      userId: recipientId,
      requestId: reqId,
      type: 'chat_message',
      title: `Message on ${reqRow.request_code}`,
      body: `${sender.fullName}: ${parsed.data.body.slice(0, 80)}`,
    });

    res.status(201).json({ message: msg });
  });

  // ---- NOTIFICATIONS ----

  app.get('/api/notifications', requireAuth, (req, res) => {
    const rows = db.db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
      .all(req.authUser!.sub) as Array<Record<string, unknown>>;
    res.json({
      notifications: rows.map((n) => ({
        id: Number(n.id),
        userId: Number(n.user_id),
        requestId: n.request_id === null ? null : Number(n.request_id),
        type: String(n.type),
        title: String(n.title),
        body: String(n.body),
        isRead: Boolean(n.is_read),
        fcmDispatched: Boolean(n.fcm_dispatched),
        createdAt: String(n.created_at),
      })),
    });
  });

  app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
    db.db
      .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
      .run(Number(req.params.id), req.authUser!.sub);
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req, res) => {
    db.db
      .prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?')
      .run(req.authUser!.sub);
    res.json({ ok: true });
  });

  // ---- BILINGUAL GEMINI AI ASSISTANT (BOUNDED PATIENT GUIDANCE) ----

  const aiAssistSchema = z.object({
    message: z.string().trim().min(1).max(1500),
    language: z.enum(['en', 'ur', 'roman_ur']).default('en'),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          text: z.string().max(1500),
        }),
      )
      .max(10)
      .optional()
      .default([]),
  });

  app.post('/api/ai/assist', requireAuth, requireRole('patient'), async (req, res) => {
    const parsed = aiAssistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter a valid message for the assistant.' });
      return;
    }

    const uid = req.authUser!.sub;
    const user = db.getUserById(uid)!;
    const patientProfile = db.db
      .prepare('SELECT default_address FROM patient_profiles WHERE user_id = ?')
      .get(uid) as { default_address?: string } | undefined;

    // Fetch ONLY this authenticated patient's own requests
    const ownRows = db.db
      .prepare(`
        SELECT sr.request_code, svc.name AS service_name, sr.status, sr.preferred_time_window,
               nu.full_name AS assigned_nurse_name, sr.created_at
        FROM service_requests sr
        JOIN approved_services svc ON svc.id = sr.service_id
        LEFT JOIN users nu ON nu.id = sr.assigned_nurse_id
        WHERE sr.patient_id = ?
        ORDER BY sr.created_at DESC
        LIMIT 10
      `)
      .all(uid) as Array<Record<string, unknown>>;

    try {
      const result = await generateBoundedAssistantReply({
        message: parsed.data.message,
        language: parsed.data.language,
        patientName: user.fullName,
        patientDefaultAddress: patientProfile?.default_address ?? '',
        hospital: db.getHospitalSettings(),
        services: db.getApprovedServices(false),
        authorizedRequests: ownRows.map((r) => ({
          requestCode: String(r.request_code),
          serviceName: String(r.service_name),
          status: String(r.status),
          preferredTimeWindow: String(r.preferred_time_window),
          assignedNurseName: r.assigned_nurse_name === null ? null : String(r.assigned_nurse_name),
          createdAt: String(r.created_at),
        })),
        history: parsed.data.history,
      });

      db.logAudit({
        actorId: uid,
        actorRole: 'patient',
        action: 'AI_ASSISTANT_QUERY',
        targetType: 'ai_assistant',
        targetId: String(uid),
        metadata: {
          language: parsed.data.language,
          outOfScopeBlocked: result.outOfScopeBlocked,
          emergencyEscalation: result.emergencyEscalation,
          preparedDraft: Boolean(result.draft),
        },
        ipAddress: req.ip,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI assistant service error.';
      res.status(503).json({ error: msg });
    }
  });

  const ttsSchema = z.object({
    text: z.string().trim().min(1).max(600),
    language: z.enum(['en', 'ur', 'roman_ur']).default('en'),
  });

  app.post('/api/ai/tts', requireAuth, requireRole('patient'), async (req, res) => {
    const parsed = ttsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid text is required for speech output.' });
      return;
    }
    try {
      const audio = await generateSpeechWavBase64(parsed.data);
      res.json(audio);
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Speech synthesis unavailable.',
      });
    }
  });

  // ---- DOCTOR COORDINATION ----

  const doctorProfileSchema = z.object({
    department: z.string().min(2).max(120).optional(),
    specialty: z.string().min(2).max(160).optional(),
    availabilityStatus: z.enum(['on_duty', 'on_call', 'off_duty']).optional(),
    coordinationNotes: z.string().max(500).optional(),
  });

  app.patch('/api/doctor/profile', requireAuth, requireRole('doctor'), (req, res) => {
    const parsed = doctorProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid doctor profile update.' });
      return;
    }
    const d = parsed.data;
    const nowIso = new Date().toISOString();
    const uid = req.authUser!.sub;
    db.db
      .prepare(`
        UPDATE doctor_profiles
        SET department = COALESCE(?, department),
            specialty = COALESCE(?, specialty),
            availability_status = COALESCE(?, availability_status),
            coordination_notes = COALESCE(?, coordination_notes),
            updated_at = ?
        WHERE user_id = ?
      `)
      .run(
        d.department ?? null,
        d.specialty ?? null,
        d.availabilityStatus ?? null,
        d.coordinationNotes ?? null,
        nowIso,
        uid,
      );
    db.logAudit({
      actorId: uid,
      actorRole: 'doctor',
      action: 'DOCTOR_PROFILE_UPDATED',
      targetType: 'doctor_profile',
      targetId: String(uid),
      ipAddress: req.ip,
    });
    res.json(buildUserSessionPayload(uid));
  });

  // ---- HOSPITAL ADMINISTRATOR ----

  app.get('/api/admin/overview', requireAuth, requireRole('admin'), (_req, res) => {
    const statusCounts = db.db
      .prepare('SELECT status, COUNT(*) AS count FROM service_requests GROUP BY status')
      .all() as Array<{ status: string; count: number }>;

    const staffCounts = db.db
      .prepare(`
        SELECT role, COUNT(*) AS total
        FROM users
        WHERE role IN ('patient', 'nurse', 'doctor')
        GROUP BY role
      `)
      .all() as Array<{ role: string; total: number }>;

    const pendingCreds = db.db
      .prepare("SELECT COUNT(*) AS cnt FROM credential_documents WHERE review_status = 'pending'")
      .get() as { cnt: number };

    const activeNursesOnline = db.db
      .prepare("SELECT COUNT(*) AS cnt FROM nurse_profiles WHERE verification_status = 'approved' AND is_online = 1 AND is_available = 1")
      .get() as { cnt: number };

    res.json({
      requestCountsByStatus: Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.count)])),
      userCountsByRole: Object.fromEntries(staffCounts.map((s) => [s.role, Number(s.total)])),
      pendingCredentialsCount: Number(pendingCreds.cnt),
      activeNursesOnlineCount: Number(activeNursesOnline.cnt),
    });
  });

  app.get('/api/admin/staff', requireAuth, requireRole('admin'), (_req, res) => {
    const nurses = db.db
      .prepare(`
        SELECT u.id, u.email, u.full_name, u.phone, u.is_active, np.*
        FROM users u
        JOIN nurse_profiles np ON np.user_id = u.id
        ORDER BY u.id ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const doctors = db.db
      .prepare(`
        SELECT u.id, u.email, u.full_name, u.phone, u.is_active, dp.*
        FROM users u
        JOIN doctor_profiles dp ON dp.user_id = u.id
        ORDER BY u.id ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const credentials = db.db
      .prepare(`
        SELECT cd.*, u.full_name AS user_name, u.email AS user_email
        FROM credential_documents cd
        JOIN users u ON u.id = cd.user_id
        ORDER BY cd.uploaded_at DESC
      `)
      .all() as Array<Record<string, unknown>>;

    const mappedCreds: CredentialDocRecord[] = credentials.map((c) => ({
      id: Number(c.id),
      userId: Number(c.user_id),
      userName: String(c.user_name),
      userEmail: String(c.user_email),
      role: String(c.role) as 'nurse' | 'doctor',
      documentType: String(c.document_type),
      storageProvider: String(c.storage_provider) as 'firebase_storage' | 'local_private_vault',
      storagePath: String(c.storage_path),
      originalFilename: String(c.original_filename),
      mimeType: String(c.mime_type),
      sha256Checksum: String(c.sha256_checksum),
      reviewStatus: String(c.review_status) as 'pending' | 'approved' | 'rejected',
      reviewedBy: c.reviewed_by === null ? null : Number(c.reviewed_by),
      reviewedAt: c.reviewed_at === null ? null : String(c.reviewed_at),
      reviewNotes: String(c.review_notes),
      uploadedAt: String(c.uploaded_at),
    }));

    res.json({
      nurses: nurses.map((n) => ({
        userId: Number(n.user_id),
        fullName: String(n.full_name),
        email: String(n.email),
        phone: String(n.phone),
        isActive: Boolean(n.is_active),
        licenseNumber: String(n.license_number),
        specialization: String(n.specialization),
        yearsExperience: Number(n.years_experience),
        verificationStatus: String(n.verification_status),
        isAvailable: Boolean(n.is_available),
        isOnline: Boolean(n.is_online),
        locationConsentGranted: Boolean(n.location_consent_granted),
      })),
      doctors: doctors.map((d) => ({
        userId: Number(d.user_id),
        fullName: String(d.full_name),
        email: String(d.email),
        phone: String(d.phone),
        isActive: Boolean(d.is_active),
        pmdcLicense: String(d.pmdc_license),
        department: String(d.department),
        specialty: String(d.specialty),
        verificationStatus: String(d.verification_status),
        availabilityStatus: String(d.availability_status),
      })),
      credentials: mappedCreds,
    });
  });

  const reviewCredentialSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    reviewNotes: z.string().min(2).max(500),
  });

  app.patch('/api/admin/credentials/:id/review', requireAuth, requireRole('admin'), (req, res) => {
    const parsed = reviewCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid decision and review notes are required.' });
      return;
    }

    const credId = Number(req.params.id);
    const adminId = req.authUser!.sub;
    const nowIso = new Date().toISOString();

    const doc = db.db
      .prepare('SELECT * FROM credential_documents WHERE id = ?')
      .get(credId) as Record<string, unknown> | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Credential document not found.' });
      return;
    }

    const targetUserId = Number(doc.user_id);
    const targetRole = String(doc.role) as 'nurse' | 'doctor';

    db.runInTransaction(() => {
      db.db
        .prepare(`
          UPDATE credential_documents
          SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?, uploaded_at = uploaded_at
          WHERE id = ?
        `)
        .run(parsed.data.decision, adminId, nowIso, parsed.data.reviewNotes.trim(), credId);

      if (targetRole === 'nurse') {
        db.db
          .prepare(`
            UPDATE nurse_profiles
            SET verification_status = ?, verified_by = ?, verified_at = ?, verification_notes = ?,
                is_available = CASE WHEN ? = 'rejected' THEN 0 ELSE is_available END,
                is_online = CASE WHEN ? = 'rejected' THEN 0 ELSE is_online END,
                updated_at = ?
            WHERE user_id = ?
          `)
          .run(
            parsed.data.decision,
            adminId,
            nowIso,
            parsed.data.reviewNotes.trim(),
            parsed.data.decision,
            parsed.data.decision,
            nowIso,
            targetUserId,
          );
      } else {
        db.db
          .prepare(`
            UPDATE doctor_profiles
            SET verification_status = ?, verified_by = ?, verified_at = ?, verification_notes = ?, updated_at = ?
            WHERE user_id = ?
          `)
          .run(parsed.data.decision, adminId, nowIso, parsed.data.reviewNotes.trim(), nowIso, targetUserId);
      }

      db.logAudit({
        actorId: adminId,
        actorRole: 'admin',
        action: `CREDENTIAL_${parsed.data.decision.toUpperCase()}`,
        targetType: 'credential_document',
        targetId: String(credId),
        metadata: { targetUserId, targetRole, reviewNotes: parsed.data.reviewNotes },
        ipAddress: req.ip,
      });
    });

    pushUserNotification({
      userId: targetUserId,
      type: 'credential_reviewed',
      title: `Credential ${parsed.data.decision === 'approved' ? 'Approved' : 'Rejected'}`,
      body: parsed.data.reviewNotes.trim(),
    });

    res.json({ ok: true, decision: parsed.data.decision });
  });

  app.get('/api/admin/services', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({ services: db.getApprovedServices(true) });
  });

  const serviceSchema = z.object({
    code: z.string().min(3).max(40),
    name: z.string().min(3).max(160),
    nameUr: z.string().min(2).max(160),
    category: z.string().min(2).max(80),
    description: z.string().min(10).max(1000),
    descriptionUr: z.string().min(2).max(1000),
    estimatedDurationMins: z.number().int().min(10).max(240),
    preparationNotes: z.string().max(600),
    requiresPrescriptionNote: z.boolean(),
    isActive: z.boolean().optional().default(true),
  });

  app.post('/api/admin/services', requireAuth, requireRole('admin'), (req, res) => {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid service data.' });
      return;
    }
    const d = parsed.data;
    const nowIso = new Date().toISOString();
    try {
      const ins = db.db
        .prepare(`
          INSERT INTO approved_services (
            code, name, name_ur, category, description, description_ur,
            estimated_duration_mins, preparation_notes, requires_prescription_note, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          d.code.trim(),
          d.name.trim(),
          d.nameUr.trim(),
          d.category.trim(),
          d.description.trim(),
          d.descriptionUr.trim(),
          d.estimatedDurationMins,
          d.preparationNotes.trim(),
          d.requiresPrescriptionNote ? 1 : 0,
          d.isActive ? 1 : 0,
          nowIso,
          nowIso,
        );
      db.logAudit({
        actorId: req.authUser!.sub,
        actorRole: 'admin',
        action: 'APPROVED_SERVICE_CREATED',
        targetType: 'approved_service',
        targetId: String(ins.lastInsertRowid),
        metadata: { code: d.code, name: d.name },
        ipAddress: req.ip,
      });
      res.status(201).json({ services: db.getApprovedServices(true) });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'Service code conflict.' });
    }
  });

  app.patch('/api/admin/services/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;
    const estimatedDurationMins =
      typeof req.body?.estimatedDurationMins === 'number' ? req.body.estimatedDurationMins : undefined;
    const nowIso = new Date().toISOString();

    db.db
      .prepare(`
        UPDATE approved_services
        SET is_active = COALESCE(?, is_active),
            estimated_duration_mins = COALESCE(?, estimated_duration_mins),
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        isActive === undefined ? null : isActive ? 1 : 0,
        estimatedDurationMins ?? null,
        nowIso,
        id,
      );

    db.logAudit({
      actorId: req.authUser!.sub,
      actorRole: 'admin',
      action: 'APPROVED_SERVICE_UPDATED',
      targetType: 'approved_service',
      targetId: String(id),
      metadata: { isActive, estimatedDurationMins },
      ipAddress: req.ip,
    });
    res.json({ services: db.getApprovedServices(true) });
  });

  const hospitalUpdateSchema = z.object({
    address: z.string().min(5).max(255).optional(),
    phone: z.string().min(5).max(40).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    serviceRadiusKm: z.number().min(1).max(100).optional(),
    locationFreshnessSeconds: z.number().int().min(30).max(3600).optional(),
    operatingHours: z.string().min(3).max(120).optional(),
  });

  app.patch('/api/admin/hospital', requireAuth, requireRole('admin'), (req, res) => {
    const parsed = hospitalUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid hospital configuration update.' });
      return;
    }
    const d = parsed.data;
    const nowIso = new Date().toISOString();
    db.db
      .prepare(`
        UPDATE hospital_settings
        SET address = COALESCE(?, address),
            phone = COALESCE(?, phone),
            latitude = COALESCE(?, latitude),
            longitude = COALESCE(?, longitude),
            service_radius_km = COALESCE(?, service_radius_km),
            location_freshness_seconds = COALESCE(?, location_freshness_seconds),
            operating_hours = COALESCE(?, operating_hours),
            updated_at = ?
        WHERE id = 1
      `)
      .run(
        d.address ?? null,
        d.phone ?? null,
        d.latitude ?? null,
        d.longitude ?? null,
        d.serviceRadiusKm ?? null,
        d.locationFreshnessSeconds ?? null,
        d.operatingHours ?? null,
        nowIso,
      );
    db.logAudit({
      actorId: req.authUser!.sub,
      actorRole: 'admin',
      action: 'HOSPITAL_SETTINGS_UPDATED',
      targetType: 'hospital_settings',
      targetId: '1',
      metadata: d,
      ipAddress: req.ip,
    });
    res.json(db.getHospitalSettings());
  });

  app.patch('/api/admin/users/:id/toggle-active', requireAuth, requireRole('admin'), (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.authUser!.sub) {
      res.status(400).json({ error: 'Cannot deactivate your own administrator account.' });
      return;
    }
    const nowIso = new Date().toISOString();
    db.db
      .prepare('UPDATE users SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?')
      .run(nowIso, targetId);
    db.logAudit({
      actorId: req.authUser!.sub,
      actorRole: 'admin',
      action: 'USER_ACTIVE_TOGGLED',
      targetType: 'user',
      targetId: String(targetId),
      ipAddress: req.ip,
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/audit-logs', requireAuth, requireRole('admin'), (_req, res) => {
    const rows = db.db
      .prepare(`
        SELECT al.*, u.full_name AS actor_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_id
        ORDER BY al.id DESC
        LIMIT 80
      `)
      .all() as Array<Record<string, unknown>>;

    const logs: AuditLogRecord[] = rows.map((r) => ({
      id: Number(r.id),
      actorId: r.actor_id === null ? null : Number(r.actor_id),
      actorName: r.actor_name === null ? null : String(r.actor_name),
      actorRole: String(r.actor_role),
      action: String(r.action),
      targetType: String(r.target_type),
      targetId: String(r.target_id),
      metadataJson: r.metadata_json === null ? null : String(r.metadata_json),
      ipAddress: r.ip_address === null ? null : String(r.ip_address),
      createdAt: String(r.created_at),
    }));
    res.json({ logs });
  });

  return { app, httpServer, io, db };
}
