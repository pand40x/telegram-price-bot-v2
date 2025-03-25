import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import { AlertService } from './alert.service';
import { Context } from 'telegraf';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AlertList } from '../symbol/symbol.schema';
import { Logger } from '@nestjs/common';

@Update()
export class AlertUpdate {
  private readonly logger = new Logger(AlertUpdate.name);

  constructor(
    private readonly alertService: AlertService,
    @InjectModel(AlertList.name) private alertListModel: Model<AlertList>
  ) {}

  // Özel ve grup listeleri arasında geçiş yapmak için migrasyon komutu
  @Command('migrasyonliste')
  async migrateAlertLists(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();
      const isGroup = chatId.startsWith('-');
      
      // Grup içindeyse özel listeleri gruba taşı
      if (isGroup) {
        const oldGroupId = `${chatId}_${userId}`;  // Eski format
        
        // Eski format listeleri kontrol et ve taşı
        const groupLists = await this.alertListModel.find({ userId: oldGroupId }).exec();
        if (groupLists.length > 0) {
          for (const list of groupLists) {
            await this.alertListModel.updateOne(
              { _id: list._id },
              { 
                $set: { 
                  userId: userId,  // Yeni format ile güncelle
                  chatId: chatId 
                } 
              }
            ).exec();
            this.logger.debug(`Grup listesi taşındı: "${list.listName}" (${oldGroupId} -> ${userId})`);
          }
        }
        
        return ctx.reply(`Listelerin güncellendi. Artık hem özel mesajda hem de grupta aynı listelerine erişebilirsin. 👍`);
      } else {
        // Özel mesajda sadece bilgi ver
        return ctx.reply(`Bu komut sadece gruplarda çalışır. Grup içinde çalıştırırsan, listelerini güncelleyeceğim.`);
      }
    } catch (error) {
      this.logger.error(`Liste migrasyon hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['uyari', 'alarm'])
  async createAlert(@Ctx() ctx: Context) {
    try {
      const message: any = ctx.message;
      const text = message?.text || '';
      const params = text.split(' ').slice(1);
      const userId = message.from.id.toString();
      const chatId = message.chat.id.toString();

      if (params.length < 1) {
        return ctx.reply('Kullanım: /uyari <liste_adi> [<sembol> <yuzde_esik>]\n\nÖrnekler:\n/uyari btc\n/uyari kripto BTC 5');
      }

      const listName = params[0].toLowerCase();
      const symbol = params.length > 1 ? params[1].toUpperCase() : null;
      const percentThreshold = params.length > 2 ? parseFloat(params[2]) : 5;

      // Eğer sembol belirtilmemişse, yeni liste oluştur
      if (!symbol) {
        const result = await this.alertService.createAlertList(chatId, listName, userId);
        if (result) {
          return ctx.reply(`"${listName}" isimli yeni uyarı listesi oluşturuldu. Listeye sembol eklemek için:\n/uyari ${listName} BTC 5`);
        }
        return ctx.reply(`"${listName}" isimli uyarı listesi zaten mevcut.`);
      }

      // Sembol belirtilmişse, mevcut listeye ekle
      const result = await this.alertService.addSymbolToAlertList(chatId, listName, symbol, percentThreshold, userId);
      if (result) {
        return ctx.reply(`"${symbol}" sembolü "${listName}" listesine %${percentThreshold} eşik değeriyle eklendi.`);
      }
      return ctx.reply(`"${listName}" isimli bir uyarı listesi bulunamadı. Önce listeyi oluşturun: /uyari ${listName}`);
    } catch (error) {
      this.logger.error(`Uyarı komut hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['uyarilisteler', 'alarmlisteler'])
  async getUserAlertLists(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      const lists = await this.alertService.getUserAlertLists(chatId, userId);
      
      if (lists.length === 0) {
        return ctx.reply('Henüz bir uyarı listeniz bulunmuyor. Liste oluşturmak için:\n/uyari <liste_adi>');
      }

      const listMessages = lists.map(list => {
        const activeEmoji = list.isActive ? '✅' : '❌';
        return `${activeEmoji} ${list.listName} (${list.symbolCount} sembol)`;
      });

      return ctx.reply(`📋 Uyarı Listeleriniz:\n\n${listMessages.join('\n')}`);
    } catch (error) {
      this.logger.error(`Uyarı listeleri komut hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['uyaridetay', 'alarmdetay'])
  async getAlertListDetails(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 1) {
        return ctx.reply('Kullanım: /uyaridetay <liste_adi>');
      }

      const listName = params[0].toLowerCase();
      const list = await this.alertService.getAlertListDetails(chatId, listName, userId);
      
      if (!list) {
        return ctx.reply(`"${listName}" isimli bir uyarı listesi bulunamadı.`);
      }

      const activeEmoji = list.isActive ? '✅ Aktif' : '❌ Devre Dışı';
      const symbols = list.symbols.map(symbol => {
        const threshold = list.highThresholds.get(symbol) || list.percentChangeThreshold;
        const lastPrice = list.lastPrices.get(symbol) || 'Henüz fiyat alınmadı';
        return `${symbol} (eşik: %${threshold}, son fiyat: ${lastPrice})`;
      });

      const detailMessage = `📋 "${list.listName}" Uyarı Listesi Detayları:
      
Durum: ${activeEmoji}
Genel Eşik: %${list.percentChangeThreshold}
Sembol Sayısı: ${list.symbols.length}

Semboller:
${symbols.length > 0 ? symbols.join('\n') : 'Liste boş'}

Son kontrol: ${list.lastCheckTime ? new Date(list.lastCheckTime).toLocaleString() : 'Henüz kontrol edilmedi'}`;

      return ctx.reply(detailMessage);
    } catch (error) {
      this.logger.error(`Uyarı detay komut hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['uyaridurum', 'alarmdurum'])
  async toggleAlertList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 2) {
        return ctx.reply('Kullanım: /uyaridurum <liste_adi> <aktif|devre>');
      }

      const listName = params[0].toLowerCase();
      const status = params[1].toLowerCase();
      
      if (status !== 'aktif' && status !== 'devre') {
        return ctx.reply('Durum için "aktif" veya "devre" yazın.');
      }
      
      const isActive = status === 'aktif';
      const result = await this.alertService.toggleAlertList(chatId, listName, isActive, userId);
      
      if (!result) {
        return ctx.reply(`"${listName}" isimli bir uyarı listesi bulunamadı.`);
      }

      return ctx.reply(`"${listName}" uyarı listesi ${isActive ? 'aktifleştirildi' : 'devre dışı bırakıldı'}.`);
    } catch (error) {
      this.logger.error(`Uyarı durum komut hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['uyarisil', 'alarmsil'])
  async removeAlertList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 1) {
        return ctx.reply('Kullanım: /uyarisil <liste_adi>');
      }

      const listName = params[0].toLowerCase();
      const result = await this.alertService.deleteAlertList(chatId, listName, userId);
      
      if (!result) {
        return ctx.reply(`"${listName}" isimli bir uyarı listesi bulunamadı.`);
      }

      return ctx.reply(`"${listName}" uyarı listesi silindi.`);
    } catch (error) {
      this.logger.error(`Uyarı silme komut hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['uyarisembolsil', 'alarmsembolsil'])
  async removeSymbolFromAlertList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 2) {
        return ctx.reply('Kullanım: /uyarisembolsil <liste_adi> <sembol>');
      }

