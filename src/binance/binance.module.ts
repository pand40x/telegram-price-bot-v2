import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BinanceService } from './binance.service';
import { BinancePrice, BinancePriceSchema } from './schemas/binance-price.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BinancePrice.name, schema: BinancePriceSchema },
    ]),
  ],
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {} 