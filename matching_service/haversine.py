"""Pure Python Haversine distance & nurse eligibility ranking engine for HomeHeal."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, List, Optional


EARTH_RADIUS_KM = 6371.0


def haversine_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate great-circle distance in kilometers between two WGS84 coordinates."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return round(EARTH_RADIUS_KM * c, 3)


def parse_iso_timestamp(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


@dataclass(frozen=True)
class NurseCandidate:
    nurse_id: int
    full_name: str
    verification_status: str
    capable_service_ids: List[int]
    is_available: bool
    is_online: bool
    location_consent_granted: bool
    current_lat: Optional[float]
    current_lng: Optional[float]
    location_updated_at: Optional[str]
    active_assignment_count: int


@dataclass(frozen=True)
class RankedNurse:
    nurse_id: int
    full_name: str
    haversine_distance_km: float
    rank_order: int


def is_location_fresh(
    location_updated_at: Optional[str],
    now_epoch_seconds: float,
    max_age_seconds: int,
) -> bool:
    updated_ts = parse_iso_timestamp(location_updated_at)
    if updated_ts is None:
        return False
    age = now_epoch_seconds - updated_ts
    return 0 <= age <= max_age_seconds


def evaluate_and_rank_nurses(
    candidates: Iterable[NurseCandidate],
    service_id: int,
    patient_lat: float,
    patient_lng: float,
    hospital_lat: float,
    hospital_lng: float,
    service_radius_km: float,
    location_freshness_seconds: int,
    now_epoch_seconds: Optional[float] = None,
) -> List[RankedNurse]:
    now_ts = (
        now_epoch_seconds
        if now_epoch_seconds is not None
        else datetime.now(timezone.utc).timestamp()
    )

    eligible: List[tuple[float, int, str]] = []
    for nurse in candidates:
        if nurse.verification_status != "approved":
            continue
        if service_id not in nurse.capable_service_ids:
            continue
        if not nurse.is_available or not nurse.is_online:
            continue
        if not nurse.location_consent_granted:
            continue
        if nurse.active_assignment_count > 0:
            continue
        if nurse.current_lat is None or nurse.current_lng is None:
            continue
        if not is_location_fresh(
            nurse.location_updated_at, now_ts, location_freshness_seconds
        ):
            continue

        dist_from_hospital = haversine_distance_km(
            hospital_lat, hospital_lng, patient_lat, patient_lng
        )
        if dist_from_hospital > service_radius_km:
            continue

        dist_km = haversine_distance_km(
            nurse.current_lat, nurse.current_lng, patient_lat, patient_lng
        )
        if dist_km > service_radius_km:
            continue

        eligible.append((dist_km, nurse.nurse_id, nurse.full_name))

    eligible.sort(key=lambda item: (item[0], item[1]))
    return [
        RankedNurse(
            nurse_id=nurse_id,
            full_name=full_name,
            haversine_distance_km=dist_km,
            rank_order=index + 1,
        )
        for index, (dist_km, nurse_id, full_name) in enumerate(eligible)
    ]
