// QA-only policy model. Not a database limiter, HTTP handler or production integration.
export const LIMITS = Object.freeze({ perInstallationPerHour: 12, globalPerHour: 240 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['installed', 'standalone_launch']);
const PLATFORMS = new Set(['ios', 'android', 'desktop', 'other']);
const HOUR_MS = 60 * 60 * 1000;

// Caller must serialize read/check/insert in the database. This deterministic
// model proves boundary decisions only; it is not concurrency or deployment QA.
export function decidePwaTelemetry({ history, event, nowMs, limits = LIMITS }) {
  if (!Array.isArray(history) || !event || !Number.isSafeInteger(nowMs) || nowMs < 0
    || !Number.isInteger(limits?.perInstallationPerHour) || limits.perInstallationPerHour < 1
    || !Number.isInteger(limits?.globalPerHour) || limits.globalPerHour < 1) {
    return { recorded: false, reason: 'invalid' };
  }
  if (!UUID.test(event.installationId || '') || !UUID.test(event.eventId || '')
    || !TYPES.has(event.eventType) || !PLATFORMS.has(event.platform)) {
    return { recorded: false, reason: 'invalid' };
  }
  // Reject corrupted synthetic state instead of silently under-counting events.
  if (!history.every(item => item && UUID.test(item.eventId || '')
    && UUID.test(item.installationId || '') && TYPES.has(item.eventType)
    && Number.isSafeInteger(item.createdAtMs) && item.createdAtMs <= nowMs)) {
    return { recorded: false, reason: 'invalid_history' };
  }
  if (history.some(item => item.eventId === event.eventId)) {
    return { recorded: false, reason: 'duplicate_event' };
  }
  if (event.eventType === 'installed'
    && history.some(item => item.installationId === event.installationId && item.eventType === 'installed')) {
    return { recorded: false, reason: 'duplicate_installation' };
  }
  const recent = history.filter(item => item.createdAtMs > nowMs - HOUR_MS);
  if (recent.length >= limits.globalPerHour) {
    return { recorded: false, reason: 'global_limit' };
  }
  if (recent.filter(item => item.installationId === event.installationId).length
    >= limits.perInstallationPerHour) {
    return { recorded: false, reason: 'installation_limit' };
  }
  return { recorded: true, reason: 'accepted' };
}

// Only for in-memory tests; no SQL, file writes, network access or credentials.
export function insertPwaTelemetryQa(history, event, nowMs, limits = LIMITS) {
  const decision = decidePwaTelemetry({ history, event, nowMs, limits });
  if (!decision.recorded) return { decision, history: [...history] };
  return { decision, history: [...history, { ...event, createdAtMs: nowMs }] };
}
