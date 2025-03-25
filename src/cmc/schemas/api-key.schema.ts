import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ApiKeyDocument = ApiKey & Document;

@Schema()
export class ApiKey {
  @Prop({ required: true })
  key: string;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop({ default: false })
  isLimitReached: boolean;

  @Prop({ default: Date.now })
  lastUsed: Date;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey); 