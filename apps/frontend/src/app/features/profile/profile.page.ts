import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Save } from 'lucide-angular';
import {
  BodyShapeEnum,
  BudgetTierEnum,
  ClimateEnum,
  FitPreferenceEnum,
  GenderEnum,
  PresentationPreferenceEnum,
  StyleArchetypeEnum,
  enumLabels,
  measurementKeys,
  measurementLabels,
  measurementsVersion,
  type UpdateStyleProfile,
} from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';
import { NotificationService } from '../../core/notifications/notification.service';
import { ChipGroupComponent, type IChipOption } from '../../shared/ui/chip-group.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { FieldComponent } from '../../shared/ui/field.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { SubmitButtonComponent } from '../../shared/ui/submit-button.component';
import { GarmentTypesStore } from '../closet/garment-types.store';
import { ProfileStore } from './profile.store';

const savedMessage = 'Perfil guardado';
const maxAvoidedColors = 20;

/**
 * Valor inicial de los campos numéricos. El tipo es `string | number | null`
 * porque Angular escribe un número en el control al teclear en un
 * `input[type=number]` y `null` al vaciarlo.
 */
const numericFieldInitialValue: string | number | null = '';

/**
 * Convierte una lista de valores de enum en opciones de chip con su etiqueta.
 * @param {readonly string[]} values - Valores del enum.
 * @param {Record<string, string>} labels - Etiquetas en español.
 * @returns {IChipOption[]}
 */
function toChipOptions(values: readonly string[], labels: Record<string, string>): IChipOption[] {
  return values.map(value => ({ value, label: labels[value] ?? value }));
}

/**
 * Página de perfil de estilo. Todos los campos son opcionales: la app funciona
 * sin ninguno, y las preferencias de ajuste y comodidad pesan más que cualquier
 * medida. Nada se infiere; sólo se guarda lo que el usuario escribe.
 * @class
 */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ChipGroupComponent,
    ErrorBannerComponent,
    FieldComponent,
    SkeletonComponent,
    SubmitButtonComponent,
  ],
  host: { style: 'display: flex; flex: 1; flex-direction: column' },
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
})
export class ProfilePage implements OnInit {
  protected readonly iconSave = Save;
  protected readonly labels = enumLabels;
  protected readonly measurementKeys = measurementKeys;
  protected readonly measurementLabels = measurementLabels;

  protected readonly genderOptions = GenderEnum.options;
  protected readonly bodyShapeOptions = BodyShapeEnum.options;
  protected readonly budgetTierOptions = BudgetTierEnum.options;
  protected readonly climateOptions = ClimateEnum.options;

  protected readonly fitOptions = toChipOptions(
    FitPreferenceEnum.options,
    enumLabels.fitPreference,
  );
  protected readonly archetypeOptions = toChipOptions(
    StyleArchetypeEnum.options,
    enumLabels.styleArchetype,
  );
  protected readonly presentationOptions = toChipOptions(
    PresentationPreferenceEnum.options,
    enumLabels.presentationPreference,
  );

  private readonly _formBuilder = inject(FormBuilder);
  private readonly _profile = inject(ProfileStore);
  private readonly _garmentTypes = inject(GarmentTypesStore);
  private readonly _notifications = inject(NotificationService);

  protected readonly loading = this._profile.loading;
  protected readonly loadError = this._profile.error;
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  /** Selecciones múltiples: viven fuera del form porque son chips, no inputs. */
  protected readonly preferredFits = signal<string[]>([]);
  protected readonly styleArchetypes = signal<string[]>([]);
  protected readonly presentationPreferences = signal<string[]>([]);
  protected readonly avoidedColors = signal<string[]>([]);
  protected readonly avoidedGarmentTypeIds = signal<string[]>([]);
  protected readonly newAvoidedColor = signal('');

  protected readonly avoidedTypeOptions = computed<IChipOption[]>(() =>
    this._garmentTypes.types().map(type => ({ value: type.id, label: type.name })),
  );

  protected readonly form = this._formBuilder.nonNullable.group({
    gender: [''],
    heightCm: [numericFieldInitialValue],
    weightKg: [numericFieldInitialValue],
    bodyShape: [''],
    shoeSize: [''],
    skinTone: [''],
    hairColor: [''],
    budgetTier: [''],
    country: [''],
    currency: [''],
    city: [''],
    climate: [''],
    notes: [''],
    chest: [numericFieldInitialValue],
    waist: [numericFieldInitialValue],
    hips: [numericFieldInitialValue],
    shoulder: [numericFieldInitialValue],
    inseam: [numericFieldInitialValue],
    sleeve: [numericFieldInitialValue],
  });

