import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Sección de la ficha de look.
 *
 */
@Component({
  selector: 'closet-look-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
  template: `
    <details
      class="look-section"
      [class.look-section-static]="!collapsible()"
      [open]="!collapsible() || startOpen()"
    >
      <summary
        class="look-section-title"
        [attr.tabindex]="collapsible() ? null : -1"
        (click)="onSummaryClick($event)"
      >
        {{ title() }}
        @if (hint(); as text) {
          <span class="look-section-hint">{{ text }}</span>
        }
      </summary>
      <ng-content />
    </details>
  `,
  styleUrl: './look-section.component.scss',
})
export class LookSectionComponent {
  readonly title = input.required<string>();
  /** Texto pequeño a la derecha del título, como la altura en el bloque de ajuste. */
  readonly hint = input<string>();
  readonly collapsible = input<boolean>(false);
  readonly startOpen = input<boolean>(true);

  /**
   * Impide plegar la sección cuando no debe plegarse.
   * @param {Event} event - Evento `click` sobre el resumen.
   * @returns {void}
   */
  protected onSummaryClick(event: Event): void {
    if (!this.collapsible()) {
      event.preventDefault();
    }
  }
}
