import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Shirt, ShoppingBag } from 'lucide-angular';
import { enumLabels, type WardrobeGap } from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ClosetStore } from '../closet/closet.store';
import type { IGarmentPrefill } from '../closet/closet.types';
import { GarmentDialogComponent } from '../closet/garment-dialog.component';
import { GapCardComponent } from './gap-card.component';
import { GapsStore } from './gaps.store';

const skeletonCards = 2;
const costFractionDigits = 4;

/**
 * Página "Qué comprar": la cobertura del clóset y las brechas priorizadas.
 * @class
 */
@Component({
  selector: 'app-shopping-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    ErrorBannerComponent,
    GapCardComponent,
    GarmentDialogComponent,
    SkeletonComponent,
  ],
  host: { style: 'display: flex; flex: 1; flex-direction: column' },
  templateUrl: './shopping.page.html',
  styleUrl: './shopping.page.scss',
})
export class ShoppingPage implements OnInit {
  protected readonly iconBag = ShoppingBag;
  protected readonly iconShirt = Shirt;
  protected readonly labels = enumLabels;
  protected readonly skeletonCards = Array.from({ length: skeletonCards }, (_unused, i) => i);

  protected readonly usage = inject(AiUsageStore);
  private readonly _gaps = inject(GapsStore);
  private readonly _closet = inject(ClosetStore);
  private readonly _confirm = inject(ConfirmService);
  private readonly _notify = inject(NotificationService);

  protected readonly coverage = this._gaps.coverage;
  protected readonly note = this._gaps.note;
  protected readonly discarded = this._gaps.discarded;
  protected readonly openGaps = this._gaps.openGaps;
  protected readonly resolvedGaps = this._gaps.resolvedGaps;
  protected readonly loading = this._gaps.loading;
  protected readonly analyzing = this._gaps.analyzing;
  protected readonly error = this._gaps.error;

  /** Brecha sobre la que hay una acción en vuelo. */
  protected readonly pendingGapId = signal<string | null>(null);
  /** Datos con los que se abre el alta al marcar una brecha como comprada. */
  protected readonly prefill = signal<IGarmentPrefill | null>(null);

  /** Sin prendas no hay cobertura que medir: se manda al clóset antes de analizar. */
  protected readonly closetIsEmpty = computed(
    () => this._closet.garments().length === 0 && !this._closet.loading(),
  );

  /**
   * El análisis sólo se ofrece si el mes tiene presupuesto. Sin resumen cargado se
   * da por disponible: el servidor responde 503 con su motivo si no lo está.
   */
  protected readonly analysisAvailable = computed(() => !this.usage.isExhausted());

  /** Escenarios que el clóset no cubre, para explicarlos sin pagar nada. */
  protected readonly uncoveredScenarios = computed(() => {
    const coverage = this.coverage();
    if (!coverage) {
      return [];
    }
    return coverage.scenarios.filter(scenario =>
      coverage.uncoveredScenarioIds.includes(scenario.id),
    );
  });

  /** Costo del último análisis, formateado, o null si aún no hubo ninguno. */
  protected readonly costLabel = computed(() => {
    const costUsd = this._gaps.lastCostUsd();
    return costUsd === null ? null : `${costUsd.toFixed(costFractionDigits)} USD`;
  });

  /**
   * Carga las brechas guardadas, la cobertura, el clóset y el gasto del mes.
   * @returns {void}
   */
  ngOnInit(): void {
    void this._gaps.load();
    void this._closet.load();
    void this.usage.load();
  }

  /**
   * Pide el análisis con IA y cuenta lo que pasó.
   * @returns {Promise<void>}
   */
  protected async analyze(): Promise<void> {
    const response = await this._gaps.analyze();
    if (!response) {
      return;
    }
    if (response.reused) {
      this._notify.success(
        'Tu clóset no ha cambiado desde el último análisis: se reaplicó el guardado, sin volver a pagarlo.',
      );
      return;
    }
    if (response.gaps.length === 0) {
      this._notify.success('No hay brechas que proponer con el clóset que tienes ahora.');
    }
  }

  /**
   * Marca la brecha como comprada y abre el alta de prenda ya rellena.
   * @param {WardrobeGap} gap - Brecha afectada.
   * @returns {Promise<void>}
   */
  protected async markPurchased(gap: WardrobeGap): Promise<void> {
    if (!(await this._setStatus(gap, 'PURCHASED'))) {
      return;
    }
    this.prefill.set({
      name: `${gap.garmentTypeName} ${gap.colorName.toLowerCase()}`,
      garmentTypeId: gap.garmentTypeId,
      slot: gap.slot,
      formality: gap.formality,
      primaryColorHex: gap.colorHex,
      primaryColorName: gap.colorName,
    });
  }

  /**
   * Descarta una brecha, avisando de que no volverá a proponerse.
   * @param {WardrobeGap} gap - Brecha afectada.
   * @returns {Promise<void>}
   */
  protected async dismiss(gap: WardrobeGap): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Descartar la sugerencia',
      message: `"${gap.description}" deja la lista y los próximos análisis no volverán a proponerla. Puedes reabrirla cuando quieras.`,
      confirmLabel: 'Descartar',
    });
    if (confirmed) {
      await this._setStatus(gap, 'DISMISSED');
    }
  }

  /**
   * Devuelve una brecha resuelta a la lista pendiente.
   * @param {WardrobeGap} gap - Brecha afectada.
   * @returns {Promise<void>}
   */
  protected async reopen(gap: WardrobeGap): Promise<void> {
    await this._setStatus(gap, 'OPEN');
  }

  /**
   * Cierra el alta de prenda abierta desde una brecha y recalcula la cobertura:
   * si acaba de entrar la prenda que faltaba, la matriz de arriba ya no es cierta.
   * @returns {void}
   */
  protected closeDialog(): void {
    this.prefill.set(null);
    void this._gaps.load();
  }

  /**
   * Indica si hay una acción en vuelo sobre esa brecha.
   * @param {WardrobeGap} gap - Brecha de la ficha.
   * @returns {boolean}
   */
  protected isPending(gap: WardrobeGap): boolean {
    return this.pendingGapId() === gap.id;
  }

  /**
   * Manda el cambio de estado y refleja el resultado.
   * @private
   * @param {WardrobeGap} gap - Brecha afectada.
   * @param {WardrobeGap['status']} status - Nuevo estado.
   * @returns {Promise<boolean>}
   */
  private async _setStatus(gap: WardrobeGap, status: WardrobeGap['status']): Promise<boolean> {
    this.pendingGapId.set(gap.id);
    try {
      await this._gaps.updateStatus(gap.id, status);
      return true;
    } catch {
      this._notify.error('No se pudo guardar tu decisión. Inténtalo otra vez.');
      return false;
    } finally {
      this.pendingGapId.set(null);
    }
  }
}
