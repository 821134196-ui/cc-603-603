// 后端 API 客户端
const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `请求失败 ${res.status}`;
    try {
      const body = await res.json();
      message = Array.isArray(body.message)
        ? body.message.join('；')
        : body.message || message;
    } catch {
      /* 忽略解析失败 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

export interface Gate {
  id: string;
  code: string;
  station: string;
  name: string;
  status: 'NORMAL' | 'FAULT';
}

export interface GateLog {
  id: string;
  gateCode: string;
  station: string;
  cardId: string;
  eventType: 'ENTRY' | 'EXIT';
  eventTime: string;
  receivedAt: string;
  batchNo: string | null;
  isLate: boolean;
  reviewed: boolean;
  reviewNote: string | null;
}

export interface Trip {
  id: string;
  cardId: string;
  status: 'MISSING' | 'REGISTERED' | 'REFUNDED';
  entryStation: string | null;
  exitStation: string | null;
  correctFare: number;
  manualExitNote: string | null;
  registeredBy: string | null;
  entryLog: GateLog | null;
  exitLog: GateLog | null;
  receipt: {
    id: string;
    receiptNo: string;
    amountCharged: number;
    correctAmount: number;
    status: 'PAID' | 'REFUNDED';
  } | null;
  refund: { id: string; amount: number; operator: string; reason: string } | null;
}

export interface Fault {
  id: string;
  gateId: string;
  station: string;
  occurredAt: string;
  description: string;
  stationAgent: string;
  status: 'ALERT' | 'REPAIR_CLOSED';
  repairNote: string | null;
  repairedBy: string | null;
  repairedAt: string | null;
  gate: Gate;
  ticketCase: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    closedBy: string | null;
    closedAt: string | null;
    closeNote: string | null;
  } | null;
  logs: GateLog[];
  trips: Trip[];
}

export interface DashboardOverview {
  alertCount: number;
  openTicketCount: number;
  pendingRefundCount: number;
  alertGates: Array<{
    gateId: string;
    gateCode: string;
    gateName: string;
    station: string;
    status: string;
    activeFaults: Array<{
      faultId: string;
      occurredAt: string;
      description: string;
      stationAgent: string;
      ticketStatus: string | null;
    }>;
  }>;
}

export interface UploadResult {
  received: number;
  acceptedCount: number;
  duplicateCount: number;
  duplicates: string[];
  latePendingCount: number;
  latePending: string[];
  note?: string;
}

export const api = {
  gates: () => request<Gate[]>('/gates'),
  dashboard: () => request<DashboardOverview>('/dashboard/overview'),
  faults: (status?: string) =>
    request<Fault[]>(`/faults${status ? `?status=${status}` : ''}`),
  fault: (id: string) => request<Fault>(`/faults/${id}`),
  registerFault: (body: {
    gateCode: string;
    occurredAt: string;
    description: string;
    stationAgent: string;
  }) => post<Fault>('/faults', body),
  repairClose: (id: string, body: { repairNote?: string; repairedBy: string }) =>
    post<Fault>(`/faults/${id}/repair-close`, body),
  simulate: (faultId: string, scenario: 'normal' | 'duplicate' | 'late') =>
    post<UploadResult>(`/simulator/faults/${faultId}/logs/${scenario}`),
  reviewLog: (
    logId: string,
    body: { approve: boolean; reviewNote?: string; reviewer?: string },
  ) => post<GateLog>(`/logs/${logId}/review`, body),
  registerTrip: (
    tripId: string,
    body: { operator: string; exitStation?: string; entryStation?: string; note?: string },
  ) => post(`/trips/${tripId}/register`, body),
  refund: (tripId: string, body: { operator: string; reason?: string }) =>
    post(`/trips/${tripId}/refund`, body),
  closeTicket: (
    ticketId: string,
    body: { operator: string; closeNote?: string; force?: boolean },
  ) => post(`/tickets/${ticketId}/close`, body),
};
