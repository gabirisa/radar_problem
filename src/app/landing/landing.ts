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
  private hasStartedProblem = false;
  protected readonly maxProblems = 5;

  protected readonly professions = [
    'Administración',
    'Marketing',
    'Ventas',
    'Diseño / creativo en empresa',
    'Freelance creativo / artista',
    'Desarrollo / IT en empresa',
    'Freelance IT / técnico',
    'Operaciones',
    'Finanzas',
    'Recursos humanos',
    'Atención al cliente',
    'Legal / abogacía',
    'Educación',
    'Sanidad',
    'Hosteleria',
    'Comercio / tienda propia',
    'Logística',
    'Oficios / servicios técnicos',
    'Construcción / reformas',
    'Arquitectura / interiorismo',
    'Inmobiliaria',
    'Consultoria',
    'Dirección / gerencia',
    'Crianza y cuidados',
    'Gestión del hogar',
    'Estudios / oposiciones',
    'Otro',
  ];

  protected readonly stats = signal<LandingStats>({ problemCount: 47, professionCount: 14 });
  protected readonly loading = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submittedCount = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly isConfigured = this.submissions.configured;
  protected readonly isOtherProfession = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    profession: ['', Validators.required],
    otherProfession: [''],
    email: ['', Validators.email],
    problems: this.fb.nonNullable.array([this.createProblemGroup()]),
    website: [''],
    renderedAt: [Date.now()],
  });

  protected get problemControls() {
    return this.form.controls.problems.controls;
  }

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
    this.submittedCount.set(0);

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
        profession,
        email: rawValue.email,
        problems: rawValue.problems,
        website: rawValue.website,
        renderedAt: rawValue.renderedAt,
      });
      this.submitted.set(true);
      this.track('problem_submitted');
      const submittedCount = rawValue.problems.length;
      this.submittedCount.set(submittedCount);

      while (this.form.controls.problems.length > 1) {
        this.form.controls.problems.removeAt(this.form.controls.problems.length - 1);
      }

      this.form.reset({
        profession: '',
        otherProfession: '',
        email: '',
        website: '',
        renderedAt: Date.now(),
      });
      this.form.controls.problems.at(0).reset({
        description: '',
        tools: '',
        extra: '',
      });
      if (this.isConfigured) {
        this.stats.set(await this.submissions.getStats());
      } else {
        this.stats.update((current) => ({
          problemCount: current.problemCount + submittedCount,
          professionCount: current.professionCount,
        }));
      }
    } catch {
      this.track('problem_submit_error');
      this.error.set('No hemos podido guardar tu problema. Prueba de nuevo en un momento.');
    } finally {
      this.loading.set(false);
    }
  }

  protected showError(controlName: 'profession' | 'otherProfession' | 'email'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }

  protected showProblemError(index: number, controlName: 'description'): boolean {
    const control = this.form.controls.problems.at(index).controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }

  protected descriptionLength(index: number): number {
    return this.form.controls.problems.at(index).controls.description.value.length;
  }

  protected onProblemInput(): void {
    if (this.hasStartedProblem) {
      return;
    }

    this.hasStartedProblem = true;
    this.track('problem_started');
  }

  protected addProblem(): void {
    if (this.form.controls.problems.length >= this.maxProblems) {
      return;
    }

    this.form.controls.problems.push(this.createProblemGroup());
  }

  protected removeProblem(index: number): void {
    if (index === 0 || this.form.controls.problems.length === 1) {
      return;
    }

    this.form.controls.problems.removeAt(index);
  }

  protected returnToStart(): void {
    this.submitted.set(false);
    this.submittedCount.set(0);
    this.form.controls.renderedAt.setValue(Date.now());
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  private createProblemGroup() {
    return this.fb.nonNullable.group({
      description: ['', [Validators.required, Validators.minLength(20)]],
      tools: [''],
      extra: [''],
    });
  }

  private track(eventName: string): void {
    const plausible = (window as { plausible?: (eventName: string, options?: { interactive?: boolean }) => void })
      .plausible;
    plausible?.(eventName, { interactive: false });
  }
}