  /**
   * Carga catálogo y perfil, y vuelca el perfil en el formulario.
   * @returns {void}
   */
  ngOnInit(): void {
    void this._garmentTypes.load();
    void this._profile.load().then(() => this._fillForm());
  }

  /**
   * Refleja en el signal lo que el usuario teclea en el campo de color evitado.
   * @param {Event} event - Evento `input` del campo de texto.
   * @returns {void}
   */
  protected onAvoidedColorInput(event: Event): void {
    this.newAvoidedColor.set((event.target as HTMLInputElement).value);
  }

  /**
   * Añade un color a la lista de colores que el usuario evita.
   * @returns {void}
   */
  protected addAvoidedColor(): void {
    const color = this.newAvoidedColor().trim();
    if (!color || this.avoidedColors().length >= maxAvoidedColors) {
      return;
    }
    if (!this.avoidedColors().includes(color)) {
      this.avoidedColors.update(list => [...list, color]);
    }
    this.newAvoidedColor.set('');
  }

  /**
   * Quita un color de la lista de colores evitados.
   * @param {string} color - Color a quitar.
   * @returns {void}
   */
  protected removeAvoidedColor(color: string): void {
    this.avoidedColors.update(list => list.filter(item => item !== color));
  }

  /**
   * Reemplaza la selección de tipos de prenda que el usuario no quiere ver.
   * @param {string[]} values - Ids seleccionados.
   * @returns {void}
   */
  protected setAvoidedTypes(values: string[]): void {
    this.avoidedGarmentTypeIds.set(values);
  }

