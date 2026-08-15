import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Sparkles } from 'lucide-angular';
import {
  ClimateEnum,
  GarmentSlotEnum,
  LookOccasionEnum,
  StyleArchetypeEnum,
  defaultLooksPerRequest,
  enumLabels,
  maxLooksPerRequest,
  minLooksPerRequest,
  type Climate,
  type Garment,
  type GarmentSlot,
  type GenerateOutfitsRequest,
  type LookOccasion,
  type StyleArchetype,
} from '@closetai/shared-types';
import { ChipGroupComponent, type IChipOption } from '../../shared/ui/chip-group.component';
import { FieldComponent } from '../../shared/ui/field.component';
import { SubmitButtonComponent } from '../../shared/ui/submit-button.component';
import { ClosetStore } from '../closet/closet.store';
import { ProfileStore } from '../profile/profile.store';

const anyValue = '';
const defaultStyleTag: StyleArchetype = 'MINIMALIST';

/**
 * Panel de generación: estilo, ocasión, clima y restricciones de la petición.
 * @class
 */
@Component({
  selector: 'closet-look-request-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipGroupComponent, FieldComponent, SubmitButtonComponent],
  host: { style: 'display: block' },
  templateUrl: './look-request-form.component.html',
  styleUrl: './look-request-form.component.scss',
})
export class LookRequestFormComponent implements OnInit {
  readonly busy = input<boolean>(false);
  /**
   * False cuando el servidor no tiene proveedor de IA configurado. El interruptor
   * del estilista desaparece y el panel se queda en el motor, que sigue siendo
   * gratis y funciona igual.
   */
  readonly stylistAvailable = input<boolean>(true);
  readonly submitted = output<ILookRequestSubmission>();

  protected readonly iconSparkles = Sparkles;
  protected readonly labels = enumLabels;
  protected readonly anyValue = anyValue;
  protected readonly slotOptions = GarmentSlotEnum.options;
  protected readonly climateOptions = ClimateEnum.options;
  protected readonly occasionOptions = LookOccasionEnum.options;
  protected readonly limitOptions = Array.from(
    { length: maxLooksPerRequest - minLooksPerRequest + 1 },
    (_unused, offset) => minLooksPerRequest + offset,
  );
  protected readonly styleChips: IChipOption[] = StyleArchetypeEnum.options.map(archetype => ({
    value: archetype,
    label: enumLabels.styleArchetype[archetype],
  }));

  private readonly _closet = inject(ClosetStore);
  private readonly _profile = inject(ProfileStore);

  protected readonly styleTag = signal<StyleArchetype>(defaultStyleTag);
  protected readonly occasion = signal<LookOccasion | ''>('');
  protected readonly useStylist = signal(true);
  protected readonly climate = signal<Climate | ''>('');
  protected readonly temperatureC = signal<number | null>(null);
  protected readonly mustIncludeGarmentId = signal<string>('');
  protected readonly includeSuggested = signal(false);
  protected readonly limit = signal<number>(defaultLooksPerRequest);

  /** El grupo de chips trabaja con arrays; el estilo es de selección única. */
  protected readonly styleSelection = computed(() => [this.styleTag()]);

  /** Sólo se ofrecen prendas disponibles: pedir una de la lavandería no arma nada. */
  protected readonly availableGarments = computed(() =>
    this._closet.garments().filter(garment => garment.status === 'ACTIVE'),
  );

  /** Prendas disponibles agrupadas por slot, para el desplegable. */
  protected readonly garmentsBySlot = computed(() => {
    const groups = new Map<GarmentSlot, Garment[]>();
    for (const garment of this.availableGarments()) {
      groups.set(garment.slot, [...(groups.get(garment.slot) ?? []), garment]);
    }
    return groups;
  });

  /**
   * La opción de incluir sugeridas sólo aparece si hay algo sin confirmar: un
   * interruptor que no cambia nada es ruido.
   */
  protected readonly hasSuggested = computed(() =>
    this._closet.garments().some(garment => garment.taggingStatus !== 'CONFIRMED'),
  );

