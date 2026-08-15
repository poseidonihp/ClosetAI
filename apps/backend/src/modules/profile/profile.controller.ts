import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  UpdateStyleProfileSchema,
  type AuthenticatedUser,
  type StyleProfile,
  type UpdateStyleProfile,
} from '@closetai/shared-types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  /**
   * Inicializa el controlador de perfil.
   * @constructor
   * @param {ProfileService} _profile - Servicio de perfil de estilo.
   */
  constructor(private readonly _profile: ProfileService) {}

  /**
   * Devuelve el perfil de estilo del usuario de la sesión.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {Promise<StyleProfile>}
   */
  @Get()
  get(@CurrentUser() user: AuthenticatedUser): Promise<StyleProfile> {
    return this._profile.get(user.id);
  }

  /**
   * Actualiza parcialmente el perfil de estilo.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {UpdateStyleProfile} dto - Campos a modificar.
   * @returns {Promise<StyleProfile>}
   */
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateStyleProfileSchema)) dto: UpdateStyleProfile,
  ): Promise<StyleProfile> {
    return this._profile.update(user.id, dto);
  }
}
