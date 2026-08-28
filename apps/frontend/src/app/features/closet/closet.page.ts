import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Plus, Shirt } from 'lucide-angular';
import {
  ClimateEnum,
  ColorFamilyEnum,
  GarmentSlotEnum,
  GarmentStatusEnum,
  colorFamilyFromHex,
  colorFamilyLabels,
  colorFamilySwatches,
  enumLabels,
  formalityLabel,
  type Climate,
  type ColorFamily,
  type Garment,
  type GarmentSlot,
  type GarmentStatus,
} from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { LayoutService } from '../../core/layout/layout.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { ChipGroupComponent, type IChipOption } from '../../shared/ui/chip-group.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ClosetStore } from './closet.store';
import { hasActiveFilters, matchesFilters, type IClosetFilters } from './closet-filters';
import { GarmentDialogComponent } from './garment-dialog.component';
import { GarmentTypesStore } from './garment-types.store';
import { carriesFiles, imagesFrom } from './image-drop';

const skeletonCards = 8;
const anyValue = '';

/**
 * Página del clóset: rejilla responsive de prendas con filtros, alta manual y
 * subida de fotos.
 * @class
 */
@Component({
  selector: 'app-closet-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ChipGroupComponent,
    EmptyStateComponent,
    ErrorBannerComponent,
    GarmentDialogComponent,
    SkeletonComponent,
  ],
  host: {
    style: 'display: flex; flex: 1; flex-direction: column',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
    '(document:paste)': 'onPaste($event)',
  },
  templateUrl: './closet.page.html',
  styleUrl: './closet.page.scss',
})
export class ClosetPage implements OnInit {
  protected readonly iconShirt = Shirt;
  protected readonly iconPlus = Plus;
  protected readonly labels = enumLabels;
  protected readonly formalityLabel = formalityLabel;
  protected readonly skeletonCards = Array.from({ length: skeletonCards }, (_unused, i) => i);
  protected readonly anyValue = anyValue;

  protected readonly statusOptions = GarmentStatusEnum.options;
  protected readonly climateOptions = ClimateEnum.options;
  protected readonly slotChips: IChipOption[] = GarmentSlotEnum.options.map(slot => ({
    value: slot,
    label: enumLabels.garmentSlot[slot],
  }));
  protected readonly colorChips: IChipOption[] = ColorFamilyEnum.options.map(family => ({
    value: family,
    label: colorFamilyLabels[family],
    swatch: colorFamilySwatches[family],
  }));

  protected readonly layout = inject(LayoutService);
  private readonly _closet = inject(ClosetStore);
  private readonly _garmentTypes = inject(GarmentTypesStore);
  private readonly _confirm = inject(ConfirmService);
  private readonly _notifications = inject(NotificationService);

  protected readonly loading = this._closet.loading;
  protected readonly loadError = this._closet.error;
  protected readonly garments = this._closet.garments;

  protected readonly search = signal('');
  protected readonly slotFilter = signal<string[]>([]);
  protected readonly colorFilter = signal<ColorFamily | ''>('');
  protected readonly climateFilter = signal<Climate | ''>('');
  protected readonly statusFilter = signal<GarmentStatus | ''>('');

  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Garment | null>(null);
  protected readonly droppedFiles = signal<File[]>([]);
  protected readonly dragging = signal(false);

  /** Filtros agrupados tal como los espera el módulo de filtrado. */
  private readonly _filters = computed<IClosetFilters>(() => ({
    search: this.search(),
    slots: this.slotFilter(),
    colorFamily: this.colorFilter(),
    climate: this.climateFilter(),
    status: this.statusFilter(),
  }));

  /** Prendas que pasan todos los filtros activos. */
  protected readonly filtered = computed(() =>
    this.garments().filter(garment => matchesFilters(garment, this._filters())),
  );

  /** El grupo de chips trabaja con arrays; el filtro de color es de uno solo. */
  protected readonly colorSelection = computed(() => {
    const family = this.colorFilter();
    return family === '' ? [] : [family];
  });

  protected readonly hasFilters = computed(() => hasActiveFilters(this._filters()));

  /**
   * Carga el clóset y el catálogo de tipos.
   * @returns {void}
   */
  ngOnInit(): void {
    void this._garmentTypes.load();
    void this._closet.load();
  }

  /**
   * Abre el alta de prenda, opcionalmente con fotos ya elegidas.
   * @param {readonly File[]} [files=[]] - Fotos arrastradas o pegadas.
   * @returns {void}
   */
  protected openCreate(files: readonly File[] = []): void {
    this.editing.set(null);
    this.droppedFiles.set([...files]);
    this.dialogOpen.set(true);
  }

  /**
   * Abre la edición de una prenda existente.
   * @param {Garment} garment - Prenda a editar.
   * @returns {void}
   */
  protected openEdit(garment: Garment): void {
    this.editing.set(garment);
    this.droppedFiles.set([]);
    this.dialogOpen.set(true);
  }

