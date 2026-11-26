"""Unit tests for HomeHeal Python Haversine nurse eligibility and distance ranking."""

import unittest
from datetime import datetime, timezone, timedelta

from haversine import NurseCandidate, evaluate_and_rank_nurses, haversine_distance_km


class TestMatchingEngine(unittest.TestCase):
    def test_haversine_known_distance(self) -> None:
        # ~3.15 km inside Islamabad Sector F-8 to F-6
        d = haversine_distance_km(33.7077, 73.0501, 33.7294, 73.0764)
        self.assertGreater(d, 2.8)
        self.assertLess(d, 3.8)

    def test_eligibility_filters_and_ranking(self) -> None:
        now = datetime(2026, 11, 26, 12, 0, 0, tzinfo=timezone.utc)
        fresh = (now - timedelta(seconds=60)).isoformat()
        stale = (now - timedelta(seconds=1200)).isoformat()

        candidates = [
            NurseCandidate(
                nurse_id=10,
                full_name="Unverified Nurse",
                verification_status="pending",
                capable_service_ids=[1, 2],
                is_available=True,
                is_online=True,
                location_consent_granted=True,
                current_lat=33.7080,
                current_lng=73.0510,
                location_updated_at=fresh,
                active_assignment_count=0,
            ),
            NurseCandidate(
                nurse_id=11,
                full_name="Busy Nurse",
                verification_status="approved",
                capable_service_ids=[1, 2],
                is_available=True,
                is_online=True,
                location_consent_granted=True,
                current_lat=33.7080,
                current_lng=73.0510,
                location_updated_at=fresh,
                active_assignment_count=1,
            ),
            NurseCandidate(
                nurse_id=12,
                full_name="Stale GPS Nurse",
                verification_status="approved",
                capable_service_ids=[1, 2],
                is_available=True,
                is_online=True,
                location_consent_granted=True,
                current_lat=33.7080,
                current_lng=73.0510,
                location_updated_at=stale,
                active_assignment_count=0,
            ),
            NurseCandidate(
                nurse_id=13,
                full_name="Farther Approved Nurse",
                verification_status="approved",
                capable_service_ids=[1, 2],
                is_available=True,
                is_online=True,
                location_consent_granted=True,
                current_lat=33.7350,
                current_lng=73.0850,
                location_updated_at=fresh,
                active_assignment_count=0,
            ),
            NurseCandidate(
                nurse_id=14,
                full_name="Closest Approved Nurse",
                verification_status="approved",
                capable_service_ids=[1, 2],
                is_available=True,
                is_online=True,
                location_consent_granted=True,
                current_lat=33.7110,
                current_lng=73.0540,
                location_updated_at=fresh,
                active_assignment_count=0,
            ),
        ]

        ranked = evaluate_and_rank_nurses(
            candidates=candidates,
            service_id=2,
            patient_lat=33.7100,
            patient_lng=73.0530,
            hospital_lat=33.7077,
            hospital_lng=73.0501,
            service_radius_km=18.0,
            location_freshness_seconds=600,
            now_epoch_seconds=now.timestamp(),
        )

        self.assertEqual([r.nurse_id for r in ranked], [14, 13])
        self.assertEqual([r.rank_order for r in ranked], [1, 2])
        self.assertLess(ranked[0].haversine_distance_km, ranked[1].haversine_distance_km)


if __name__ == "__main__":
    unittest.main()
