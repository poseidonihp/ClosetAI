import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, Loader, type LogIn } from 'lucide-angular';

/**
 * Botón de envío con estado de carga: spinner + `loadingLabel` mientras `loading`.
 * Dentro de un <form> usa `type="submit"` (por defecto) para disparar `ngSubmit`.
 * En un footer fuera del form usa `type="button"` + `(clicked)`.
 */
@Component({
  selector: 'closet-submit-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: { style: 'display: contents' },
  template: `
    <button
      [type]="type()"
      class="pill pill-solid"
      [class]="extraClass()"
      [attr.data-test]="dataTest()"
      [disabled]="loading() || disabled()"
      (click)="clicked.emit()"
    >
      @if (loading()) {
        <lucide-icon [name]="iconLoader" class="h-4 w-4 animate-spin" aria-hidden="true" />
      } @else if (icon(); as buttonIcon) {
        <lucide-icon [name]="buttonIcon" class="h-4 w-4" aria-hidden="true" />
      }
      <span>{{ loading() ? (loadingLabel() ?? label()) : label() }}</span>
    </button>
  `,
})
export class SubmitButtonComponent {
  protected readonly iconLoader = Loader;

  readonly label = input.required<string>();
  readonly loadingLabel = input<string>();
  readonly loading = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly icon = input<typeof LogIn>();
  readonly type = input<'submit' | 'button'>('submit');
  readonly dataTest = input<string>();
  /** Clases extra para el botón (p. ej. `mt-2 justify-center`). */
  readonly extraClass = input<string>('');

  readonly clicked = output();
}
