import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineDistanceKm,
  isLocationFresh,
  rankEligibleNurses,
  validateRequestTransition,
  type NurseMatchingCandidate,
} from './domain.ts';

test('haversineDistanceKm computes accurate distance between hospital and home', () => {
  const hospital = { lat: 33.7077, lng: 73.0501 };
  const patientHome = { lat: 33.7294, lng: 73.0764 };
  const dist = haversineDistanceKm(hospital, patientHome);
  assert.ok(dist > 2.8 && dist < 3.8, `Expected ~3.4km, got ${dist}`);
  assert.equal(haversineDistanceKm(hospital, hospital), 0);
});

test('isLocationFresh enforces freshness window strictly', () => {
  const nowMs = Date.parse('2026-11-26T12:00:00.000Z');
  assert.equal(isLocationFresh('2026-11-26T11:55:00.000Z', nowMs, 600), true);
  assert.equal(isLocationFresh('2026-11-26T11:40:00.000Z', nowMs, 600), false);
  assert.equal(isLocationFresh(null, nowMs, 600), false);
});

test('rankEligibleNurses enforces all 7 matching rules and sorts ascending by distance', () => {
  const nowMs = Date.parse('2026-11-26T12:00:00.000Z');
  const freshIso = '2026-11-26T11:58:00.000Z';
  const staleIso = '2026-11-26T11:30:00.000Z';
  const hospital = { lat: 33.7077, lng: 73.0501 };
  const patient = { lat: 33.7120, lng: 73.0560 };

  const candidates: NurseMatchingCandidate[] = [
    {
      nurseId: 1,
      fullName: 'Unapproved',
      verificationStatus: 'pending',
      capableServiceIds: [2],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: true,
      currentLat: 33.711,
      currentLng: 73.055,
      locationUpdatedAt: freshIso,
      activeAssignmentCount: 0,
    },
    {
      nurseId: 2,
      fullName: 'Missing Capability',
      verificationStatus: 'approved',
      capableServiceIds: [1],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: true,
      currentLat: 33.711,
      currentLng: 73.055,
      locationUpdatedAt: freshIso,
      activeAssignmentCount: 0,
    },
    {
      nurseId: 3,
      fullName: 'No Consent',
      verificationStatus: 'approved',
      capableServiceIds: [2],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: false,
      currentLat: 33.711,
      currentLng: 73.055,
      locationUpdatedAt: freshIso,
      activeAssignmentCount: 0,
    },
    {
      nurseId: 4,
      fullName: 'Active Visit Conflict',
      verificationStatus: 'approved',
      capableServiceIds: [2],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: true,
      currentLat: 33.711,
      currentLng: 73.055,
      locationUpdatedAt: freshIso,
      activeAssignmentCount: 1,
    },
    {
      nurseId: 5,
      fullName: 'Stale Location',
      verificationStatus: 'approved',
      capableServiceIds: [2],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: true,
      currentLat: 33.711,
      currentLng: 73.055,
      locationUpdatedAt: staleIso,
      activeAssignmentCount: 0,
    },
    {
      nurseId: 6,
      fullName: 'Farther Eligible',
      verificationStatus: 'approved',
      capableServiceIds: [2],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: true,
      currentLat: 33.745,
      currentLng: 73.095,
      locationUpdatedAt: freshIso,
      activeAssignmentCount: 0,
    },
    {
      nurseId: 7,
      fullName: 'Nearest Eligible',
      verificationStatus: 'approved',
      capableServiceIds: [2],
      isAvailable: true,
      isOnline: true,
      locationConsentGranted: true,
      currentLat: 33.713,
      currentLng: 73.057,
      locationUpdatedAt: freshIso,
      activeAssignmentCount: 0,
    },
  ];

  const ranked = rankEligibleNurses(candidates, 2, patient, hospital, 18, 600, nowMs);
  assert.deepEqual(
    ranked.map((r) => r.nurseId),
    [7, 6],
  );
  assert.equal(ranked[0].rankOrder, 1);
  assert.equal(ranked[1].rankOrder, 2);
  assert.ok(ranked[0].haversineDistanceKm < ranked[1].haversineDistanceKm);
});

test('validateRequestTransition enforces lifecycle and role ownership', () => {
  assert.equal(validateRequestTransition('Pending', 'Accepted', 'nurse', false, false).allowed, true);
  assert.equal(validateRequestTransition('Pending', 'Accepted', 'patient', false, true).allowed, false);
  assert.equal(validateRequestTransition('Pending', 'Completed', 'nurse', true, false).allowed, false);
  assert.equal(validateRequestTransition('Accepted', 'En Route', 'nurse', true, false).allowed, true);
  assert.equal(validateRequestTransition('Accepted', 'En Route', 'nurse', false, false).allowed, false);
  assert.equal(validateRequestTransition('En Route', 'Arrived', 'nurse', true, false).allowed, true);
  assert.equal(validateRequestTransition('Arrived', 'Completed', 'nurse', true, false).allowed, true);
  assert.equal(validateRequestTransition('Arrived', 'Cancelled', 'patient', false, true).allowed, false);
  assert.equal(validateRequestTransition('Completed', 'Cancelled', 'admin', false, false).allowed, false);
});
