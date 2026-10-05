export interface Gate {
  id: string;
  code: string;
  name: string;
  station: string;
  status: 'NORMAL' | 'FAULT';
}

export interface RepairOrder {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';
  assignee: string;
  note: string;
  startedAt?: string | null;
  resolvedAt?: string | null;
}

export interface TicketOrder {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'CLOSED';
  handler: string;
  note: string;
  closedAt?: string | null;
}

export interface TripStats {
  total: number;
  needsReview: number;
  missingExit: number;
  handled: number;
  refundedAmount: number;
}

export interface Incident {
  id: string;
  occurredAt: string;
  reportedBy: string;
  description: string;
  gate: Gate;
  repairOrder: RepairOrder;
  ticketOrder: TicketOrder;
  tripStats: TripStats;
}

export interface Trip {
  id: string;
  cardId: string;
  entryStation: string;
  entryTime: string;
  exitStation?: string | null;
  exitTime?: string | null;
  chargedFare: number;
  correctFare?: number | null;
  status: 'NORMAL' | 'MISSING_EXIT' | 'NEEDS_REVIEW' | 'COMPLETED' | 'REFUNDED';
  late: boolean;
  incidentId?: string | null;
  gate: { code: string; name: string; station: string };
  refund?: Refund | null;
}

export interface Refund {
  id: string;
  tripId: string;
  amount: number;
  reason: string;
  receiptNo: string;
  createdAt: string;
  trip?: { cardId: string; entryStation: string; entryTime: string };
}

export interface Receipt {
  id: string;
  receiptNo: string;
  cardId: string;
  amount: number;
  kind: 'CHARGE' | 'REFUND';
  createdAt: string;
}

export interface GateLog {
  id: string;
  contentHash: string;
  recordCount: number;
  uploadedAt: string;
  gate: { code: string; name: string; station: string };
}

export interface AlertItem {
  gate: Gate;
  incident: (Incident & { repairOrder: RepairOrder; ticketOrder: TicketOrder }) | null;
}

export interface Meta {
  gates: Gate[];
  stations: string[];
  maxFare: number;
}
