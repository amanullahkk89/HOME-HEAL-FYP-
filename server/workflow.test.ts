import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc } from 'socket.io-client';
import { createHomeHealApp } from './app.ts';

async function startTestServer() {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'homeheal-vault-'));
  const bundle = createHomeHealApp({ dbPath: ':memory:', privateVaultDir: tmpVault });
  await new Promise<void>((resolve) => {
    bundle.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = bundle.httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('Invalid server address');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    close: async () => {
      bundle.io.close();
      await new Promise<void>((resolve) => bundle.httpServer.close(() => resolve()));
      fs.rmSync(tmpVault, { recursive: true, force: true });
    },
  };
}

async function jsonReq(baseUrl: string, pathUrl: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}${pathUrl}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('full patient-to-nurse workflow, credential gate, concurrency lock, messaging, and ownership checks', async () => {
  const srv = await startTestServer();
  try {
    // 1. Login demo users
    const adminLogin = await jsonReq(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@eastcity.org', password: 'HomeHeal@2026' },
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    const patientAliLogin = await jsonReq(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'patient.ali@example.com', password: 'HomeHeal@2026' },
    });
    assert.equal(patientAliLogin.status, 200);
    const aliToken = patientAliLogin.data.token as string;

    const patientFatimaLogin = await jsonReq(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'patient.fatima@example.com', password: 'HomeHeal@2026' },
    });
    assert.equal(patientFatimaLogin.status, 200);
    const fatimaToken = patientFatimaLogin.data.token as string;

    const nurseAyeshaLogin = await jsonReq(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'nurse.ayesha@eastcity.org', password: 'HomeHeal@2026' },
    });
    assert.equal(nurseAyeshaLogin.status, 200);
    const ayeshaToken = nurseAyeshaLogin.data.token as string;

    const nurseBilalLogin = await jsonReq(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'nurse.bilal@eastcity.org', password: 'HomeHeal@2026' },
    });
    assert.equal(nurseBilalLogin.status, 200);
    const bilalToken = nurseBilalLogin.data.token as string;

    const pendingNurseLogin = await jsonReq(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'nurse.pending@eastcity.org', password: 'HomeHeal@2026' },
    });
    assert.equal(pendingNurseLogin.status, 200);
    const pendingToken = pendingNurseLogin.data.token as string;

    // 2. Unverified nurse cannot go online
    const unverifiedOnline = await jsonReq(srv.baseUrl, '/api/nurse/status', {
      method: 'PATCH',
      token: pendingToken,
      body: { isAvailable: true, isOnline: true },
    });
    assert.equal(unverifiedOnline.status, 403);

    // 3. Private credential file access restricted to owner or admin
    const pendingCredId = pendingNurseLogin.data.credentials[0].id as number;
    const unauthorizedFileRes = await fetch(`${srv.baseUrl}/api/credentials/${pendingCredId}/file`, {
      headers: { Authorization: `Bearer ${aliToken}` },
    });
    assert.equal(unauthorizedFileRes.status, 403);

    const adminFileRes = await fetch(`${srv.baseUrl}/api/credentials/${pendingCredId}/file`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminFileRes.status, 200);

    // 4. Request creation requires explicit location consent & confirmation
    const missingConsent = await jsonReq(srv.baseUrl, '/api/requests', {
      method: 'POST',
      token: aliToken,
      body: {
        serviceId: 2,
        patientAddress: 'House 22, F-7/2, Islamabad',
        patientLat: 33.7215,
        patientLng: 73.0568,
        patientLocationConsent: false,
        explicitConfirmation: true,
        preferredTimeWindow: '15:00 - 17:00',
      },
    });
    assert.equal(missingConsent.status, 400);

    // 5. Connect Patient Ali Socket.IO to verify real-time updates
    const socket = ioc(srv.baseUrl, { auth: { token: aliToken }, transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    const receivedStatuses: string[] = [];
    socket.on('request:updated', (payload: { status: string }) => {
      receivedStatuses.push(payload.status);
    });

    // 6. Create valid request by Patient Ali
    const createdReq = await jsonReq(srv.baseUrl, '/api/requests', {
      method: 'POST',
      token: aliToken,
      body: {
        serviceId: 2,
        patientAddress: 'House 22, Street 9, Sector F-7/2, Islamabad',
        patientLat: 33.7215,
        patientLng: 73.0568,
        patientLocationConsent: true,
        explicitConfirmation: true,
        preferredTimeWindow: '15:00 - 17:00',
        patientNotes: 'Prescribed normal saline drip by Dr. Sara.',
      },
    });
    assert.equal(createdReq.status, 201);
    const reqId = createdReq.data.request.id as number;
    assert.equal(createdReq.data.request.status, 'Pending');
    assert.equal(createdReq.data.offeredNursesCount, 2);

    // Check Haversine rank order (Nurse Ayesha is closer to F-7/2 than Nurse Bilal in G-9)
    const offersRes = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/offers`, {
      token: aliToken,
    });
    assert.equal(offersRes.status, 200);
    assert.equal(offersRes.data.offers[0].nurseName, 'Nurse Ayesha Siddiqui');
    assert.equal(offersRes.data.offers[0].rankOrder, 1);

    // Patient Fatima cannot read Ali's offers or messages
    const crossPatientOffers = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/offers`, {
      token: fatimaToken,
    });
    assert.equal(crossPatientOffers.status, 403);

    // 7. Concurrent nurse acceptances must strictly allow only ONE winner
    const [acceptA, acceptB] = await Promise.all([
      jsonReq(srv.baseUrl, `/api/requests/${reqId}/accept`, { method: 'POST', token: ayeshaToken }),
      jsonReq(srv.baseUrl, `/api/requests/${reqId}/accept`, { method: 'POST', token: bilalToken }),
    ]);
    const statuses = [acceptA.status, acceptB.status].sort();
    assert.deepEqual(statuses, [200, 409], 'One nurse must win (200) and the other must get 409 Conflict');

    const winnerToken = acceptA.status === 200 ? ayeshaToken : bilalToken;

    // 8. Messaging between patient and assigned nurse (with idempotent clientMsgId)
    const msg1 = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/messages`, {
      method: 'POST',
      token: aliToken,
      body: { body: 'Gate is open, please ring bell #1.', clientMsgId: 'offline-msg-1' },
    });
    assert.equal(msg1.status, 201);

    const msgDuplicate = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/messages`, {
      method: 'POST',
      token: aliToken,
      body: { body: 'Gate is open, please ring bell #1.', clientMsgId: 'offline-msg-1' },
    });
    assert.equal(msgDuplicate.status, 200);
    assert.equal(msgDuplicate.data.deduplicated, true);

    const crossMsg = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/messages`, {
      method: 'POST',
      token: fatimaToken,
      body: { body: 'Intruder message' },
    });
    assert.equal(crossMsg.status, 403);

    // 9. Authoritative lifecycle progression: Accepted -> En Route -> Arrived -> Completed
    const enRoute = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/status`, {
      method: 'PATCH',
      token: winnerToken,
      body: { status: 'En Route' },
    });
    assert.equal(enRoute.status, 200);
    assert.equal(enRoute.data.request.status, 'En Route');
    assert.ok(enRoute.data.request.assignedNurseLat !== null, 'Live nurse location shared during En Route');

    // Invalid skip from En Route -> Completed must fail
    const invalidSkip = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/status`, {
      method: 'PATCH',
      token: winnerToken,
      body: { status: 'Completed' },
    });
    assert.equal(invalidSkip.status, 403);

    const arrived = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/status`, {
      method: 'PATCH',
      token: winnerToken,
      body: { status: 'Arrived' },
    });
    assert.equal(arrived.status, 200);

    const completed = await jsonReq(srv.baseUrl, `/api/requests/${reqId}/status`, {
      method: 'PATCH',
      token: winnerToken,
      body: { status: 'Completed' },
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.data.request.status, 'Completed');
    assert.equal(completed.data.request.assignedNurseLat, null, 'Nurse location stops sharing once Completed');

    // Wait briefly for Socket.IO events
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(receivedStatuses.includes('Accepted'));
    assert.ok(receivedStatuses.includes('Completed'));

    socket.disconnect();
  } finally {
    await srv.close();
  }
});
