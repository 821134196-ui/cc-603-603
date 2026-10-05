// 状态常量（SQLite 以字符串存储，类型层用字面量联合约束）

export const GATE_STATUS = {
  NORMAL: 'NORMAL',
  FAULT: 'FAULT',
} as const;
export type GateStatus = (typeof GATE_STATUS)[keyof typeof GATE_STATUS];

export const FAULT_STATUS = {
  ALERT: 'ALERT', // 告警中：维修未确认完成，看板持续提示
  REPAIR_CLOSED: 'REPAIR_CLOSED', // 维修员确认修复并结案
} as const;
export type FaultStatus = (typeof FAULT_STATUS)[keyof typeof FAULT_STATUS];

export const TICKET_STATUS = {
  OPEN: 'OPEN', // 客服处理中
  CLOSED: 'CLOSED', // 客服结案
} as const;
export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

export const GATE_EVENT = {
  ENTRY: 'ENTRY',
  EXIT: 'EXIT',
} as const;
export type GateEventType = (typeof GATE_EVENT)[keyof typeof GATE_EVENT];

export const TRIP_STATUS = {
  MISSING: 'MISSING', // 缺失行程，待客服补登
  REGISTERED: 'REGISTERED', // 已补登/已核对
  REFUNDED: 'REFUNDED', // 已退还差价（终态）
} as const;
export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];

export const RECEIPT_STATUS = {
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
} as const;
export type ReceiptStatus = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS];
