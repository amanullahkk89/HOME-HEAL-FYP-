import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  LocateFixed,
  MapPin,
  Phone,
  User,
  XCircle,
} from 'lucide-react';
import {
  ACTIVE_VISIT_STATUSES,
  apiFetch,
  type ApprovedService,
  type AssistantDraft,
  type ChatMessageItem,
  type HospitalSettings,
  type NotificationItem,
  type ServiceRequestItem,
  type SessionPayload,
} from '../types/api.ts';
import { AiAssistantDrawer } from './AiAssistantDrawer.tsx';
import { HospitalMapPanel } from './HospitalMapPanel.tsx';
import { RequestChatPanel } from './RequestChatPanel.tsx';
import { RequestStatusLabel } from './StatusBadge.tsx';

interface PatientWorkspaceProps {
  session: SessionPayload;
  token: string;
  hospital: HospitalSettings;
  services: ApprovedService[];
  requests: ServiceRequestItem[];
  notifications: NotificationItem[];
  mapsApiKey: string;
  isOffline: boolean;
  incomingMessages: ChatMessageItem[];
  onRefreshData: () => Promise<void>;
  onMarkNotificationRead: (id: number) => Promise<void>;
  onUpdateSession: (s: SessionPayload) => void;
}

const PRESET_SECTORS = [
  { label: 'Sector F-7/2', lat: 33.7215, lng: 73.0568, address: 'House 22, Street 9, Sector F-7/2, Islamabad' },
  { label: 'Sector F-6/3', lat: 33.7294, lng: 73.0764, address: 'Apartment 4B, Kohsar Lane, Sector F-6/3, Islamabad' },
  { label: 'Sector F-8/4', lat: 33.7098, lng: 73.0462, address: 'House 7, Street 41, Sector F-8/4, Islamabad' },
  { label: 'Sector G-9/1', lat: 33.6942, lng: 73.0285, address: 'House 19, Street 12, Sector G-9/1, Islamabad' },
];

