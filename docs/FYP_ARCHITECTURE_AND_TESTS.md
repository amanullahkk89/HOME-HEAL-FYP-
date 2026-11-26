# HomeHeal Technical Architecture, Security & Verification Report

## 1. Authoritative Request State Machine
All status changes are validated transactionally inside `server/app.ts` using `validateRequestTransition()` from `shared/domain.ts`:

- `Pending` -> `Accepted` (verified online/available nurse with location consent and matching capability)
- `Pending` -> `Cancelled` (request patient or hospital administrator)
- `Pending` -> `Rejected` (hospital administrator)
- `Accepted` -> `En Route` -> `Arrived` -> `Completed` (assigned nurse only)
- `Accepted` / `En Route` -> `Cancelled` (request patient, assigned nurse prior to travel, or hospital administrator)

### Concurrency Protection Against Duplicate Assignments
1. `POST /api/requests/:id/accept` executes inside `BEGIN IMMEDIATE` (or MySQL transaction + `sp_accept_nurse_request`).
2. Checks nurse's active assignment count (`Accepted`, `En Route`, `Arrived`).
3. Atomically updates `service_requests` with `WHERE id = ? AND status = 'Pending' AND assigned_nurse_id IS NULL` and asserts `changes === 1`.
4. Enforced at the schema level by a partial unique index `uq_active_nurse_visit` (and MySQL generated unique column `active_nurse_guard`), returning HTTP `409 Conflict` to losing concurrent requests and emitting `offer:superseded` over Socket.IO.

## 2. Nurse Matching Criteria & Haversine Ranking
Both `/matching_service/main.py` (Python FastAPI) and `/shared/domain.ts` enforce all 7 criteria before ranking by Haversine distance (`R = 6371 km`):
1. `verificationStatus === 'approved'`
2. `capableServiceIds` includes requested `serviceId`
3. `isAvailable === true`
4. `isOnline === true`
5. `locationConsentGranted === true`
6. Location timestamp within configured `locationFreshnessSeconds` and both patient/nurse coordinates within `serviceRadiusKm` of East-City Hospital
7. `activeAssignmentCount === 0`

## 3. Security Controls Implemented
- **Password Hashing**: `crypto.scryptSync` with per-user 16-byte random salt and `crypto.timingSafeEqual`.
- **Stateless Bearer Auth**: HMAC-SHA256 signed tokens verified on both REST (`requireAuth`) and Socket.IO handshake (`io.use`). Client stores token in memory only (no `localStorage`).
- **Private Credential Storage**: Nurse/doctor licenses are uploaded privately (`/api/credentials/upload`) and retrieved via `/api/credentials/:id/file` enforcing owner-or-admin checks and `path.resolve` prefix confinement (`resolvePrivateStoragePath`).
- **Privacy & Location Consent**: Patient requests require explicit `patientLocationConsent: true` and `explicitConfirmation: true`. Assigned nurse live GPS coordinates are redacted (`null`) outside `Accepted`/`En Route`/`Arrived` states or when nurse consent is turned off. Doctor view masks patient street address, phone, and private notes.
- **Bounded Bilingual AI Assistant**: `/api/ai/assist` uses server-side `@google/genai` (`gemini-4-hydrogen`) with strict JSON schema output, restricting context solely to active approved services and the authenticated patient's own requests (`WHERE sr.patient_id = ?`). It prepares an editable `draft` object (`requiresExplicitConfirmation: true`) and never calls any request submission mutation.

## 4. Automated Verification Coverage
- `shared/domain.test.ts` (4 specs): Haversine calculations, 7-point eligibility filtering, freshness window, and state transition matrix.
- `server/workflow.test.ts` (5 specs): End-to-end authentication, unverified nurse gating (`403`), private credential access boundaries (`403`/`200`), patient location consent validation (`400`), parallel `Promise.all` concurrent accept conflict (`200` + `409`), Socket.IO real-time status & message delivery, idempotent offline message deduplication, and post-completion nurse GPS privacy redaction.
- `matching_service/test_matching.py` (2 specs): Python Haversine distance accuracy and eligible nurse distance ranking.
