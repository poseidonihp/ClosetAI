import { Module } from '@nestjs/common';
import { GarmentTypesController } from './garment-types.controller';
import { GarmentTypesService } from './garment-types.service';

@Module({
  controllers: [GarmentTypesController],
  providers: [GarmentTypesService],
  exports: [GarmentTypesService],
})
export class GarmentTypesModule {}
