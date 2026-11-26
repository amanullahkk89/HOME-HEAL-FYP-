import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Eye,
  FileCheck2,
  Plus,
  Shield,
  Users,
  XCircle,
} from 'lucide-react';
import {
  apiFetch,
  type ApprovedService,
  type CredentialItem,
  type HospitalSettings,
  type ServiceRequestItem,
} from '../types/api.ts';
import { RequestStatusLabel, VerificationStatusLabel } from './StatusBadge.tsx';

interface AdminWorkspaceProps {
  token: string;
  hospital: HospitalSettings;
  requests: ServiceRequestItem[];
  onHospitalUpdated: (h: HospitalSettings) => void;
  onRefreshData: () => Promise<void>;
}

interface AdminOverview {
  requestCountsByStatus: Record<string, number>;
  userCountsByRole: Record<string, number>;
  pendingCredentialsCount: number;
  activeNursesOnlineCount: number;
}

interface StaffResponse {
  nurses: Array<{
    userId: number;
    fullName: string;
    email: string;
    phone: string;
    isActive: boolean;
    licenseNumber: string;
    specialization: string;
    verificationStatus: 'pending' | 'under_review' | 'approved' | 'rejected';
    isAvailable: boolean;
    isOnline: boolean;
  }>;
  doctors: Array<{
    userId: number;
    fullName: string;
    email: string;
    pmdcLicense: string;
    department: string;
    verificationStatus: 'pending' | 'under_review' | 'approved' | 'rejected';
    availabilityStatus: string;
    isActive: boolean;
  }>;
  credentials: CredentialItem[];
}

interface AuditLogItem {
  id: number;
  actorName: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadataJson: string | null;
  createdAt: string;
}

