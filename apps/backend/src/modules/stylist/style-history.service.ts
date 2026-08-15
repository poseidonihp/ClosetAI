import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { emptyFeedback, type IStyleFeedback } from './engine/learning';
import { garmentSetKey } from './engine/outfit-draft';

/**
 * Cuántos looks del historial se miran.
 */
const maxHistoryOutfits = 60;
/** Valoración a partir de la cual un look cuenta como que le gustó. */
const likedRatingThreshold = 4;

/**
 * Traduce el historial de looks del usuario en la entrada que consume el motor.
 * @class
 */
@Injectable()
export class StyleHistoryService {
  /**
   * Inicializa el servicio de historial de estilo.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   */
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Carga las valoraciones recientes del usuario.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<IStyleFeedback>}
   */
  async load(userId: string): Promise<IStyleFeedback> {
    const outfits = await this._prisma.outfit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: maxHistoryOutfits,
      select: {
        rejectedReason: true,
        isFavorite: true,
        wornAt: true,
        rating: true,
        items: { select: { garmentId: true } },
      },
    });
    if (outfits.length === 0) {
      return emptyFeedback;
    }

    const rejected = outfits
      .filter(outfit => outfit.rejectedReason !== null)
      .map(outfit => ({
        reason: outfit.rejectedReason,
        garmentIds: outfit.items.map(item => item.garmentId),
      }));
    const likedGarmentIds = outfits
      .filter(outfit => StyleHistoryService._wasLiked(outfit))
      .flatMap(outfit => outfit.items.map(item => item.garmentId));

    return {
      rejected,
      generatedKeys: outfits.map(outfit => garmentSetKey(outfit.items.map(item => item.garmentId))),
      likedGarmentIds: [...new Set(likedGarmentIds)],
    };
  }

  /**
   * Indica si el usuario dio por bueno el look: lo guardó como favorito, se lo
   * puso, o lo valoró alto. Rechazarlo manda sobre las tres cosas, porque es la
   * decisión más reciente y la más explícita.
   * @private
   * @param {{ isFavorite: boolean; wornAt: Date | null; rating: number | null; rejectedReason: unknown }} outfit - Estado del look.
   * @returns {boolean}
   */
  private static _wasLiked(outfit: {
    isFavorite: boolean;
    wornAt: Date | null;
    rating: number | null;
    rejectedReason: unknown;
  }): boolean {
    if (outfit.rejectedReason !== null) {
      return false;
    }
    return (
      outfit.isFavorite ||
      outfit.wornAt !== null ||
      (outfit.rating !== null && outfit.rating >= likedRatingThreshold)
    );
  }
}
