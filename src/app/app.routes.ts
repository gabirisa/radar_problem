import { Routes } from '@angular/router';

import { adminGuard } from './core/admin.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/landing').then((m) => m.Landing),
  },
  {
    path: 'admin/login',
    loadComponent: () => import('./admin-login/admin-login').then((m) => m.AdminLogin),
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/admin').then((m) => m.Admin),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
