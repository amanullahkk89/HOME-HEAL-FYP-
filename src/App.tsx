import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AlertTriangle, Bell, LogOut, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';
import { AdminWorkspace } from './components/AdminWorkspace.tsx';
import { AuthPortal } from './components/AuthPortal.tsx';
import { DoctorWorkspace } from './components/DoctorWorkspace.tsx';
import { NurseWorkspace } from './components/NurseWorkspace.tsx';
import { PatientWorkspace } from './components/PatientWorkspace.tsx';
import {
  ACTIVE_VISIT_STATUSES,
  apiFetch,
  type ApprovedService,
  type ChatMessageItem,
  type HospitalSettings,
  type NotificationItem,
  type NurseOfferItem,
  type ServiceRequestItem,
  type SessionPayload,
} from './types/api.ts';

const FALLBACK_HOSPITAL: HospitalSettings = {
  id: 1,
  hospitalName: 'East-City Hospital',
  departmentName: 'Home Healthcare Coordination Unit',
  address: 'Plot 14, Hospital Avenue, Sector F-8, Islamabad',
  city: 'Islamabad',
  phone: '+92-51-5550100',
  supportEmail: 'homeheal@eastcity.org',
  latitude: 33.7138,
  longitude: 73.0501,
  serviceRadiusKm: 18,
  locationFreshnessSeconds: 300,
  operatingHours: '07:00 - 22:00 Daily',
  emergencyNotice:
    'HomeHeal is for scheduled, hospital-approved home nursing services only. For chest pain, severe bleeding, breathing difficulty, or medical emergencies, call 1122 or visit East-City Hospital Emergency immediately.',
};

const ROLE_LABELS: Record<string, string> = {
  patient: 'Patient Portal',
  nurse: 'Nurse Dispatch Portal',
  doctor: 'Doctor Coordination Portal',
  admin: 'Hospital Admin Console',
};

