import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Camera, ImagePlus, Save } from 'lucide-angular';
import {
  FitPreferenceEnum,
  GarmentMaterialEnum,
  GarmentPatternEnum,
  GarmentSlotEnum,
  GarmentStatusEnum,
  PatternScaleEnum,
  SeasonEnum,
  acceptedUploadMimeTypes,
  colorFamilyFromHex,
  colorFamilyLabels,
  enumLabels,
  formalityLabel,
  maxFormality,
  maxGarmentNameLength,
  maxGarmentPhotos,
  maxUploadFileBytes,
  maxUploadFileMb,
  minFormality,
  type CreateGarment,
  type Garment,
  type GarmentPhoto,
  type GarmentSlot,
  type GarmentType,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ApiClient } from '../../core/http/api.client';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { LayoutService } from '../../core/layout/layout.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { ChipGroupComponent, type IChipOption } from '../../shared/ui/chip-group.component';
import { DialogComponent } from '../../shared/ui/dialog.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { FieldComponent } from '../../shared/ui/field.component';
import { SubmitButtonComponent } from '../../shared/ui/submit-button.component';
import { ClosetStore } from './closet.store';
import type { GarmentDialogMode, IGarmentPrefill, IPendingPhoto } from './closet.types';
import { CameraCaptureComponent } from './camera-capture.component';
import { GarmentTaggingPanelComponent } from './garment-tagging-panel.component';
import { GarmentTypesStore } from './garment-types.store';
import { compressForUpload } from './image-compression';
import { isCameraAvailable } from './camera';
import { carriesFiles, imagesFrom } from './image-drop';

const defaultColorHex = '#1a1815';

/**
 * Valor inicial de los campos de temperatura. El tipo es `string | number | null`
 * porque Angular escribe un número en el control al teclear en un
 * `input[type=number]` y `null` al vaciarlo.
 */
const numericFieldInitialValue: string | number | null = '';
const fileTooLargeMessage = `Cada foto debe pesar menos de ${maxUploadFileMb} MB`;
const tooManyPhotosMessage = `Máximo ${maxGarmentPhotos} fotos por prenda`;
const partialUploadMessage =
  'La prenda se guardó, pero alguna foto no subió. Reintenta las marcadas en rojo.';
const reusedTaggingMessage =
  'Se reaplicó el etiquetado que ya estaba guardado, sin volver a pagar la llamada.';
const unusablePhotosMessage =
  'De estas fotos no se pudo sacar una prenda. Cámbialas o completa los datos a mano.';

/**
 * Alta y edición de una prenda. Diálogo centrado en escritorio y tablet, hoja
 * inferior en móvil — puro CSS, la estructura no cambia.
 */
@Component({
  selector: 'closet-garment-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CameraCaptureComponent,
    ChipGroupComponent,
    DialogComponent,
    ErrorBannerComponent,
    FieldComponent,
    GarmentTaggingPanelComponent,
    SubmitButtonComponent,
  ],
  host: {
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
    '(document:paste)': 'onPaste($event)',
  },
  templateUrl: './garment-dialog.component.html',
  styleUrl: './garment-dialog.component.scss',
})
export class GarmentDialogComponent implements OnInit {
  readonly garment = input<Garment | null>(null);
  /** Archivos que llegan desde un arrastre o un pegado en el clóset. */
  readonly initialFiles = input<readonly File[]>([]);
  /** Valores iniciales del alta. Sólo se aplican cuando no se está editando. */
  readonly prefill = input<IGarmentPrefill | null>(null);
  /** Qué es esta prenda para el diálogo y qué significa guardarla. */
  readonly mode = input<GarmentDialogMode>('CLOSET');

  readonly closed = output();

  protected readonly iconSave = Save;
  protected readonly iconCamera = Camera;
  protected readonly iconImage = ImagePlus;

  protected readonly labels = enumLabels;
  protected readonly acceptedMimeTypes = acceptedUploadMimeTypes.join(',');
  /** Se resuelve una vez: ni el contexto seguro ni el soporte de `getUserMedia` */
  protected readonly cameraSupported = isCameraAvailable();
  protected readonly minFormality = minFormality;
  protected readonly maxFormality = maxFormality;
  protected readonly maxPhotos = maxGarmentPhotos;
  protected readonly formalityLabel = formalityLabel;

