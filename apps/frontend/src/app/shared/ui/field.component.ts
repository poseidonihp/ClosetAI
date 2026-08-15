import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Campo de formulario reutilizable: label `.uplabel` + control proyectado + error.
 * El control nativo se proyecta tal cual y conserva su `formControlName` y su
 * clase (`.field-input` / `.field-select` / `.field-textarea`).
 * Pasa `controlId` con el mismo valor que el `id` del control para que el
 * `<label>` quede asociado por `for` (accesibilidad).
 */
@Component({
  selector: 'closet-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
  template: `
    <label class="field" [attr.for]="controlId()">
      <span class="uplabel">{{ label() }}</span>
      <ng-content />
      @if (error(); as message) {
        <span class="mt-1 text-xs" style="color: var(--qp-clay)">{{ message }}</span>
      }
    </label>
  `,
})
export class FieldComponent {
  readonly label = input.required<string>();
  readonly error = input<string | null>(null);
  readonly controlId = input<string>();
}
