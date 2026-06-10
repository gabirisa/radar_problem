import { Injectable } from '@angular/core';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../environments/environment';

export type SubmissionStatus = 'pending' | 'approved' | 'spam' | 'duplicate';

export interface ProblemEntryPayload {
  description: string;
  tools?: string | null;
  extra?: string | null;
}

export interface ProblemPayload {
  profession: string;
  email?: string | null;
  problems: ProblemEntryPayload[];
  website?: string | null;
  renderedAt?: number | null;
}

export interface LandingStats {
  problemCount: number;
  professionCount: number;
}

export interface Submission {
  id: string;
  created_at: string;
  profession: string;
  email: string | null;
  description: string;
  tools: string | null;
  extra: string | null;
  status: SubmissionStatus;
  ip_hash: string | null;
  user_agent: string | null;
  duplicate_of: string | null;
  metadata: Record<string, unknown>;
}

type StatsRow = {
  problem_count?: number | string | null;
  profession_count?: number | string | null;
};

@Injectable({ providedIn: 'root' })
export class SubmissionsService {
  readonly client: SupabaseClient | null = this.hasSupabaseConfig()
    ? createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
      })
    : null;

  get configured(): boolean {
    return this.client !== null;
  }

  async getStats(): Promise<LandingStats> {
    if (!this.client) {
      return { problemCount: 47, professionCount: 14 };
    }

    const { data, error } = await this.client.rpc('get_landing_stats').single<StatsRow>();

    if (error) {
      throw error;
    }

    return {
      problemCount: Number(data?.problem_count ?? 0),
      professionCount: Number(data?.profession_count ?? 0),
    };
  }

  async submitProblem(payload: ProblemPayload): Promise<void> {
    if (!this.client) {
      await this.saveLocalPreview(payload);
      return;
    }

    const { error } = await this.client.functions.invoke(environment.submitFunctionName, {
      body: payload,
    });

    if (error) {
      throw error;
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!this.client) {
      throw new Error('Configura Supabase antes de acceder al panel.');
    }

    const { error } = await this.client.auth.signInWithPassword({ email, password });

    if (error) {
      throw error;
    }
  }

  async signOut(): Promise<void> {
    await this.client?.auth.signOut();
  }

  async getCurrentUserEmail(): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    const { data } = await this.client.auth.getUser();
    return data.user?.email ?? null;
  }

  async listSubmissions(): Promise<Submission[]> {
    if (!this.client) {
      return this.getLocalPreviewSubmissions();
    }

    const { data, error } = await this.client
      .from('submissions')
      .select(
        'id, created_at, profession, email, description, tools, extra, status, ip_hash, user_agent, duplicate_of, metadata',
      )
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  async updateStatus(id: string, status: SubmissionStatus): Promise<void> {
    if (!this.client) {
      return;
    }

    const { error } = await this.client
      .from('submissions')
      .update({ status })
      .eq('id', id)
      .select('id')
      .single();

    if (error) {
      throw error;
    }
  }

  subscribeToNewSubmissions(onInsert: () => void): RealtimeChannel | null {
    if (!this.client) {
      return null;
    }

    return this.client
      .channel('admin-submissions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'submissions' },
        () => onInsert(),
      )
      .subscribe();
  }

  subscribeToLandingStats(onStats: (stats: LandingStats) => void): RealtimeChannel | null {
    if (!this.client) {
      return null;
    }

    return this.client
      .channel('landing-stats')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'landing_stats', filter: 'id=eq.1' },
        (payload) => {
          const next = payload.new as StatsRow | null;
          onStats({
            problemCount: Number(next?.problem_count ?? 0),
            professionCount: Number(next?.profession_count ?? 0),
          });
        },
      )
      .subscribe();
  }

  removeChannel(channel: RealtimeChannel | null): void {
    if (channel && this.client) {
      void this.client.removeChannel(channel);
    }
  }

  private hasSupabaseConfig(): boolean {
    return (
      environment.supabaseUrl.startsWith('https://') &&
      !environment.supabaseUrl.includes('YOUR_PROJECT_REF') &&
      environment.supabasePublishableKey.length > 30 &&
      !environment.supabasePublishableKey.includes('YOUR_SUPABASE')
    );
  }

  private async saveLocalPreview(payload: ProblemPayload): Promise<void> {
    const submissions = this.getLocalPreviewSubmissions();
    const now = new Date().toISOString();
    const next = payload.problems.map((problem): Submission => ({
      id: crypto.randomUUID(),
      created_at: now,
      profession: payload.profession,
      email: payload.email ?? null,
      description: problem.description,
      tools: problem.tools ?? null,
      extra: problem.extra ?? null,
      status: 'pending',
      ip_hash: null,
      user_agent: navigator.userAgent,
      duplicate_of: null,
      metadata: {},
    }));

    localStorage.setItem('fastidios-preview-submissions', JSON.stringify([...next, ...submissions].slice(0, 20)));
  }

  private getLocalPreviewSubmissions(): Submission[] {
    try {
      return JSON.parse(localStorage.getItem('fastidios-preview-submissions') ?? '[]') as Submission[];
    } catch {
      return [];
    }
  }
}
