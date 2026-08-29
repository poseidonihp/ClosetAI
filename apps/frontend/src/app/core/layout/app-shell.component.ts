import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  LucideAngularModule,
  Bookmark,
  LogOut,
  Menu,
  Moon,
  Shirt,
  ShoppingBag,
  Sparkles,
  Sun,
  UserRound,
  type Shirt as LucideIcon,
} from 'lucide-angular';

import { AuthStore } from '../auth/auth.store';
import { ConfirmService } from '../confirm/confirm.service';
import { LayoutService } from './layout.service';
import { ThemeService } from '../theme/theme.service';
import { BrandMarkComponent } from '../../shared/ui/brand-mark.component';
import { InstallButtonComponent } from '../pwa/install-button.component';

export interface INavItem {
  label: string;
  route: string;
  icon: typeof LucideIcon;
}

/**
 * Shell responsive: barra lateral fija en escritorio, cajón colapsable en tablet
 * y navegación inferior de cuatro destinos en móvil. La estructura la decide
 * `LayoutService`; el estilo, el CSS.
 * @class
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    BrandMarkComponent,
    InstallButtonComponent,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly layout = inject(LayoutService);
  private readonly _auth = inject(AuthStore);
  private readonly _confirm = inject(ConfirmService);
  private readonly _router = inject(Router);

  protected readonly iconSun = Sun;
  protected readonly iconMoon = Moon;
  protected readonly iconLogout = LogOut;
  protected readonly iconMenu = Menu;

  /** Estado del cajón lateral en tablet. En escritorio la barra es fija. */
  protected readonly sidebarOpen = signal(false);

  protected readonly user = this._auth.user;
  protected readonly initial = computed(() => {
    const user = this._auth.user();
    if (!user) {
      return 'C';
    }
    return (user.displayName || user.email).charAt(0).toUpperCase();
  });

  /** Los destinos del producto; en móvil son la navegación inferior. */
  protected readonly nav: readonly INavItem[] = [
    { label: 'Clóset', route: '/closet', icon: Shirt },
    { label: 'Looks', route: '/looks', icon: Sparkles },
    { label: 'Guardados', route: '/guardados', icon: Bookmark },
    { label: 'Comprar', route: '/comprar', icon: ShoppingBag },
    { label: 'Perfil', route: '/perfil', icon: UserRound },
  ];

  /**
   * Cierra el cajón al pasar a un ancho donde deja de tener sentido.
   * @constructor
   */
  constructor() {
    effect(() => {
      if (!this.layout.isSidebarCollapsible()) {
        this.sidebarOpen.set(false);
      }
    });
  }

  /**
   * Abre o cierra el cajón lateral.
   * @returns {void}
   */
  protected toggleSidebar(): void {
    this.sidebarOpen.update(open => !open);
  }

  /**
   * Cierra el cajón lateral.
   * @returns {void}
   */
  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  /**
   * Pide confirmación y cierra la sesión.
   * @returns {Promise<void>}
   */
  protected async logout(): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Cerrar sesión',
      message: '¿Quieres salir de tu cuenta?',
      confirmLabel: 'Salir',
    });
    if (!confirmed) {
      return;
    }
    await this._auth.logout();
    await this._router.navigateByUrl('/login');
  }
}
