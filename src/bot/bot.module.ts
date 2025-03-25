import { Module } from '@nestjs/common';
import { BotUpdate } from './bot.update';
import { PriceService } from '../price/price.service';
import { SymbolService } from '../symbol/symbol.service';
import { MongooseModule } from '@nestjs/mongoose';
import { SymbolData, SymbolDataSchema } from '../symbol/symbol.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SymbolData.name, schema: SymbolDataSchema }
    ])
  ],
  providers: [BotUpdate, PriceService, SymbolService],
  exports: [BotUpdate]
})
export class BotModule {} 