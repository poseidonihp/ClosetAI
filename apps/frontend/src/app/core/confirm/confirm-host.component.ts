import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, TriangleAlert, CircleQuestionMark } from 'lucide-angular';
import { ConfirmService } from './confirm.service';

/** Render del diálogo de confirmación. Se monta una sola vez en la raíz. */
@Component({
  selector: 'app-confirm-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  templateUrl: './confirm-host.component.html',
  styleUrl: './confirm-host.component.scss',
})
export class ConfirmHostComponent {
  protected readonly confirm = inject(ConfirmService);
  protected readonly iconDanger = TriangleAlert;
  protected readonly iconAsk = CircleQuestionMark;

  private readonly _confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  /**
   * Al abrirse el diálogo mueve el foco al botón de confirmación.
   * @constructor
   */
  constructor() {
    effect(() => {
      if (this.confirm.request()) {
        queueMicrotask(() => this._confirmButton()?.nativeElement.focus());
      }
    });
  }

  /**
   * Cierra el diálogo con Escape tratándolo como cancelación.
   * @returns {void}
   */
  protected onEscape(): void {
    if (this.confirm.request()) {
      this.confirm.resolve(false);
    }
  }
}
