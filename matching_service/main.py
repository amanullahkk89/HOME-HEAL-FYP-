"""FastAPI Haversine Nurse Distance Ranking Microservice for HomeHeal (East-City Hospital)."""

from __future__ import annotations

from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel, Field

from haversine import NurseCandidate, evaluate_and_rank_nurses

app = FastAPI(
    title="HomeHeal Nurse Distance Ranking Service",
    version="1.0.0",
    description="Eligible nurse filtering and Haversine distance ranking for East-City Hospital.",
)


class NurseCandidatePayload(BaseModel):
    nurse_id: int
    full_name: str
    verification_status: str
    capable_service_ids: List[int]
    is_available: bool
    is_online: bool
    location_consent_granted: bool
    current_lat: Optional[float] = None
    current_lng: Optional[float] = None
    location_updated_at: Optional[str] = None
    active_assignment_count: int = Field(ge=0)


class RankNursesRequest(BaseModel):
    service_id: int
    patient_lat: float
    patient_lng: float
    hospital_lat: float
    hospital_lng: float
    service_radius_km: float = Field(gt=0)
    location_freshness_seconds: int = Field(ge=30)
    candidates: List[NurseCandidatePayload]


class RankedNurseResponse(BaseModel):
    nurse_id: int
    full_name: str
    haversine_distance_km: float
    rank_order: int


class RankNursesResult(BaseModel):
    engine: str
    eligible_count: int
    ranked_nurses: List[RankedNurseResponse]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "homeheal-fastapi-matcher"}


@app.post("/rank-nurses", response_model=RankNursesResult)
def rank_nurses(payload: RankNursesRequest) -> RankNursesResult:
    candidates = [
        NurseCandidate(
            nurse_id=c.nurse_id,
            full_name=c.full_name,
            verification_status=c.verification_status,
            capable_service_ids=c.capable_service_ids,
            is_available=c.is_available,
            is_online=c.is_online,
            location_consent_granted=c.location_consent_granted,
            current_lat=c.current_lat,
            current_lng=c.current_lng,
            location_updated_at=c.location_updated_at,
            active_assignment_count=c.active_assignment_count,
        )
        for c in payload.candidates
    ]

    ranked = evaluate_and_rank_nurses(
        candidates=candidates,
        service_id=payload.service_id,
        patient_lat=payload.patient_lat,
        patient_lng=payload.patient_lng,
        hospital_lat=payload.hospital_lat,
        hospital_lng=payload.hospital_lng,
        service_radius_km=payload.service_radius_km,
        location_freshness_seconds=payload.location_freshness_seconds,
    )

    return RankNursesResult(
        engine="python-fastapi-haversine",
        eligible_count=len(ranked),
        ranked_nurses=[
            RankedNurseResponse(
                nurse_id=r.nurse_id,
                full_name=r.full_name,
                haversine_distance_km=r.haversine_distance_km,
                rank_order=r.rank_order,
            )
            for r in ranked
        ],
    )
