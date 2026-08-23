import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GarmentTypesModule } from '../garment-types/garment-types.module';
import { GarmentsModule } from '../garments/garments.module';
import { ProfileModule } from '../profile/profile.module';
import { AdviceLlmService } from './llm/advice-llm.service';
import { PurchaseAdviceController } from './purchase-advice.controller';
import { PurchaseAdviceService } from './purchase-advice.service';

/**
 * "¿Me lo compro?": la medición determinista sobre el motor y quien la redacta.
 */
@Module({
  imports: [AiModule, GarmentsModule, GarmentTypesModule, ProfileModule],
  controllers: [PurchaseAdviceController],
  providers: [PurchaseAdviceService, AdviceLlmService],
})
export class PurchaseAdviceModule {}
