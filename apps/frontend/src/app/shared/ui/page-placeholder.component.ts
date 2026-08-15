import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Inbox } from 'lucide-angular';
import { EmptyStateComponent } from './empty-state.component';

/**
 * Cabecera de página + estado vacío. Sostiene las secciones que todavía no tienen
 * contenido para que el shell sea verificable en ambos anchos desde la Fase 0.
 * Cada página la irá sustituyendo por su contenido real en su fase.
 */
@Component({
  selector: 'closet-page-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent],
  host: { style: 'display: flex; flex: 1; flex-direction: column' },
  template: `
    <header class="page-header">
      <div class="uplabel">{{ eyebrow() }}</div>
      <h1 class="serif page-title">{{ title() }}</h1>
    </header>
    <closet-empty-state [title]="emptyTitle()" [description]="description()" [icon]="icon()" />
  `,
  styles: [
    `
      .page-header {
        padding: 22px 24px 4px;
      }
      .page-title {
        font-size: 32px;
        line-height: 1.1;
        margin: 2px 0 0;
      }
      @media (max-width: 639px) {
        .page-header {
          padding: 16px 16px 0;
        }
        .page-title {
          font-size: 26px;
        }
      }
    `,
  ],
})
export class PagePlaceholderComponent {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly emptyTitle = input.required<string>();
  readonly description = input.required<string>();
  readonly icon = input<typeof Inbox>(Inbox);
}
