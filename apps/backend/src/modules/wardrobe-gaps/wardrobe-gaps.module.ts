import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GarmentTypesModule } from '../garment-types/garment-types.module';
import { GarmentsModule } from '../garments/garments.module';
import { ProfileModule } from '../profile/profile.module';
import { GapsLlmService } from './llm/gaps-llm.service';
import { WardrobeGapsController } from './wardrobe-gaps.controller';
import { WardrobeGapsService } from './wardrobe-gaps.service';

/**
 * Análisis de vacíos del clóset: la cobertura determinista y quien la redacta.
 */
@Module({
  imports: [AiModule, GarmentsModule, GarmentTypesModule, ProfileModule],
  controllers: [WardrobeGapsController],
  providers: [WardrobeGapsService, GapsLlmService],
  exports: [WardrobeGapsService],
})
export class WardrobeGapsModule {}
