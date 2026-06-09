import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RealtimeChannel } from '@supabase/supabase-js';

import { LandingStats, SubmissionsService } from '../core/submissions.service';

@Component({
  selector: 'app-landing',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly submissions = inject(SubmissionsService);
  private readonly destroyRef = inject(DestroyRef);
  private statsChannel: RealtimeChannel | null = null;

  protected readonly professions = [
    'Marketing',
    'Administracion',
    'Diseno',
    'Ventas',
    'Operaciones',
    'Finanzas',
    'Recursos humanos',
    'Atencion al cliente',
    'Legal',
    'Otro',
  ];

  protected readonly stats = signal<LandingStats>({ problemCount: 47, professionCount: 14 });
  protected readonly loading = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isConfigured = this.submissions.configured;
  protected readonly isOtherProfession = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    profession: ['', Validators.required],
    otherProfession: [''],
    email: ['', Validators.email],
    description: ['', [Validators.required, Validators.minLength(20)]],
    tools: [''],
    extra: [''],
    website: [''],
    renderedAt: [Date.now()],
  });

  async ngOnInit(): Promise<void> {
    this.syncOtherProfessionValidators(this.form.controls.profession.value);
    this.form.controls.profession.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((profession) => {
      this.syncOtherProfessionValidators(profession);
    });

    try {
      this.stats.set(await this.submissions.getStats());
      this.statsChannel = this.submissions.subscribeToLandingStats((stats) => {
        this.stats.set(stats);
      });
    } catch {
      this.error.set('No se pudo cargar el contador. El formulario sigue disponible.');
    }
  }

  ngOnDestroy(): void {
    this.submissions.removeChannel(this.statsChannel);
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    this.submitted.set(false);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);

    try {
      const rawValue = this.form.getRawValue();
      const profession =
        rawValue.profession === 'Otro' ? rawValue.otherProfession.trim() : rawValue.profession;

      await this.submissions.submitProblem({
        ...rawValue,
        profession,
      });
      this.submitted.set(true);
      this.form.reset({
        profession: '',
        otherProfession: '',
        email: '',
        description: '',
        tools: '',
        extra: '',
        website: '',
        renderedAt: Date.now(),
      });
      if (this.isConfigured) {
        this.stats.set(await this.submissions.getStats());
      } else {
        this.stats.update((current) => ({
          problemCount: current.problemCount + 1,
          professionCount: current.professionCount,
        }));
      }
    } catch {
      this.error.set('No hemos podido guardar tu problema. Prueba de nuevo en un momento.');
    } finally {
      this.loading.set(false);
    }
  }

  protected showError(controlName: 'profession' | 'otherProfession' | 'email' | 'description'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }

  protected descriptionLength(): number {
    return this.form.controls.description.value.length;
  }

  private syncOtherProfessionValidators(profession: string): void {
    const otherProfession = this.form.controls.otherProfession;
    this.isOtherProfession.set(profession === 'Otro');

    if (profession === 'Otro') {
      otherProfession.setValidators([Validators.required, Validators.minLength(2)]);
    } else {
      otherProfession.clearValidators();
      otherProfession.setValue('', { emitEvent: false });
    }

    otherProfession.updateValueAndValidity({ emitEvent: false });
  }
}
