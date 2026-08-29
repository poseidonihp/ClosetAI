import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { GarmentTypesModule } from './modules/garment-types/garment-types.module';
import { GarmentsModule } from './modules/garments/garments.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { ProfileModule } from './modules/profile/profile.module';
import { PurchaseAdviceModule } from './modules/purchase-advice/purchase-advice.module';
import { StylistModule } from './modules/stylist/stylist.module';
import { WardrobeGapsModule } from './modules/wardrobe-gaps/wardrobe-gaps.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { validateEnv } from './config/env.validation';
import { aiThrottlerName, skipUnlessAiEndpoint } from './common/rate-limit.decorator';

const throttleWindowSeconds = 60;
const requestsPerWindow = 100;
const aiRequestsPerWindow = 12;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: seconds(throttleWindowSeconds),
        limit: requestsPerWindow,
      },
      {
        name: aiThrottlerName,
        ttl: seconds(throttleWindowSeconds),
        limit: aiRequestsPerWindow,
        skipIf: skipUnlessAiEndpoint,
      },
    ]),
    PrismaModule,
    StorageModule,
    AiModule,
    AuthModule,
    HealthModule,
    MediaModule,
    ProfileModule,
    GarmentTypesModule,
    GarmentsModule,
    StylistModule,
    WardrobeGapsModule,
    PurchaseAdviceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
