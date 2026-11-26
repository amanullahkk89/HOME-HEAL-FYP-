import {
  ACTIVE_VISIT_STATUSES,
  TERMINAL_REQUEST_STATUSES,
  type ApprovedService,
  type AssistantDraft,
  type AssistantStructuredReply,
  type HospitalSettings,
  type LanguageCode,
  type RequestStatus,
  type UserRole,
  type VerificationStatus,
} from '../../shared/domain.ts';

export {
  ACTIVE_VISIT_STATUSES,
  TERMINAL_REQUEST_STATUSES,
};

export type {
  ApprovedService,
  AssistantDraft,
  AssistantStructuredReply,
  HospitalSettings,
  LanguageCode,
  RequestStatus,
  UserRole,
  VerificationStatus,
};

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  phone: string;
  role: UserRole;
  preferredLanguage: LanguageCode;
}

export interface CredentialItem {
  id: number;
  userId?: number;
  userName?: string;
  userEmail?: string;
  role?: 'nurse' | 'doctor';
  documentType: string;
  storageProvider: 'firebase_storage' | 'local_private_vault';
  originalFilename: string;
  mimeType: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  reviewNotes: string;
  uploadedAt: string;
}

export interface SessionPayload {
  token?: string;
  user: AuthUser;
  profile: Record<string, unknown>;
  credentials: CredentialItem[];
}

export interface ServiceRequestItem {
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

export interface NurseOfferItem {
  id: number;
  requestId: number;
  nurseId: number;
  haversineDistanceKm: number;
  rankOrder: number;
  offerStatus: 'offered' | 'accepted' | 'declined' | 'expired' | 'superseded';
  respondedAt: string | null;
  createdAt: string;
  requestCode: string;
  serviceId: number;
  serviceName: string;
  serviceCategory: string;
  patientAddress: string;
  patientLat: number;
  patientLng: number;
  preferredTimeWindow: string;
  patientNotes: string;
  requestStatus: RequestStatus;
}

export interface ChatMessageItem {
  id: number;
  requestId: number;
  senderId: number;
  senderName: string;
  senderRole: 'patient' | 'nurse';
  body: string;
  clientMsgId: string | null;
  createdAt: string;
}

export interface NotificationItem {
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

export interface DemoAccount {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: unknown;
  } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`,
    );
  }
  return payload as T;
}
