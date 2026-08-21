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
import { enumLabels, type GenerateOutfitsRequest } from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
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
import { OutfitListComponent } from './outfit-list.component';
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
    OutfitListComponent,
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
  /** Público porque la lista de fichas lo recibe como entrada. */
  protected readonly outfitsStore = inject(OutfitsStore);
  private readonly _looks = inject(LooksStore);
  private readonly _closet = inject(ClosetStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _notify = inject(NotificationService);

  /** True mientras se muestre lo que devolvió el estilista y no el motor. */
  protected readonly stylistMode = signal(true);
  protected readonly panelOpen = signal(false);

  protected readonly looks = this._looks.looks;
  protected readonly outfits = this.outfitsStore.outfits;
  protected readonly discarded = this.outfitsStore.discarded;

  protected readonly loading = computed(() =>
    this.stylistMode() ? this.outfitsStore.generating() : this._looks.loading(),
  );
  protected readonly error = computed(() =>
    this.stylistMode() ? this.outfitsStore.error() : this._looks.error(),
  );
  protected readonly diagnostics = computed(() =>
    this.stylistMode() ? this.outfitsStore.diagnostics() : this._looks.diagnostics(),
  );
  /** True si hay fichas que enseñar en la capa que se está mostrando. */
  protected readonly hasResults = computed(() =>
    this.stylistMode() ? this.outfitsStore.outfits().length > 0 : this._looks.looks().length > 0,
  );

  /**
   * False hasta la primera generación: distingue "vacío" de "todavía no pediste".
   * En la capa del estilista basta con tener algún look guardado, porque el
   * historial no se borra al recargar.
   */
  protected readonly generated = computed(() =>
    this.stylistMode() ? this.outfitsStore.outfits().length > 0 : this._looks.generated(),
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
    const costUsd = this.outfitsStore.lastCostUsd();
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
    this.outfitsStore.reset();
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
   * Pide los looks al estilista y avisa de lo que el servidor descartó.
   * @private
   * @param {GenerateOutfitsRequest} request - Configuración del panel.
   * @returns {Promise<void>}
   */
  private async _generateWithStylist(request: GenerateOutfitsRequest): Promise<void> {
    const ok = await this.outfitsStore.generate(request);
    if (!ok) {
      return;
    }
    const discarded = this.outfitsStore.discarded();
    if (discarded.length > 0) {
      this._notify.warning(
        `El estilista propuso ${discarded.length} look(s) que no pasaron la validación del servidor.`,
      );
    }
  }
}
