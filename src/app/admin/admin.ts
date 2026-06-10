import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';

import { Submission, SubmissionStatus, SubmissionsService } from '../core/submissions.service';

@Component({
  selector: 'app-admin',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly submissionsService = inject(SubmissionsService);
  private channel: RealtimeChannel | null = null;

  protected readonly isConfigured = this.submissionsService.configured;
  protected readonly userEmail = signal<string | null>(null);
  protected readonly submissions = signal<Submission[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draftStatuses = signal<Record<string, SubmissionStatus>>({});
  protected readonly savingStatusIds = signal<Record<string, boolean>>({});
  protected readonly statuses: SubmissionStatus[] = ['pending', 'approved', 'spam', 'duplicate'];
  protected readonly statusFilter = signal<SubmissionStatus | 'all'>('all');
  protected readonly professionFilter = signal<string>('all');
  protected readonly technicalView = signal(false);

  protected readonly professions = computed(() => {
    const values = new Set(this.submissions().map((submission) => submission.profession));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'es'));
  });

  protected readonly filteredSubmissions = computed(() => {
    const status = this.statusFilter();
    const profession = this.professionFilter();

    return this.submissions().filter((submission) => {
      const matchesStatus = status === 'all' || submission.status === status;
      const matchesProfession = profession === 'all' || submission.profession === profession;
      return matchesStatus && matchesProfession;
    });
  });

  async ngOnInit(): Promise<void> {
    const email = await this.submissionsService.getCurrentUserEmail();
    this.userEmail.set(email);

    await this.loadSubmissions();
    this.channel = this.submissionsService.subscribeToNewSubmissions(() => {
      void this.loadSubmissions();
    });
  }

  ngOnDestroy(): void {
    this.submissionsService.removeChannel(this.channel);
  }

  protected async logout(): Promise<void> {
    await this.submissionsService.signOut();
    this.userEmail.set(null);
    this.submissions.set([]);
    this.submissionsService.removeChannel(this.channel);
    this.channel = null;
    await this.router.navigateByUrl('/admin/login');
  }

  protected setStatusFilter(value: SubmissionStatus | 'all'): void {
    this.statusFilter.set(value);
  }

  protected setProfessionFilter(value: string): void {
    this.professionFilter.set(value);
  }

  protected selectedStatus(submission: Submission): SubmissionStatus {
    return this.draftStatuses()[submission.id] ?? submission.status;
  }

  protected hasStatusChange(submission: Submission): boolean {
    return this.selectedStatus(submission) !== submission.status;
  }

  protected isSavingStatus(submission: Submission): boolean {
    return this.savingStatusIds()[submission.id] ?? false;
  }

  protected setDraftStatus(submission: Submission, status: SubmissionStatus): void {
    this.draftStatuses.update((drafts) => {
      const next = { ...drafts };

      if (status === submission.status) {
        delete next[submission.id];
      } else {
        next[submission.id] = status;
      }

      return next;
    });
  }

  protected async saveStatus(submission: Submission): Promise<void> {
    const status = this.selectedStatus(submission);

    if (status === submission.status || this.isSavingStatus(submission)) {
      return;
    }

    this.savingStatusIds.update((ids) => ({ ...ids, [submission.id]: true }));

    try {
      await this.submissionsService.updateStatus(submission.id, status);
      this.submissions.update((items) => items.map((item) => (item.id === submission.id ? { ...item, status } : item)));
      this.draftStatuses.update((drafts) => {
        const next = { ...drafts };
        delete next[submission.id];
        return next;
      });
    } catch {
      this.error.set('No se pudo actualizar el estado.');
    } finally {
      this.savingStatusIds.update((ids) => {
        const next = { ...ids };
        delete next[submission.id];
        return next;
      });
    }
  }

  protected trackById(_: number, submission: Submission): string {
    return submission.id;
  }

  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat('es', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private async loadSubmissions(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      this.submissions.set(await this.submissionsService.listSubmissions());
      this.draftStatuses.set({});
    } catch {
      this.error.set('No se pudieron cargar los envíos.');
    } finally {
      this.loading.set(false);
    }
  }
}
