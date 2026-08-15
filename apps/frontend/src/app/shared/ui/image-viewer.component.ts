import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { LucideAngularModule, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-angular';

export interface IViewerImage {
  url: string;
  alt?: string;
}

const minZoom = 0.25;
const maxZoom = 5;
const zoomStep = 0.25;
const percentBase = 100;

/**
 * Visor de imágenes a pantalla completa con zoom y navegación por teclado.
 * Se usará para ver las fotos reales de una prenda o de un look.
 */
@Component({
  selector: 'closet-image-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './image-viewer.component.html',
  styleUrl: './image-viewer.component.scss',
})
export class ImageViewerComponent {
  protected readonly iconClose = X;
  protected readonly iconPrev = ChevronLeft;
  protected readonly iconNext = ChevronRight;
  protected readonly iconZoomIn = ZoomIn;
  protected readonly iconZoomOut = ZoomOut;

  readonly images = input.required<IViewerImage[]>();
  readonly startIndex = input<number>(0);
  /** Mensaje cuando no hay ninguna imagen que mostrar. */
  readonly emptyLabel = input<string>('');
  readonly dismissed = output();

  protected readonly index = signal(0);
  protected readonly zoom = signal(1);
  protected readonly current = computed<IViewerImage | undefined>(
    () => this.images()[this.index()],
  );
  protected readonly zoomLabel = computed(() => `${Math.round(this.zoom() * percentBase)}%`);

  /**
   * Reposiciona el índice y resetea el zoom cuando cambia el juego de imágenes.
   * @constructor
   */
  constructor() {
    effect(() => {
      this.images();
      untracked(() => {
        this.index.set(this._clampIndex(this.startIndex()));
        this.zoom.set(1);
      });
    });
  }

  /**
   * Va a la imagen anterior, con vuelta al final.
   * @returns {void}
   */
  protected prev(): void {
    const total = this.images().length;
    if (total === 0) {
      return;
    }
    this.zoom.set(1);
    this.index.update(current => (current - 1 + total) % total);
  }

  /**
   * Va a la imagen siguiente, con vuelta al principio.
   * @returns {void}
   */
  protected next(): void {
    const total = this.images().length;
    if (total === 0) {
      return;
    }
    this.zoom.set(1);
    this.index.update(current => (current + 1) % total);
  }

  /**
   * Aumenta el zoom un paso.
   * @returns {void}
   */
  protected zoomIn(): void {
    this.zoom.update(current => Math.min(current + zoomStep, maxZoom));
  }

  /**
   * Reduce el zoom un paso.
   * @returns {void}
   */
  protected zoomOut(): void {
    this.zoom.update(current => Math.max(current - zoomStep, minZoom));
  }

  /**
   * Zoom con la rueda mientras se mantiene Ctrl o Cmd.
   * @param {WheelEvent} event - Evento de rueda.
   * @returns {void}
   */
  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    if (event.deltaY < 0) {
      this.zoomIn();
    } else {
      this.zoomOut();
    }
  }

  /** Atajos de teclado como tabla, no como cadena de `if`. */
  private readonly _keyActions = new Map<string, () => void>([
    ['Escape', (): void => this.dismissed.emit()],
    ['ArrowLeft', (): void => this.prev()],
    ['ArrowRight', (): void => this.next()],
    ['+', (): void => this.zoomIn()],
    ['=', (): void => this.zoomIn()],
    ['-', (): void => this.zoomOut()],
  ]);

  /**
   * Ejecuta el atajo de teclado correspondiente, si existe.
   * @param {KeyboardEvent} event - Evento de teclado.
   * @returns {void}
   */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    this._keyActions.get(event.key)?.();
  }

  /**
   * Acota un índice al rango válido de imágenes.
   * @private
   * @param {number} candidate - Índice propuesto.
   * @returns {number}
   */
  private _clampIndex(candidate: number): number {
    const total = this.images().length;
    if (total === 0) {
      return 0;
    }
    return Math.min(Math.max(candidate, 0), total - 1);
  }
}
