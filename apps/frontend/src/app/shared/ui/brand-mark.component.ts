import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Logotipo de closetAI: percha + wordmark opcional. */
@Component({
  selector: 'closet-brand-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: inline-flex; align-items: center; gap: 10px' },
  template: `
    <svg viewBox="0 0 32 32" class="brand-glyph" role="img" aria-label="closetAI" focusable="false">
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <g
        fill="none"
        stroke="var(--qp-bg)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M16 9.5a2.2 2.2 0 1 1 2.2 2.2c-1.2 0-2.2.7-2.2 1.9" />
        <path d="M16 14.2 6.5 20.4c-.8.5-.5 1.8.5 1.8h18c1 0 1.3-1.3.5-1.8L16 14.2Z" />
      </g>
    </svg>
    @if (showWordmark()) {
      <span class="brand-word serif">closetAI</span>
    }
  `,
  styles: [
    `
      .brand-glyph {
        width: 32px;
        height: 32px;
        color: var(--qp-ink);
        flex: none;
      }
      .brand-word {
        font-size: 21px;
        line-height: 1;
        color: var(--qp-ink);
      }
    `,
  ],
})
export class BrandMarkComponent {
  readonly showWordmark = input<boolean>(true);
}
