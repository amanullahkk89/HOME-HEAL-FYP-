export type UserRole = 'patient' | 'nurse' | 'doctor' | 'admin';

export type LanguageCode = 'en' | 'ur' | 'roman_ur';

export type VerificationStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export type RequestStatus =
  | 'Pending'
  | 'Accepted'
  | 'En Route'
  | 'Arrived'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected';

export type OfferStatus = 'offered' | 'accepted' | 'declined' | 'expired' | 'superseded';

export const ACTIVE_VISIT_STATUSES: ReadonlyArray<RequestStatus> = [
  'Accepted',
  'En Route',
  'Arrived',
];

export const TERMINAL_REQUEST_STATUSES: ReadonlyArray<RequestStatus> = [
  'Completed',
  'Cancelled',
  'Rejected',
];

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface HospitalSettings {
  id: number;
  hospitalName: string;
  departmentName: string;
  address: string;
  city: string;
  phone: string;
  supportEmail: string;
  latitude: number;
  longitude: number;
  serviceRadiusKm: number;
  locationFreshnessSeconds: number;
  operatingHours: string;
  emergencyNotice: string;
}

export interface ApprovedService {
  id: number;
  code: string;
  name: string;
  nameUr: string;
  category: string;
  description: string;
  descriptionUr: string;
  estimatedDurationMins: number;
  preparationNotes: string;
  requiresPrescriptionNote: boolean;
  isActive: boolean;
}

export interface NurseMatchingCandidate {
  nurseId: number;
  fullName: string;
  verificationStatus: VerificationStatus;
  capableServiceIds: number[];
  isAvailable: boolean;
  isOnline: boolean;
  locationConsentGranted: boolean;
  currentLat: number | null;
  currentLng: number | null;
  locationUpdatedAt: string | null;
  activeAssignmentCount: number;
}

export interface RankedNurseMatch {
  nurseId: number;
  fullName: string;
  haversineDistanceKm: number;
  rankOrder: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Computes great-circle Haversine distance in kilometers rounded to 3 decimals.
 */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dPhi = toRadians(b.lat - a.lat);
  const dLambda = toRadians(b.lng - a.lng);

  const sinHalfPhi = Math.sin(dPhi / 2);
  const sinHalfLambda = Math.sin(dLambda / 2);

  const h =
    sinHalfPhi * sinHalfPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;
  const clampedH = Math.min(1, Math.max(0, h));
  const c = 2 * Math.atan2(Math.sqrt(clampedH), Math.sqrt(1 - clampedH));
  return Math.round(EARTH_RADIUS_KM * c * 1000) / 1000;
}

export function isLocationFresh(
  updatedAtIso: string | null,
  nowMs: number,
  maxAgeSeconds: number,
): boolean {
  if (!updatedAtIso) return false;
  const parsed = Date.parse(updatedAtIso);
  if (Number.isNaN(parsed)) return false;
  const ageSeconds = (nowMs - parsed) / 1000;
  return ageSeconds >= -30 && ageSeconds <= maxAgeSeconds;
}

export interface EligibilityCheckResult {
  eligible: boolean;
  reasons: string[];
  distanceKm: number | null;
}

/**
 * Evaluates all 7 HomeHeal nurse matching criteria:
 * 1. Credential approval
 * 2. Service capability
 * 3. Availability toggle
 * 4. Online status
 * 5. Location consent granted
 * 6. Fresh location within hospital service radius
 * 7. Zero active assignments
 */
