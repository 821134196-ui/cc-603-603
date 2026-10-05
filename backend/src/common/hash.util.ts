import { createHash } from 'node:crypto';

/**
 * 闸机日志内容指纹：同一台闸机、同一张卡、同一事件类型、同一刷卡时刻
 * 的记录视为同一段日志。重复上传时该 hash 命中唯一约束，只形成一次有效记录。
 */
export function buildGateLogHash(input: {
  gateCode: string;
  cardId: string;
  eventType: string;
  eventTime: string | Date;
}): string {
  const eventIso = new Date(input.eventTime).toISOString();
  const canonical = [
    input.gateCode.trim(),
    input.cardId.trim(),
    input.eventType.trim().toUpperCase(),
    eventIso,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