  protected readonly slotOptions = GarmentSlotEnum.options;
  protected readonly patternOptions = GarmentPatternEnum.options;
  protected readonly patternScaleOptions = PatternScaleEnum.options;
  protected readonly materialOptions = GarmentMaterialEnum.options;
  protected readonly fitOptions = FitPreferenceEnum.options;
  protected readonly statusOptions = GarmentStatusEnum.options;
  protected readonly seasonOptions: IChipOption[] = SeasonEnum.options.map(season => ({
    value: season,
    label: enumLabels.season[season],
  }));

  protected readonly layout = inject(LayoutService);
  private readonly _formBuilder = inject(FormBuilder);
  private readonly _closet = inject(ClosetStore);
  private readonly _garmentTypes = inject(GarmentTypesStore);
  private readonly _aiUsage = inject(AiUsageStore);
  private readonly _confirm = inject(ConfirmService);
  private readonly _notifications = inject(NotificationService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly photos = signal<GarmentPhoto[]>([]);
  protected readonly pending = signal<IPendingPhoto[]>([]);
  protected readonly seasons = signal<string[]>([]);
  /** Fotos ya subidas y total del lote, para el contador del botón. */
  protected readonly uploadedCount = signal(0);
  protected readonly uploadTotal = signal(0);
  /** True mientras se arrastran archivos por encima del diálogo. */
  protected readonly dragging = signal(false);
  /** True mientras la cámara está abierta encima del diálogo. */
  protected readonly cameraOpen = signal(false);

  /**
   * Prenda tal como está en el servidor. Empieza siendo la que llega por input
   * y pasa a ser el borrador en cuanto se crea uno para etiquetar, así que el
   * guardado siempre sabe si hay algo creado y en qué estado quedó.
   */
  protected readonly current = signal<Garment | null>(null);
  protected readonly tagging = signal(false);
  protected readonly taggingError = signal<string | null>(null);
  /** Paso real del etiquetado, para decir qué se está haciendo y no un porcentaje. */
  private readonly _taggingStep = signal<'uploading' | 'analyzing'>('analyzing');
  /** True si este diálogo creó el borrador y todavía no está confirmado. */
  private readonly _createdDraft = signal(false);

  protected readonly isEdit = computed(() => this.garment() !== null);
  /** True mientras la prenda siga siendo algo que el usuario está pensando comprar. */
  protected readonly isCandidate = computed(() => this.mode() !== 'CLOSET');
  protected readonly totalPhotos = computed(() => this.photos().length + this.pending().length);
  protected readonly canAddPhotos = computed(() => this.totalPhotos() < maxGarmentPhotos);
  protected readonly typesBySlot = this._garmentTypes.bySlot;

  /** Confirmar es lo que saca a la prenda del estado de borrador. */
  protected readonly needsConfirmation = computed(() => {
    const status = this.current()?.tagging.status;
    return status !== undefined && status !== 'CONFIRMED';
  });

  protected readonly saveLabel = computed(() => {
    if (this.mode() === 'PURCHASE') {
      return 'Confirmar compra';
    }
    if (this.mode() === 'CANDIDATE') {
      return 'Guardar y medir';
    }
    if (this.needsConfirmation()) {
      return 'Confirmar prenda';
    }
    return this.isEdit() ? 'Guardar cambios' : 'Añadir prenda';
  });

  /** Cabecera del diálogo: dice a qué clóset pertenece lo que se está editando. */
  protected readonly dialogTitle = computed(() => {
    if (this.mode() === 'PURCHASE') {
      return 'Confirmar la compra';
    }
    if (this.mode() === 'CANDIDATE') {
      return this.isEdit() ? 'Revisar la candidata' : 'Evaluar una prenda';
    }
    return this.isEdit() ? 'Editar prenda' : 'Nueva prenda';
  });

  protected readonly dialogSubtitle = computed(() => {
    if (this.mode() === 'PURCHASE') {
      return 'Pasa a tu clóset';
    }
    return this.mode() === 'CANDIDATE' ? '¿Me lo compro?' : 'Tu clóset';
  });

  /**
   * Qué está pasando mientras se etiqueta. Son los dos pasos reales: no hay
   * porcentaje que enseñar porque `withFetch()` no emite progreso de subida y
   * la llamada al modelo es una sola petición.
   */
  protected readonly taggingLabel = computed(() => {
    if (this._taggingStep() !== 'uploading') {
      return 'Analizando la foto…';
    }
    return `Subiendo ${this.uploadedCount() + 1} de ${this.uploadTotal()}…`;
  });

  protected readonly form = this._formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(maxGarmentNameLength)]],
    garmentTypeId: ['', [Validators.required]],
    slot: ['TOP' as GarmentSlot, [Validators.required]],
    primaryColorHex: [defaultColorHex],
    primaryColorName: ['', [Validators.required]],
    secondaryColorHex: [''],
    pattern: ['SOLID'],
    patternScale: ['NONE'],
    material: ['OTHER'],
    fit: ['REGULAR'],
    formality: [minFormality + 1],
    weatherMinC: [numericFieldInitialValue],
    weatherMaxC: [numericFieldInitialValue],
    brand: [''],
    size: [''],
    status: ['ACTIVE'],
  });

  /**
   * Vuelca la prenda recibida en el formulario y encola los archivos iniciales.
   * @returns {void}
   */
  ngOnInit(): void {
    void this._garmentTypes.load();
    void this._aiUsage.load();
    const garment = this.garment();
    if (garment) {
      this.current.set(garment);
      this._fillFrom(garment);
    } else {
      this._applyPrefill();
    }
    this.addFiles(this.initialFiles());
    this._destroyRef.onDestroy(() => this._revokePreviews());
  }

  /**
   * Cierra el diálogo. Si aquí se creó un borrador que nunca llegó a
   * confirmarse, se pregunta antes de descartarlo: dejarlo suelto ensuciaría el
   * clóset con una prenda a medio etiquetar, y borrarlo sin avisar tiraría un
   * etiquetado que quizá ya se pagó.
   * @returns {Promise<void>}
   */
  protected async requestClose(): Promise<void> {
    const draft = this.current();
    if (this.isCandidate() || !this._createdDraft() || !draft || !this.needsConfirmation()) {
      this.closed.emit();
      return;
    }
    const discard = await this._confirm.ask({
      title: 'Descartar prenda sin confirmar',
      message: `"${draft.name}" no está confirmada todavía. Si sales ahora se borrará junto con sus fotos.`,
      confirmLabel: 'Descartar',
      cancelLabel: 'Seguir editando',
      tone: 'danger',
    });
    if (!discard) {
      return;
    }
    try {
      await this._closet.remove(draft.id);
    } catch (error) {
      this._notifications.error(ApiClient.messageFromError(error));
    }
    this.closed.emit();
  }

  /**
   * Etiqueta la prenda con IA.
   * @param {boolean} force - Reetiquetado explícito que vuelve a pagar y pisa
   * también los atributos corregidos a mano.
   * @returns {Promise<void>}
   */
  protected async runTagging(force: boolean): Promise<void> {
    if (this.tagging()) {
      return;
    }
    this.tagging.set(true);
    this.taggingError.set(null);
    this.uploadedCount.set(0);
    this.uploadTotal.set(this.pending().length);
    this._taggingStep.set(this.pending().length > 0 ? 'uploading' : 'analyzing');
    try {
      const garment = await this._ensurePersisted();
      if (!(await this._uploadPending(garment.id))) {
        this.taggingError.set(partialUploadMessage);
        return;
      }
      this._taggingStep.set('analyzing');
      const response = await this._closet.tag(garment.id, force);
      this._adopt(response.garment);
      this._notifyTagged(response.garment, response.reused);
    } catch (error) {
      this.taggingError.set(ApiClient.messageFromError(error));
    } finally {
      this.tagging.set(false);
      void this._aiUsage.refresh();
    }
  }

  /**
   * Devuelve la prenda ya creada en el servidor, creando el borrador si hace
   * falta.
   * @private
   * @returns {Promise<Garment>}
   */
  private async _ensurePersisted(): Promise<Garment> {
    const existing = this.current();
    if (existing) {
      return existing;
    }
    const draft = await this._closet.createDraft(
      this.form.controls.name.value.trim() || null,
      this.isCandidate() ? 'CONSIDERED' : 'OWNED',
    );
    this.current.set(draft);
    this._createdDraft.set(true);
    return draft;
  }

  /**
   * Adopta la prenda que devolvió el servidor.
   * Una prenda ya confirmada no se vacía: sus datos son del usuario y un
   * reetiquetado fallido no tiene por qué borrárselos.
   * @private
   * @param {Garment} garment - Prenda tal como quedó en el servidor.
   * @returns {void}
   */
  private _adopt(garment: Garment): void {
    this.current.set(garment);
    if (garment.tagging.usableForTagging || garment.taggingStatus === 'CONFIRMED') {
      this._fillFrom(garment);
      return;
    }
    this._clearAttributes();
    this.photos.set([...garment.photos]);
  }

  /**
   * Deja los atributos en blanco conservando las fotos. El formulario queda
   * inválido a propósito: es lo que impide guardar una prenda sin datos.
   * @private
   * @returns {void}
   */
  private _clearAttributes(): void {
    this.form.reset({
      name: '',
      garmentTypeId: '',
      slot: 'TOP',
      primaryColorHex: defaultColorHex,
      primaryColorName: '',
      secondaryColorHex: '',
      pattern: 'SOLID',
      patternScale: 'NONE',
      material: 'OTHER',
      fit: 'REGULAR',
      formality: minFormality + 1,
      weatherMinC: numericFieldInitialValue,
      weatherMaxC: numericFieldInitialValue,
      brand: '',
      size: '',
      status: 'ACTIVE',
    });
    this.seasons.set([]);
  }

  /**
   * Cuenta qué pasó con el etiquetado. Una negativa del modelo no es un éxito y
   * no se anuncia como tal: el panel ya explica el motivo y qué hacer.
   * @private
   * @param {Garment} garment - Prenda tal como quedó en el servidor.
   * @param {boolean} reused - Si se reaplicó un resultado ya guardado.
   * @returns {void}
   */
  private _notifyTagged(garment: Garment, reused: boolean): void {
    if (!garment.tagging.usableForTagging) {
      this._notifications.warning(unusablePhotosMessage);
      return;
    }
    this._notifications.success(
      reused ? reusedTaggingMessage : 'La IA ya rellenó los atributos. Revísalos.',
    );
  }

  /**
   * Añade archivos a la cola de subida, descartando los que no cumplen tipo o
   * tamaño antes de gastar red en ellos.
   * @param {readonly File[]} files - Archivos elegidos, arrastrados o pegados.
   * @returns {void}
   */
  addFiles(files: readonly File[]): void {
    const isWithinLimit = (candidate: File): boolean => candidate.size <= maxUploadFileBytes;
    for (const rejected of files.filter(candidate => !isWithinLimit(candidate))) {
      this._notifications.error(`${rejected.name}: ${fileTooLargeMessage}`);
    }
    for (const file of files.filter(isWithinLimit)) {
      if (!this.canAddPhotos()) {
        this._notifications.warning(tooManyPhotosMessage);
        return;
      }
      this.pending.update(list => [
        ...list,
        {
          file,
          id: Date.now() + list.length,
          previewUrl: URL.createObjectURL(file),
          status: 'pending',
        },
      ]);
    }
  }

  /**
   * Abre la cámara del dispositivo. En Chrome de escritorio es la única forma de
   * tomar una foto: el `capture` de un input sólo lo atiende el móvil.
   * @returns {void}
   */
  protected openCamera(): void {
    this.cameraOpen.set(true);
  }

  /**
   * Cierra la cámara. La foto, si la hubo, ya entró por `addFiles`.
   * @returns {void}
   */
  protected closeCamera(): void {
    this.cameraOpen.set(false);
  }

  /**
   * Recoge los archivos de un `<input type="file">` y limpia el control para que
   * elegir el mismo archivo dos veces vuelva a disparar el evento.
   * @param {Event} event - Evento `change` del input.
   * @returns {void}
   */
  protected onFilesPicked(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    this.addFiles(Array.from(fileInput.files ?? []));
    fileInput.value = '';
  }

  /**
   * Marca el diálogo como zona de suelte mientras se arrastran archivos.
   * @param {DragEvent} event - Evento de arrastre.
   * @returns {void}
   */
  protected onDragOver(event: DragEvent): void {
    if (!carriesFiles(Array.from(event.dataTransfer?.types ?? []))) {
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
   * Encola las imágenes soltadas sobre el diálogo.
   * @param {DragEvent} event - Evento de suelte.
   * @returns {void}
   */
  protected onDrop(event: DragEvent): void {
    if (!carriesFiles(Array.from(event.dataTransfer?.types ?? []))) {
      return;
    }
    event.preventDefault();
    this.dragging.set(false);
    this.addFiles(imagesFrom(Array.from(event.dataTransfer?.files ?? [])));
  }

  /**
   * Encola las imágenes pegadas desde el portapapeles: una captura o una foto
   * copiada nunca pasó por el disco y no hay archivo que elegir.
   * @param {ClipboardEvent} event - Evento de pegado.
   * @returns {void}
   */
  protected onPaste(event: ClipboardEvent): void {
    const images = imagesFrom(Array.from(event.clipboardData?.files ?? []));
    if (images.length === 0) {
      return;
    }
    event.preventDefault();
    this.addFiles(images);
  }

  /**
   * Quita una foto todavía no subida.
   * @param {number} pendingId - Identificador local de la foto pendiente.
   * @returns {void}
   */
  protected removePending(pendingId: number): void {
    const target = this.pending().find(photo => photo.id === pendingId);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }
    this.pending.update(list => list.filter(photo => photo.id !== pendingId));
  }

  /**
   * Borra una foto ya guardada, previa confirmación.
   * @param {GarmentPhoto} photo - Foto a borrar.
   * @returns {Promise<void>}
   */
  protected async removePhoto(photo: GarmentPhoto): Promise<void> {
    const garment = this.current();
    if (!garment) {
      return;
    }
    const confirmed = await this._confirm.ask({
      title: 'Borrar foto',
      message: '¿Seguro que quieres borrar esta foto de la prenda?',
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      this._syncPhotos(await this._closet.removePhoto(garment.id, photo.id));
    } catch (error) {
      this._notifications.error(ApiClient.messageFromError(error));
    }
  }

  /**
   * Marca una foto ya guardada como principal. Importa para el etiquetado: la
   * portada es justo la foto que se le manda al modelo.
   * @param {GarmentPhoto} photo - Foto que pasa a ser portada.
   * @returns {Promise<void>}
   */
  protected async setPrimary(photo: GarmentPhoto): Promise<void> {
    const garment = this.current();
    if (!garment || photo.isPrimary) {
      return;
    }
    try {
      this._syncPhotos(await this._closet.setPrimaryPhoto(garment.id, photo.id));
    } catch (error) {
      this._notifications.error(ApiClient.messageFromError(error));
    }
  }

  /**
   * Guarda la prenda que devolvió el servidor y refresca la tira de fotos, sin
   * tocar lo que el usuario esté escribiendo en el formulario.
   * @private
   * @param {Garment} garment - Prenda ya actualizada por el servidor.
   * @returns {void}
   */
  private _syncPhotos(garment: Garment): void {
    this.current.set(garment);
    this.photos.set(garment.photos);
  }

  /**
   * Al elegir tipo de prenda hereda su slot y, si estamos creando, sus valores
   * por defecto de formalidad y clima. En edición no se tocan: son datos que el
   * usuario ya ajustó.
   * @param {Event} event - Evento `change` del select de tipo.
   * @returns {void}
   */
  protected onTypeChange(event: Event): void {
    const typeId = (event.target as HTMLSelectElement).value;
    const type = this._garmentTypes.byId().get(typeId);
    if (!type) {
      return;
    }
    this.form.patchValue({ slot: type.slot });
    if (this.isEdit()) {
      return;
    }
    this.form.patchValue({
      formality: type.defaultFormality,
      weatherMinC: GarmentDialogComponent._toInput(type.defaultWeatherMinC),
      weatherMaxC: GarmentDialogComponent._toInput(type.defaultWeatherMaxC),
    });
    this.seasons.set([...type.typicalSeasons]);
  }

  /**
   * Propone el nombre del color al elegir un hex, si el campo sigue vacío.
   * @returns {void}
   */
  protected onColorChange(): void {
    if (this.form.controls.primaryColorName.value.trim()) {
      return;
    }
    const family = colorFamilyFromHex(this.form.controls.primaryColorHex.value);
    if (family) {
      this.form.patchValue({ primaryColorName: colorFamilyLabels[family] });
    }
  }

  /**
   * Quita el color secundario. Un `input[type=color]` vacío se pinta negro, así
   * que sin este botón no habría forma de distinguir "negro" de "ninguno".
   * @returns {void}
   */
  protected clearSecondaryColor(): void {
    this.form.patchValue({ secondaryColorHex: '' });
  }

  /**
   * Guarda la prenda y sube las fotos pendientes.
   * @returns {Promise<void>}
   */
  protected async submit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set(null);
    this.uploadedCount.set(0);
    this.uploadTotal.set(this.pending().length);
    try {
      const wasDraft = this.needsConfirmation();
      const garment = await this._persistGarment();
      const allUploaded = await this._uploadPending(garment.id);
      if (!allUploaded) {
        this.errorMessage.set(partialUploadMessage);
        return;
      }
      this._notifications.success(this._savedMessage(wasDraft));
      this.closed.emit();
    } catch (error) {
      this.errorMessage.set(ApiClient.messageFromError(error));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Crea, actualiza o confirma la prenda según en qué punto esté.
   * @private
   * @returns {Promise<Garment>}
   */
  private async _persistGarment(): Promise<Garment> {
    const payload = this._buildPayload();
    if (this.isCandidate()) {
      return this._persistCandidate(payload);
    }
    const existing = this.current();
    if (!existing) {
      const created = await this._closet.create(payload);
      this.current.set(created);
      return created;
    }
    const saved = this.needsConfirmation()
      ? await this._closet.confirmTagging(existing.id, payload)
      : await this._closet.update(existing.id, payload);
    this._syncPhotos(saved);
    this._createdDraft.set(false);
    return saved;
  }

  /**
   * Guarda la prenda que el usuario está pensando comprar.
   * @private
   * @param {CreateGarment} payload - Atributos tal como los dejó el formulario.
   * @returns {Promise<Garment>}
   */
  private async _persistCandidate(payload: CreateGarment): Promise<Garment> {
    const candidate = await this._ensurePersisted();
    const saved =
      this.mode() === 'PURCHASE'
        ? await this._closet.purchaseCandidate(candidate.id, payload)
        : await this._closet.update(candidate.id, payload);
    this._syncPhotos(saved);
    this._createdDraft.set(false);
    return saved;
  }

  /**
   * Mensaje de éxito según lo que acaba de pasar.
   * @private
   * @param {boolean} wasDraft - Si la prenda venía sin confirmar.
   * @returns {string}
   */
  private _savedMessage(wasDraft: boolean): string {
    if (this.mode() === 'PURCHASE') {
      return 'Ya es tuya: entra en el clóset y cuenta para tus looks';
    }
    if (this.mode() === 'CANDIDATE') {
      return 'Candidata guardada: ya puedes medirla contra tu clóset';
    }
    if (wasDraft) {
      return 'Prenda confirmada: ya cuenta para tus looks';
    }
    return this.isEdit() ? 'Prenda actualizada' : 'Prenda añadida';
  }

  /**
   * Sube las fotos pendientes de una en una. Devuelve si todas terminaron; las
   * que fallen se quedan en la lista marcadas para reintentar.
   * @private
   * @param {string} garmentId - Prenda destino.
   * @returns {Promise<boolean>}
   */
  private async _uploadPending(garmentId: string): Promise<boolean> {
    for (const photo of this.pending()) {
      this._markPending(photo.id, 'uploading');
      try {
        const payload = await compressForUpload(photo.file);
        this._syncPhotos(await this._closet.uploadPhoto(garmentId, payload.blob, payload.filename));
        this.removePending(photo.id);
        this.uploadedCount.update(count => count + 1);
      } catch (error) {
        this._markPending(photo.id, 'error', ApiClient.messageFromError(error));
      }
    }
    return this.pending().length === 0;
  }

  /**
   * Actualiza el estado de una foto pendiente.
   * @private
   * @param {number} pendingId - Identificador local de la foto.
   * @param {IPendingPhoto['status']} status - Nuevo estado.
   * @param {string} [error] - Mensaje de error si lo hubo.
   * @returns {void}
   */
  private _markPending(pendingId: number, status: IPendingPhoto['status'], error?: string): void {
    this.pending.update(list =>
      list.map(photo => (photo.id === pendingId ? { ...photo, status, error } : photo)),
    );
  }

  /**
   * Construye el payload de la prenda a partir del formulario.
   * @private
   * @returns {CreateGarment}
   */
  private _buildPayload(): CreateGarment {
    const raw = this.form.getRawValue();
    return {
      name: raw.name.trim(),
      garmentTypeId: raw.garmentTypeId,
      slot: raw.slot,
      primaryColorHex: raw.primaryColorHex,
      primaryColorName: raw.primaryColorName.trim(),
      secondaryColorHex: raw.secondaryColorHex || null,
      pattern: GarmentPatternEnum.parse(raw.pattern),
      patternScale: PatternScaleEnum.parse(raw.patternScale),
      material: GarmentMaterialEnum.parse(raw.material),
      fit: FitPreferenceEnum.parse(raw.fit),
      formality: Number(raw.formality),
      seasons: SeasonEnum.options.filter(season => this.seasons().includes(season)),
      weatherMinC: GarmentDialogComponent._toNumber(raw.weatherMinC),
      weatherMaxC: GarmentDialogComponent._toNumber(raw.weatherMaxC),
      brand: raw.brand.trim() || null,
      size: raw.size.trim() || null,
      status: GarmentStatusEnum.parse(raw.status),
    };
  }

  /**
   * Vuelca los valores propuestos al abrir un alta precargada. El resto del
   * formulario se queda como está: lo que llega es una descripción, no una prenda.
   * @private
   * @returns {void}
   */
  private _applyPrefill(): void {
    const prefill = this.prefill();
    if (!prefill) {
      return;
    }
    this.form.patchValue({
      name: prefill.name,
      garmentTypeId: prefill.garmentTypeId,
      slot: prefill.slot,
      formality: prefill.formality,
      primaryColorHex: prefill.primaryColorHex,
      primaryColorName: prefill.primaryColorName,
    });
  }

  /**
   * Rellena el formulario con los datos de una prenda existente.
   * @private
   * @param {Garment} garment - Prenda a editar.
   * @returns {void}
   */
  private _fillFrom(garment: Garment): void {
    this.form.patchValue({
      name: garment.name,
      garmentTypeId: garment.garmentTypeId,
      slot: garment.slot,
      primaryColorHex: garment.primaryColorHex,
      primaryColorName: garment.primaryColorName,
      secondaryColorHex: garment.secondaryColorHex ?? '',
      pattern: garment.pattern,
      patternScale: garment.patternScale,
      material: garment.material,
      fit: garment.fit,
      formality: garment.formality,
      weatherMinC: GarmentDialogComponent._toInput(garment.weatherMinC),
      weatherMaxC: GarmentDialogComponent._toInput(garment.weatherMaxC),
      brand: garment.brand ?? '',
      size: garment.size ?? '',
      status: garment.status,
    });
    this.seasons.set([...garment.seasons]);
    this.photos.set([...garment.photos]);
  }

  /**
   * Libera las URL de previsualización para no filtrar memoria al cerrar.
   * @private
   * @returns {void}
   */
  private _revokePreviews(): void {
    for (const photo of this.pending()) {
      URL.revokeObjectURL(photo.previewUrl);
    }
  }

  /**
   * Convierte un número opcional en texto para un input.
   * @private
   * @param {number | null} value - Valor guardado.
   * @returns {string}
   */
  private static _toInput(value: number | null): string {
    return value === null ? '' : String(value);
  }

  /**
   * Normaliza el valor de un campo numérico a entero o `null`. Acepta número,
   * texto y `null` porque los tres salen del mismo `input[type=number]`.
   * @private
   * @param {string | number | null} value - Valor del control.
   * @returns {number | null}
   */
  private static _toNumber(value: string | number | null): number | null {
    if (value === null) {
      return null;
    }
    const parsed = typeof value === 'number' ? value : Number(value.trim() || Number.NaN);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  /**
   * Tipos de prenda de un slot concreto, para agrupar el select.
   * @param {GarmentSlot} slot - Slot del catálogo.
   * @returns {GarmentType[]}
   */
  protected typesFor(slot: GarmentSlot): GarmentType[] {
    return this.typesBySlot().get(slot) ?? [];
  }
}
