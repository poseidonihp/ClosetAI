import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';

/**
 * Shell de diálogo reutilizable: panel con cabecera (título + cerrar) y pie.
 */
@Component({
  selector: 'closet-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: { style: 'display: contents' },
  template: `
    <div class="panel flex max-h-[90vh] flex-col overflow-hidden rounded-xl" [class]="widthClass()">
      <header
        class="flex items-center justify-between px-6 pb-4 pt-5"
        style="border-bottom: 1px solid var(--qp-line);"
      >
        <div>
          @if (subtitle()) {
            <div class="uplabel">{{ subtitle() }}</div>
          }
          <h2 class="serif text-[26px] leading-none">{{ title() }}</h2>
        </div>
        <button
          type="button"
          class="icon-btn"
          data-test="action-close-modal"
          aria-label="Cerrar"
          (click)="closed.emit()"
        >
          <lucide-icon [name]="iconClose" class="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <ng-content select="[dialog-body]" />

      <footer
        class="flex items-center justify-end gap-2 px-6 py-4"
        style="border-top: 1px solid var(--qp-line); background: var(--qp-bg-soft);"
      >
        <ng-content select="[dialog-footer]" />
      </footer>
    </div>
  `,
})
export class DialogComponent {
  protected readonly iconClose = X;

  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  /** Clases Tailwind para el ancho del panel. */
  readonly widthClass = input<string>('w-[min(880px,95vw)]');

  readonly closed = output();
}
