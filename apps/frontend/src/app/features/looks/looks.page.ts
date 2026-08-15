import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Shirt, Sparkles } from 'lucide-angular';
import {
  enumLabels,
  type GenerateOutfitsRequest,
  type Outfit,
  type OutfitFeedbackRequest,
  type OutfitRejectedReason,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { LayoutService } from '../../core/layout/layout.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { DialogComponent } from '../../shared/ui/dialog.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ClosetStore } from '../closet/closet.store';
import { ProfileStore } from '../profile/profile.store';
import { LookCardComponent } from './look-card.component';
import {
  LookRequestFormComponent,
  type ILookRequestSubmission,
} from './look-request-form.component';
import { LooksStore } from './looks.store';
import { OutfitsStore } from './outfits.store';

const skeletonCards = 2;
const costFractionDigits = 4;

/**
 * Página de looks: panel de generación más las fichas.
 * @class
 */
@Component({
  selector: 'app-looks-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DialogComponent,
    EmptyStateComponent,
    ErrorBannerComponent,
    LookCardComponent,
    LookRequestFormComponent,
    SkeletonComponent,
  ],
  host: { style: 'display: flex; flex: 1; flex-direction: column' },
  templateUrl: './looks.page.html',
  styleUrl: './looks.page.scss',
})
export class LooksPage implements OnInit {
  protected readonly iconSparkles = Sparkles;
  protected readonly iconShirt = Shirt;
  protected readonly labels = enumLabels;
  protected readonly skeletonCards = Array.from({ length: skeletonCards }, (_unused, i) => i);

  protected readonly layout = inject(LayoutService);
  protected readonly usage = inject(AiUsageStore);
  private readonly _looks = inject(LooksStore);
  private readonly _outfits = inject(OutfitsStore);
  private readonly _closet = inject(ClosetStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _confirm = inject(ConfirmService);
  private readonly _notify = inject(NotificationService);

  /** True mientras se muestre lo que devolvió el estilista y no el motor. */
  protected readonly stylistMode = signal(true);
  protected readonly panelOpen = signal(false);
  /** Id del look sobre el que hay una acción en vuelo. */
  protected readonly pendingOutfitId = signal<string | null>(null);

  protected readonly looks = this._looks.looks;
  protected readonly outfits = this._outfits.outfits;
  protected readonly discarded = this._outfits.discarded;

  protected readonly loading = computed(() =>
    this.stylistMode() ? this._outfits.generating() : this._looks.loading(),
  );
  protected readonly error = computed(() =>
    this.stylistMode() ? this._outfits.error() : this._looks.error(),
  );
  protected readonly diagnostics = computed(() =>
    this.stylistMode() ? this._outfits.diagnostics() : this._looks.diagnostics(),
  );
  /** True si hay fichas que enseñar en la capa que se está mostrando. */
  protected readonly hasResults = computed(() =>
    this.stylistMode() ? this._outfits.outfits().length > 0 : this._looks.looks().length > 0,
  );

  /**
   * False hasta la primera generación: distingue "vacío" de "todavía no pediste".
   * En la capa del estilista basta con tener algún look guardado, porque el
   * historial no se borra al recargar.
   */
  protected readonly generated = computed(() =>
    this.stylistMode() ? this._outfits.outfits().length > 0 : this._looks.generated(),
  );

  /** Altura declarada en el perfil; la ficha la cita sólo si existe. */
  protected readonly heightCm = computed(() => this._profile.profile()?.heightCm ?? null);

  /** Sin prendas no hay nada que combinar: se manda al clóset antes de generar. */
  protected readonly closetIsEmpty = computed(
    () => this._closet.garments().length === 0 && !this._closet.loading(),
  );

  /** Avisos del motor: qué faltó, qué se quedó fuera y por qué. */
  protected readonly hints = computed(() => this.diagnostics()?.hints ?? []);

  /**
   * El estilista sólo se ofrece si el mes tiene presupuesto. Sin resumen cargado se
   * da por disponible: el servidor responde 503 con su motivo si no lo está, y
   * esconder el interruptor por no haber podido leer el gasto sería peor.
   */
  protected readonly stylistAvailable = computed(() => !this.usage.isExhausted());

  /** Costo de la última generación, formateado, o null si aún no hubo ninguna. */
  protected readonly costLabel = computed(() => {
    const costUsd = this._outfits.lastCostUsd();
    return costUsd === null ? null : `${costUsd.toFixed(costFractionDigits)} USD`;
  });

  /**
   * Carga clóset, perfil y gasto del mes, y deja la pantalla en blanco.
   *
   * Los looks **no** se recuperan al entrar: la página enseña la tanda que acabas de
   * pedir y nada más. El servidor los sigue guardando —la llamada se pagó y de ahí
   * sale el bucle de aprendizaje— pero eso es otra cosa que una galería.
   * @returns {void}
   */
  ngOnInit(): void {
    this._outfits.reset();
    this._looks.reset();
    void this._closet.load();
    void this._profile.load();
    void this.usage.load();
  }

  /**
   * Abre el panel de generación en pantallas donde no está siempre visible.
   * @returns {void}
   */
  protected openPanel(): void {
    this.panelOpen.set(true);
  }

  /**
   * Cierra el panel de generación.
   * @returns {void}
   */
  protected closePanel(): void {
    this.panelOpen.set(false);
  }

  /**
   * Pide los looks a la capa que eligió el usuario y cierra el panel.
   * @param {ILookRequestSubmission} submission - Configuración del panel.
   * @returns {Promise<void>}
   */
  protected async generate(submission: ILookRequestSubmission): Promise<void> {
    this.closePanel();
    this.stylistMode.set(submission.useStylist);
    if (submission.useStylist) {
      await this._generateWithStylist(submission.request);
      return;
    }
    const { request } = submission;
    await this._looks.generate({
      styleTag: request.styleTag,
      temperatureC: request.temperatureC,
      climate: request.climate,
      mustIncludeGarmentId: request.mustIncludeGarmentId,
      includeSuggested: request.includeSuggested,
      limit: request.limit,
    });
  }

  /**
   * Marca o desmarca un look como guardado.
   * @param {Outfit} outfit - Look afectado.
   * @param {boolean} isFavorite - Nuevo estado del favorito.
   * @returns {Promise<void>}
   */
  protected async toggleFavorite(outfit: Outfit, isFavorite: boolean): Promise<void> {
    await this._sendFeedback(outfit, { kind: 'FAVORITE', value: isFavorite }, null);
  }

  /**
   * Marca el look como usado. Suma un uso a cada prenda, que es lo que alimenta la
   * penalización por repetición del motor.
   * @param {Outfit} outfit - Look afectado.
   * @returns {Promise<void>}
   */
  protected async markWorn(outfit: Outfit): Promise<void> {
    await this._sendFeedback(outfit, { kind: 'WORN' }, 'Anotado: suma un uso a cada prenda.');
  }

  /**
   * Guarda la valoración del look.
   * @param {Outfit} outfit - Look afectado.
   * @param {number} rating - Nota de 1 a 5.
   * @returns {Promise<void>}
   */
  protected async rate(outfit: Outfit, rating: number): Promise<void> {
    await this._sendFeedback(outfit, { kind: 'RATING', rating }, null);
  }

  /**
   * Rechaza el look con su motivo.
   * @param {Outfit} outfit - Look afectado.
   * @param {OutfitRejectedReason} reason - Motivo del rechazo.
   * @returns {Promise<void>}
   */
  protected async reject(outfit: Outfit, reason: OutfitRejectedReason): Promise<void> {
    await this._sendFeedback(
      outfit,
      { kind: 'REJECTED', reason },
      'Anotado: la próxima tanda lo tendrá en cuenta.',
    );
  }

  /**
   * Borra un look guardado, preguntando antes.
   * @param {Outfit} outfit - Look a borrar.
   * @returns {Promise<void>}
   */
  protected async removeOutfit(outfit: Outfit): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Borrar el look',
      message: `Se borra "${outfit.title}" y su historial de valoraciones. Tus prendas no se tocan.`,
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.pendingOutfitId.set(outfit.id);
    try {
      await this._outfits.remove(outfit.id);
    } catch {
      this._notify.error('No se pudo borrar el look. Inténtalo otra vez.');
    } finally {
      this.pendingOutfitId.set(null);
    }
  }

