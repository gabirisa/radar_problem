import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { SubmissionsService } from '../core/submissions.service';

@Component({
  selector: 'app-admin-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-login.html',
  styleUrl: './admin-login.css',
})
export class AdminLogin implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly submissions = inject(SubmissionsService);

  protected readonly isConfigured = this.submissions.configured;
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async ngOnInit(): Promise<void> {
    if (await this.submissions.getCurrentUserEmail()) {
      await this.router.navigateByUrl('/admin');
    }
  }

  protected async login(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const { email, password } = this.form.getRawValue();
      await this.submissions.signIn(email, password);
      await this.router.navigateByUrl('/admin');
    } catch {
      this.error.set('No se pudo iniciar sesión. Revisa el email y la contraseña.');
    } finally {
      this.loading.set(false);
    }
  }
}
