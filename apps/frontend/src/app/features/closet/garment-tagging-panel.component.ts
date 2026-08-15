import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Sparkles } from 'lucide-angular';
import {
  enumLabels,
  maxVisionImages,
  type Garment,
  type GarmentTagging,
  type TaggableField,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { SubmitButtonComponent } from '../../shared/ui/submit-button.component';

/** Dígitos con los que se muestra un costo en dólares. Céntimos no bastan. */
const costFractionDigits = 4;

/**
 * Panel de etiquetado por IA dentro del diálogo de prenda.
 * @class
 */
@Component({
  selector: 'closet-tagging-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorBannerComponent, SubmitButtonComponent],
  templateUrl: './garment-tagging-panel.component.html',
  styleUrl: './garment-tagging-panel.component.scss',
})
export class GarmentTaggingPanelComponent {
  /** Prenda ya guardada, o null si todavía no existe en el servidor. */
  readonly garment = input<Garment | null>(null);
  /** Fotos que hay disponibles contando las que aún no se han subido. */
  readonly photoCount = input.required<number>();
  readonly running = input(false);
  /** Qué está pasando mientras `running`: subiendo la foto o analizándola. */
  readonly runningLabel = input('Analizando la foto…');
  readonly errorMessage = input<string | null>(null);

  /** Pide etiquetar. `true` es un reetiquetado explícito que vuelve a pagar. */
  readonly requested = output<boolean>();

  protected readonly iconSparkles = Sparkles;
  protected readonly labels = enumLabels;
  protected readonly usage = inject(AiUsageStore);

  /** Bloque de etiquetado de la prenda, o el estado inicial si aún no existe. */
  protected readonly tagging = computed<GarmentTagging | null>(
    () => this.garment()?.tagging ?? null,
  );

  /**
   * True cuando ya hay un borrador guardado y lo que procede es revisarlo. Una
   * negativa del modelo no cuenta: hay respuesta guardada pero no hay borrador,
   * así que lo que procede es cambiar las fotos, no revisar nada.
   */
  protected readonly hasDraft = computed(() => {
    const state = this.tagging();
    return state !== null && state.version !== null && state.usableForTagging;
  });

  /** True cuando el modelo dijo que de estas fotos no sale una prenda. */
  protected readonly isUnusable = computed(() => {
    const state = this.tagging();
    return state !== null && state.version !== null && !state.usableForTagging;
  });

  protected readonly canRun = computed(() => this.photoCount() > 0 && !this.running());

  /** Cuántas fotos entran de verdad en la llamada, contando el tope. */
  protected readonly imagesToSend = computed(() => Math.min(this.photoCount(), maxVisionImages));

  /**
   * Explica qué fotos se van a mandar. Se dice el número real y no "tus fotos":
   * si hay más de las que caben, el usuario tiene que poder saber que el resto se
   * queda fuera y elegir cuál es la portada.
   */
  protected readonly photosLabel = computed(() => {
    const total = this.photoCount();
    const sending = this.imagesToSend();
    if (total === 0) {
      return null;
    }
    if (total === 1) {
      return 'Se analizará la única foto que hay.';
    }
    if (sending < total) {
      return `Se analizarán ${sending} de las ${total} fotos: la portada y las siguientes por orden de subida.`;
    }
    return `Se analizarán las ${sending} fotos juntas, empezando por la portada.`;
  });

  /**
   * Si la siguiente pulsación pide una llamada nueva —y por tanto cuesta— o si
   * es un reintento gratis sobre el job que ya estaba reservado.
   */
  protected readonly costsNewCall = computed(() => {
    const state = this.tagging();
    if (!state) {
      return false;
    }
    // Una negativa del modelo no necesita `force`: con las mismas fotos el
    // servidor reaplica el mismo veredicto gratis, y en cuanto cambian las fotos
    // abre un job nuevo por sí solo.
    if (this.isUnusable()) {
      return false;
    }
    if (state.status === 'FAILED') {
      return !state.canRetry;
    }
    return this.hasDraft();
  });

  /** Etiqueta del botón: etiquetar, reintentar o pedir una llamada nueva. */
  protected readonly actionLabel = computed(() => {
    if (this.isUnusable()) {
      return 'Analizar otra vez';
    }
    if (this.tagging()?.status === 'FAILED') {
      return this.costsNewCall() ? 'Volver a etiquetar' : 'Reintentar etiquetado';
    }
    return this.hasDraft() ? 'Volver a etiquetar' : 'Etiquetar con IA';
  });

  /** Costo de la última llamada, formateado, o null si todavía no hubo. */
  protected readonly costLabel = computed(() => {
    const costUsd = this.tagging()?.costUsd;
    return typeof costUsd === 'number' ? `${costUsd.toFixed(costFractionDigits)} USD` : null;
  });

  /** Gasto del mes frente al techo, ya formateado. */
  protected readonly monthLabel = computed(() => {
    const summary = this.usage.summary();
    if (!summary) {
      return null;
    }
    return `${summary.committedUsd.toFixed(costFractionDigits)} de ${summary.monthlyBudgetUsd.toFixed(2)} USD este mes`;
  });

  /** Atributos que el modelo dijo no ver claros y que el usuario no ha tocado. */
  protected readonly reviewLabels = computed(() => {
    const tagging = this.tagging();
    // Si el modelo se negó no hay atributos que revisar; lo que haya en
    // `reviewFields` viene de un borrador anterior y ya no describe nada.
    if (!tagging || this.isUnusable()) {
      return [];
    }
    const manual = new Set<TaggableField>(tagging.manualFields);
    return tagging.reviewFields
      .filter(field => !manual.has(field))
      .map(field => enumLabels.taggableField[field]);
  });

  /** Atributos que el usuario corrigió y que un reetiquetado respetará. */
  protected readonly manualLabels = computed(() =>
    (this.tagging()?.manualFields ?? []).map(field => enumLabels.taggableField[field]),
  );

  /**
   * Lanza el etiquetado. Una llamada nueva se marca como tal para que el
   * servidor sepa que puede volver a pagar y pisar las correcciones manuales.
   * @returns {void}
   */
  protected run(): void {
    this.requested.emit(this.costsNewCall());
  }
}
