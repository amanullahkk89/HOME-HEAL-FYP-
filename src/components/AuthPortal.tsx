import { useEffect, useState } from 'react';
import { ArrowRight, Building2, Lock, Mail, Phone, ShieldCheck, User, UserPlus } from 'lucide-react';
import {
  apiFetch,
  type DemoAccount,
  type HospitalSettings,
  type LanguageCode,
  type SessionPayload,
} from '../types/api.ts';

interface AuthPortalProps {
  hospital: HospitalSettings | null;
  onAuthenticated: (session: SessionPayload & { token: string }) => void;
}

const HOSPITAL_IMG = '/src/assets/images/east_city_hospital_exterior_1795729074371.jpg';
const CARE_IMG = '/src/assets/images/home_nursing_care_1795729075209.jpg';

export function AuthPortal({ hospital, onAuthenticated }: AuthPortalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'patient' | 'nurse' | 'doctor'>('patient');
  const [preferredLanguage, setPreferredLanguage] = useState<LanguageCode>('en');
  const [defaultAddress, setDefaultAddress] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    apiFetch<{ accounts: DemoAccount[] }>('/api/auth/demo-accounts')
      .then((res) => setDemoAccounts(res.accounts))
      .catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<SessionPayload & { token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      onAuthenticated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<SessionPayload & { token: string }>('/api/auth/register', {
        method: 'POST',
        body: {
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          phone: phone.trim(),
          role,
          preferredLanguage,
          defaultAddress: role === 'patient' ? defaultAddress.trim() : undefined,
          licenseNumber: role !== 'patient' ? licenseNumber.trim() : undefined,
          specialization: role !== 'patient' ? specialization.trim() : undefined,
        },
      });
      onAuthenticated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemoSignIn = async (accountEmail: string) => {
    setMode('login');
    setEmail(accountEmail);
    setPassword('HomeHeal@2026');
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<SessionPayload & { token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email: accountEmail, password: 'HomeHeal@2026' },
      });
      onAuthenticated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
        <a href="#top" className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          HomeHeal
        </a>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a href="#services" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Approved Care
          </a>
          <a href="#hospital-info" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            East-City Hospital
          </a>
          <a href="#demo-access" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Role Portals
          </a>
        </nav>
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {mode === 'login' ? 'Create Account' : 'Sign In'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-7 grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left: Hospital Hero & Context */}
        <section className="lg:col-span-7 flex flex-col gap-5">
          <div className="space-y-2.5">
            <p className="text-xs font-medium text-teal-800">
              East-City Hospital · Home Healthcare Coordination Unit
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight max-w-2xl">
              Hospital-verified home nursing care, coordinated in real time.
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
              Request approved nursing visits—injections, IV drip setup, post-surgical wound dressing,
              and vitals monitoring—matched to verified East-City nurses with explicit location consent.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
              {!imgError ? (
                <img
                  src={HOSPITAL_IMG}
                  alt="East-City Hospital main entrance"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-36 object-cover"
                />
              ) : (
                <div className="w-full h-36 bg-gradient-to-br from-slate-100 to-teal-50 flex flex-col items-center justify-center text-slate-700">
                  <Building2 className="w-8 h-8 mb-2 text-teal-700" aria-hidden="true" />
                  <span className="text-xs font-medium">East-City Hospital</span>
                </div>
              )}
              <div className="p-3" id="hospital-info">
                <p className="text-sm font-semibold text-slate-900">
                  {hospital?.hospitalName || 'East-City Hospital'}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {hospital ? `${hospital.address}, ${hospital.city}` : 'Sector F-8, Islamabad'} ·{' '}
                  {hospital?.operatingHours || '07:00 - 22:00 Daily'}
                </p>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
              {!imgError ? (
                <img
                  src={CARE_IMG}
                  alt="Certified home healthcare nurse arriving for a visit"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-36 object-cover"
                />
              ) : (
                <div className="w-full h-36 bg-gradient-to-br from-teal-50 to-slate-100 flex flex-col items-center justify-center text-slate-700">
                  <ShieldCheck className="w-8 h-8 mb-2 text-teal-700" aria-hidden="true" />
                  <span className="text-xs font-medium">Verified Home Nursing</span>
                </div>
              )}
              <div className="p-3" id="services">
                <p className="text-sm font-semibold text-slate-900">Credential-Verified Staff</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  PNC-licensed nurses · Haversine proximity matching · Single-visit concurrency lock
                </p>
              </div>
            </div>
          </div>

          {/* Demo Accounts Matrix */}
          <div id="demo-access" className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Demonstration Role Access
                </h2>
                <p className="text-xs text-slate-500">
                  One-click sign-in across all four East-City Hospital roles (password:{' '}
                  <span className="font-mono">HomeHeal@2026</span>)
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleQuickDemoSignIn(acc.email)}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-left rounded-lg border border-slate-200 hover:border-teal-600 hover:bg-teal-50/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">{acc.fullName}</p>
                    <p className="text-[11px] text-slate-500 font-mono truncate">
                      {acc.role} · {acc.email}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-teal-700 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Auth Card */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Register Account
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                {error}
              </div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="patient.ali@example.com"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
                    <input
                      id="login-password"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Signing in...' : 'Sign In to HomeHeal'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3.5">
                <div>
                  <label htmlFor="reg-role" className="block text-xs font-medium text-slate-700 mb-1">
                    Account Role
                  </label>
                  <select
                    id="reg-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'patient' | 'nurse' | 'doctor')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="patient">Patient (Home Nursing Requests)</option>
                    <option value="nurse">Registered Nurse (Requires Admin Verification)</option>
                    <option value="doctor">Hospital Doctor (Coordination Profile)</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
                      <input
                        id="reg-name"
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Amina Tariq"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="reg-phone" className="block text-xs font-medium text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
                      <input
                        id="reg-phone"
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+92-300-5550199"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 mb-1">
                      Email
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-lang" className="block text-xs font-medium text-slate-700 mb-1">
                      Preferred Language
                    </label>
                    <select
                      id="reg-lang"
                      value={preferredLanguage}
                      onChange={(e) => setPreferredLanguage(e.target.value as LanguageCode)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      <option value="en">English</option>
                      <option value="ur">Urdu (اردو)</option>
                      <option value="roman_ur">Roman Urdu</option>
                    </select>
                  </div>
                </div>

                {role === 'patient' ? (
                  <div>
                    <label htmlFor="reg-address" className="block text-xs font-medium text-slate-700 mb-1">
                      Home Address (East-City Zone)
                    </label>
                    <input
                      id="reg-address"
                      type="text"
                      required
                      value={defaultAddress}
                      onChange={(e) => setDefaultAddress(e.target.value)}
                      placeholder="House 14, Street 5, Sector F-8/3, Islamabad"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="reg-lic" className="block text-xs font-medium text-slate-700 mb-1">
                        {role === 'nurse' ? 'PNC License Number' : 'PMDC License Number'}
                      </label>
                      <input
                        id="reg-lic"
                        type="text"
                        required
                        value={licenseNumber}
                        onChange={(e) => setLicenseNumber(e.target.value)}
                        placeholder={role === 'nurse' ? 'PNC-RN-99102' : 'PMDC-60211-P'}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="reg-spec" className="block text-xs font-medium text-slate-700 mb-1">
                        Specialization
                      </label>
                      <input
                        id="reg-spec"
                        type="text"
                        required
                        value={specialization}
                        onChange={(e) => setSpecialization(e.target.value)}
                        placeholder={role === 'nurse' ? 'Infusion & Wound Care' : 'Internal Medicine'}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="reg-password" className="block text-xs font-medium text-slate-700 mb-1">
                    Password (minimum 8 characters)
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>{submitting ? 'Creating Account...' : 'Create HomeHeal Account'}</span>
                </button>
              </form>
            )}
          </div>

          <p className="text-[11px] text-slate-500 mt-6 pt-4 border-t border-slate-100 leading-relaxed">
            {hospital?.emergencyNotice ||
              'HomeHeal supports scheduled, hospital-approved home nursing visits only. For medical emergencies, call 1122 or visit East-City Hospital Emergency.'}
          </p>
        </section>
      </main>
    </div>
  );
}
