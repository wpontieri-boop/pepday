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

export function trialExpiryNotice(access) {
  const normalized = normalizeEntitlement(access, { signedIn: access?.signedIn === true });
  if (normalized.status !== 'trial' || !normalized.pro || !normalized.endsAt || !normalized.serverNow) return null;
  const remainingMs = new Date(normalized.endsAt).getTime() - new Date(normalized.serverNow).getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  if (remainingMs <= 86400000) return Object.freeze({ level:'one-day', message:'Seu teste PRO termina em menos de 1 dia.' });
  if (remainingMs <= 259200000) return Object.freeze({ level:'three-days', message:'Seu teste PRO termina em até 3 dias.' });
  return null;
}

export function postTrialExperience(access) {
  const normalized = normalizeEntitlement(access, { signedIn: access?.signedIn === true });
  const visible = normalized.signedIn
    && normalized.status === 'pro_expired'
    && (normalized.source === 'trial' || normalized.source === 'card')
    && (normalized.source === 'card' || normalized.trialUsed);
  if (!visible) return Object.freeze({ visible:false });
  const card=normalized.source==='card';
  return Object.freeze({
    visible:true,
    title:card?'Seus 30 dias PRO terminaram':'Seu teste PRO terminou',
    message:card
      ?'Você voltou ao PepDay FREE. Seus dados continuam salvos e você pode assinar o PRO quando quiser continuar com todos os recursos.'
      :'Você continua no PepDay FREE com a calculadora e o tutorial. Seus dados PRO permanecem salvos para quando quiser voltar.',
    primaryLabel:'Ver planos PRO',
    secondaryLabel:'Continuar no FREE'
  });
}

export function entitlementPresentation(access, locale = 'pt-BR') {
  const normalized = normalizeEntitlement(access, { signedIn: access?.signedIn === true });
  const notice = trialExpiryNotice(normalized);
  const end = normalized.endsAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(normalized.endsAt))
    : null;
  if (normalized.status === 'trial' && normalized.pro) {
    const base = end ? `Teste PRO ativo até ${end}. Nenhum cartão foi solicitado.` : 'Teste PRO ativo por 7 dias. Nenhum cartão foi solicitado.';
    return { label:'PEPDAY PRO — TESTE GRÁTIS', description:notice ? `${base} ${notice.message}` : base };
  }
  if (normalized.status === 'pro_active' && normalized.pro) return {
    label: normalized.source === 'card'
      ? 'PEPDAY PRO — CARTÃO 30 DIAS'
      : normalized.source === 'promo' ? 'PEPDAY PRO — CÓDIGO PROMOCIONAL' : 'PEPDAY PRO ATIVO',
    description: normalized.source === 'card'
      ? (end ? `Benefício do cartão ativo até ${end}. Sem cartão e sem cobrança automática.` : 'Benefício de 30 dias PRO do cartão ativo.')
      : normalized.source === 'promo'
        ? (end ? `Acesso PRO promocional ativo até ${end}.` : 'Acesso PRO promocional ativo.')
        : (end ? `Acesso PRO ativo até ${end}.` : 'Acesso PRO ativo.')
  };
  if (normalized.status === 'pro_expired') return {
    label: 'PEPDAY PRO EXPIRADO',
    description: normalized.source === 'trial'
      ? 'Seu teste PRO terminou. Seus dados continuam salvos e os recursos FREE permanecem disponíveis.'
      : normalized.source === 'card'
        ? 'Seus 30 dias PRO do cartão terminaram. Seus dados continuam salvos e você pode assinar o PRO quando quiser.'
        : 'Seu acesso PRO terminou. Seus dados continuam salvos e os recursos FREE permanecem disponíveis.'
  };
  return {
    label: 'PEPDAY FREE',
    description: normalized.signedIn
      ? 'Calculadora e tutorial disponíveis. Rotinas, frascos e histórico são recursos PRO.'
      : 'Calculadora e tutorial disponíveis sem login neste aparelho.'
  };
}
