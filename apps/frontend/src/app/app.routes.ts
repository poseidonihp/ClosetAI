import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'registro',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register.component').then(m => m.RegisterComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./core/layout/app-shell.component').then(m => m.AppShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'closet' },
      {
        path: 'closet',
        loadComponent: () => import('./features/closet/closet.page').then(m => m.ClosetPage),
      },
      {
        path: 'looks',
        loadComponent: () => import('./features/looks/looks.page').then(m => m.LooksPage),
      },
      {
        path: 'comprar',
        loadComponent: () => import('./features/shopping/shopping.page').then(m => m.ShoppingPage),
      },
      {
        path: 'perfil',
        loadComponent: () => import('./features/profile/profile.page').then(m => m.ProfilePage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
