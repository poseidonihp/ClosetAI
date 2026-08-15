import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Banner de error reutilizable. No renderiza nada si `message` es falsy, así que
 * encapsula el `@if` del llamante.
 */
@Component({
  selector: 'closet-error-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.display]': "message() ? 'block' : 'none'",
  },
  template: `
    @if (message(); as text) {
      <div
        class="rounded-md px-3 py-2 text-xs"
        style="background: rgba(181,80,60,0.1); border: 1px solid rgba(181,80,60,0.3); color: var(--qp-clay);"
        role="alert"
      >
        {{ text }}
      </div>
    }
  `,
})
export class ErrorBannerComponent {
  readonly message = input<string | null>(null);
}