  /**
   * Guarda el perfil completo.
   * @returns {Promise<void>}
   */
  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this._profile.save(this._buildPayload());
      this._notifications.success(savedMessage);
    } catch (error) {
      this.saveError.set(ApiClient.messageFromError(error));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Construye el payload completo a partir del formulario y de los chips.
   * @private
   * @returns {UpdateStyleProfile}
   */
  private _buildPayload(): UpdateStyleProfile {
    return {
      ...this._buildBodyFields(),
      ...this._buildContextFields(),
      ...this._buildSelectionFields(),
      measurements: this._buildMeasurements(),
    };
  }

  /**
   * Campos corporales, todos opcionales. Un input vacío viaja como `null`
   * explícito para que el backend lo borre en vez de dejarlo como estaba.
   * @private
   * @returns {UpdateStyleProfile}
   */
  private _buildBodyFields(): UpdateStyleProfile {
    const raw = this.form.getRawValue();
    return {
      gender: ProfilePage._toEnum(raw.gender, GenderEnum.options),
      heightCm: ProfilePage._toNumber(raw.heightCm),
      weightKg: ProfilePage._toNumber(raw.weightKg),
      bodyShape: ProfilePage._toEnum(raw.bodyShape, BodyShapeEnum.options),
      shoeSize: ProfilePage._toText(raw.shoeSize),
      skinTone: ProfilePage._toText(raw.skinTone),
      hairColor: ProfilePage._toText(raw.hairColor),
    };
  }

  /**
   * Contexto de compra y clima: dónde vive, con qué moneda y con qué presupuesto.
   * @private
   * @returns {UpdateStyleProfile}
   */
  private _buildContextFields(): UpdateStyleProfile {
    const raw = this.form.getRawValue();
    const currency = ProfilePage._toText(raw.currency);
    return {
      budgetTier: ProfilePage._toEnum(raw.budgetTier, BudgetTierEnum.options),
      country: ProfilePage._toText(raw.country),
      currency: currency === null ? null : currency.toUpperCase(),
      city: ProfilePage._toText(raw.city),
      climate: ProfilePage._toEnum(raw.climate, ClimateEnum.options),
      notes: ProfilePage._toText(raw.notes),
    };
  }

  /**
   * Selecciones múltiples, filtradas contra su enum por si el estado local
   * arrastrase un valor que ya no existe en el vocabulario.
   * @private
   * @returns {UpdateStyleProfile}
   */
  private _buildSelectionFields(): UpdateStyleProfile {
    return {
      preferredFits: ProfilePage._toEnumList(this.preferredFits(), FitPreferenceEnum.options),
      styleArchetypes: ProfilePage._toEnumList(this.styleArchetypes(), StyleArchetypeEnum.options),
      presentationPreferences: ProfilePage._toEnumList(
        this.presentationPreferences(),
        PresentationPreferenceEnum.options,
      ),
      avoidedColors: this.avoidedColors(),
      avoidedGarmentTypeIds: this.avoidedGarmentTypeIds(),
    };
  }

  /**
   * Arma el Json de medidas. Si el usuario no dio ninguna devuelve `null`, para
   * no guardar un objeto que sólo contiene su propia versión.
   * @private
   * @returns {UpdateStyleProfile['measurements']}
   */
  private _buildMeasurements(): UpdateStyleProfile['measurements'] {
    const raw = this.form.getRawValue();
    const entries = measurementKeys
      .map(key => [key, ProfilePage._toNumber(raw[key])] as const)
      .filter(([, value]) => value !== null);
    if (entries.length === 0) {
      return null;
    }
    return {
      version: measurementsVersion,
      unit: 'cm',
      ...Object.fromEntries(entries),
    };
  }

  /**
   * Vuelca el perfil cargado en el formulario y en los chips.
   * @private
   * @returns {void}
   */
  private _fillForm(): void {
    const profile = this._profile.profile();
    if (!profile) {
      return;
    }
    const measurements = profile.measurements;
    this.form.patchValue({
      gender: ProfilePage._toInputText(profile.gender),
      heightCm: ProfilePage._toInput(profile.heightCm),
      weightKg: ProfilePage._toInput(profile.weightKg),
      bodyShape: ProfilePage._toInputText(profile.bodyShape),
      shoeSize: ProfilePage._toInputText(profile.shoeSize),
      skinTone: ProfilePage._toInputText(profile.skinTone),
      hairColor: ProfilePage._toInputText(profile.hairColor),
      budgetTier: ProfilePage._toInputText(profile.budgetTier),
      country: ProfilePage._toInputText(profile.country),
      currency: ProfilePage._toInputText(profile.currency),
      city: ProfilePage._toInputText(profile.city),
      climate: ProfilePage._toInputText(profile.climate),
      notes: ProfilePage._toInputText(profile.notes),
      ...Object.fromEntries(
        measurementKeys.map(key => [key, ProfilePage._toInput(measurements?.[key])]),
      ),
    });
    this.preferredFits.set([...profile.preferredFits]);
    this.styleArchetypes.set([...profile.styleArchetypes]);
    this.presentationPreferences.set([...profile.presentationPreferences]);
    this.avoidedColors.set([...profile.avoidedColors]);
    this.avoidedGarmentTypeIds.set([...profile.avoidedGarmentTypeIds]);
  }

  /**
   * Convierte un valor numérico opcional en texto para el input.
   * @private
   * @param {number | null | undefined} value - Valor guardado.
   * @returns {string}
   */
  private static _toInput(value: number | null | undefined): string {
    return value === null || value === undefined ? '' : String(value);
  }

  /**
   * Convierte un texto opcional en el valor por defecto del input (cadena vacía).
   * @private
   * @param {string | null | undefined} value - Valor guardado.
   * @returns {string}
   */
  private static _toInputText(value: string | null | undefined): string {
    return value ?? '';
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
   * Normaliza un texto opcional: vacío significa "sin dato", no cadena vacía.
   * @private
   * @param {string} value - Texto del input.
   * @returns {string | null}
   */
  private static _toText(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Acepta un valor de select sólo si pertenece al enum; si no, es "sin elegir".
   * @private
   * @param {string} value - Valor del select.
   * @param {readonly TValue[]} options - Valores válidos del enum.
   * @returns {TValue | null}
   */
  private static _toEnum<TValue extends string>(
    value: string,
    options: readonly TValue[],
  ): TValue | null {
    return options.find(option => option === value) ?? null;
  }

  /**
   * Filtra una selección múltiple dejando sólo los valores del enum.
   * @private
   * @param {readonly string[]} values - Valores seleccionados.
   * @param {readonly TValue[]} options - Valores válidos del enum.
   * @returns {TValue[]}
   */
  private static _toEnumList<TValue extends string>(
    values: readonly string[],
    options: readonly TValue[],
  ): TValue[] {
    return options.filter(option => values.includes(option));
  }
}