export default function App() {
  const [hospital, setHospital] = useState<HospitalSettings>(FALLBACK_HOSPITAL);
  const [services, setServices] = useState<ApprovedService[]>([]);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    typeof import.meta.env.VITE_GOOGLE_MAPS_API_KEY === 'string'
      ? import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      : '',
  );
  const [quotaBannerVisible, setQuotaBannerVisible] = useState(false);

  // Security: Auth token & session stored strictly in JS memory
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);

  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [offers, setOffers] = useState<NurseOfferItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [incomingMessages, setIncomingMessages] = useState<ChatMessageItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const [isBrowserOffline, setIsBrowserOffline] = useState(!navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const wasDisconnectedRef = useRef(false);

  // Load hospital info, services catalog, and runtime Maps browser key
  const loadPublicConfig = useCallback(async () => {
    try {
      const [hospRes, svcRes, mapsRes] = await Promise.all([
        apiFetch<HospitalSettings>('/api/hospital'),
        apiFetch<{ services: ApprovedService[] }>('/api/services'),
        apiFetch<{ apiKey: string }>('/api/config/maps-client'),
      ]);
      setHospital(hospRes);
      setServices(svcRes.services);
      if (mapsRes.apiKey) {
        setMapsApiKey(mapsRes.apiKey);
      }
    } catch {
      // Retain defaults if temporary network blip occurs on initial boot
    }
  }, []);

  useEffect(() => {
    void loadPublicConfig();
  }, [loadPublicConfig]);

  // Case A: Google Maps Demo Key quota exhaustion listener
  useEffect(() => {
    const onQuotaExceeded = () => setQuotaBannerVisible(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Browser online/offline tracking
  useEffect(() => {
    const goOnline = () => setIsBrowserOffline(false);
    const goOffline = () => setIsBrowserOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const refreshAuthenticatedData = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [meRes, reqRes, notifRes, svcRes, hospRes] = await Promise.all([
        apiFetch<SessionPayload>('/api/auth/me', { token }),
        apiFetch<{ requests: ServiceRequestItem[]; offers: NurseOfferItem[] }>('/api/requests', {
          token,
        }),
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications', { token }),
        apiFetch<{ services: ApprovedService[] }>('/api/services'),
        apiFetch<HospitalSettings>('/api/hospital'),
      ]);
      setSession(meRes);
      setRequests(reqRes.requests);
      setOffers(reqRes.offers || []);
      setNotifications(notifRes.notifications);
      setServices(svcRes.services);
      setHospital(hospRes);
    } catch {
      // Preserve committed client state during transient disconnect
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void refreshAuthenticatedData();
    }
  }, [token, refreshAuthenticatedData]);

  // Socket.IO connection & state reconciliation
  useEffect(() => {
    if (!token || !session) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      wasDisconnectedRef.current = false;
      return;
    }

    const socket = io({
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1200,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      if (wasDisconnectedRef.current) {
        wasDisconnectedRef.current = false;
        setSyncNotice('Reconnected to East-City Hospital server. Committed visit state restored.');
        void refreshAuthenticatedData();
        setTimeout(() => setSyncNotice(null), 5000);
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
      wasDisconnectedRef.current = true;
    });

    socket.on('connect_error', () => {
      setSocketConnected(false);
      wasDisconnectedRef.current = true;
    });

    socket.on('request:created', (newReq: ServiceRequestItem) => {
      setRequests((prev) =>
        prev.some((r) => r.id === newReq.id) ? prev : [newReq, ...prev],
      );
    });

    socket.on('request:updated', (updated: ServiceRequestItem) => {
      setRequests((prev) => {
        const exists = prev.some((r) => r.id === updated.id);
        return exists
          ? prev.map((r) => (r.id === updated.id ? updated : r))
          : [updated, ...prev];
      });
    });

    socket.on('offer:new', () => {
      void refreshAuthenticatedData();
    });

    socket.on('offer:superseded', (payload: { requestId: number }) => {
      setOffers((prev) =>
        prev.map((o) =>
          o.requestId === payload.requestId && o.offerStatus === 'offered'
            ? { ...o, offerStatus: 'superseded' }
            : o,
        ),
      );
    });

    socket.on('notification:new', (notif: NotificationItem) => {
      setNotifications((prev) =>
        prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev],
      );
    });

    socket.on('message:new', (msg: ChatMessageItem) => {
      setIncomingMessages((prev) => [...prev.slice(-100), msg]);
    });

    socket.on(
      'nurse:location',
      (loc: { requestId: number; nurseId: number; lat: number; lng: number; updatedAt: string }) => {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === loc.requestId && ACTIVE_VISIT_STATUSES.includes(r.status)
              ? {
                  ...r,
                  assignedNurseLat: loc.lat,
                  assignedNurseLng: loc.lng,
                  assignedNurseLocationUpdatedAt: loc.updatedAt,
                }
              : r,
          ),
        );
      },
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, session?.user.id, refreshAuthenticatedData]);

  // Ensure active visit rooms are joined when requests update
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socketConnected) return;
    for (const r of requests) {
      if (ACTIVE_VISIT_STATUSES.includes(r.status)) {
        socket.emit('request:join', { requestId: r.id });
      }
    }
  }, [requests, socketConnected]);

  const handleAuthenticated = (payload: SessionPayload & { token: string }) => {
    setToken(payload.token);
    setSession({
      user: payload.user,
      profile: payload.profile,
      credentials: payload.credentials,
    });
    setIncomingMessages([]);
    setNotifOpen(false);
  };

  const handleSignOut = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setToken(null);
    setSession(null);
    setRequests([]);
    setOffers([]);
    setNotifications([]);
    setIncomingMessages([]);
    setNotifOpen(false);
    setSyncNotice(null);
  };

  const handleMarkNotificationRead = async (id: number) => {
    if (!token) return;
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH', token });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
  };

  const handleMarkAllRead = async () => {
    if (!token) return;
    await apiFetch('/api/notifications/read-all', { method: 'POST', token });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const isOffline = isBrowserOffline || (Boolean(token) && !socketConnected);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Case A: Google Maps Demo Key Quota Warning Banner */}
      {quotaBannerVisible && (
        <div
          role="alert"
          className="sticky top-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-2.5 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              This app uses the free demo key quota which has temporarily run out for this project —
              please add a Google Maps billing key or try again later. Coordinate fallback map remains active.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setQuotaBannerVisible(false)}
            aria-label="Dismiss Maps quota warning"
            className="p-1 rounded hover:bg-amber-200/70 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!session || !token ? (
        <AuthPortal hospital={hospital} onAuthenticated={handleAuthenticated} />
      ) : (
        <>
          {/* 3-Zone Single-Row App Header */}
          <header className="bg-white border-b border-slate-200 px-6 py-3.5 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
              {/* Zone 1: Brand Identity */}
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
                  HomeHeal
                </span>
                <span className="hidden sm:inline text-xs font-medium text-slate-500 truncate">
                  {hospital.hospitalName} · {ROLE_LABELS[session.user.role] || session.user.role}
                </span>
              </div>

              {/* Zone 2: Connectivity, Notifications, Manual Sync */}
              <div className="flex items-center gap-3">
                <div className="hidden md:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 whitespace-nowrap shrink-0">
                  {isBrowserOffline ? (
                    <>
                      <WifiOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                      <span className="text-amber-800">Offline Mode</span>
                    </>
                  ) : socketConnected ? (
                    <>
                      <Wifi className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span className="text-slate-700">Live Sync</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" aria-hidden="true" />
                      <span className="text-amber-800">Reconnecting</span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void refreshAuthenticatedData()}
                  disabled={refreshing}
                  aria-label="Sync latest state"
                  className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                </button>

                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setNotifOpen((prev) => !prev)}
                    aria-label={`Notifications (${unreadCount} unread)`}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Bell className="w-4 h-4 text-teal-700" aria-hidden="true" />
                    <span className="hidden sm:inline">Alerts</span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 text-[11px] font-mono tabular-nums rounded bg-teal-700 text-white">
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900">
                          Notifications ({unreadCount} unread)
                        </span>
                        <div className="flex items-center gap-3">
                          {unreadCount > 0 && (
                            <button
                              type="button"
                              onClick={() => void handleMarkAllRead()}
                              className="text-[11px] font-medium text-teal-700 hover:underline"
                            >
                              Mark all read
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setNotifOpen(false)}
                            aria-label="Close notifications"
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                        {notifications.length === 0 ? (
                          <p className="p-4 text-xs text-slate-500 text-center">No alerts yet.</p>
                        ) : (
                          notifications.slice(0, 15).map((n) => (
                            <div
                              key={n.id}
                              className={`p-3.5 text-xs flex items-start justify-between gap-2 ${
                                n.isRead ? 'bg-white' : 'bg-teal-50/40'
                              }`}
                            >
                              <div className="space-y-0.5">
                                <p className={n.isRead ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}>
                                  {n.title}
                                </p>
                                <p className="text-slate-600">{n.body}</p>
                              </div>
                              {!n.isRead && (
                                <button
                                  type="button"
                                  onClick={() => void handleMarkNotificationRead(n.id)}
                                  className="text-[11px] font-medium text-teal-700 hover:underline shrink-0"
                                >
                                  Read
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Zone 3: User Identity & Primary Action */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="hidden lg:inline text-xs font-medium text-slate-700 whitespace-nowrap">
                  {session.user.fullName}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </header>

          {/* Connectivity & Recovery Feedback */}
          {isBrowserOffline && (
            <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-900">
              <div className="max-w-7xl mx-auto flex items-center gap-2">
                <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Internet connection interrupted. Your committed request state stays visible; queued visit
                  messages will flush automatically on reconnection.
                </span>
              </div>
            </div>
          )}
          {syncNotice && (
            <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 text-xs text-emerald-900">
              <div className="max-w-7xl mx-auto">{syncNotice}</div>
            </div>
          )}

          {/* Main Role-Routed Workspace */}
          <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
            {session.user.role === 'patient' && (
              <PatientWorkspace
                session={session}
                token={token}
                hospital={hospital}
                services={services}
                requests={requests}
                notifications={notifications}
                mapsApiKey={mapsApiKey}
                isOffline={isOffline}
                incomingMessages={incomingMessages}
                onRefreshData={refreshAuthenticatedData}
                onMarkNotificationRead={handleMarkNotificationRead}
                onUpdateSession={setSession}
              />
            )}

            {session.user.role === 'nurse' && (
              <NurseWorkspace
                session={session}
                token={token}
                hospital={hospital}
                services={services}
                requests={requests}
                offers={offers}
                notifications={notifications}
                mapsApiKey={mapsApiKey}
                isOffline={isOffline}
                incomingMessages={incomingMessages}
                onRefreshData={refreshAuthenticatedData}
                onUpdateSession={setSession}
              />
            )}

            {session.user.role === 'doctor' && (
              <DoctorWorkspace
                session={session}
                token={token}
                requests={requests}
                notifications={notifications}
                onUpdateSession={setSession}
                onMarkNotificationRead={handleMarkNotificationRead}
              />
            )}

            {session.user.role === 'admin' && (
              <AdminWorkspace
                token={token}
                hospital={hospital}
                requests={requests}
                onHospitalUpdated={setHospital}
                onRefreshData={refreshAuthenticatedData}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
