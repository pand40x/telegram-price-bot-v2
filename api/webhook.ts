import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getBotToken } from 'nestjs-telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

export default async (req: VercelRequest, res: VercelResponse) => {
  // Debug için tüm isteği logla
  console.log('Webhook request:', {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Webhook active but expects POST' });
  }

  try {
    // Debug mesajı
    console.log('Creating NestJS app...');
    
    // Create a NestJS app instance
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug'], // Daha kapsamlı loglama
    });
    
    console.log('Getting bot instance...');
    // Get the bot instance from the NestJS app
    const bot = app.get(getBotToken());
    
    console.log('Processing update...');
    // Process the webhook update
    await bot.handleUpdate(req.body);
    
    // Send response
    console.log('Sending response...');
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    // Hata detaylarını da yanıtta döndür
    res.status(200).json({ 
      ok: true,
      error: error.message,
      stack: error.stack
    });
  }
}; 