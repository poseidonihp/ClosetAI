import { Injectable, Logger } from '@nestjs/common';
import type {
  GenerateLooksRequest,
  GenerateLooksResponse,
  LooksDebugResponse,
} from '@closetai/shared-types';
import { GarmentsService } from '../garments/garments.service';
import { ProfileService } from '../profile/profile.service';
import { engineVersion } from './engine/engine.constants';
import { generateLooks, toEngineRequest } from './engine/engine';
import type { IEngineInput, IEngineResult } from './engine/engine.types';
import { allGarments, garmentIds } from './engine/outfit-draft';
import { StyleHistoryService } from './style-history.service';

/**
 * Puente entre el motor y los datos del usuario.
 * @class
 */
@Injectable()
export class StylistService {
  private readonly _logger = new Logger(StylistService.name);

  /**
   * Inicializa el servicio de estilismo.
   * @constructor
   * @param {GarmentsService} _garments - Prendas del usuario.
   * @param {ProfileService} _profile - Perfil de estilo del usuario.
   * @param {StyleHistoryService} _history - Valoraciones de looks anteriores.
   */
  constructor(
    private readonly _garments: GarmentsService,
    private readonly _profile: ProfileService,
    private readonly _history: StyleHistoryService,
  ) {}

  /**
   * Genera looks deterministas con las prendas del usuario.
   * @param {string} userId - Usuario autenticado.
   * @param {GenerateLooksRequest} request - Petición de looks.
   * @returns {Promise<GenerateLooksResponse>}
   */
  async generate(userId: string, request: GenerateLooksRequest): Promise<GenerateLooksResponse> {
    const { result } = await this.runEngine(userId, request);
    return { looks: result.looks, diagnostics: result.diagnostics, engineVersion };
  }

  /**
   * Expone lo que vio el motor: prendas elegibles, descartes con su motivo y
   * candidatos puntuados. Va scoped por usuario como cualquier otro endpoint.
   * @param {string} userId - Usuario autenticado.
   * @param {GenerateLooksRequest} request - Petición de looks.
   * @returns {Promise<LooksDebugResponse>}
   */
  async debug(userId: string, request: GenerateLooksRequest): Promise<LooksDebugResponse> {
    const { input, result } = await this.runEngine(userId, request);
    return {
      engineVersion,
      resolvedTemperatureC: input.request.temperatureC,
      eligible: result.eligible.map(garment => ({
        garmentId: garment.id,
        name: garment.name,
        slot: garment.slot,
        formality: garment.formality,
      })),
      excluded: result.excluded,
      candidates: result.scored.map(candidate => ({
        id: garmentIds(candidate.draft).join('-'),
        garmentIds: garmentIds(candidate.draft),
        garmentNames: StylistService._namesOf(candidate),
        engineScore: candidate.engineScore,
        scoreBreakdown: candidate.breakdown,
      })),
      diagnostics: result.diagnostics,
    };
  }

  /**
   * Carga los datos del usuario y ejecuta el motor. Es público porque la Capa 2
   * parte de este mismo resultado: el estilista no vuelve a enumerar candidatos,
   * elige entre los que ya puntuó el motor.
   * @param {string} userId - Usuario autenticado.
   * @param {GenerateLooksRequest} request - Petición de looks.
   * @returns {Promise<{ input: IEngineInput; result: IEngineResult }>}
   */
  async runEngine(
    userId: string,
    request: GenerateLooksRequest,
  ): Promise<{ input: IEngineInput; result: IEngineResult }> {
    const [garments, profile, feedback] = await Promise.all([
      this._garments.list(userId, {}),
      this._profile.get(userId),
      this._history.load(userId),
    ]);

    const input: IEngineInput = {
      garments,
      profile,
      feedback,
      request: toEngineRequest(request, profile),
      now: new Date(),
    };
    const result = generateLooks(input);

    if (result.diagnostics.truncated) {
      this._logger.warn(
        `StylistService > runEngine - enumeración truncada para el usuario ${userId} (${result.eligible.length} prendas elegibles)`,
      );
    }
    if (result.looks.length === 0) {
      this._logger.log(
        `StylistService > runEngine - sin candidatos para el usuario ${userId}: ${result.diagnostics.note ?? 'sin nota'}`,
      );
    }
    return { input, result };
  }

  /**
   * Nombres de las prendas de un candidato, en el orden de la ficha.
   * @private
   * @param {IEngineResult['scored'][number]} candidate - Candidato puntuado.
   * @returns {string[]}
   */
  private static _namesOf(candidate: IEngineResult['scored'][number]): string[] {
    return allGarments(candidate.draft).map(garment => garment.name);
  }
}
