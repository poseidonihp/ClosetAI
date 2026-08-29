import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationHostComponent } from './core/notifications/notification-host.component';
import { ConfirmHostComponent } from './core/confirm/confirm-host.component';
import { UpdateBannerComponent } from './core/pwa/update-banner.component';
import { PwaService } from './core/pwa/pwa.service';
import { ThemeService } from './core/theme/theme.service';
import { SessionIdleService } from './core/auth/session-idle.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NotificationHostComponent, ConfirmHostComponent, UpdateBannerComponent],
  template: `
    <router-outlet />
    <app-notification-host />
    <app-confirm-host />
    <app-update-banner />
  `,
})
export class App {
  /**
   * Instancia en el arranque el tema (para que `.dark` se aplique en cualquier ruta,
   * incluidas login y registro), el vigilante de inactividad de la sesión y el
   * servicio de PWA, que tiene que estar escuchando antes de que el navegador
   * ofrezca instalar: ese evento se dispara una sola vez.
   * @constructor
   */
  constructor() {
    inject(ThemeService);
    inject(SessionIdleService);
    inject(PwaService);
  }
}
