import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// User Preferences Schema
@Schema()
export class UserPreference extends Document {
  @Prop({ required: true, unique: true })
  userId: string;

  @Prop({ default: 0 })
  stockSearches: number;

  @Prop({ default: 0 })
  cryptoSearches: number;

  @Prop({ type: Map, of: String, default: {} })
  queryPreferences: Map<string, string>;
}

export const UserPreferenceSchema = SchemaFactory.createForClass(UserPreference);

// Symbol Database Schema
@Schema()
export class SymbolData extends Document {
  @Prop({ required: true, unique: true })
  symbol: string;

  @Prop({ required: true, enum: ['stock', 'crypto'] })
  type: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], default: [] })
  aliases: string[];

  @Prop({ required: true, min: 1, max: 100 })
  popularity: number;
}

export const SymbolDataSchema = SchemaFactory.createForClass(SymbolData);

// User Lists Schema
@Schema()
export class UserList extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  listName: string;

  @Prop({ type: [String], default: [] })
  symbols: string[];

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const UserListSchema = SchemaFactory.createForClass(UserList);

// Alert List Schema
@Schema()
export class AlertList extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  listName: string;

  @Prop({ type: [String], default: [] })
  symbols: string[];

  @Prop({ type: Map, of: Number, default: {} })
  lastPrices: Map<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  highThresholds: Map<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  lowThresholds: Map<string, number>;

  @Prop({ type: Number, default: 5 })
  percentChangeThreshold: number;

  @Prop({ default: false })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isGroupChat: boolean;

  @Prop({ type: String, default: null })
  chatId: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop({ default: null })
  lastCheckTime: Date;
}

export const AlertListSchema = SchemaFactory.createForClass(AlertList);

// Mongoose'un ensureIndex/createIndex işlevlerini kullanarak index oluşturma
UserListSchema.index({ userId: 1, listName: 1 }, { unique: true });
AlertListSchema.index({ userId: 1, listName: 1 }, { unique: true }); 