  /**
   * Cierra el diálogo y suelta los archivos pendientes.
   * @returns {void}
   */
  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.editing.set(null);
    this.droppedFiles.set([]);
  }

  /**
   * Borra una prenda tras confirmarlo.
   * @param {Garment} garment - Prenda a borrar.
   * @returns {Promise<void>}
   */
  protected async remove(garment: Garment): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Borrar prenda',
      message: `Se borrarán "${garment.name}" y sus fotos. No se puede deshacer.`,
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this._closet.remove(garment.id);
      this._notifications.success('Prenda borrada');
    } catch (error) {
      this._notifications.error(ApiClient.messageFromError(error));
    }
  }

  /**
   * Limpia todos los filtros.
   * @returns {void}
   */
  protected clearFilters(): void {
    this.search.set('');
    this.slotFilter.set([]);
    this.colorFilter.set('');
    this.climateFilter.set('');
    this.statusFilter.set('');
  }

  /**
   * Actualiza el texto de búsqueda.
   * @param {Event} event - Evento `input` del buscador.
   * @returns {void}
   */
  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /**
   * Fija el filtro de color desde los chips (selección simple).
   * @param {string[]} values - Selección emitida por el grupo de chips.
   * @returns {void}
   */
  protected onColorChips(values: string[]): void {
    const [selected] = values;
    this.colorFilter.set(ColorFamilyEnum.options.find(family => family === selected) ?? '');
  }

  /**
   * Fija el filtro de clima a partir del select.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onClimateFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.climateFilter.set(ClimateEnum.options.find(climate => climate === value) ?? '');
  }

  /**
   * Fija el filtro de estado a partir del select.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onStatusFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.statusFilter.set(GarmentStatusEnum.options.find(status => status === value) ?? '');
  }

  /**
   * Marca la rejilla como zona de suelte mientras se arrastran archivos.
   * @param {DragEvent} event - Evento de arrastre.
   * @returns {void}
   */
  protected onDragOver(event: DragEvent): void {
    if (!this._acceptsDroppedImages(event)) {
      return;
    }
    event.preventDefault();
    this.dragging.set(true);
  }

  /**
   * Quita el resaltado al salir del área de suelte.
   * @param {DragEvent} event - Evento de arrastre.
   * @returns {void}
   */
  protected onDragLeave(event: DragEvent): void {
    if (event.relatedTarget === null) {
      this.dragging.set(false);
    }
  }

  /**
   * Abre el alta con las imágenes soltadas sobre la rejilla.
   * @param {DragEvent} event - Evento de suelte.
   * @returns {void}
   */
  protected onDrop(event: DragEvent): void {
    if (!this._acceptsDroppedImages(event)) {
      return;
    }
    event.preventDefault();
    this.dragging.set(false);
    const images = imagesFrom(Array.from(event.dataTransfer?.files ?? []));
    if (images.length > 0) {
      this.openCreate(images);
    }
  }

  /**
   * Abre el alta con las imágenes pegadas desde el portapapeles.
   * @param {ClipboardEvent} event - Evento de pegado.
   * @returns {void}
   */
  protected onPaste(event: ClipboardEvent): void {
    if (this.dialogOpen()) {
      return;
    }
    const images = imagesFrom(Array.from(event.clipboardData?.files ?? []));
    if (images.length > 0) {
      this.openCreate(images);
    }
  }

  /**
   * Indica si el arrastre trae archivos y si esta página es quien debe atenderlo.
   * El diálogo tiene su propia zona de suelte y se renderiza aquí dentro, así que
   * sin este corte una foto soltada sobre él se añadiría y además reabriría el
   * alta en blanco.
   * @private
   * @param {DragEvent} event - Evento de arrastre.
   * @returns {boolean}
   */
  private _acceptsDroppedImages(event: DragEvent): boolean {
    return !this.dialogOpen() && carriesFiles(Array.from(event.dataTransfer?.types ?? []));
  }

  /**
   * Portada de la prenda: la marcada como principal o, si no hay, la primera.
   * @param {Garment} garment - Prenda de la rejilla.
   * @returns {string | null}
   */
  protected coverUrl(garment: Garment): string | null {
    const cover = garment.photos.find(photo => photo.isPrimary) ?? garment.photos[0];
    return cover?.thumbUrl ?? null;
  }

  /**
   * Indica si el tipo y el color de la prenda son datos y no relleno.
   *
   * Sólo lo son cuando hay un etiquetado que salió bien —propuesto por la IA o
   * confirmado por el usuario—. Una prenda `PENDING` o con el etiquetado
   * `FAILED` arrastra los valores con los que nació, y enseñarlos en la rejilla
   * los haría pasar por información real.
   * @param {Garment} garment - Prenda de la rejilla.
   * @returns {boolean}
   */
  protected hasRealAttributes(garment: Garment): boolean {
    return garment.taggingStatus === 'CONFIRMED' || garment.taggingStatus === 'SUGGESTED';
  }

  /**
   * Etiqueta legible de la familia de color de una prenda.
   * @param {Garment} garment - Prenda de la rejilla.
   * @returns {string}
   */
  protected colorLabel(garment: Garment): string {
    const family = colorFamilyFromHex(garment.primaryColorHex);
    return family ? colorFamilyLabels[family] : garment.primaryColorName;
  }

  /**
   * Nombre del slot en español.
   * @param {GarmentSlot} slot - Slot de la prenda.
   * @returns {string}
   */
  protected slotLabel(slot: GarmentSlot): string {
    return enumLabels.garmentSlot[slot];
  }
}
