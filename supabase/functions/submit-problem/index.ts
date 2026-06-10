import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ProblemInput = {
  description?: string;
  tools?: string;
  extra?: string;
};

type Payload = {
  profession?: string;
  email?: string;
  problems?: ProblemInput[];
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
  const ipHashSalt = Deno.env.get('IP_HASH_SALT') ?? serviceRoleKey;

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server is not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const problems = getProblems(payload!).map((problem) => ({
    description: clean(problem.description!),
    tools: optionalClean(problem.tools),
    extra: optionalClean(problem.extra),
  }));
  const clientIp = getClientIp(request);
  const ipHash = await sha256(`${ipHashSalt}:${clientIp}`);
  const rateLimitMax = Number(Deno.env.get('RATE_LIMIT_MAX') ?? 3);
  const rateLimitWindowMinutes = Number(Deno.env.get('RATE_LIMIT_WINDOW_MINUTES') ?? 10);
  const duplicateWindowDays = Number(Deno.env.get('DUPLICATE_WINDOW_DAYS') ?? 90);
  const duplicateThreshold = Number(Deno.env.get('DUPLICATE_THRESHOLD') ?? 0.85);
  const rateLimitSince = new Date(Date.now() - rateLimitWindowMinutes * 60 * 1000).toISOString();
  const duplicateSince = new Date(Date.now() - duplicateWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentSubmissions, error: rateLimitError } = await supabase
    .from('submissions')
    .select('id')
    .eq('ip_hash', ipHash)
    .gte('created_at', rateLimitSince)
    .limit(rateLimitMax);

  if (rateLimitError) {
    return json({ stage: 'rate_limit', error: describeError(rateLimitError) }, 500);
  }

  const rateLimited = (recentSubmissions?.length ?? 0) >= rateLimitMax;
  const rows = [];

  for (let index = 0; index < problems.length; index += 1) {
    const problem = problems[index];
    let duplicate: { id: string; score: number } | null = null;

    if (!rateLimited) {
      const { data: similar, error: duplicateError } = await supabase
        .rpc('find_similar_submission', {
          input_description: problem.description,
          since: duplicateSince,
          threshold: duplicateThreshold,
        })
        .limit(1);

      if (duplicateError) {
        return json({ stage: 'duplicate_check', error: describeError(duplicateError) }, 500);
      }

      duplicate = similar?.[0] ?? null;
    }

    const status = rateLimited ? 'spam' : duplicate ? 'duplicate' : 'pending';

    rows.push({
      profession: clean(payload!.profession!),
      email: optionalEmail(payload!.email),
      description: problem.description,
      tools: problem.tools,
      extra: problem.extra,
      ip_hash: ipHash,
      user_agent: request.headers.get('user-agent'),
      status,
      duplicate_of: duplicate?.id ?? null,
      metadata: {
        duplicate_score: duplicate?.score ?? null,
        duplicate_threshold: duplicateThreshold,
        form_age_ms: ageMs,
        problem_index: index + 1,
        problem_count: problems.length,
        rate_limited: rateLimited,
        rate_limit_max: rateLimitMax,
        rate_limit_window_minutes: rateLimitWindowMinutes,
        source_origin: request.headers.get('origin'),
      },
    });
  }

  const { error } = await supabase.from('submissions').insert(rows);

  if (error) {
    return json({ stage: 'insert', error: describeError(error) }, 500);
  }

  return json({ ok: true, count: rows.length, statuses: rows.map((row) => row.status) });
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

  const problems = getProblems(payload);
  if (problems.length < 1 || problems.length > 5) {
    return 'Problem count is invalid';
  }

  for (const problem of problems) {
    const descriptionLength = clean(problem.description ?? '').length;
    if (descriptionLength < 20 || descriptionLength > 4000) {
      return 'Description length is invalid';
    }
  }

  return null;
}

function getProblems(payload: Payload): ProblemInput[] {
  if (Array.isArray(payload.problems)) {
    return payload.problems;
  }

  return [
    {
      description: payload.description,
      tools: payload.tools,
      extra: payload.extra,
    },
  ];
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

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = [record['message'], record['details'], record['hint'], record['code']]
      .filter((value) => typeof value === 'string' && value.length > 0);

    if (parts.length > 0) {
      return parts.join(' | ');
    }

    return JSON.stringify(record);
  }

  return String(error);
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
