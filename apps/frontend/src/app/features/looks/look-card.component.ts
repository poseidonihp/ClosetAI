import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  OutfitRejectedReasonEnum,
  enumLabels,
  formalityLabel,
  maxOutfitRating,
  minOutfitRating,
  type Look,
  type LookItem,
  type LookScoreLine,
  type Outfit,
  type OutfitRejectedReason,
  type OutfitRender,
} from '@closetai/shared-types';
import { LayoutService } from '../../core/layout/layout.service';
import { ImageViewerComponent, type IViewerImage } from '../../shared/ui/image-viewer.component';
import { LookSectionComponent } from './look-section.component';

const percentBase = 100;
/** Texto alternativo del render. Dice qué es antes de que se vea qué es. */
const renderViewerAlt = 'Visual del look generado por IA';

/**
 * La ficha del look: el objetivo visual de [examplepng.png](../../../../../../examplepng.png),
 * armada con prendas reales de la base de datos.
 * @class
 */
@Component({
  selector: 'closet-look-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImageViewerComponent, LookSectionComponent],
  host: { style: 'display: block' },
  templateUrl: './look-card.component.html',
  styleUrl: './look-card.component.scss',
})
export class LookCardComponent {
  readonly look = input.required<Look>();
  /** Posición dentro de la tanda, para rotular "LOOK 1", "LOOK 2"… */
  readonly index = input<number>(0);
  /** Altura declarada en el perfil. Sin ella, el bloque de ajuste no la menciona. */
  readonly heightCm = input<number | null>(null);
  /**
   * El look guardado, si viene del estilista. Null en la ficha determinista, que no
   * tiene narrativa ni estado que guardar.
   */
  readonly outfit = input<Outfit | null>(null);
  /** True mientras hay una acción en vuelo, para no mandar dos veces lo mismo. */
  readonly busy = input<boolean>(false);
  /**
   * True mientras se está generando el render. Va aparte de `busy` porque tarda
   * mucho más que valorar un look y el botón tiene que decirlo.
   */
  readonly renderPending = input<boolean>(false);

  readonly favoriteToggled = output<boolean>();
  readonly wornMarked = output();
  readonly rated = output<number>();
  readonly rejected = output<OutfitRejectedReason>();
  readonly deleted = output();
  readonly renderRequested = output();
  readonly renderDeleted = output<string>();

  protected readonly labels = enumLabels;
  protected readonly formalityLabel = formalityLabel;
  protected readonly layout = inject(LayoutService);
  protected readonly rejectedReasons = OutfitRejectedReasonEnum.options;
  protected readonly ratingStars = Array.from(
    { length: maxOutfitRating - minOutfitRating + 1 },
    (_unused, offset) => minOutfitRating + offset,
  );

  protected readonly viewerImages = signal<IViewerImage[] | null>(null);
  protected readonly viewerIndex = signal<number>(0);
  /** True cuando el usuario abrió el selector de motivo del rechazo. */
  protected readonly choosingReason = signal(false);
  protected readonly chosenReason = signal<OutfitRejectedReason>('COLOR');

  /** Marcas de referencia sólo si el estilista propuso alguna. */
  protected readonly hasReferenceBrands = computed(() => {
    const brands = this.outfit()?.referenceBrands;
    return brands !== undefined && brands.luxury.length + brands.affordable.length > 0;
  });

  /** Fotos reales de las prendas del look, para el visor a pantalla completa. */
  protected readonly photos = computed<IViewerImage[]>(() =>
    this.look()
      .items.filter(item => item.url !== null)
      .map(item => ({ url: item.url ?? '', alt: item.name })),
  );

  /** Renders del look, del más reciente al más antiguo. Vacío en la ficha del motor. */
  protected readonly renders = computed<OutfitRender[]>(() => this.outfit()?.renders ?? []);

  protected readonly heightHint = computed(() => {
    const height = this.heightCm();
    return height === null ? undefined : `Altura: ${height} cm`;
  });

  /**
   * Abre el visor en la foto de una prenda concreta.
   * @param {LookItem} item - Prenda cuya foto se quiere ver.
   * @returns {void}
   */
  protected openViewer(item: LookItem): void {
    const position = this.photos().findIndex(photo => photo.alt === item.name);
    this.viewerIndex.set(Math.max(position, 0));
    this.viewerImages.set(this.photos());
  }

  /**
   * Abre el visor en un render concreto.
   * @param {number} position - Posición del render en la lista.
   * @returns {void}
   */
  protected openRenderViewer(position: number): void {
    this.viewerIndex.set(position);
    this.viewerImages.set(
      this.renders().map(render => ({ url: render.url, alt: renderViewerAlt })),
    );
  }

  /**
   * Cierra el visor.
   * @returns {void}
   */
  protected closeViewer(): void {
    this.viewerImages.set(null);
  }

  /**
   * Ancho de la barra de una señal del desglose, en porcentaje.
   * @param {LookScoreLine} line - Línea del desglose.
   * @returns {string}
   */
  protected barWidth(line: LookScoreLine): string {
    return `${Math.round(line.score * percentBase)}%`;
  }

  /**
   * Texto del rango térmico del look, o null si sus prendas no lo declaran.
   * @returns {string | null}
   */
  protected weatherText(): string | null {
    const { weatherMinC, weatherMaxC } = this.look();
    if (weatherMinC === null && weatherMaxC === null) {
      return null;
    }
    if (weatherMinC !== null && weatherMaxC !== null) {
      return `${weatherMinC}–${weatherMaxC} °C`;
    }
    return weatherMinC === null ? `Hasta ${weatherMaxC} °C` : `Desde ${weatherMinC} °C`;
  }

  /**
   * Alterna el favorito del look guardado.
   * @returns {void}
   */
  protected toggleFavorite(): void {
    this.favoriteToggled.emit(!(this.outfit()?.isFavorite ?? false));
  }

  /**
   * Abre o cierra el selector de motivo del rechazo. Se pide el motivo antes de
   * mandar nada: un rechazo sin motivo no enseña nada al motor.
   * @returns {void}
   */
  protected toggleReasonPicker(): void {
    this.choosingReason.update(open => !open);
  }

  /**
   * Fija el motivo elegido en el selector.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onReason(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const reason = OutfitRejectedReasonEnum.options.find(option => option === value);
    if (reason) {
      this.chosenReason.set(reason);
    }
  }

  /**
   * Manda el rechazo con el motivo elegido y cierra el selector.
   * @returns {void}
   */
  protected confirmReject(): void {
    this.choosingReason.set(false);
    this.rejected.emit(this.chosenReason());
  }
}