export function AdminWorkspace({
  token,
  hospital,
  requests,
  onHospitalUpdated,
  onRefreshData,
}: AdminWorkspaceProps) {
  const [tab, setTab] = useState<'overview' | 'verification' | 'services' | 'hospital' | 'audit'>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [staff, setStaff] = useState<StaffResponse | null>(null);
  const [allServices, setAllServices] = useState<ApprovedService[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [evidencePreview, setEvidencePreview] = useState<{ title: string; content: string; isImage: boolean; url?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New Service Form
  const [svcCode, setSvcCode] = useState('');
  const [svcName, setSvcName] = useState('');
  const [svcNameUr, setSvcNameUr] = useState('');
  const [svcCategory, setSvcCategory] = useState('Specialized Nursing');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcDescUr, setSvcDescUr] = useState('');
  const [svcMins, setSvcMins] = useState(30);
  const [svcPrep, setSvcPrep] = useState('');
  const [svcRx, setSvcRx] = useState(true);

  // Hospital Settings Form
  const [hospAddress, setHospAddress] = useState(hospital.address);
  const [hospPhone, setHospPhone] = useState(hospital.phone);
  const [hospRadius, setHospRadius] = useState(hospital.serviceRadiusKm);
  const [hospFreshness, setHospFreshness] = useState(hospital.locationFreshnessSeconds);
  const [hospHours, setHospHours] = useState(hospital.operatingHours);

  const loadAdminData = useCallback(async () => {
    try {
      const [ov, st, svcs, logs] = await Promise.all([
        apiFetch<AdminOverview>('/api/admin/overview', { token }),
        apiFetch<StaffResponse>('/api/admin/staff', { token }),
        apiFetch<{ services: ApprovedService[] }>('/api/admin/services', { token }),
        apiFetch<{ logs: AuditLogItem[] }>('/api/admin/audit-logs', { token }),
      ]);
      setOverview(ov);
      setStaff(st);
      setAllServices(svcs.services);
      setAuditLogs(logs.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console data.');
    }
  }, [token]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const handleReviewCredential = async (credId: number, decision: 'approved' | 'rejected') => {
    setError(null);
    setNotice(null);
    const notes =
      reviewNotes[credId]?.trim() ||
      (decision === 'approved'
        ? 'Verified by East-City Hospital Administrator.'
        : 'Verification declined; please resubmit valid license.');
    try {
      await apiFetch(`/api/admin/credentials/${credId}/review`, {
        method: 'PATCH',
        token,
        body: { decision, reviewNotes: notes },
      });
      setNotice(`Credential #${credId} marked ${decision}.`);
      await loadAdminData();
      await onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review.');
    }
  };

  const handleInspectEvidence = async (cred: CredentialItem) => {
    setError(null);
    try {
      const resp = await fetch(`/api/credentials/${cred.id}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Unable to retrieve credential file.');
      if (cred.mimeType.startsWith('image/')) {
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        setEvidencePreview({ title: cred.originalFilename, content: '', isImage: true, url });
      } else {
        const text = await resp.text();
        setEvidencePreview({ title: cred.originalFilename, content: text, isImage: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open credential evidence.');
    }
  };

  const handleToggleService = async (svc: ApprovedService) => {
    setError(null);
    try {
      const res = await apiFetch<{ services: ApprovedService[] }>(`/api/admin/services/${svc.id}`, {
        method: 'PATCH',
        token,
        body: { isActive: !svc.isActive },
      });
      setAllServices(res.services);
      await onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update service.');
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ services: ApprovedService[] }>('/api/admin/services', {
        method: 'POST',
        token,
        body: {
          code: svcCode,
          name: svcName,
          nameUr: svcNameUr,
          category: svcCategory,
          description: svcDesc,
          descriptionUr: svcDescUr,
          estimatedDurationMins: svcMins,
          preparationNotes: svcPrep,
          requiresPrescriptionNote: svcRx,
          isActive: true,
        },
      });
      setAllServices(res.services);
      setSvcCode('');
      setSvcName('');
      setSvcNameUr('');
      setSvcDesc('');
      setSvcDescUr('');
      setSvcPrep('');
      setNotice('New hospital-approved service added to HomeHeal catalog.');
      await onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create service.');
    }
  };

  const handleSaveHospital = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<HospitalSettings>('/api/admin/hospital', {
        method: 'PATCH',
        token,
        body: {
          address: hospAddress,
          phone: hospPhone,
          serviceRadiusKm: hospRadius,
          locationFreshnessSeconds: hospFreshness,
          operatingHours: hospHours,
        },
      });
      onHospitalUpdated(updated);
      setNotice('East-City Hospital operational settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update hospital settings.');
    }
  };

  const handleToggleUserActive = async (userId: number) => {
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${userId}/toggle-active`, {
        method: 'PATCH',
        token,
      });
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update staff status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg overflow-x-auto">
          {[
            { id: 'overview', label: 'Operations & Requests' },
            {
              id: 'verification',
              label: `Staff Verification (${overview?.pendingCredentialsCount ?? 0})`,
            },
            { id: 'services', label: `Approved Services (${allServices.length})` },
            { id: 'hospital', label: 'Hospital Settings' },
            { id: 'audit', label: 'Audit Logs' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === item.id ? 'bg-teal-700 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
          {error}
        </div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          {notice}
        </div>
      )}

      {/* TAB 1: OPERATIONS OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Pending Requests</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {overview?.requestCountsByStatus?.Pending ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Active Visits In Field</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-teal-700 mt-1">
                {(overview?.requestCountsByStatus?.Accepted ?? 0) +
                  (overview?.requestCountsByStatus?.['En Route'] ?? 0) +
                  (overview?.requestCountsByStatus?.Arrived ?? 0)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Completed Visits</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {overview?.requestCountsByStatus?.Completed ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Verified Nurses Online</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {overview?.activeNursesOnlineCount ?? 0}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-700" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">
                  East-City Hospital Live Request Monitor
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {requests.length} total
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4">Service</th>
                    <th className="py-2.5 px-4">Assigned Nurse</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono text-xs">{r.requestCode}</td>
                      <td className="py-2.5 px-4">{r.patientName}</td>
                      <td className="py-2.5 px-4 text-slate-700">{r.serviceName}</td>
                      <td className="py-2.5 px-4 text-slate-600">{r.assignedNurseName || 'Unassigned'}</td>
                      <td className="py-2.5 px-4">
                        <RequestStatusLabel status={r.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {r.status === 'Pending' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/requests/${r.id}/status`, {
                                method: 'PATCH',
                                token,
                                body: {
                                  status: 'Rejected',
                                  cancellationReason: 'Rejected by Hospital Administrator',
                                },
                              });
                              await onRefreshData();
                              await loadAdminData();
                            }}
                            className="text-xs font-medium text-red-700 hover:underline"
                          >
                            Reject
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CREDENTIAL VERIFICATION & STAFF MANAGEMENT */}
      {tab === 'verification' && staff && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-base font-semibold text-slate-900">
                Staff Credential Evidence Review Queue
              </h3>
            </div>

            <div className="space-y-3">
              {staff.credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="p-4 rounded-lg border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {cred.userName} ({cred.role})
                      </span>
                      <VerificationStatusLabel status={cred.reviewStatus} />
                    </div>
                    <p className="text-xs text-slate-600">
                      {cred.documentType} · {cred.originalFilename} · Storage: {cred.storageProvider}
                    </p>
                    <p className="text-xs text-slate-500">Notes: {cred.reviewNotes}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleInspectEvidence(cred)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Inspect File</span>
                    </button>

                    {cred.reviewStatus === 'pending' && (
                      <>
                        <input
                          type="text"
                          aria-label={`Review note for ${cred.userName}`}
                          value={reviewNotes[cred.id] ?? ''}
                          onChange={(e) =>
                            setReviewNotes((prev) => ({ ...prev, [cred.id]: e.target.value }))
                          }
                          placeholder="Verification note..."
                          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => void handleReviewCredential(cred.id, 'approved')}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReviewCredential(cred.id, 'rejected')}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {evidencePreview && (
            <div className="bg-white border border-slate-300 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">
                  Private Evidence Preview: {evidencePreview.title}
                </h4>
                <button
                  type="button"
                  onClick={() => setEvidencePreview(null)}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Close Preview
                </button>
              </div>
              {evidencePreview.isImage && evidencePreview.url ? (
                <img
                  src={evidencePreview.url}
                  alt={evidencePreview.title}
                  className="max-h-72 rounded-lg border border-slate-200"
                />
              ) : (
                <pre className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono whitespace-pre-wrap">
                  {evidencePreview.content}
                </pre>
              )}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">Hospital Nursing & Medical Roster</h3>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-4">Staff Member</th>
                  <th className="py-2.5 px-4">Role / License</th>
                  <th className="py-2.5 px-4">Verification</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staff.nurses.map((n) => (
                  <tr key={`n-${n.userId}`}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{n.fullName}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                      Nurse · {n.licenseNumber}
                    </td>
                    <td className="py-2.5 px-4">
                      <VerificationStatusLabel status={n.verificationStatus} />
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {n.isOnline ? 'Online' : 'Offline'} · {n.isAvailable ? 'Available' : 'Busy'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleToggleUserActive(n.userId)}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        {n.isActive ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
                {staff.doctors.map((d) => (
                  <tr key={`d-${d.userId}`}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{d.fullName}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                      Doctor · {d.pmdcLicense}
                    </td>
                    <td className="py-2.5 px-4">
                      <VerificationStatusLabel status={d.verificationStatus} />
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">{d.availabilityStatus}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleToggleUserActive(d.userId)}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        {d.isActive ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: APPROVED SERVICES */}
      {tab === 'services' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                East-City Approved Home Nursing Services
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {allServices.map((svc) => (
                <div key={svc.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-mono text-slate-500">
                      {svc.code} · {svc.category} · {svc.estimatedDurationMins} min
                    </p>
                    <p className="text-sm font-semibold text-slate-900">{svc.name}</p>
                    <p className="text-xs text-slate-600">{svc.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleService(svc)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border shrink-0 ${
                      svc.isActive
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {svc.isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateService} className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">Add Approved Service</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="svc-code" className="block text-xs font-medium text-slate-700 mb-1">
                  Service Code
                </label>
                <input
                  id="svc-code"
                  required
                  value={svcCode}
                  onChange={(e) => setSvcCode(e.target.value)}
                  placeholder="SVC-NGT-06"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="svc-mins" className="block text-xs font-medium text-slate-700 mb-1">
                  Duration (mins)
                </label>
                <input
                  id="svc-mins"
                  type="number"
                  min={10}
                  max={240}
                  value={svcMins}
                  onChange={(e) => setSvcMins(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label htmlFor="svc-name" className="block text-xs font-medium text-slate-700 mb-1">
                Service Name (English)
              </label>
              <input
                id="svc-name"
                required
                value={svcName}
                onChange={(e) => setSvcName(e.target.value)}
                placeholder="Suture Removal & Site Check"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="svc-name-ur" className="block text-xs font-medium text-slate-700 mb-1">
                Service Name (Urdu)
              </label>
              <input
                id="svc-name-ur"
                required
                dir="rtl"
                value={svcNameUr}
                onChange={(e) => setSvcNameUr(e.target.value)}
                placeholder="ٹانکے نکالنا اور معائنہ"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="svc-cat" className="block text-xs font-medium text-slate-700 mb-1">
                Category
              </label>
              <input
                id="svc-cat"
                required
                value={svcCategory}
                onChange={(e) => setSvcCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="svc-desc" className="block text-xs font-medium text-slate-700 mb-1">
                Description (English)
              </label>
              <textarea
                id="svc-desc"
                required
                rows={2}
                value={svcDesc}
                onChange={(e) => setSvcDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="svc-desc-ur" className="block text-xs font-medium text-slate-700 mb-1">
                Description (Urdu)
              </label>
              <textarea
                id="svc-desc-ur"
                required
                dir="rtl"
                rows={2}
                value={svcDescUr}
                onChange={(e) => setSvcDescUr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="svc-prep" className="block text-xs font-medium text-slate-700 mb-1">
                Preparation Notes
              </label>
              <input
                id="svc-prep"
                value={svcPrep}
                onChange={(e) => setSvcPrep(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={svcRx}
                onChange={(e) => setSvcRx(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700"
              />
              <span>Requires hospital discharge or physician prescription note</span>
            </label>
            <button
              type="submit"
              className="w-full py-2 px-4 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Publish Approved Service
            </button>
          </form>
        </div>
      )}

      {/* TAB 4: HOSPITAL SETTINGS */}
      {tab === 'hospital' && (
        <form onSubmit={handleSaveHospital} className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-teal-700" aria-hidden="true" />
            <h3 className="text-base font-semibold text-slate-900">
              East-City Hospital Operational Configuration
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hosp-addr" className="block text-xs font-medium text-slate-700 mb-1">
                Hospital Address
              </label>
              <input
                id="hosp-addr"
                value={hospAddress}
                onChange={(e) => setHospAddress(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="hosp-phone" className="block text-xs font-medium text-slate-700 mb-1">
                Coordination Phone
              </label>
              <input
                id="hosp-phone"
                value={hospPhone}
                onChange={(e) => setHospPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="hosp-rad" className="block text-xs font-medium text-slate-700 mb-1">
                Service Radius (km)
              </label>
              <input
                id="hosp-rad"
                type="number"
                step="0.5"
                value={hospRadius}
                onChange={(e) => setHospRadius(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="hosp-fresh" className="block text-xs font-medium text-slate-700 mb-1">
                GPS Freshness Threshold (seconds)
              </label>
              <input
                id="hosp-fresh"
                type="number"
                value={hospFreshness}
                onChange={(e) => setHospFreshness(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="hosp-hours" className="block text-xs font-medium text-slate-700 mb-1">
                Operating Hours
              </label>
              <input
                id="hosp-hours"
                value={hospHours}
                onChange={(e) => setHospHours(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
          >
            Save Hospital Settings
          </button>
        </form>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-700" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-slate-900">Security & Operational Audit Logs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 px-4 text-slate-500 tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-slate-800 font-sans">
                      {log.actorName || 'System'} ({log.actorRole})
                    </td>
                    <td className="py-2 px-4 text-teal-800">{log.action}</td>
                    <td className="py-2 px-4 text-slate-600">
                      {log.targetType} #{log.targetId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
