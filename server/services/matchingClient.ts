import {
  rankEligibleNurses,
  type Coordinates,
  type HospitalSettings,
  type NurseMatchingCandidate,
  type RankedNurseMatch,
} from '../../shared/domain.ts';

export interface MatchingResult {
  engine: 'python-fastapi-haversine' | 'node-haversine-fallback';
  ranked: RankedNurseMatch[];
}

export async function rankNursesForRequest(params: {
  candidates: NurseMatchingCandidate[];
  serviceId: number;
  patientCoords: Coordinates;
  hospital: HospitalSettings;
}): Promise<MatchingResult> {
  const fastApiBase = process.env.MATCHING_SERVICE_URL?.trim();
  if (fastApiBase) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(`${fastApiBase.replace(/\/$/, '')}/rank-nurses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          service_id: params.serviceId,
          patient_lat: params.patientCoords.lat,
          patient_lng: params.patientCoords.lng,
          hospital_lat: params.hospital.latitude,
          hospital_lng: params.hospital.longitude,
          service_radius_km: params.hospital.serviceRadiusKm,
          location_freshness_seconds: params.hospital.locationFreshnessSeconds,
          candidates: params.candidates.map((c) => ({
            nurse_id: c.nurseId,
            full_name: c.fullName,
            verification_status: c.verificationStatus,
            capable_service_ids: c.capableServiceIds,
            is_available: c.isAvailable,
            is_online: c.isOnline,
            location_consent_granted: c.locationConsentGranted,
            current_lat: c.currentLat,
            current_lng: c.currentLng,
            location_updated_at: c.locationUpdatedAt,
            active_assignment_count: c.activeAssignmentCount,
          })),
        }),
      });
      clearTimeout(timer);
      if (response.ok) {
        const data = (await response.json()) as {
          ranked_nurses: Array<{
            nurse_id: number;
            full_name: string;
            haversine_distance_km: number;
            rank_order: number;
          }>;
        };
        return {
          engine: 'python-fastapi-haversine',
          ranked: data.ranked_nurses.map((r) => ({
            nurseId: r.nurse_id,
            fullName: r.full_name,
            haversineDistanceKm: r.haversine_distance_km,
            rankOrder: r.rank_order,
          })),
        };
      }
    } catch {
      // FastAPI service not running externally; fall through to shared TypeScript Haversine engine
    }
  }

  const ranked = rankEligibleNurses(
    params.candidates,
    params.serviceId,
    params.patientCoords,
    { lat: params.hospital.latitude, lng: params.hospital.longitude },
    params.hospital.serviceRadiusKm,
    params.hospital.locationFreshnessSeconds,
  );

  return {
    engine: 'node-haversine-fallback',
    ranked,
  };
}
