import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GarmentsModule } from '../garments/garments.module';
import { ProfileModule } from '../profile/profile.module';
import { StylistLlmService } from './llm/stylist-llm.service';
import { OutfitsController } from './outfits.controller';
import { OutfitsService } from './outfits.service';
import { OutfitRendersController } from './render/outfit-renders.controller';
import { OutfitRendersService } from './render/outfit-renders.service';
import { RenderService } from './render/render.service';
import { StyleHistoryService } from './style-history.service';
import { StylistController } from './stylist.controller';
import { StylistService } from './stylist.service';

/**
 * Las dos capas del motor de recomendación, más el render visual de la Fase 6,
 * que se cuelga del look y no de una capa nueva.
 */
@Module({
  imports: [AiModule, GarmentsModule, ProfileModule],
  controllers: [StylistController, OutfitsController, OutfitRendersController],
  providers: [
    StylistService,
    StylistLlmService,
    StyleHistoryService,
    OutfitsService,
    RenderService,
    OutfitRendersService,
  ],
  exports: [StylistService, OutfitsService],
})
export class StylistModule {}