export function PatientWorkspace({
  session,
  token,
  hospital,
  services,
  requests,
  notifications,
  mapsApiKey,
  isOffline,
  incomingMessages,
  onRefreshData,
  onMarkNotificationRead,
  onUpdateSession,
}: PatientWorkspaceProps) {
  const [tab, setTab] = useState<'request' | 'tracker' | 'history' | 'profile'>('request');
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Request Form State (never auto-submitted)
  const [selectedServiceId, setSelectedServiceId] = useState<number>(services[0]?.id ?? 1);
  const [patientAddress, setPatientAddress] = useState<string>(
    String(session.profile.defaultAddress || 'House 22, Street 9, Sector F-7/2, Islamabad'),
  );
  const [patientLat, setPatientLat] = useState<number>(
    typeof session.profile.defaultLat === 'number' ? session.profile.defaultLat : 33.7215,
  );
  const [patientLng, setPatientLng] = useState<number>(
    typeof session.profile.defaultLng === 'number' ? session.profile.defaultLng : 73.0568,
  );
  const [preferredTimeWindow, setPreferredTimeWindow] = useState<string>('14:00 - 16:00 Today');
  const [patientNotes, setPatientNotes] = useState<string>('');
  const [locationConsent, setLocationConsent] = useState<boolean>(false);
  const [assistantDraftUsed, setAssistantDraftUsed] = useState<boolean>(false);
  const [reviewStep, setReviewStep] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Profile State
  const [profPhone, setProfPhone] = useState(session.user.phone);
  const [profEmergencyName, setProfEmergencyName] = useState(String(session.profile.emergencyContactName || ''));
  const [profEmergencyPhone, setProfEmergencyPhone] = useState(String(session.profile.emergencyContactPhone || ''));
  const [profSaving, setProfSaving] = useState(false);
  const [profMsg, setProfMsg] = useState<string | null>(null);

  const selectedService = services.find((s) => s.id === selectedServiceId) ?? services[0];
  const activeRequests = requests.filter(
    (r) => r.status === 'Pending' || ACTIVE_VISIT_STATUSES.includes(r.status),
  );
  const activeVisit = activeRequests[0] ?? null;

  const [visitOffers, setVisitOffers] = useState<
    Array<{
      id: number;
      nurseName: string;
      haversineDistanceKm: number;
      rankOrder: number;
      offerStatus: string;
    }>
  >([]);

  useEffect(() => {
    if (!activeVisit) {
      setVisitOffers([]);
      return;
    }
    let active = true;
    apiFetch<{
      offers: Array<{
        id: number;
        nurseName: string;
        haversineDistanceKm: number;
        rankOrder: number;
        offerStatus: string;
      }>;
    }>(`/api/requests/${activeVisit.id}/offers`, { token })
      .then((res) => {
        if (active) setVisitOffers(res.offers);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeVisit?.id, activeVisit?.status, token]);

  const handleUseBrowserGps = () => {
    setFormError(null);
    if (!navigator.geolocation) {
      setFormError('Geolocation is not supported in this browser. Choose a sector preset or enter coordinates.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPatientLat(Number(pos.coords.latitude.toFixed(6)));
        setPatientLng(Number(pos.coords.longitude.toFixed(6)));
      },
      () => {
        setFormError('Browser location permission was denied. You can select an East-City sector below.');
      },
    );
  };

  const handleApplyAssistantDraft = (draft: AssistantDraft) => {
    if (draft.serviceId) setSelectedServiceId(draft.serviceId);
    if (draft.preferredTimeWindow) setPreferredTimeWindow(draft.preferredTimeWindow);
    if (draft.patientNotes) setPatientNotes(draft.patientNotes);
    if (draft.patientAddress) setPatientAddress(draft.patientAddress);
    setAssistantDraftUsed(true);
    setReviewStep(false);
    setTab('request');
    setFormSuccess(
      'AI Assistant draft loaded into the form. Please review details, grant location consent, and confirm manually.',
    );
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!selectedService) {
      setFormError('Please select an approved nursing service.');
      return;
    }
    if (patientAddress.trim().length < 5) {
      setFormError('Please enter your complete home address.');
      return;
    }
    if (!locationConsent) {
      setFormError('Explicit Location Consent is required to match nearby nurses and navigate.');
      return;
    }
    setReviewStep(true);
  };

  const handleConfirmSubmit = async () => {
    if (!selectedService) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await apiFetch<{
        request: ServiceRequestItem;
        matchingEngine: string;
        offeredNursesCount: number;
      }>('/api/requests', {
        method: 'POST',
        token,
        body: {
          serviceId: selectedService.id,
          patientAddress: patientAddress.trim(),
          patientLat,
          patientLng,
          patientLocationConsent: true,
          explicitConfirmation: true,
          preferredTimeWindow: preferredTimeWindow.trim(),
          patientNotes: patientNotes.trim(),
          assistantDraftUsed,
        },
      });
      setReviewStep(false);
      setPatientNotes('');
      setAssistantDraftUsed(false);
      setFormSuccess(
        `Request ${res.request.requestCode} submitted (${res.offeredNursesCount} eligible nurse offer(s) dispatched via ${res.matchingEngine}).`,
      );
      await onRefreshData();
      setTab('tracker');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (reqId: number) => {
    try {
      await apiFetch(`/api/requests/${reqId}/status`, {
        method: 'PATCH',
        token,
        body: { status: 'Cancelled', cancellationReason: 'Cancelled by patient from portal' },
      });
      await onRefreshData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to cancel request.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfSaving(true);
    setProfMsg(null);
    try {
      const updated = await apiFetch<SessionPayload>('/api/patient/profile', {
        method: 'PATCH',
        token,
        body: {
          phone: profPhone,
          defaultAddress: patientAddress,
          defaultLat: patientLat,
          defaultLng: patientLng,
          emergencyContactName: profEmergencyName,
          emergencyContactPhone: profEmergencyPhone,
        },
      });
      onUpdateSession(updated);
      setProfMsg('Patient profile updated.');
    } catch (err) {
      setProfMsg(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setProfSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Assistant trigger */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg overflow-x-auto">
          {[
            { id: 'request', label: 'New Nursing Request' },
            { id: 'tracker', label: `Active Tracker (${activeRequests.length})` },
            { id: 'history', label: `History (${requests.length})` },
            { id: 'profile', label: 'Profile & Hospital' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === item.id
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          className="px-4 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Bot className="w-4 h-4 text-teal-700" aria-hidden="true" />
          <span>Bilingual AI Care Assistant (EN / اردو)</span>
        </button>
      </div>

      {formSuccess && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>{formSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormSuccess(null)}
            className="text-xs font-medium text-emerald-800 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {formError && (
        <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

      {/* TAB 1: NEW REQUEST */}
      {tab === 'request' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
            {!reviewStep ? (
              <form onSubmit={handleProceedToReview} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Request Hospital-Approved Home Nursing
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    East-City Hospital · Select a service, grant location consent, and review before submitting.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    1. Select Approved Nursing Service
                  </label>
                  <div className="space-y-2">
                    {services.map((svc) => {
                      const active = svc.id === selectedServiceId;
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => setSelectedServiceId(svc.id)}
                          className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                            active
                              ? 'border-teal-700 bg-teal-50/50'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900">{svc.name}</span>
                            <span className="text-xs font-mono text-slate-600 tabular-nums">
                              {svc.category} · {svc.estimatedDurationMins} min
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">{svc.description}</p>
                          <p className="text-[11px] text-teal-800 mt-1" dir="rtl">
                            {svc.nameUr}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedService && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">Preparation: </span>
                    {selectedService.preparationNotes}
                  </div>
                )}

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label htmlFor="req-address" className="text-xs font-semibold text-slate-700">
                      2. Home Visit Address & Coordinates
                    </label>
                    <button
                      type="button"
                      onClick={handleUseBrowserGps}
                      className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
                    >
                      <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Use Current GPS</span>
                    </button>
                  </div>
                  <input
                    id="req-address"
                    type="text"
                    required
                    value={patientAddress}
                    onChange={(e) => setPatientAddress(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {PRESET_SECTORS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setPatientAddress(preset.address);
                          setPatientLat(preset.lat);
                          setPatientLng(preset.lng);
                        }}
                        className="text-[11px] px-2.5 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2.5">
                    <div>
                      <label htmlFor="req-lat" className="block text-[11px] text-slate-500 mb-1">
                        Latitude
                      </label>
                      <input
                        id="req-lat"
                        type="number"
                        step="0.0001"
                        value={patientLat}
                        onChange={(e) => setPatientLat(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-lg bg-slate-50"
                      />
                    </div>
                    <div>
                      <label htmlFor="req-lng" className="block text-[11px] text-slate-500 mb-1">
                        Longitude
                      </label>
                      <input
                        id="req-lng"
                        type="number"
                        step="0.0001"
                        value={patientLng}
                        onChange={(e) => setPatientLng(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-lg bg-slate-50"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="req-window" className="block text-xs font-semibold text-slate-700 mb-1">
                      3. Preferred Time Window
                    </label>
                    <input
                      id="req-window"
                      type="text"
                      required
                      value={preferredTimeWindow}
                      onChange={(e) => setPreferredTimeWindow(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label htmlFor="req-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                      4. Visit Notes / Access Instructions
                    </label>
                    <input
                      id="req-notes"
                      type="text"
                      value={patientNotes}
                      onChange={(e) => setPatientNotes(e.target.value)}
                      placeholder="e.g., Prescription attached, ground floor"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={locationConsent}
                      onChange={(e) => setLocationConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span className="text-xs text-slate-700 leading-relaxed">
                      <strong className="text-slate-900">Explicit Location Consent:</strong> I consent to
                      share my home coordinates with East-City Hospital for Haversine nurse matching and
                      turn-by-turn navigation for the assigned nurse only.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors inline-flex items-center justify-center gap-2"
                >
                  <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Review Request Summary</span>
                </button>
              </form>
            ) : (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Confirm Home Nursing Request
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Please verify all details carefully. Requests are only submitted upon your confirmation.
                  </p>
                </div>

                <dl className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-sm">
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-slate-500">Service</dt>
                    <dd className="font-medium text-slate-900 text-right">{selectedService?.name}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-slate-500">Home Address</dt>
                    <dd className="font-medium text-slate-900 text-right">{patientAddress}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-slate-500">Coordinates</dt>
                    <dd className="font-mono text-xs text-slate-700 tabular-nums">
                      {patientLat.toFixed(4)}, {patientLng.toFixed(4)}
                    </dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-slate-500">Time Window</dt>
                    <dd className="font-medium text-slate-900">{preferredTimeWindow}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-slate-500">Location Consent</dt>
                    <dd className="font-medium text-emerald-700">Granted explicitly</dd>
                  </div>
                  {patientNotes && (
                    <div className="px-4 py-3 flex justify-between gap-4">
                      <dt className="text-slate-500">Notes</dt>
                      <dd className="text-slate-800 text-right">{patientNotes}</dd>
                    </div>
                  )}
                </dl>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setReviewStep(false)}
                    disabled={submitting}
                    className="flex-1 py-2.5 px-4 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Edit Request
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmSubmit()}
                    disabled={submitting}
                    className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-60"
                  >
                    {submitting ? 'Submitting...' : 'Confirm & Submit Request'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 space-y-5">
            <HospitalMapPanel
              mapsApiKey={mapsApiKey}
              hospital={hospital}
              patientLocation={{ lat: patientLat, lng: patientLng, label: 'Selected Home' }}
              title="Service Coverage & Location Preview"
            />

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Recent Notifications</h3>
              {notifications.length === 0 ? (
                <p className="text-xs text-slate-500">No notifications yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {notifications.slice(0, 4).map((n) => (
                    <li key={n.id} className="py-2 flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-xs ${n.isRead ? 'text-slate-600' : 'font-semibold text-slate-900'}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-slate-500">{n.body}</p>
                      </div>
                      {!n.isRead && (
                        <button
                          type="button"
                          onClick={() => void onMarkNotificationRead(n.id)}
                          className="text-[11px] text-teal-700 hover:underline shrink-0"
                        >
                          Mark read
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE TRACKER */}
      {tab === 'tracker' && (
        <div className="space-y-6">
          {!activeVisit ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
              <Clock className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
              <h2 className="text-base font-semibold text-slate-900">No Active Nursing Request</h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                When you submit a home nursing request, live assignment status, nurse arrival tracking,
                and real-time messaging appear here.
              </p>
              <button
                type="button"
                onClick={() => setTab('request')}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                Create Nursing Request
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-5">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono text-slate-500">{activeVisit.requestCode}</p>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {activeVisit.serviceName}
                      </h2>
                    </div>
                    <RequestStatusLabel status={activeVisit.status} />
                  </div>

                  {/* Authoritative 5-Stage Progress */}
                  <div className="grid grid-cols-5 gap-2 pt-2">
                    {(['Pending', 'Accepted', 'En Route', 'Arrived', 'Completed'] as const).map((step, idx) => {
                      const order = ['Pending', 'Accepted', 'En Route', 'Arrived', 'Completed'];
                      const currentIdx = order.indexOf(activeVisit.status);
                      const reached = idx <= currentIdx;
                      return (
                        <div key={step} className="space-y-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              reached ? 'bg-teal-700' : 'bg-slate-200'
                            }`}
                          />
                          <p
                            className={`text-[11px] font-medium ${
                              reached ? 'text-slate-900' : 'text-slate-400'
                            }`}
                          >
                            {step}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs text-slate-700 border-t border-slate-100">
                    <div>
                      <span className="text-slate-500">Assigned Nurse: </span>
                      <span className="font-semibold text-slate-900">
                        {activeVisit.assignedNurseName || 'Awaiting nurse acceptance'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Time Window: </span>
                      <span className="font-medium text-slate-900">
                        {activeVisit.preferredTimeWindow}
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-slate-500">Address: </span>
                      <span>{activeVisit.patientAddress}</span>
                    </div>
                  </div>

                  {(activeVisit.status === 'Pending' ||
                    activeVisit.status === 'Accepted' ||
                    activeVisit.status === 'En Route') && (
                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleCancelRequest(activeVisit.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg inline-flex items-center gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Cancel Request</span>
                      </button>
                    </div>
                  )}
                </div>

                <HospitalMapPanel
                  mapsApiKey={mapsApiKey}
                  hospital={hospital}
                  patientLocation={{
                    lat: activeVisit.patientLat,
                    lng: activeVisit.patientLng,
                    label: 'Your Home',
                  }}
                  nurseLocation={
                    activeVisit.assignedNurseLat !== null && activeVisit.assignedNurseLng !== null
                      ? {
                          lat: activeVisit.assignedNurseLat,
                          lng: activeVisit.assignedNurseLng,
                          label: activeVisit.assignedNurseName || 'Assigned Nurse',
                          updatedAt: activeVisit.assignedNurseLocationUpdatedAt,
                        }
                      : null
                  }
                  title="Live Nurse Tracking & Route Estimate"
                />
              </div>

              <div className="lg:col-span-5 space-y-5">
                {activeVisit.assignedNurseId ? (
                  <RequestChatPanel
                    requestId={activeVisit.id}
                    requestCode={activeVisit.requestCode}
                    currentUserId={session.user.id}
                    token={token}
                    isOffline={isOffline}
                    canSend={ACTIVE_VISIT_STATUSES.includes(activeVisit.status)}
                    incomingMessages={incomingMessages}
                  />
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Haversine Nurse Dispatch Queue
                    </h3>
                    <p className="text-xs text-slate-600">
                      Direct messaging activates once a verified East-City nurse accepts your offer.
                    </p>
                    {visitOffers.length > 0 && (
                      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {visitOffers.map((o) => (
                          <li
                            key={o.id}
                            className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <span className="font-mono font-semibold text-teal-800 mr-2">
                                #{o.rankOrder}
                              </span>
                              <span className="font-medium text-slate-900">{o.nurseName}</span>
                            </div>
                            <span className="font-mono text-slate-600 tabular-nums">
                              {o.haversineDistanceKm.toFixed(2)} km · {o.offerStatus}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: HISTORY */}
      {tab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Your Home Nursing History</h2>
            <p className="text-xs text-slate-500">
              Authoritative record of all submitted, active, completed, and cancelled visits.
            </p>
          </div>
          {requests.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No requests recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Nurse</th>
                    <th className="py-3 px-4">Window</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">
                        {r.requestCode}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{r.serviceName}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {r.assignedNurseName || 'Unassigned'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">{r.preferredTimeWindow}</td>
                      <td className="py-3 px-4">
                        <RequestStatusLabel status={r.status} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-500 tabular-nums">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PROFILE & HOSPITAL INFO */}
      {tab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h2 className="text-base font-semibold text-slate-900">Patient Profile</h2>
            </div>

            {profMsg && (
              <div className="px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900">
                {profMsg}
              </div>
            )}

            <div>
              <label htmlFor="pat-phone" className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                id="pat-phone"
                type="tel"
                value={profPhone}
                onChange={(e) => setProfPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="pat-addr" className="block text-xs font-medium text-slate-700 mb-1">
                Default Home Address
              </label>
              <input
                id="pat-addr"
                type="text"
                value={patientAddress}
                onChange={(e) => setPatientAddress(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pat-em-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Emergency Contact Name
                </label>
                <input
                  id="pat-em-name"
                  type="text"
                  value={profEmergencyName}
                  onChange={(e) => setProfEmergencyName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
                />
              </div>
              <div>
                <label htmlFor="pat-em-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Emergency Contact Phone
                </label>
                <input
                  id="pat-em-phone"
                  type="tel"
                  value={profEmergencyPhone}
                  onChange={(e) => setProfEmergencyPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={profSaving}
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              {profSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h2 className="text-base font-semibold text-slate-900">{hospital.hospitalName}</h2>
            </div>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-start gap-2 text-slate-700">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {hospital.address}, {hospital.city}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <Phone className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <span className="font-mono text-xs">{hospital.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <span>
                  {hospital.operatingHours} · Service radius{' '}
                  <span className="font-mono tabular-nums">{hospital.serviceRadiusKm} km</span>
                </span>
              </div>
            </dl>
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
              {hospital.emergencyNotice}
            </div>
          </div>
        </div>
      )}

      <AiAssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        token={token}
        initialLanguage={session.user.preferredLanguage}
        onApplyDraft={handleApplyAssistantDraft}
      />
    </div>
  );
}
