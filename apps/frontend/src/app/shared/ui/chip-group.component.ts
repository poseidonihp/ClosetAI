import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface IChipOption {
  value: string;
  label: string;
  /** Hex de muestra: si viene, el chip pinta un punto de color a la izquierda. */
  swatch?: string;
}

/**
 * Grupo de chips seleccionables. En modo `multi` alterna valores; en modo simple
 * el mismo valor vuelve a deseleccionarse, lo que equivale a "sin filtro".
 */
@Component({
  selector: 'closet-chip-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
  template: `
    <div class="chip-row" role="group" [attr.aria-label]="label()">
      @for (option of options(); track option.value) {
        <button
          type="button"
          class="chip"
          [class.chip-on]="isSelected(option.value)"
          [attr.aria-pressed]="isSelected(option.value)"
          [attr.data-test]="dataTest() + '-' + option.value.toLowerCase()"
          (click)="toggle(option.value)"
        >
          @if (option.swatch; as swatch) {
            <span class="chip-dot" [style.background]="swatch" aria-hidden="true"></span>
          }
          <span>{{ option.label }}</span>
        </button>
      }
    </div>
  `,
  styles: [
    `
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        border-radius: 999px;
        border: 1px solid var(--qp-line-strong);
        background: transparent;
        color: var(--qp-ink-soft);
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
        transition:
          background 120ms ease,
          color 120ms ease,
          border-color 120ms ease;
      }
      .chip:hover {
        background: var(--qp-bg-soft);
      }
      .chip-on {
        background: var(--qp-ink);
        border-color: var(--qp-ink);
        color: var(--qp-bg);
      }
      .chip-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        border: 1px solid var(--qp-line-strong);
        flex: none;
      }
    `,
  ],
})
export class ChipGroupComponent {
  readonly options = input.required<readonly IChipOption[]>();
  readonly selected = input<readonly string[]>([]);
  readonly multi = input<boolean>(true);
  readonly label = input<string>('');
  readonly dataTest = input<string>('action-chip');

  readonly changed = output<string[]>();

  /**
   * Indica si un valor está seleccionado.
   * @param {string} value - Valor del chip.
   * @returns {boolean}
   */
  protected isSelected(value: string): boolean {
    return this.selected().includes(value);
  }

  /**
   * Alterna un chip y emite la selección resultante.
   * @param {string} value - Valor del chip pulsado.
   * @returns {void}
   */
  protected toggle(value: string): void {
    if (!this.multi()) {
      this.changed.emit(this.isSelected(value) ? [] : [value]);
      return;
    }
    const current = this.selected();
    const next = current.includes(value)
      ? current.filter(item => item !== value)
      : [...current, value];
    this.changed.emit([...next]);
  }
}
