import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AlertService } from './alert.service';
import { AlertList, AlertListSchema } from '../symbol/symbol.schema';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AlertList.name, schema: AlertListSchema }
    ]),
    PriceModule
  ],
  providers: [AlertService],
  exports: [AlertService]
})
export class AlertModule {} 