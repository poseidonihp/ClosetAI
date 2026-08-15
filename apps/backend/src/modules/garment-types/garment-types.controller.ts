import { Controller, Get } from '@nestjs/common';
import type { GarmentType } from '@closetai/shared-types';
import { GarmentTypesService } from './garment-types.service';

@Controller('garment-types')
export class GarmentTypesController {
  /**
   * Inicializa el controlador del catálogo.
   * @constructor
   * @param {GarmentTypesService} _garmentTypes - Servicio del catálogo.
   */
  constructor(private readonly _garmentTypes: GarmentTypesService) {}

  /**
   * Devuelve el catálogo completo. Exige sesión (guard global) pero no filtra por
   * usuario: el catálogo es el mismo para todos.
   * @returns {Promise<GarmentType[]>}
   */
  @Get()
  list(): Promise<GarmentType[]> {
    return this._garmentTypes.list();
  }
}
