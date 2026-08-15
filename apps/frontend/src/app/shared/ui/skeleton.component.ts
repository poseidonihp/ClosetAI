import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Placeholder con animación shimmer para estados de carga.
 * Uso: <closet-skeleton [rows]="8" height="44px" /> o <closet-skeleton width="40%" />.
 */
@Component({
  selector: 'closet-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sk-stack" aria-hidden="true">
      @for (line of lines(); track line) {
        <span
          class="sk-bar"
          [style.height]="height()"
          [style.width]="width()"
          [style.borderRadius]="radius()"
        ></span>
      }
    </div>
  `,
  styleUrl: './skeleton.component.scss',
})
export class SkeletonComponent {
  readonly rows = input(1);
  readonly height = input('14px');
  readonly width = input('100%');
  readonly radius = input('6px');

  protected readonly lines = computed(() =>
    Array.from({ length: this.rows() }, (_unused, index) => index),
  );
}
