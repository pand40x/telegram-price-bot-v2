import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CmcService } from './cmc.service';
import { ApiKey, ApiKeySchema } from './schemas/api-key.schema';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: ApiKey.name, schema: ApiKeySchema },
    ]),
  ],
  providers: [CmcService],
  exports: [CmcService],
})
export class CmcModule {} 