      const listName = params[0].toLowerCase();
      const symbol = params[1].toUpperCase();
      
      const result = await this.alertService.removeSymbolFromAlertList(chatId, listName, symbol, userId);
      
      if (!result) {
        return ctx.reply(`"${listName}" isimli bir uyarı listesi bulunamadı.`);
      }

      return ctx.reply(`"${symbol}" sembolü "${listName}" uyarı listesinden çıkarıldı.`);
    } catch (error) {
      this.logger.error(`Uyarı sembol silme komut hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Help()
  async help(@Ctx() ctx: Context) {
    return ctx.reply(`📈 Fiyat Uyarı Bot Komutları:

/uyari <liste_adi> - Yeni uyarı listesi oluştur
/uyari <liste_adi> <sembol> <yuzde_esik> - Listeye sembol ekle

/uyarilisteler - Tüm uyarı listelerini göster
/uyaridetay <liste_adi> - Liste detaylarını göster
/uyaridurum <liste_adi> <aktif|devre> - Liste durumunu değiştir
/uyarisil <liste_adi> - Uyarı listesini sil
/uyarisembolsil <liste_adi> <sembol> - Listeden sembol çıkar
/migrasyonliste - Özel listelerinizi ve grup listelerinizi senkronize eder

Alternatif komutlar: /alarm, /alarmlisteler, /alarmdetay, /alarmdurum, /alarmsil, /alarmsembolsil`);
  }
  
  // Metin mesajlarını kontrol et ve uyarı listesi detaylarını göster
  @On('text')
  async handleTextMessage(@Ctx() ctx: Context) {
    try {
      // Text mesajını doğru şekilde al
      const message: any = ctx.message;
      if (!message || !message.text) return;
      
      const text = message.text.trim();
      const userId = message.from.id.toString();
      const chatId = message.chat.id.toString();
      
      // Komut değilse ve uyarı listesinde var mı kontrol et
      if (text.startsWith('/')) {
        return;
      }
      
      this.logger.debug(`Uyarı için metin mesajı alındı: "${text}", kullanıcı: ${userId}, chat: ${chatId}`);
      
      // Kullanıcının bu isimde bir uyarı listesi var mı kontrol et
      const list = await this.alertService.getAlertListDetails(chatId, text, userId);
      
      if (!list) {
        return;
      }
      
      this.logger.debug(`"${text}" uyarı listesi bulundu, ${list.symbols.length} sembol içeriyor`);
      
      // Liste detaylarını göster
      const activeEmoji = list.isActive ? '✅ Aktif' : '❌ Devre Dışı';
      const symbols = list.symbols.map(symbol => {
        const threshold = list.highThresholds.get(symbol) || list.percentChangeThreshold;
        const lastPrice = list.lastPrices.get(symbol) || 'Henüz fiyat alınmadı';
        return `${symbol} (eşik: %${threshold}, son fiyat: ${lastPrice})`;
      });

      const detailMessage = `📋 "${list.listName}" Uyarı Listesi Detayları:
      
Durum: ${activeEmoji}
Genel Eşik: %${list.percentChangeThreshold}
Sembol Sayısı: ${list.symbols.length}

Semboller:
${symbols.length > 0 ? symbols.join('\n') : 'Liste boş'}

Son kontrol: ${list.lastCheckTime ? new Date(list.lastCheckTime).toLocaleString() : 'Henüz kontrol edilmedi'}`;

      return ctx.reply(detailMessage);
    } catch (error) {
      this.logger.error(`Uyarı metin mesajı işleme hatası: ${error.message}`);
    }
  }
} 