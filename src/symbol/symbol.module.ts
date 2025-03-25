import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SymbolService } from './symbol.service';
import { UserPreference, UserPreferenceSchema, SymbolData, SymbolDataSchema, UserList, UserListSchema, AlertList, AlertListSchema } from './symbol.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserPreference.name, schema: UserPreferenceSchema },
      { name: SymbolData.name, schema: SymbolDataSchema },
      { name: UserList.name, schema: UserListSchema },
      { name: AlertList.name, schema: AlertListSchema }
    ])
  ],
  providers: [SymbolService],
  exports: [SymbolService]
})
export class SymbolModule {} 