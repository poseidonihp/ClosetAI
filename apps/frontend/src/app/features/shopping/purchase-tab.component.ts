import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScanLine, Shirt } from 'lucide-angular';
import type { PurchaseCandidate, PurchaseMeasurement } from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ClosetStore } from '../closet/closet.store';
import type { GarmentDialogMode } from '../closet/closet.types';
import { GarmentDialogComponent } from '../closet/garment-dialog.component';
import { PurchaseCardComponent } from './purchase-card.component';
import { PurchaseStore } from './purchase.store';
import type { PurchaseAction } from './shopping.types';

const skeletonCards = 2;
const costFractionDigits = 4;

/** Prenda abierta en el diálogo y con qué intención. */
interface IOpenDialog {
  candidate: PurchaseCandidate | null;
  mode: GarmentDialogMode;
}

/**
 * Pestaña "Evaluar": fotografías la prenda que tienes en la mano y el sistema
 * dice si encaja en tu clóset y cuántas combinaciones abre.
 * @class
 */
@Component({
  selector: 'closet-purchase-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    ErrorBannerComponent,
    GarmentDialogComponent,
    PurchaseCardComponent,
    SkeletonComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './purchase-tab.component.html',
  styleUrl: './purchase-tab.component.scss',
})
export class PurchaseTabComponent implements OnInit {
  protected readonly iconScan = ScanLine;
  protected readonly iconShirt = Shirt;
  protected readonly skeletonCards = Array.from({ length: skeletonCards }, (_unused, i) => i);

  protected readonly usage = inject(AiUsageStore);
  private readonly _purchases = inject(PurchaseStore);
  private readonly _closet = inject(ClosetStore);
  private readonly _confirm = inject(ConfirmService);
  private readonly _notify = inject(NotificationService);

  protected readonly loading = this._purchases.loading;
  protected readonly error = this._purchases.error;
  protected readonly measurements = this._purchases.measurements;
  protected readonly openCandidates = this._purchases.openCandidates;
  protected readonly resolvedCandidates = this._purchases.resolvedCandidates;

  /** Qué prenda está abierta en el diálogo y con qué intención. */
  protected readonly dialog = signal<IOpenDialog | null>(null);

  /** Sin prendas confirmadas no hay clóset contra el que medir nada. */
  protected readonly closetIsEmpty = computed(
    () => this._closet.garments().length === 0 && !this._closet.loading(),
  );

  /**
   * La redacción sólo se ofrece si el mes tiene presupuesto. Sin resumen cargado
   * se da por disponible: el servidor responde con su motivo si no lo está.
   */
  protected readonly evaluationAvailable = computed(() => !this.usage.isExhausted());

  /** Costo del último veredicto, formateado, o null si aún no hubo ninguno. */
  protected readonly costLabel = computed(() => {
    const costUsd = this._purchases.lastCostUsd();
    return costUsd === null ? null : `${costUsd.toFixed(costFractionDigits)} USD`;
  });

  /**
   * Carga las candidatas guardadas, el clóset y el gasto del mes.
   * @returns {void}
   */
  ngOnInit(): void {
    void this._purchases.load();
    void this._closet.load();
    void this.usage.load();
  }

  /**
   * Abre el diálogo para fotografiar y etiquetar una prenda nueva.
   * @returns {void}
   */
  protected startNew(): void {
    this.dialog.set({ candidate: null, mode: 'CANDIDATE' });
  }

  /**
   * Abre la candidata para revisar o corregir sus atributos antes de medirla.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {void}
   */
  protected edit(candidate: PurchaseCandidate): void {
    this.dialog.set({ candidate, mode: 'CANDIDATE' });
  }

  /**
   * Abre la candidata para confirmarla como comprada. La transición sólo ocurre
   * si el usuario guarda: cancelar la deja tal como estaba.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {void}
   */
  protected buy(candidate: PurchaseCandidate): void {
    this.dialog.set({ candidate, mode: 'PURCHASE' });
  }

  /**
   * Cierra el diálogo y vuelve a leer las candidatas: acaban de cambiar.
   * @returns {void}
   */
  protected closeDialog(): void {
    this.dialog.set(null);
    void this._purchases.load();
    void this._closet.load(true);
  }

