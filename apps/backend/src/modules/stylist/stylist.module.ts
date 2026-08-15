import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GarmentsModule } from '../garments/garments.module';
import { ProfileModule } from '../profile/profile.module';
import { StylistLlmService } from './llm/stylist-llm.service';
import { OutfitsController } from './outfits.controller';
import { OutfitsService } from './outfits.service';
import { StyleHistoryService } from './style-history.service';
import { StylistController } from './stylist.controller';
import { StylistService } from './stylist.service';

/**
 * Las dos capas del motor de recomendación.
 *
 */
@Module({
  imports: [AiModule, GarmentsModule, ProfileModule],
  controllers: [StylistController, OutfitsController],
  providers: [StylistService, StylistLlmService, StyleHistoryService, OutfitsService],
  exports: [StylistService, OutfitsService],
})
export class StylistModule {}
