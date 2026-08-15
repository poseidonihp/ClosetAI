import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule, Inbox } from 'lucide-angular';

/**
 * Estado vacío reutilizable: icono + título + descripción + CTA proyectada.
 */
@Component({
  selector: 'closet-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="empty">
      <div class="empty-icon">
        <lucide-icon [name]="icon()" class="h-7 w-7" aria-hidden="true" />
      </div>
      <p class="empty-title serif">{{ title() }}</p>
      @if (description()) {
        <p class="empty-desc">{{ description() }}</p>
      }
      <div class="empty-cta">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly icon = input<typeof Inbox>(Inbox);
}
