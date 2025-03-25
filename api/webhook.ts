import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getBotToken } from 'nestjs-telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Create a NestJS app instance
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn'], // Minimize logging for performance
    });
    
    // Get the bot instance from the NestJS app
    const bot = app.get(getBotToken());
    
    // Process the webhook update
    await bot.handleUpdate(req.body);
    
    // Send response
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).send('Internal Server Error');
  }
}; 