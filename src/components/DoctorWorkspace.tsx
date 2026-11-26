import { useState } from 'react';
import { Bell, FileUp, Stethoscope } from 'lucide-react';
import {
  apiFetch,
  type NotificationItem,
  type ServiceRequestItem,
  type SessionPayload,
  type VerificationStatus,
} from '../types/api.ts';
import { RequestStatusLabel, VerificationStatusLabel } from './StatusBadge.tsx';

interface DoctorWorkspaceProps {
  session: SessionPayload;
  token: string;
  requests: ServiceRequestItem[];
  notifications: NotificationItem[];
  onUpdateSession: (s: SessionPayload) => void;
  onMarkNotificationRead: (id: number) => Promise<void>;
}

export function DoctorWorkspace({
  session,
  token,
  requests,
  notifications,
  onUpdateSession,
  onMarkNotificationRead,
}: DoctorWorkspaceProps) {
  const [department, setDepartment] = useState(String(session.profile.department || 'Internal Medicine'));
  const [specialty, setSpecialty] = useState(String(session.profile.specialty || 'Care Coordination'));
  const [availabilityStatus, setAvailabilityStatus] = useState<'on_duty' | 'on_call' | 'off_duty'>(
    (session.profile.availabilityStatus as 'on_duty' | 'on_call' | 'off_duty') || 'on_duty',
  );
  const [coordinationNotes, setCoordinationNotes] = useState(
    String(session.profile.coordinationNotes || ''),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const verificationStatus = (session.profile.verificationStatus as VerificationStatus) || 'pending';

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const updated = await apiFetch<SessionPayload>('/api/doctor/profile', {
        method: 'PATCH',
        token,
        body: { department, specialty, availabilityStatus, coordinationNotes },
      });
      onUpdateSession(updated);
      setMsg('Doctor coordination profile and duty status updated.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Unable to save doctor profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    setMsg(null);
    try {
      const base64Content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(selectedFile);
      });
      const res = await apiFetch<{ session: SessionPayload }>('/api/credentials/upload', {
        method: 'POST',
        token,
        body: {
          documentType: 'PMDC Medical License',
          originalFilename: selectedFile.name,
          mimeType: selectedFile.type || 'text/plain',
          base64Content,
        },
      });
      onUpdateSession(res.session);
      setSelectedFile(null);
      setMsg('PMDC credential uploaded for East-City Hospital Administrator review.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Stethoscope className="w-5 h-5 text-teal-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">{session.user.fullName}</h2>
            <VerificationStatusLabel status={verificationStatus} />
          </div>
          <p className="text-xs text-slate-500 font-mono">
            PMDC: {String(session.profile.pmdcLicense || 'N/A')} · {department} · {specialty}
          </p>
        </div>
        <p className="text-xs text-slate-600 max-w-md">
          Hospital Coordination Scope: View East-City HomeHeal operational activity and manage your
          in-hospital coordination availability. (Home visits are performed strictly by verified nurses.)
        </p>
      </div>

      {msg && (
        <div className="px-4 py-2.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Profile & Credentials */}
        <div className="lg:col-span-5 space-y-6">
          <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Professional Profile & Availability
            </h3>
            <div>
              <label htmlFor="doc-dept" className="block text-xs font-medium text-slate-700 mb-1">
                Hospital Department
              </label>
              <input
                id="doc-dept"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              />
            </div>
            <div>
              <label htmlFor="doc-spec" className="block text-xs font-medium text-slate-700 mb-1">
                Clinical Specialty
              </label>
              <input
                id="doc-spec"
                type="text"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              />
            </div>
            <div>
              <label htmlFor="doc-avail" className="block text-xs font-medium text-slate-700 mb-1">
                Coordination Duty Status
              </label>
              <select
                id="doc-avail"
                value={availabilityStatus}
                onChange={(e) =>
                  setAvailabilityStatus(e.target.value as 'on_duty' | 'on_call' | 'off_duty')
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              >
                <option value="on_duty">On Duty (East-City Hospital)</option>
                <option value="on_call">On Call Coordination</option>
                <option value="off_duty">Off Duty</option>
              </select>
            </div>
            <div>
              <label htmlFor="doc-notes" className="block text-xs font-medium text-slate-700 mb-1">
                Coordination Desk Notes
              </label>
              <textarea
                id="doc-notes"
                rows={2}
                value={coordinationNotes}
                onChange={(e) => setCoordinationNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              {saving ? 'Saving...' : 'Update Availability & Profile'}
            </button>
          </form>

          <form onSubmit={handleUploadDoc} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FileUp className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">Doctor Credential Evidence</h3>
            </div>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,.txt"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-800"
            />
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Submit PMDC Evidence'}
            </button>
            {session.credentials.map((c) => (
              <div key={c.id} className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                <span>{c.originalFilename}</span>
                <VerificationStatusLabel status={c.reviewStatus} />
              </div>
            ))}
          </form>
        </div>

        {/* Right: Hospital Coordination Notifications & Request Overview */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">
                Hospital Coordination Notifications ({notifications.length})
              </h3>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">No coordination notices yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.slice(0, 8).map((n) => (
                  <li key={n.id} className="py-2.5 flex items-start justify-between gap-3">
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
                        Acknowledge
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                East-City Home Nursing Coordination Feed
              </h3>
              <p className="text-xs text-slate-500">
                De-identified operational overview of hospital-approved nursing visits
              </p>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-4">Code</th>
                  <th className="py-2.5 px-4">Service</th>
                  <th className="py-2.5 px-4">Assigned Nurse</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-4 font-mono text-xs">{r.requestCode}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{r.serviceName}</td>
                    <td className="py-2.5 px-4 text-slate-600">{r.assignedNurseName || 'Pending'}</td>
                    <td className="py-2.5 px-4">
                      <RequestStatusLabel status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