export function checkNurseEligibility(
  candidate: NurseMatchingCandidate,
  serviceId: number,
  patientCoords: Coordinates,
  hospitalCoords: Coordinates,
  serviceRadiusKm: number,
  locationFreshnessSeconds: number,
  nowMs: number = Date.now(),
): EligibilityCheckResult {
  const reasons: string[] = [];

  if (candidate.verificationStatus !== 'approved') {
    reasons.push('Credential verification not approved');
  }
  if (!candidate.capableServiceIds.includes(serviceId)) {
    reasons.push('Service not in approved nurse capabilities');
  }
  if (!candidate.isAvailable) {
    reasons.push('Nurse is currently marked unavailable');
  }
  if (!candidate.isOnline) {
    reasons.push('Nurse is offline');
  }
  if (!candidate.locationConsentGranted) {
    reasons.push('Nurse location sharing consent not granted');
  }
  if (candidate.activeAssignmentCount > 0) {
    reasons.push('Nurse already has an active home visit');
  }
  if (candidate.currentLat === null || candidate.currentLng === null) {
    reasons.push('Nurse GPS coordinates unavailable');
  } else if (!isLocationFresh(candidate.locationUpdatedAt, nowMs, locationFreshnessSeconds)) {
    reasons.push('Nurse GPS location is stale');
  }

  const hospitalDistanceKm = haversineDistanceKm(hospitalCoords, patientCoords);
  if (hospitalDistanceKm > serviceRadiusKm) {
    reasons.push(`Patient address (${hospitalDistanceKm} km) is outside hospital service radius (${serviceRadiusKm} km)`);
  }

  let distanceKm: number | null = null;
  if (candidate.currentLat !== null && candidate.currentLng !== null) {
    distanceKm = haversineDistanceKm(
      { lat: candidate.currentLat, lng: candidate.currentLng },
      patientCoords,
    );
    if (distanceKm > serviceRadiusKm) {
      reasons.push(`Nurse distance (${distanceKm} km) exceeds service radius (${serviceRadiusKm} km)`);
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    distanceKm,
  };
}

export function rankEligibleNurses(
  candidates: ReadonlyArray<NurseMatchingCandidate>,
  serviceId: number,
  patientCoords: Coordinates,
  hospitalCoords: Coordinates,
  serviceRadiusKm: number,
  locationFreshnessSeconds: number,
  nowMs: number = Date.now(),
): RankedNurseMatch[] {
  const matched: Array<{ nurseId: number; fullName: string; distanceKm: number }> = [];

  for (const candidate of candidates) {
    const check = checkNurseEligibility(
      candidate,
      serviceId,
      patientCoords,
      hospitalCoords,
      serviceRadiusKm,
      locationFreshnessSeconds,
      nowMs,
    );
    if (check.eligible && check.distanceKm !== null) {
      matched.push({
        nurseId: candidate.nurseId,
        fullName: candidate.fullName,
        distanceKm: check.distanceKm,
      });
    }
  }

  matched.sort((a, b) => {
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.nurseId - b.nurseId;
  });

  return matched.map((item, idx) => ({
    nurseId: item.nurseId,
    fullName: item.fullName,
    haversineDistanceKm: item.distanceKm,
    rankOrder: idx + 1,
  }));
}

export interface TransitionValidation {
  allowed: boolean;
  reason?: string;
}

/**
 * Authoritative request status state machine:
 * Pending -> Accepted (nurse) | Cancelled (patient, admin) | Rejected (admin)
 * Accepted -> En Route (nurse) | Cancelled (patient, nurse, admin)
 * En Route -> Arrived (nurse) | Cancelled (patient, admin)
 * Arrived -> Completed (nurse)
 */
export function validateRequestTransition(
  currentStatus: RequestStatus,
  nextStatus: RequestStatus,
  actorRole: UserRole,
  isAssignedNurse: boolean,
  isRequestPatient: boolean,
): TransitionValidation {
  if (TERMINAL_REQUEST_STATUSES.includes(currentStatus)) {
    return {
      allowed: false,
      reason: `Request is already in terminal status "${currentStatus}".`,
    };
  }

  if (currentStatus === nextStatus) {
    return { allowed: false, reason: 'Request is already in that status.' };
  }

  if (nextStatus === 'Accepted') {
    if (currentStatus !== 'Pending') {
      return { allowed: false, reason: 'Only Pending requests can be accepted.' };
    }
    if (actorRole !== 'nurse') {
      return { allowed: false, reason: 'Only verified nurses can accept requests.' };
    }
    return { allowed: true };
  }

  if (nextStatus === 'En Route') {
    if (currentStatus !== 'Accepted') {
      return { allowed: false, reason: 'Nurse must accept the request before marking En Route.' };
    }
    if (actorRole !== 'nurse' || !isAssignedNurse) {
      return { allowed: false, reason: 'Only the assigned nurse can start travel.' };
    }
    return { allowed: true };
  }

  if (nextStatus === 'Arrived') {
    if (currentStatus !== 'En Route') {
      return { allowed: false, reason: 'Request must be En Route before marking Arrived.' };
    }
    if (actorRole !== 'nurse' || !isAssignedNurse) {
      return { allowed: false, reason: 'Only the assigned nurse can mark arrival.' };
    }
    return { allowed: true };
  }

  if (nextStatus === 'Completed') {
    if (currentStatus !== 'Arrived') {
      return { allowed: false, reason: 'Nurse must mark Arrived before completing the visit.' };
    }
    if (actorRole !== 'nurse' || !isAssignedNurse) {
      return { allowed: false, reason: 'Only the assigned nurse can complete the visit.' };
    }
    return { allowed: true };
  }

  if (nextStatus === 'Cancelled') {
    if (actorRole === 'admin') {
      return { allowed: true };
    }
    if (actorRole === 'patient' && isRequestPatient) {
      if (currentStatus === 'Pending' || currentStatus === 'Accepted' || currentStatus === 'En Route') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Cannot cancel after the nurse has arrived.' };
    }
    if (actorRole === 'nurse' && isAssignedNurse && currentStatus === 'Accepted') {
      return { allowed: true };
    }
    return { allowed: false, reason: 'You are not authorized to cancel this request in its current state.' };
  }

  if (nextStatus === 'Rejected') {
    if (currentStatus !== 'Pending' || actorRole !== 'admin') {
      return { allowed: false, reason: 'Only Hospital Administrators can reject Pending requests.' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: `Unsupported transition from ${currentStatus} to ${nextStatus}.` };
}

export interface AssistantDraft {
  serviceId: number | null;
  serviceCode: string | null;
  preferredTimeWindow: string;
  patientNotes: string;
  patientAddress: string;
}

export interface AssistantStructuredReply {
  replyText: string;
  language: LanguageCode;
  outOfScopeBlocked: boolean;
  emergencyEscalation: boolean;
  requiresExplicitConfirmation: true;
  draft: AssistantDraft | null;
}
