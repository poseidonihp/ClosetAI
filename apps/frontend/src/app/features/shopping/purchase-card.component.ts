import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Loader, LucideAngularModule } from 'lucide-angular';
import {
  enumLabels,
  formalityLabel,
  type PurchaseCandidate,
  type PurchaseImpact,
  type PurchaseMeasurement,
  type PurchaseVerdict,
} from '@closetai/shared-types';
import type { PurchaseAction } from './shopping.types';

/**
 * Una prenda que el usuario está pensando comprar: sus atributos revisables, lo
 * que midió el motor y el veredicto si ya lo pidió.
 * @class
 */
@Component({
  selector: 'closet-purchase-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, RouterLink],
  host: { style: 'display: block' },
  templateUrl: './purchase-card.component.html',
  styleUrl: './purchase-card.component.scss',
})
export class PurchaseCardComponent {
  readonly candidate = input.required<PurchaseCandidate>();
  /** Medición gratis pedida en esta sesión, si la hay. */
  readonly measurement = input<PurchaseMeasurement | null>(null);
  /** True mientras hay una acción en vuelo, para no mandar dos veces lo mismo. */
  readonly busy = input<boolean>(false);
  /** Qué se está haciendo, para poder decirlo en vez de sólo bloquear el botón. */
  readonly busyAction = input<PurchaseAction | null>(null);
  /** False cuando el presupuesto del mes no da para pagar la redacción. */
  readonly evaluationAvailable = input<boolean>(true);

  readonly measured = output();
  readonly evaluated = output();
  readonly edited = output();
  readonly purchased = output();
  readonly dismissed = output();
  readonly reopened = output();
  readonly removed = output();
  readonly forgotten = output();
  /** El usuario quiere ver en su lista la brecha que el veredicto le propuso. */
  readonly alternativeOpened = output();

  protected readonly iconLoader = Loader;
  protected readonly labels = enumLabels;
  protected readonly formalityLabel = formalityLabel;

  protected readonly garment = computed(() => this.candidate().garment);
  protected readonly advice = computed(() => this.candidate().advice);
  protected readonly status = computed(() => this.advice()?.status ?? 'OPEN');

  /** Portada de la candidata, si ya subió alguna foto. */
  protected readonly cover = computed(() => this.garment().photos[0] ?? null);

  /**
   * El veredicto vigente: el guardado si lo hay, y si no el de la última
   * medición gratis. Los dos salen del mismo cálculo, así que no pueden discrepar.
   */
  protected readonly verdict = computed<PurchaseVerdict | null>(
    () => this.advice()?.verdict ?? this.measurement()?.verdict ?? null,
  );

  protected readonly verdictReason = computed(
    () => this.advice()?.verdictReason ?? this.measurement()?.verdictReason ?? null,
  );

  /** Los números del motor, vengan del veredicto guardado o de la medición. */
  protected readonly impact = computed<PurchaseImpact | null>(
    () => this.advice()?.impact ?? this.measurement()?.impact ?? null,
  );

  protected readonly pairedGarments = computed(
    () => this.advice()?.pairedGarments ?? this.measurement()?.pairedGarments ?? [],
  );

  protected readonly duplicateGarments = computed(
    () => this.advice()?.duplicateGarments ?? this.measurement()?.duplicateGarments ?? [],
  );

  /** True si ya se puede pedir la redacción: hay algo medido que contar. */
  protected readonly canEvaluate = computed(() => {
    const measurement = this.measurement();
    return measurement === null || measurement.canWriteAdvice;
  });

  /** La respuesta honesta a "cuántas combinaciones puedo hacer", en una frase. */
  protected readonly numbersLabel = computed(() => {
    const impact = this.impact();
    if (impact === null) {
      return null;
    }
    const total = `Entra en ${impact.outfitsUsingItEstimate} conjunto(s)`;
    if (impact.unlockedOutfitsEstimate === 0) {
      return `${total}, ninguno imposible sin ella.`;
    }
    return `${total}, ${impact.unlockedOutfitsEstimate} de ellos imposibles sin ella.`;
  });

  /** Clase del distintivo del veredicto, para no repetir el `switch` en la plantilla. */
  protected readonly verdictClass = computed(() => {
    const verdict = this.verdict();
    if (verdict === 'RECOMMENDED') {
      return 'verdict-yes';
    }
    return verdict === 'NOT_RECOMMENDED' ? 'verdict-no' : 'verdict-maybe';
  });

  /** Aviso de privacidad cuando la foto incluye a una persona. */
  protected readonly showsPerson = computed(() => this.garment().tagging.personVisible);

  protected readonly isMeasuring = computed(() => this.busyAction() === 'measure');
  protected readonly isEvaluating = computed(() => this.busyAction() === 'evaluate');

  /** Etiqueta del botón del veredicto: pedirlo, repetirlo o esperar el que va. */
  protected readonly evaluateLabel = computed(() => {
    if (this.isEvaluating()) {
      return 'Pidiendo el veredicto…';
    }
    return this.advice() ? 'Volver a pedir el veredicto' : 'Pedir el veredicto · IA';
  });

  /**
   * Qué está esperando la ficha, en una frase. Sólo se anuncian las dos esperas
   * que el usuario nota: la del motor y la de la IA, que tarda segundos.
   */
  protected readonly waitingLabel = computed(() => {
    if (this.isMeasuring()) {
      return 'Midiendo tu clóset: metiendo la prenda y volviendo a armar conjuntos…';
    }
    if (this.isEvaluating()) {
      return 'Pidiéndole el veredicto a la IA. Puede tardar unos segundos; no cierres la página.';
    }
    return null;
  });
}
