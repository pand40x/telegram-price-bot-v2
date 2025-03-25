import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';

import { BotUpdate } from './bot/bot.update';
import { SymbolModule } from './symbol/symbol.module';
import { PriceModule } from './price/price.module';
import { ListModule } from './list/list.module';
import { AlertModule } from './alert/alert.module';
import { CmcModule } from './cmc/cmc.module';
import { BinanceModule } from './binance/binance.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        token: configService.get('TELEGRAM_BOT_TOKEN'),
        include: [],
        launchOptions: process.env.VERCEL ? 
          { webhook: { domain: process.env.VERCEL_URL, hookPath: '/api/webhook' } } : 
          {
            polling: true,
            allowedUpdates: ['message', 'callback_query', 'inline_query', 'chat_member'],
          },
        middlewares: [
          // Bu middleware tüm mesajları yazarak debug etmemize yardımcı olacak
          async (ctx, next) => {
            if (ctx.message) {
              // Gelen mesajı logla
              console.log('Yeni mesaj:', {
                from: ctx.message.from?.id,
                chat: ctx.message.chat?.id,
                text: ctx.message.text,
                chat_type: ctx.message.chat?.type,
              });
            }
            return next();
          },
        ],
      }),
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get('MONGODB_URI'),
      }),
    }),
    ScheduleModule.forRoot(),
    SymbolModule,
    PriceModule,
    ListModule,
    AlertModule,
    CmcModule,
    BinanceModule,
  ],
  controllers: [],
  providers: [BotUpdate],
})
export class AppModule {} 