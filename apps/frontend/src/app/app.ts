import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationHostComponent } from './core/notifications/notification-host.component';
import { ConfirmHostComponent } from './core/confirm/confirm-host.component';
import { ThemeService } from './core/theme/theme.service';
import { SessionIdleService } from './core/auth/session-idle.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NotificationHostComponent, ConfirmHostComponent],
  template: `
    <router-outlet />
    <app-notification-host />
    <app-confirm-host />
  `,
})
export class App {
  /**
   * Instancia en el arranque el tema (para que `.dark` se aplique en cualquier ruta,
   * incluidas login y registro) y el vigilante de inactividad de la sesión.
   * @constructor
   */
  constructor() {
    inject(ThemeService);
    inject(SessionIdleService);
  }
}
