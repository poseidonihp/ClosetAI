import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GarmentTypesModule } from '../garment-types/garment-types.module';
import { GarmentPhotosService } from './garment-photos.service';
import { GarmentTaggingService } from './garment-tagging.service';
import { GarmentsController } from './garments.controller';
import { GarmentsService } from './garments.service';
import { VisionService } from './vision/vision.service';

@Module({
  imports: [GarmentTypesModule, AiModule],
  controllers: [GarmentsController],
  providers: [GarmentsService, GarmentPhotosService, GarmentTaggingService, VisionService],
  exports: [GarmentsService],
})
export class GarmentsModule {}