  /** Clima del perfil, para rotular la opción por defecto con un dato real. */
  protected readonly profileClimate = computed(() => this._profile.profile()?.climate ?? null);

  /**
   * Carga clóset y perfil, y propone el primer arquetipo del perfil como estilo.
   * @returns {void}
   */
  ngOnInit(): void {
    void this._closet.load();
    void this._profile.load().then(() => {
      const [preferred] = this._profile.profile()?.styleArchetypes ?? [];
      if (preferred) {
        this.styleTag.set(preferred);
      }
    });
  }

  /**
   * Fija el estilo desde los chips.
   * @param {string[]} values - Selección emitida por el grupo de chips.
   * @returns {void}
   */
  protected onStyleChips(values: string[]): void {
    const [selected] = values;
    const archetype = StyleArchetypeEnum.options.find(option => option === selected);
    if (archetype) {
      this.styleTag.set(archetype);
    }
  }

  /**
   * Fija la ocasión a partir del select.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onOccasion(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.occasion.set(LookOccasionEnum.options.find(option => option === value) ?? '');
  }

  /**
   * Alterna el uso del estilista con IA.
   * @param {Event} event - Evento `change` de la casilla.
   * @returns {void}
   */
  protected onUseStylist(event: Event): void {
    this.useStylist.set((event.target as HTMLInputElement).checked);
  }

  /**
   * Fija el clima a partir del select.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onClimate(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.climate.set(ClimateEnum.options.find(option => option === value) ?? '');
  }

  /**
   * Fija la temperatura exacta, o la borra si el campo queda vacío.
   * @param {Event} event - Evento `input` del campo numérico.
   * @returns {void}
   */
  protected onTemperature(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = Number(raw);
    this.temperatureC.set(raw.length > 0 && Number.isFinite(parsed) ? Math.round(parsed) : null);
  }

  /**
   * Fija la prenda que debe aparecer en todos los looks.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onMustInclude(event: Event): void {
    this.mustIncludeGarmentId.set((event.target as HTMLSelectElement).value);
  }

  /**
   * Fija cuántos looks se piden.
   * @param {Event} event - Evento `change` del select.
   * @returns {void}
   */
  protected onLimit(event: Event): void {
    const parsed = Number((event.target as HTMLSelectElement).value);
    this.limit.set(Number.isFinite(parsed) ? parsed : defaultLooksPerRequest);
  }

  /**
   * Alterna la inclusión de prendas todavía sin confirmar.
   * @param {Event} event - Evento `change` de la casilla.
   * @returns {void}
   */
  protected onIncludeSuggested(event: Event): void {
    this.includeSuggested.set((event.target as HTMLInputElement).checked);
  }

  /**
   * Prendas disponibles de un slot concreto.
   * @param {GarmentSlot} slot - Slot del catálogo.
   * @returns {Garment[]}
   */
  protected garmentsFor(slot: GarmentSlot): Garment[] {
    return this.garmentsBySlot().get(slot) ?? [];
  }

  /**
   * Emite la petición con la configuración actual del panel.
   * @returns {void}
   */
  protected submit(): void {
    const climate = this.climate();
    const occasion = this.occasion();
    this.submitted.emit({
      useStylist: this.useStylist() && this.stylistAvailable(),
      request: {
        styleTag: this.styleTag(),
        occasion: occasion === '' ? null : occasion,
        temperatureC: this.temperatureC(),
        climate: climate === '' ? null : climate,
        mustIncludeGarmentId: this.mustIncludeGarmentId() || null,
        includeSuggested: this.includeSuggested(),
        limit: this.limit(),
      },
    });
  }
}

/** Lo que emite el panel: la petición completa más a qué capa hay que llamar. */
export interface ILookRequestSubmission {
  request: GenerateOutfitsRequest;
  useStylist: boolean;
}