  /**
   * Mide la candidata contra el clóset. Es gratis y se dice.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {Promise<void>}
   */
  protected async measure(candidate: PurchaseCandidate): Promise<void> {
    const measurement = await this._purchases.measure(candidate.garment.id);
    if (measurement && !measurement.canWriteAdvice) {
      this._notify.warning(measurement.note ?? 'Todavía no hay datos suficientes para medirla.');
    }
  }

  /**
   * Pide el veredicto redactado, avisando de lo que pasó con el gasto.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {Promise<void>}
   */
  protected async evaluate(candidate: PurchaseCandidate): Promise<void> {
    const response = await this._purchases.evaluate(candidate.garment.id);
    if (!response) {
      return;
    }
    if (response.advice === null) {
      this._notify.warning(
        response.measurement.note ?? 'No hay datos suficientes: no se llamó a la IA.',
      );
      return;
    }
    if (response.reused) {
      this._notify.success(
        'Ni la prenda ni tu clóset han cambiado: se reaplicó el veredicto guardado, sin volver a pagarlo.',
      );
    }
  }

  /**
   * Descarta la candidata dejándola en el historial.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {Promise<void>}
   */
  protected async dismiss(candidate: PurchaseCandidate): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Descartar la prenda',
      message: `"${candidate.garment.name}" pasa a las que ya decidiste. Puedes volver a considerarla cuando quieras.`,
      confirmLabel: 'Descartar',
    });
    if (confirmed) {
      await this._purchases.updateStatus(candidate.garment.id, 'DISMISSED');
    }
  }

  /**
   * Devuelve una candidata descartada a las que siguen sobre la mesa.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {Promise<void>}
   */
  protected async reopen(candidate: PurchaseCandidate): Promise<void> {
    await this._purchases.updateStatus(candidate.garment.id, 'OPEN');
  }

  /**
   * Borra la candidata y su veredicto, previa confirmación.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {Promise<void>}
   */
  protected async remove(candidate: PurchaseCandidate): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Borrar la prenda',
      message: `Se borran "${candidate.garment.name}", sus fotos y su veredicto. No se puede deshacer.`,
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (confirmed) {
      await this._purchases.remove(candidate.garment.id);
    }
  }

  /**
   * Quita de esta pantalla una prenda que ya compró. **No la borra del clóset**:
   * allí ya es una prenda más y se toca desde allí.
   * @param {PurchaseCandidate} candidate - Candidata afectada.
   * @returns {Promise<void>}
   */
  protected async forget(candidate: PurchaseCandidate): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Quitarla de esta lista',
      message: `"${candidate.garment.name}" desaparece de "¿Me lo compro?" junto con su veredicto. La prenda se queda en tu clóset tal como está.`,
      confirmLabel: 'Quitarla',
    });
    if (confirmed) {
      await this._purchases.forget(candidate.garment.id);
    }
  }

  /**
   * Indica si hay una acción en vuelo sobre esa candidata.
   * @param {PurchaseCandidate} candidate - Candidata de la ficha.
   * @returns {boolean}
   */
  protected isBusy(candidate: PurchaseCandidate): boolean {
    return this._purchases.busy()?.garmentId === candidate.garment.id;
  }

  /**
   * Qué se está haciendo sobre esa candidata, para que la ficha lo diga.
   * @param {PurchaseCandidate} candidate - Candidata de la ficha.
   * @returns {PurchaseAction | null}
   */
  protected busyActionOf(candidate: PurchaseCandidate): PurchaseAction | null {
    const busy = this._purchases.busy();
    return busy?.garmentId === candidate.garment.id ? busy.action : null;
  }

  /**
   * Última medición gratis de esa candidata, si se pidió en esta sesión.
   * @param {PurchaseCandidate} candidate - Candidata de la ficha.
   * @returns {PurchaseMeasurement | null}
   */
  protected measurementOf(candidate: PurchaseCandidate): PurchaseMeasurement | null {
    return this.measurements()[candidate.garment.id] ?? null;
  }
}
