import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserList, UserListSchema } from '../symbol/symbol.schema';
import { UserListService } from './user-list.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserList.name, schema: UserListSchema }
    ]),
  ],
  providers: [UserListService],
  exports: [UserListService],
})
export class ListModule {} 