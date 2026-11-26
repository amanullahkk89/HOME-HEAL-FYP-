import {
  CheckCircle2,
  Clock,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import type { RequestStatus, VerificationStatus } from '../types/api.ts';

export function RequestStatusLabel({ status }: { status: RequestStatus }) {
  const config: Record<
    RequestStatus,
    { color: string; bg: string; border: string; icon: typeof Clock }
  > = {
    Pending: {
      color: 'text-amber-800',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      icon: Clock,
    },
    Accepted: {
      color: 'text-teal-800',
      bg: 'bg-teal-50',
      border: 'border-teal-200',
      icon: CheckCircle2,
    },
    'En Route': {
      color: 'text-sky-800',
      bg: 'bg-sky-50',
      border: 'border-sky-200',
      icon: Truck,
    },
    Arrived: {
      color: 'text-indigo-800',
      bg: 'bg-indigo-50',
      border: 'border-indigo-200',
      icon: Navigation,
    },
    Completed: {
      color: 'text-emerald-800',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      icon: CheckCircle2,
    },
    Cancelled: {
      color: 'text-slate-700',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
      icon: XCircle,
    },
    Rejected: {
      color: 'text-red-800',
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: XCircle,
    },
  };

  const entry = config[status];
  const Icon = entry.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 ${entry.bg} ${entry.color} ${entry.border}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
}

export function VerificationStatusLabel({ status }: { status: VerificationStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md whitespace-nowrap">
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Verified</span>
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 px-2.5 py-1 rounded-md whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Rejected</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md whitespace-nowrap">
      <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{status === 'under_review' ? 'Under Review' : 'Pending Verification'}</span>
    </span>
  );
}
