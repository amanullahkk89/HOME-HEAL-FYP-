import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  LocateFixed,
  Navigation,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  ACTIVE_VISIT_STATUSES,
  apiFetch,
  type ApprovedService,
  type ChatMessageItem,
  type HospitalSettings,
  type NotificationItem,
  type NurseOfferItem,
  type RequestStatus,
  type ServiceRequestItem,
  type SessionPayload,
  type VerificationStatus,
} from '../types/api.ts';
import { HospitalMapPanel } from './HospitalMapPanel.tsx';
import { RequestChatPanel } from './RequestChatPanel.tsx';
import { RequestStatusLabel, VerificationStatusLabel } from './StatusBadge.tsx';

interface NurseWorkspaceProps {
  session: SessionPayload;
  token: string;
  hospital: HospitalSettings;
  services: ApprovedService[];
  requests: ServiceRequestItem[];
  offers: NurseOfferItem[];
  notifications: NotificationItem[];
  mapsApiKey: string;
  isOffline: boolean;
  incomingMessages: ChatMessageItem[];
  onRefreshData: () => Promise<void>;
  onUpdateSession: (s: SessionPayload) => void;
}

export function NurseWorkspace({
  session,
  token,
  hospital,
  services,
  requests,
  offers,
  mapsApiKey,
  isOffline,
  incomingMessages,
  onRefreshData,
  onUpdateSession,
}: NurseWorkspaceProps) {
  const [tab, setTab] = useState<'dispatch' | 'active' | 'credentials'>('dispatch');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Credential Upload State
  const [docType, setDocType] = useState('PNC Registered Nurse License');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Manual GPS adjustment for nurse testing
  const [nurseLat, setNurseLat] = useState<number>(
    typeof session.profile.currentLat === 'number' ? session.profile.currentLat : hospital.latitude + 0.006,
  );
  const [nurseLng, setNurseLng] = useState<number>(
    typeof session.profile.currentLng === 'number' ? session.profile.currentLng : hospital.longitude + 0.004,
  );

  const verificationStatus = (session.profile.verificationStatus as VerificationStatus) || 'pending';
  const isAvailable = Boolean(session.profile.isAvailable);
  const isOnline = Boolean(session.profile.isOnline);
  const locationConsentGranted = Boolean(session.profile.locationConsentGranted);
  const capableServiceIds = Array.isArray(session.profile.capableServiceIds)
    ? (session.profile.capableServiceIds as number[])
    : [];

  const activeVisit =
    requests.find(
      (r) => r.assignedNurseId === session.user.id && ACTIVE_VISIT_STATUSES.includes(r.status),
    ) ?? null;

  const pendingOffers = offers.filter(
    (o) => o.offerStatus === 'offered' && o.requestStatus === 'Pending',
  );

  const completedHistory = requests.filter(
    (r) => r.assignedNurseId === session.user.id && !ACTIVE_VISIT_STATUSES.includes(r.status),
  );

  const handleToggleShift = async (patch: {
    isAvailable?: boolean;
    isOnline?: boolean;
    locationConsentGranted?: boolean;
    capableServiceIds?: number[];
  }) => {
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<SessionPayload>('/api/nurse/status', {
        method: 'PATCH',
        token,
        body: {
          ...patch,
          ...(patch.locationConsentGranted === true ? { currentLat: nurseLat, currentLng: nurseLng } : {}),
        },
      });
      onUpdateSession(updated);
      await onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update nurse readiness.');
    }
  };

  const handlePublishGps = async () => {
    setError(null);
    const sendCoords = async (lat: number, lng: number) => {
      try {
        await apiFetch('/api/nurse/location', {
          method: 'POST',
          token,
          body: { lat, lng },
        });
        setNurseLat(lat);
        setNurseLng(lng);
        setNotice(`GPS coordinates updated (${lat.toFixed(4)}, ${lng.toFixed(4)}).`);
        await onRefreshData();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update GPS location.');
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void sendCoords(pos.coords.latitude, pos.coords.longitude),
        () => void sendCoords(nurseLat, nurseLng),
      );
    } else {
      await sendCoords(nurseLat, nurseLng);
    }
  };

  const handleAcceptOffer = async (requestId: number) => {
    setError(null);
    setNotice(null);
    setBusyAction(`accept-${requestId}`);
    try {
      await apiFetch(`/api/requests/${requestId}/accept`, {
        method: 'POST',
        token,
      });
      setNotice('Visit accepted and assigned to you. Navigate safely to the patient home.');
      await onRefreshData();
      setTab('active');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to accept request.');
      await onRefreshData();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeclineOffer = async (requestId: number) => {
    setError(null);
    setBusyAction(`decline-${requestId}`);
    try {
      await apiFetch(`/api/requests/${requestId}/decline`, {
        method: 'POST',
        token,
      });
      await onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to decline offer.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleProgressVisit = async (requestId: number, nextStatus: RequestStatus) => {
    setError(null);
    setNotice(null);
    setBusyAction(`status-${nextStatus}`);
    try {
      await apiFetch(`/api/requests/${requestId}/status`, {
        method: 'PATCH',
        token,
        body: { status: nextStatus },
      });
      setNotice(`Visit status updated to ${nextStatus}.`);
      await onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update visit status.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Select a credential document (PNG, JPG, PDF, or TXT) first.');
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const base64Content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read selected file.'));
        reader.readAsDataURL(selectedFile);
      });
      const res = await apiFetch<{ storageProvider: string; session: SessionPayload }>(
        '/api/credentials/upload',
        {
          method: 'POST',
          token,
          body: {
            documentType: docType,
            originalFilename: selectedFile.name,
            mimeType: selectedFile.type || 'text/plain',
            base64Content,
          },
        },
      );
      onUpdateSession(res.session);
      setSelectedFile(null);
      setNotice(
        `Credential uploaded securely (${res.storageProvider}). Awaiting East-City Hospital Administrator review.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credential upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Nurse Readiness & Verification Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900">{session.user.fullName}</h2>
            <VerificationStatusLabel status={verificationStatus} />
          </div>
          <p className="text-xs text-slate-500 font-mono">
            License: {String(session.profile.licenseNumber || 'N/A')} ·{' '}
            {String(session.profile.specialization || 'General Home Nursing')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={verificationStatus !== 'approved'}
            onClick={() => void handleToggleShift({ isOnline: !isOnline })}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
              isOnline
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-50 text-slate-700 border-slate-200'
            } disabled:opacity-50`}
          >
            {isOnline ? 'Online: Active' : 'Offline'}
          </button>

          <button
            type="button"
            disabled={verificationStatus !== 'approved'}
            onClick={() => void handleToggleShift({ isAvailable: !isAvailable })}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
              isAvailable
                ? 'bg-teal-50 text-teal-800 border-teal-200'
                : 'bg-slate-50 text-slate-700 border-slate-200'
            } disabled:opacity-50`}
          >
            {isAvailable ? 'Available for Offers' : 'Unavailable'}
          </button>

          <button
            type="button"
            onClick={() => void handleToggleShift({ locationConsentGranted: !locationConsentGranted })}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
              locationConsentGranted
                ? 'bg-sky-50 text-sky-800 border-sky-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            {locationConsentGranted ? 'GPS Consent: On' : 'GPS Consent: Off'}
          </button>

          <button
            type="button"
            disabled={!locationConsentGranted}
            onClick={() => void handlePublishGps()}
            className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sync GPS</span>
          </button>
        </div>
      </div>

      {verificationStatus !== 'approved' && (
        <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center justify-between gap-3">
          <span>
            Your credentials are currently <strong>{verificationStatus}</strong>. Upload your PNC
            license below; East-City Hospital Administrator approval is required before receiving visit offers.
          </span>
          <button
            type="button"
            onClick={() => setTab('credentials')}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-900 text-white rounded-md whitespace-nowrap"
          >
            Manage Credentials
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg w-fit">
        {[
          { id: 'dispatch', label: `Eligible Offers (${pendingOffers.length})` },
          { id: 'active', label: activeVisit ? `Active Visit (${activeVisit.status})` : 'Active Visit' },
          { id: 'credentials', label: 'Credentials & Capabilities' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as typeof tab)}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === item.id ? 'bg-teal-700 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OFFERS & COMPLETED HISTORY */}
      {tab === 'dispatch' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Distance-Ranked Eligible Visit Offers
                </h3>
                <p className="text-xs text-slate-500">
                  Ranked by Haversine distance. Accepting claims the request transactionally and supersedes duplicate offers.
                </p>
              </div>
            </div>

            {pendingOffers.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                No pending offers right now. Ensure your verification is approved and Online, Available, and GPS Consent toggles are enabled.
              </p>
            ) : (
              <div className="space-y-3">
                {pendingOffers.map((offer) => (
                  <div
                    key={offer.id}
                    className="p-4 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-600">
                        <span className="font-semibold text-teal-800">Rank #{offer.rankOrder}</span>
                        <span aria-hidden="true">·</span>
                        <span>{offer.haversineDistanceKm.toFixed(2)} km away</span>
                        <span aria-hidden="true">·</span>
                        <span>{offer.requestCode}</span>
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900">{offer.serviceName}</h4>
                      <p className="text-xs text-slate-600">
                        {offer.patientAddress} · Window: {offer.preferredTimeWindow}
                      </p>
                      {offer.patientNotes && (
                        <p className="text-xs text-slate-500">Note: {offer.patientNotes}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleDeclineOffer(offer.requestId)}
                        className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Decline</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null || Boolean(activeVisit)}
                        onClick={() => void handleAcceptOffer(offer.requestId)}
                        className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {busyAction === `accept-${offer.requestId}` ? 'Claiming...' : 'Accept Visit'}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Your Past Visits ({completedHistory.length})</h3>
            </div>
            {completedHistory.length === 0 ? (
              <p className="p-6 text-xs text-slate-500 text-center">No completed visits yet.</p>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-4">Service</th>
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {completedHistory.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-4 font-mono text-xs">{item.requestCode}</td>
                      <td className="py-2.5 px-4">{item.serviceName}</td>
                      <td className="py-2.5 px-4 text-slate-600">{item.patientName}</td>
                      <td className="py-2.5 px-4">
                        <RequestStatusLabel status={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE VISIT & NAVIGATION */}
      {tab === 'active' && (
        <div>
          {!activeVisit ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
              No active assigned visit. Accept an eligible offer from the Offers tab to begin navigation.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-5">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono text-slate-500">{activeVisit.requestCode}</p>
                      <h3 className="text-lg font-semibold text-slate-900">
                        {activeVisit.serviceName}
                      </h3>
                    </div>
                    <RequestStatusLabel status={activeVisit.status} />
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700 pt-2 border-t border-slate-100">
                    <div>
                      <dt className="text-slate-500">Patient</dt>
                      <dd className="font-semibold text-slate-900 mt-0.5">
                        {activeVisit.patientName} · {activeVisit.patientPhone}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Time Window</dt>
                      <dd className="font-medium text-slate-900 mt-0.5">
                        {activeVisit.preferredTimeWindow}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Destination Address</dt>
                      <dd className="font-medium text-slate-900 mt-0.5">
                        {activeVisit.patientAddress}
                      </dd>
                    </div>
                    {activeVisit.patientNotes && (
                      <div className="sm:col-span-2">
                        <dt className="text-slate-500">Patient Notes</dt>
                        <dd className="mt-0.5">{activeVisit.patientNotes}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    {activeVisit.status === 'Accepted' && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleProgressVisit(activeVisit.id, 'En Route')}
                        className="px-4 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Truck className="w-4 h-4" aria-hidden="true" />
                        <span>Start Travel (Mark En Route)</span>
                      </button>
                    )}
                    {activeVisit.status === 'En Route' && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleProgressVisit(activeVisit.id, 'Arrived')}
                        className="px-4 py-2 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Navigation className="w-4 h-4" aria-hidden="true" />
                        <span>Mark Arrived at Patient Home</span>
                      </button>
                    )}
                    {activeVisit.status === 'Arrived' && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleProgressVisit(activeVisit.id, 'Completed')}
                        className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        <span>Complete Nursing Visit</span>
                      </button>
                    )}
                  </div>
                </div>

                <HospitalMapPanel
                  mapsApiKey={mapsApiKey}
                  hospital={hospital}
                  patientLocation={{
                    lat: activeVisit.patientLat,
                    lng: activeVisit.patientLng,
                    label: activeVisit.patientName,
                  }}
                  nurseLocation={
                    locationConsentGranted
                      ? {
                          lat: nurseLat,
                          lng: nurseLng,
                          label: 'Your Location',
                          updatedAt: session.profile.locationUpdatedAt as string | null,
                        }
                      : null
                  }
                  title="Nurse Route Navigation & Patient Destination"
                />
              </div>

              <div className="lg:col-span-5">
                <RequestChatPanel
                  requestId={activeVisit.id}
                  requestCode={activeVisit.requestCode}
                  currentUserId={session.user.id}
                  token={token}
                  isOffline={isOffline}
                  canSend={ACTIVE_VISIT_STATUSES.includes(activeVisit.status)}
                  incomingMessages={incomingMessages}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CREDENTIALS & CAPABILITIES */}
      {tab === 'credentials' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <form onSubmit={handleUploadCredential} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <FileUp className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-base font-semibold text-slate-900">
                Submit Private Credential Evidence
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Files are stored in private server storage / Firebase Storage and accessible only to you
              and East-City Hospital Administrators.
            </p>

            <div>
              <label htmlFor="cred-type" className="block text-xs font-medium text-slate-700 mb-1">
                Document Type
              </label>
              <select
                id="cred-type"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              >
                <option value="PNC Registered Nurse License">PNC Registered Nurse License</option>
                <option value="East-City Hospital Staff Badge">East-City Hospital Staff Badge</option>
                <option value="Infusion & IV Therapy Certificate">Infusion & IV Therapy Certificate</option>
              </select>
            </div>

            <div>
              <label htmlFor="cred-file" className="block text-xs font-medium text-slate-700 mb-1">
                Evidence File (PNG, JPG, PDF, or TXT, max 2 MB)
              </label>
              <input
                id="cred-file"
                type="file"
                accept=".png,.jpg,.jpeg,.pdf,.txt"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-800 hover:file:bg-teal-100"
              />
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg disabled:opacity-60"
            >
              {uploading ? 'Uploading...' : 'Upload Credential for Review'}
            </button>

            <div className="pt-4 border-t border-slate-100 space-y-2">
              <h4 className="text-xs font-semibold text-slate-700">Submitted Documents</h4>
              {session.credentials.length === 0 ? (
                <p className="text-xs text-slate-500">No documents uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {session.credentials.map((c) => (
                    <li key={c.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-medium text-slate-900">{c.documentType}</p>
                        <p className="text-slate-500">
                          {c.originalFilename} · {c.reviewNotes}
                        </p>
                      </div>
                      <VerificationStatusLabel status={c.reviewStatus} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-base font-semibold text-slate-900">
                Approved Service Capabilities & GPS Calibration
              </h3>
            </div>

            <div className="space-y-2">
              {services.map((svc) => {
                const checked = capableServiceIds.includes(svc.id);
                return (
                  <label
                    key={svc.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{svc.name}</p>
                      <p className="text-xs text-slate-500">{svc.category}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? capableServiceIds.filter((id) => id !== svc.id)
                          : [...capableServiceIds, svc.id];
                        void handleToggleShift({ capableServiceIds: next });
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700"
                    />
                  </label>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nurse-lat" className="block text-xs text-slate-500 mb-1">
                  Current Latitude
                </label>
                <input
                  id="nurse-lat"
                  type="number"
                  step="0.0001"
                  value={nurseLat}
                  onChange={(e) => setNurseLat(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="nurse-lng" className="block text-xs text-slate-500 mb-1">
                  Current Longitude
                </label>
                <input
                  id="nurse-lng"
                  type="number"
                  step="0.0001"
                  value={nurseLng}
                  onChange={(e) => setNurseLng(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
