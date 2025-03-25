import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  // Bot instance'ını al
  const bot = app.get(getBotToken());
  
  try {
    // Komutları tanımla
    const commands = [
      { command: 'l', description: 'Yeni liste oluştur' },
      { command: 'liste', description: 'Yeni liste oluştur' },
      { command: 'ekle', description: 'Listeye sembol ekle' },
      { command: 'add', description: 'Listeye sembol ekle' },
      { command: 'cikar', description: 'Listeden sembol çıkar' },
      { command: 'listeler', description: 'Tüm listeleri göster' },
      { command: 'lists', description: 'Tüm listeleri göster' },
      { command: 'listedetay', description: 'Liste detaylarını göster' },
      { command: 'listesil', description: 'Listeyi sil' },
      { command: 'fiyat', description: 'Liste için fiyatları göster' },
      { command: 'price', description: 'Liste için fiyatları göster' },
      { command: 'migrasyongorev', description: 'Liste senkronizasyonu' },
      { command: 'migrasyonliste', description: 'Alert senkronizasyonu' },
      { command: 'uyari', description: 'Uyarı listesi oluştur/ekle' },
      { command: 'alarm', description: 'Uyarı listesi oluştur/ekle' },
      { command: 'uyarilisteler', description: 'Uyarı listelerini göster' },
      { command: 'alarmlisteler', description: 'Uyarı listelerini göster' },
      { command: 'help', description: 'Yardım' },
      { command: 'start', description: 'Başlat' }
    ];
    
    // Özel mesajlar için komutları ayarla
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_private_chats' } });
    
    // Gruplar için komutları ayarla
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
    
    logger.log('Bot komutları yapılandırıldı (özel mesajlar ve gruplar için)');
  } catch (e) {
    logger.error(`Bot komutları ayarlanırken hata: ${e.message}`);
  }
  
  await app.listen(3000);
  logger.log('Bot başlatıldı ve dinleniyor, port: 3000');
}
bootstrap(); 