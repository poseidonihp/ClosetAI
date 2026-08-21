import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type {
  Outfit,
  OutfitFeedbackRequest,
  OutfitRejectedReason,
  RenderQuote,
} from '@closetai/shared-types';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ApiClient } from '../../core/http/api.client';
import { NotificationService } from '../../core/notifications/notification.service';
import { LookCardComponent } from './look-card.component';
import type { IOutfitActionsStore } from './looks.types';

const costFractionDigits = 4;
const renderUnavailableMessage = 'El visual con IA no está disponible ahora mismo.';
const feedbackErrorMessage = 'No se pudo guardar tu valoración. Inténtalo otra vez.';

/**
 * Lista de fichas del estilista con sus acciones.
 *
 * Vive aparte de las páginas porque la tanda recién generada y los guardados
 * enseñan la misma ficha y la accionan igual; el store que reciben es lo único que
 * cambia entre las dos.
 * @class
 */
@Component({
  selector: 'closet-outfit-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LookCardComponent],
  host: { style: 'display: block' },
  templateUrl: './outfit-list.component.html',
  styleUrl: './outfit-list.component.scss',
})
export class OutfitListComponent {
  readonly outfits = input.required<readonly Outfit[]>();
  /** Store al que van las acciones: la tanda del estilista o los guardados. */
  readonly store = input.required<IOutfitActionsStore>();
  /** Altura declarada en el perfil. Sin ella, el bloque de ajuste no la menciona. */
  readonly heightCm = input<number | null>(null);

  private readonly _confirm = inject(ConfirmService);
  private readonly _notify = inject(NotificationService);

  /** Id del look sobre el que hay una acción en vuelo. */
  protected readonly pendingOutfitId = signal<string | null>(null);
  /** Id del look que está renderizando. Va aparte: tarda mucho más que valorar. */
  protected readonly renderingOutfitId = signal<string | null>(null);

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
      await this.store().remove(outfit.id);
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
   * Indica si ese look está renderizando ahora mismo.
   * @param {Outfit} outfit - Look de la ficha.
   * @returns {boolean}
   */
  protected isRendering(outfit: Outfit): boolean {
    return this.renderingOutfitId() === outfit.id;
  }

  /**
   * Genera el visual del look, confirmando antes lo que cuesta.
   *
   * El costo se pregunta al servidor —es determinista y gratis— y se enseña en la
   * confirmación: pagar una imagen sin saber cuánto vale no es una opción, y el
   * aviso de que el render es aspiracional va en el mismo sitio donde se acepta.
   * @param {Outfit} outfit - Look a renderizar.
   * @returns {Promise<void>}
   */
  protected async renderOutfit(outfit: Outfit): Promise<void> {
    const quote = await this._quoteRender(outfit);
    if (quote === null) {
      return;
    }
    if (!quote.available) {
      this._notify.warning(quote.unavailableReason ?? renderUnavailableMessage);
      return;
    }

    const confirmed = await this._confirm.ask({
      title: 'Generar el visual del look',
      message: [
        `Se manda ${quote.imageCount} foto(s) de tus prendas a la IA y cuesta unos`,
        `${quote.estimatedCostUsd.toFixed(costFractionDigits)} USD.`,
        'La imagen es una aproximación: puede cambiar colores, texturas y logos, y la ficha con tus',
        'fotos sigue siendo la referencia real.',
      ].join(' '),
      confirmLabel: 'Generar',
    });
    if (!confirmed) {
      return;
    }

    this.renderingOutfitId.set(outfit.id);
    try {
      const costUsd = await this.store().render(outfit.id);
      this._notify.success(`Visual generado por ${costUsd.toFixed(costFractionDigits)} USD.`);
    } catch (error) {
      this._notify.error(ApiClient.messageFromError(error));
    } finally {
      this.renderingOutfitId.set(null);
    }
  }

  /**
   * Borra un visual del look, preguntando antes.
   * @param {Outfit} outfit - Look al que pertenece.
   * @param {string} renderId - Visual a borrar.
   * @returns {Promise<void>}
   */
  protected async removeRender(outfit: Outfit, renderId: string): Promise<void> {
    const confirmed = await this._confirm.ask({
      title: 'Borrar el visual',
      message: 'Se borra la imagen generada. El look y tus prendas no se tocan.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.renderingOutfitId.set(outfit.id);
    try {
      await this.store().removeRender(outfit.id, renderId);
    } catch (error) {
      this._notify.error(ApiClient.messageFromError(error));
    } finally {
      this.renderingOutfitId.set(null);
    }
  }

  /**
   * Pide el costo del render, o null si no se pudo consultar.
   * @private
   * @param {Outfit} outfit - Look a renderizar.
   * @returns {Promise<RenderQuote | null>}
   */
  private async _quoteRender(outfit: Outfit): Promise<RenderQuote | null> {
    this.renderingOutfitId.set(outfit.id);
    try {
      return await this.store().renderQuote(outfit.id);
    } catch (error) {
      this._notify.error(ApiClient.messageFromError(error));
      return null;
    } finally {
      this.renderingOutfitId.set(null);
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
      await this.store().addFeedback(outfit.id, {
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
      this._notify.error(feedbackErrorMessage);
    } finally {
      this.pendingOutfitId.set(null);
    }
  }
}
