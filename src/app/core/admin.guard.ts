import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SubmissionsService } from './submissions.service';

export const adminGuard: CanActivateFn = async () => {
  const submissions = inject(SubmissionsService);
  const router = inject(Router);

  if (!submissions.configured) {
    return true;
  }

  const email = await submissions.getCurrentUserEmail();
  return email ? true : router.createUrlTree(['/admin/login']);
};
