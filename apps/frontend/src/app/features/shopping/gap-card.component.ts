import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { enumLabels, formalityLabel, type WardrobeGap } from '@closetai/shared-types';

/**
 * Una brecha del clóset: qué comprar, qué desbloquea y con qué marcas orientarse.
 * @class
 */
@Component({
  selector: 'closet-gap-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
  templateUrl: './gap-card.component.html',
  styleUrl: './gap-card.component.scss',
})
export class GapCardComponent {
  readonly gap = input.required<WardrobeGap>();
  /** True mientras hay una acción en vuelo, para no mandar dos veces lo mismo. */
  readonly busy = input<boolean>(false);

  readonly purchased = output();
  readonly dismissed = output();
  readonly reopened = output();

  protected readonly labels = enumLabels;
  protected readonly formalityLabel = formalityLabel;

  /** Marcas de referencia sólo si el análisis propuso alguna. */
  protected readonly hasReferenceBrands = computed(() => {
    const brands = this.gap().referenceBrands;
    return brands.luxury.length + brands.affordable.length > 0;
  });

  /** Qué desbloquea, en una frase, o null si la estimación es cero. */
  protected readonly unlockedText = computed(() => {
    const count = this.gap().unlockedOutfitsEstimate;
    if (count === 0) {
      return null;
    }
    return count === 1 ? 'Desbloquea 1 conjunto nuevo' : `Desbloquea ${count} conjuntos nuevos`;
  });
}