  /**
   * Indica si hay una acción en vuelo sobre ese look.
   * @param {Outfit} outfit - Look de la ficha.
   * @returns {boolean}
   */
  protected isPending(outfit: Outfit): boolean {
    return this.pendingOutfitId() === outfit.id;
  }

  /**
   * Pide los looks al estilista y avisa de lo que el servidor descartó.
   * @private
   * @param {GenerateOutfitsRequest} request - Configuración del panel.
   * @returns {Promise<void>}
   */
  private async _generateWithStylist(request: GenerateOutfitsRequest): Promise<void> {
    const ok = await this._outfits.generate(request);
    if (!ok) {
      return;
    }
    const discarded = this._outfits.discarded();
    if (discarded.length > 0) {
      this._notify.warning(
        `El estilista propuso ${discarded.length} look(s) que no pasaron la validación del servidor.`,
      );
    }
  }

  /**
   * Manda un evento de feedback y refleja el resultado.
   * @private
   * @param {Outfit} outfit - Look afectado.
   * @param {Partial<OutfitFeedbackRequest> & Pick<OutfitFeedbackRequest, 'kind'>} feedback - Evento a registrar.
   * @param {string | null} successMessage - Aviso al usuario, si procede.
   * @returns {Promise<void>}
   */
  private async _sendFeedback(
    outfit: Outfit,
    feedback: Partial<OutfitFeedbackRequest> & Pick<OutfitFeedbackRequest, 'kind'>,
    successMessage: string | null,
  ): Promise<void> {
    this.pendingOutfitId.set(outfit.id);
    try {
      await this._outfits.addFeedback(outfit.id, {
        rating: null,
        reason: null,
        note: null,
        value: true,
        ...feedback,
      });
      if (successMessage !== null) {
        this._notify.success(successMessage);
      }
    } catch {
      this._notify.error('No se pudo guardar tu valoración. Inténtalo otra vez.');
    } finally {
      this.pendingOutfitId.set(null);
    }
  }
}
