import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module';
import { CmcModule } from '../cmc/cmc.module';
import { PriceService } from './price.service';
import { YahooModule } from '../yahoo/yahoo.module';

@Module({
  imports: [
    BinanceModule,
    CmcModule,
    YahooModule,
  ],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {} 