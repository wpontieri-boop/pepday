export const ENTITLEMENT_STATUSES = Object.freeze(['free','trial','pro_active','pro_expired']);

const DEFAULT_ACCESS = Object.freeze({
  status: 'free', pro: false, signedIn: false, source: 'anonymous',
  trialUsed: false, trialAvailable: false, startedAt: null, endsAt: null, serverNow: null
});

export function normalizeEntitlement(raw, { signedIn = false } = {}) {
  if (!signedIn) return DEFAULT_ACCESS;
  const status = ENTITLEMENT_STATUSES.includes(raw?.status) ? raw.status : 'free';
  const active = status === 'trial' || status === 'pro_active';
  return Object.freeze({
    status,
    // A autorização vem da resposta calculada no backend. Datas são só informativas no cliente.
    pro: active && raw?.pro === true,
    signedIn: true,
    source: typeof raw?.source === 'string' ? raw.source : 'account',
    trialUsed: raw?.trial_used === true || raw?.trialUsed === true,
    trialAvailable: status === 'free' && (raw?.trial_available === true || raw?.trialAvailable === true),
    startedAt: typeof (raw?.started_at ?? raw?.startedAt) === 'string' ? (raw.started_at ?? raw.startedAt) : null,
    endsAt: typeof (raw?.ends_at ?? raw?.endsAt) === 'string' ? (raw.ends_at ?? raw.endsAt) : null,
    serverNow: typeof (raw?.server_now ?? raw?.serverNow) === 'string' ? (raw.server_now ?? raw.serverNow) : null
  });
}

export function proGateDecision(access) {
  const normalized = normalizeEntitlement(access, { signedIn: access?.signedIn === true });
  if (normalized.pro) return Object.freeze({ allowed: true, reason: 'active', canStartTrial: false, needsLogin: false });
  if (!normalized.signedIn) return Object.freeze({ allowed: false, reason: 'login', canStartTrial: false, needsLogin: true });
  if (normalized.status === 'pro_expired') return Object.freeze({ allowed: false, reason: 'expired', canStartTrial: false, needsLogin: false });
  return Object.freeze({
    allowed: false,
    reason: 'free',
    canStartTrial: normalized.trialAvailable && !normalized.trialUsed,
    needsLogin: false
  });
}

export function entitlementPresentation(access, locale = 'pt-BR') {
  const normalized = normalizeEntitlement(access, { signedIn: access?.signedIn === true });
  const end = normalized.endsAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(normalized.endsAt))
    : null;
  if (normalized.status === 'trial' && normalized.pro) return {
    label: 'PEPDAY PRO — TESTE GRÁTIS',
    description: end ? `Teste PRO ativo até ${end}. Nenhum cartão foi solicitado.` : 'Teste PRO ativo por 7 dias. Nenhum cartão foi solicitado.'
  };
  if (normalized.status === 'pro_active' && normalized.pro) return {
    label: 'PEPDAY PRO ATIVO',
    description: end ? `Acesso PRO ativo até ${end}.` : 'Acesso PRO ativo.'
  };
  if (normalized.status === 'pro_expired') return {
    label: 'PEPDAY PRO EXPIRADO',
    description: normalized.source === 'trial'
      ? 'Seu teste PRO terminou. Seus dados continuam salvos e os recursos FREE permanecem disponíveis.'
      : 'Seu acesso PRO terminou. Seus dados continuam salvos e os recursos FREE permanecem disponíveis.'
  };
  return {
    label: 'PEPDAY FREE',
    description: normalized.signedIn
      ? 'Calculadora e tutorial disponíveis. Rotinas, frascos e histórico são recursos PRO.'
      : 'Calculadora e tutorial disponíveis sem login neste aparelho.'
  };
}
