import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BinancePriceDocument = BinancePrice & Document;

@Schema()
export class BinancePrice {
  @Prop({ required: true, unique: true })
  symbol: string;

  @Prop({ required: true })
  price: number;

  @Prop({ default: 0 })
  percentChange24h: number;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const BinancePriceSchema = SchemaFactory.createForClass(BinancePrice); 