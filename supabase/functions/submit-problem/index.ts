import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Payload = {
  profession?: string;
  email?: string;
  description?: string;
  tools?: string;
  extra?: string;
  website?: string;
  renderedAt?: number;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const payload = (await request.json().catch(() => null)) as Payload | null;
  const validationError = validate(payload);

  if (validationError) {
    return json({ error: validationError }, 400);
  }

  if (payload?.website) {
    return json({ ok: true });
  }

  const ageMs = Date.now() - Number(payload?.renderedAt ?? 0);
  if (Number.isFinite(ageMs) && ageMs > 0 && ageMs < 2500) {
    return json({ error: 'Too fast' }, 429);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ipHashSalt = Deno.env.get('IP_HASH_SALT');

  if (!supabaseUrl || !serviceRoleKey || !ipHashSalt) {
    return json({ error: 'Server is not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const cleanedDescription = clean(payload!.description!);
  const clientIp = getClientIp(request);
  const ipHash = await sha256(`${ipHashSalt}:${clientIp}`);
  const rateLimitMax = Number(Deno.env.get('RATE_LIMIT_MAX') ?? 3);
  const rateLimitWindowMinutes = Number(Deno.env.get('RATE_LIMIT_WINDOW_MINUTES') ?? 10);
  const duplicateWindowDays = Number(Deno.env.get('DUPLICATE_WINDOW_DAYS') ?? 90);
  const duplicateThreshold = Number(Deno.env.get('DUPLICATE_THRESHOLD') ?? 0.85);
  const rateLimitSince = new Date(Date.now() - rateLimitWindowMinutes * 60 * 1000).toISOString();
  const duplicateSince = new Date(Date.now() - duplicateWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const { count: recentCount, error: rateLimitError } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', rateLimitSince);

  if (rateLimitError) {
    return json({ error: rateLimitError.message }, 500);
  }

  const rateLimited = (recentCount ?? 0) >= rateLimitMax;
  let duplicate: { id: string; score: number } | null = null;

  if (!rateLimited) {
    const { data: similar, error: duplicateError } = await supabase
      .rpc('find_similar_submission', {
        input_description: cleanedDescription,
        since: duplicateSince,
        threshold: duplicateThreshold,
      })
      .limit(1);

    if (duplicateError) {
      return json({ error: duplicateError.message }, 500);
    }

    duplicate = similar?.[0] ?? null;
  }

  const status = rateLimited ? 'spam' : duplicate ? 'duplicate' : 'pending';

  const { error } = await supabase.from('submissions').insert({
    profession: clean(payload!.profession!),
    email: optionalEmail(payload!.email),
    description: cleanedDescription,
    tools: optionalClean(payload!.tools),
    extra: optionalClean(payload!.extra),
    ip_hash: ipHash,
    user_agent: request.headers.get('user-agent'),
    status,
    duplicate_of: duplicate?.id ?? null,
    metadata: {
      duplicate_score: duplicate?.score ?? null,
      duplicate_threshold: duplicateThreshold,
      form_age_ms: ageMs,
      rate_limited: rateLimited,
      rate_limit_max: rateLimitMax,
      rate_limit_window_minutes: rateLimitWindowMinutes,
      source_origin: request.headers.get('origin'),
    },
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, status });
});

function validate(payload: Payload | null): string | null {
  if (!payload) {
    return 'Invalid payload';
  }

  if (!payload.profession || clean(payload.profession).length < 2) {
    return 'Profession is required';
  }

  if (payload.email && !isValidEmail(payload.email)) {
    return 'Email is invalid';
  }

  const descriptionLength = clean(payload.description ?? '').length;
  if (descriptionLength < 20 || descriptionLength > 4000) {
    return 'Description length is invalid';
  }

  return null;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function optionalClean(value?: string): string | null {
  const cleaned = clean(value ?? '');
  return cleaned.length > 0 ? cleaned : null;
}

function optionalEmail(value?: string): string | null {
  const cleaned = clean(value ?? '').toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

function isValidEmail(value: string): boolean {
  const cleaned = clean(value);
  return cleaned.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned);
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
