import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  LucideAngularModule,
  CircleCheck,
  CircleAlert,
  Info,
  TriangleAlert,
  X,
} from 'lucide-angular';
import { NotificationService, type NotificationKind } from './notification.service';

const iconByKind: Record<NotificationKind, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};

/** Render de los toasts. Se monta una sola vez en la raíz de la app. */
@Component({
  selector: 'app-notification-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './notification-host.component.html',
  styleUrl: './notification-host.component.scss',
})
export class NotificationHostComponent {
  protected readonly notifications = inject(NotificationService);
  protected readonly iconClose = X;

  /**
   * Devuelve el icono correspondiente al tipo de notificación.
   * @param {NotificationKind} kind - Tipo de notificación.
   * @returns {typeof Info}
   */
  protected icon(kind: NotificationKind): typeof Info {
    return iconByKind[kind];
  }
}
