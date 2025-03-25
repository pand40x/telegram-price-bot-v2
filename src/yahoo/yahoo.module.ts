import { Module } from '@nestjs/common';
import { YahooService } from './yahoo.service';

@Module({
  providers: [YahooService],
  exports: [YahooService],
})
export class YahooModule {} 