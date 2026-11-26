# HomeHeal — Smart Home Healthcare Assistance System for East-City Hospital

HomeHeal is an integrated single-hospital home healthcare coordination platform built for **East-City Hospital**. It connects four authenticated user roles—**Patient**, **Nurse**, **Doctor**, and **Hospital Administrator**—around verified home nursing workflows, concurrency-safe Haversine nurse dispatch, real-time Socket.IO events, consent-based GPS tracking, and a bounded bilingual AI care assistant (English, Urdu, Roman Urdu).

## Documented Scope Boundaries
HomeHeal strictly preserves East-City Hospital's FYDP scope:
- **In Scope**: Hospital-approved home nursing services (injections, IV drip setup, wound dressing, catheter care, post-discharge vitals), nurse credential verification, availability/online/location-consent gating, Haversine distance ranking, concurrency-safe visit assignment (`Pending -> Accepted -> En Route -> Arrived -> Completed`, plus `Cancelled` / `Rejected`), patient–assigned-nurse messaging, real-time alerts, and non-diagnostic bilingual AI assistance with editable drafts and explicit patient confirmation.
- **Out of Scope**: Multi-hospital management, doctor home-visit dispatch, medical diagnosis, medication prescribing, billing/payments, and ambulance dispatch.

## Architecture & Directory Layout

| Component | Path | Technology |
| :--- | :--- | :--- |
| Main Backend & Socket.IO Server | `/server.ts`, `/server/` | Node.js, Express, Socket.IO, Zod |
| Web Frontend Portal | `/src/` | React 19, TypeScript, Tailwind CSS v4, `@vis.gl/react-google-maps` |
| Shared Domain & State Machine | `/shared/domain.ts` | TypeScript pure domain rules + `node:test` specs |
| Flutter Android Client | `/flutter_app/` | Flutter / Dart, `google_maps_flutter`, `geolocator`, `firebase_*`, `socket_io_client` |
| Nurse Ranking Microservice | `/matching_service/` | Python FastAPI + Haversine filter/rank engine |
| Relational Database Schemas | `/database/` | MySQL 8.0 schema, versioned migrations, stored procedure, seed |
| Private Credential Vault | `/server/security.ts`, `/server/services/firebaseDispatcher.ts` | Firebase Storage (with path-confined local private vault fallback) |
| Bilingual Patient AI Assistant | `/server/services/aiAssistant.ts` | Google Gemini (`gemini-4-hydrogen` + `gemini-3.8-flash-lite-tts`) |

## Demonstration Accounts (Password: `HomeHeal@2026`)

| Role | Email | Initial State |
| :--- | :--- | :--- |
| **Patient** | `patient.ali@example.com` | Sector F-7/2, pre-seeded active/historical data |
| **Patient** | `patient.fatima@example.com` | Sector F-6/3 |
| **Nurse (Approved)** | `nurse.ayesha@eastcity.org` | Verified, Online, Available, Consent On (F-7/4) |
| **Nurse (Approved)** | `nurse.bilal@eastcity.org` | Verified, Online, Available, Consent On (G-9/1) |
| **Nurse (Pending)** | `nurse.pending@eastcity.org` | Verification `pending` (for Admin review testing) |
| **Doctor** | `dr.sara@eastcity.org` | Verified, On Duty coordination feed |
| **Hospital Admin** | `admin@eastcity.org` | Full verification, services, settings, and audit access |

## Local Run & Verification

### 1. Web Portal + Express + Socket.IO Server
```bash
npm install
npm run test      # Runs shared domain tests + full end-to-end API/Socket.IO/concurrency integration tests
npm run lint      # TypeScript check
npm run build     # Production Vite bundle
npm run dev       # Starts Express + Vite middleware + Socket.IO on port 3000
```

### 2. Python FastAPI Nurse Matching Microservice
```bash
cd matching_service
pip install -r requirements.txt
PYTHONPATH=. python3 -m unittest test_matching.py -v
uvicorn main:app --host 0.0.0.0 --port 8001
```
Set `MATCHING_SERVICE_URL=http://127.0.0.1:8001` in `.env` so `/api/requests` delegates nurse eligibility & Haversine ranking to FastAPI.

### 3. MySQL 8.0 Setup
```bash
mysql -u root -p < database/schema.sql
mysql -u root -p homeheal < database/migrations/001_initial_schema.sql
mysql -u root -p homeheal < database/migrations/002_audit_and_consents.sql
mysql -u root -p homeheal < database/seed.sql
```
Configure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, and `DB_CLIENT=mysql` when connecting to a live MySQL instance.

### 4. Flutter Android Client
```bash
cd flutter_app
flutter pub get
flutter run --dart-define=HOMEHEAL_API_BASE_URL=http://10.0.2.2:3000
```
Place your Firebase `google-services.json` in `flutter_app/android/app/` and supply `MAPS_API_KEY` in Android Gradle `local.properties` before building an APK.

## AI Studio Environment Notes & Limitations
- **Flutter Android Compilation**: The AI Studio cloud container does not include the Flutter SDK or Android Gradle toolchain, so `/flutter_app/` is provided as complete source code wired to the identical REST & Socket.IO contracts, while the live interactive application runs on the integrated React web client on port 3000.
- **Database Runtime**: `/database/` provides full MySQL 8.0 DDL, stored procedures (`sp_accept_nurse_request`), and seed files plus a `mysql2` pool (`/server/db/mysqlPool.ts`). Because an external MySQL daemon is not running inside this container, the Express server executes ACID transactions (`BEGIN IMMEDIATE`, foreign keys, partial unique active-visit index) on `storage/homeheal.sqlite` via Node's native `node:sqlite`.
- **Firebase Cloud Messaging & Storage**: When Firebase Admin service-account credentials are not configured in environment secrets, credential files are written securely to a path-confined private local directory (`/storage/private_credentials/`) and notifications persist in the database + Socket.IO channels cleanly.
