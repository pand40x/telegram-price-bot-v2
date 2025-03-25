import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import { UserListService } from './user-list.service';
import { Context } from 'telegraf';
import { PriceService } from '../price/price.service';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserList } from '../symbol/symbol.schema';

@Update()
export class ListUpdate {
  private readonly logger = new Logger(ListUpdate.name);

  constructor(
    private readonly userListService: UserListService,
    private readonly priceService: PriceService,
    @InjectModel(UserList.name) private userListModel: Model<UserList>
  ) {}

  // Migrasyon komutu - özel ve grup listelerini senkronize eder
  @Command('migrasyongorev')
  async migrateUserLists(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();
      const isGroup = chatId.startsWith('-');
      
      // Grup içindeyse özel listeleri gruba taşı
      if (isGroup) {
        const oldGroupId = `${chatId}_${userId}`;  // Eski format
        
        // Eski format listeleri kontrol et ve taşı
        const groupLists = await this.userListModel.find({ userId: oldGroupId }).exec();
        if (groupLists.length > 0) {
          for (const list of groupLists) {
            await this.userListModel.updateOne(
              { _id: list._id },
              { $set: { userId: userId } }
            ).exec();
            this.logger.debug(`Görev listesi taşındı: "${list.listName}" (${oldGroupId} -> ${userId})`);
          }
        }
        
        return ctx.reply(`Görev listelerin güncellendi. Artık hem özel mesajda hem de grupta aynı listelerine erişebilirsin. 👍`);
      } else {
        // Özel mesajda sadece bilgi ver
        return ctx.reply(`Bu komut sadece gruplarda çalışır. Grup içinde çalıştırırsan, görev listelerini güncelleyeceğim.`);
      }
    } catch (error) {
      this.logger.error(`Görev listesi migrasyon hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['l', 'liste'])
  async createList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 1) {
        return ctx.reply('Kullanım: /l <liste_adi> [<sembol1> <sembol2> ...]');
      }

      const listName = params[0].toLowerCase();
      const symbols = params.slice(1).map(s => s.toUpperCase());

      // Önce liste oluştur
      const result = await this.userListService.createList(chatId, listName, userId);
      
      if (!result) {
        return ctx.reply(`"${listName}" isimli liste zaten mevcut.`);
      }

      // Sembolleri ekle
      if (symbols.length > 0) {
        for (const symbol of symbols) {
          await this.userListService.addSymbolToList(chatId, listName, symbol, userId);
        }
        return ctx.reply(`"${listName}" isimli liste oluşturuldu ve ${symbols.length} sembol eklendi.`);
      }

      return ctx.reply(`"${listName}" isimli liste oluşturuldu. Sembol eklemek için:\n/ekle ${listName} BTC`);
    } catch (error) {
      this.logger.error(`Liste oluşturma hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['ekle', 'add'])
  async addSymbolToList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 2) {
        return ctx.reply('Kullanım: /ekle <liste_adi> <sembol1> [<sembol2> ...]');
      }

      const listName = params[0].toLowerCase();
      const symbols = params.slice(1).map(s => s.toUpperCase());
      
      const addedSymbols = [];
      
      for (const symbol of symbols) {
        const result = await this.userListService.addSymbolToList(chatId, listName, symbol, userId);
        if (result) {
          addedSymbols.push(symbol);
        }
      }
      
      if (addedSymbols.length === 0) {
        return ctx.reply(`"${listName}" isimli liste bulunamadı veya semboller eklenemedi.`);
      }
      
      return ctx.reply(`${addedSymbols.length} sembol "${listName}" listesine eklendi: ${addedSymbols.join(', ')}`);
    } catch (error) {
      this.logger.error(`Sembol ekleme hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['cikar', 'çıkar', 'remove'])
  async removeSymbolFromList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 2) {
        return ctx.reply('Kullanım: /cikar <liste_adi> <sembol>');
      }

      const listName = params[0].toLowerCase();
      const symbol = params[1].toUpperCase();
      
      const result = await this.userListService.removeSymbolFromList(chatId, listName, symbol, userId);
      
      if (!result) {
        return ctx.reply(`"${listName}" isimli liste bulunamadı veya sembol listede yok.`);
      }
      
      return ctx.reply(`"${symbol}" sembolü "${listName}" listesinden çıkarıldı.`);
    } catch (error) {
      this.logger.error(`Sembol çıkarma hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['listeler', 'lists'])
  async getUserLists(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);

      // Eğer bir parametre varsa, bu liste adıdır ve fiyatları gösterilecek
      if (params.length > 0) {
        const listName = params[0].toLowerCase();
        this.logger.debug(`Listeler komutu ile fiyat görüntüleme: ${listName}`);
        
        // Liste detaylarını getir
        const list = await this.userListService.getListDetails(chatId, listName, userId);
        
        if (!list || list.symbols.length === 0) {
          return ctx.reply(`"${listName}" isimli liste bulunamadı veya boş.`);
        }
        
        // Liste adına göre asset tipi belirle
        const assetType = listName.toLowerCase().includes('hisse') ? 'stock' : 'crypto';
        this.logger.debug(`Listeler komutu: "${listName}" listesi için ${assetType} tipi belirlenip fiyat alınıyor`);
        
        // Fiyatları al
        const prices = await this.priceService.getPrices(list.symbols, assetType);
        
        if (prices.length === 0) {
          return ctx.reply(`"${listName}" listesi için fiyat bilgisi bulunamadı.`);
        }
        
        // Fiyatları formatla
        const formattedPrices = prices.map(price => {
          const priceText = `${price.symbol}: ${price.price.toFixed(8)}`;
          const changeText = price['change24h'] !== undefined ? 
            ` (${price['change24h'] > 0 ? '+' : ''}${price['change24h'].toFixed(2)}%)` : '';
          return priceText + changeText;
        });
        
        return ctx.reply(formattedPrices.join('\n'));
      }

      // Parametre yoksa tüm listeleri göster (orijinal işlev)
      const lists = await this.userListService.getUserLists(chatId, userId);
      
      if (lists.length === 0) {
        return ctx.reply('Henüz bir listeniz bulunmuyor. Liste oluşturmak için:\n/l <liste_adi>');
      }

      const listMessages = lists.map(list => {
        return `${list.listName} (${list.symbolCount} sembol)`;
      });

      return ctx.reply(`📋 Listeleriniz:\n\n${listMessages.join('\n')}\n\nFiyat görüntülemek için: /listeler <liste_adı>`);
    } catch (error) {
      this.logger.error(`Kullanıcı listeleri hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['listedetay', 'listdetail'])
  async getListDetails(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString(); 
      const chatId = msgData.chat.id.toString();

      if (params.length < 1) {
        return ctx.reply('Kullanım: /listedetay <liste_adi>');
      }

      const listName = params[0].toLowerCase();
      const list = await this.userListService.getListDetails(chatId, listName, userId);
      
      if (!list) {
        return ctx.reply(`"${listName}" isimli bir liste bulunamadı.`);
      }

      const detailMessage = `📋 "${list.listName}" Listesi:
      
Sembol Sayısı: ${list.symbols.length}

Semboller:
${list.symbols.length > 0 ? list.symbols.join(', ') : 'Liste boş'}`;

      return ctx.reply(detailMessage);
    } catch (error) {
      this.logger.error(`Liste detay hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  @Command(['listesil', 'deletelist'])
  async deleteList(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();

      if (params.length < 1) {
        return ctx.reply('Kullanım: /listesil <liste_adi>');
      }

      const listName = params[0].toLowerCase();
      const result = await this.userListService.deleteList(chatId, listName, userId);
      
      if (!result) {
        return ctx.reply(`"${listName}" isimli bir liste bulunamadı.`);
      }

      return ctx.reply(`"${listName}" listesi silindi.`);
    } catch (error) {
      this.logger.error(`Liste silme hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }

  // Metin mesajlarını kontrol et ve fiyat listelerini göster
  @On('text')
  async handleTextMessage(@Ctx() ctx: Context) {
    try {
      // Text mesajını doğru şekilde al
      const msgData: any = ctx.message;  // Type assertion kullanarak text erişimini sağla
      if (!msgData || !msgData.text) return;
      
      const text = msgData.text.trim();
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();
      
      // Komut değilse ve listede var mı kontrol et
      if (text.startsWith('/')) {
        return;
      }
      
      this.logger.debug(`TEXT HANDLER - Metin mesajı alındı: "${text}", kullanıcı: ${userId}, chat: ${chatId}`);
      
      // İlk önce userListService ile deneyelim (bu service ile liste detayları çekilir)
      const listFromService = await this.userListService.getListDetails(chatId, text, userId);
      if (listFromService) {
        this.logger.debug(`TEXT HANDLER - UserListService ile "${text}" listesi bulundu, sembol sayısı: ${listFromService.symbols.length}`);
        
        // Liste adına göre asset tipi belirle (hisse veya kripto)
        const assetType = text.toLowerCase().includes('hisse') ? 'stock' : 'crypto';
        this.logger.debug(`TEXT HANDLER - "${text}" listesi için ${assetType} tipi belirlenip fiyat alınıyor`);
        
        // Fiyatları al ve formatlayarak gönder
        const prices = await this.priceService.getPrices(listFromService.symbols, assetType);
        
        if (prices.length === 0) {
          this.logger.debug(`TEXT HANDLER - "${text}" listesi için fiyat bulunamadı`);
          return ctx.reply(`"${text}" listesi için fiyat bilgisi bulunamadı.`);
        }
        
        this.logger.debug(`TEXT HANDLER - "${text}" listesi için ${prices.length} sembol fiyatı alındı, gönderiliyor`);
        
        // Fiyatları formatla
        const formattedPrices = prices.map(price => {
          const priceText = `${price.symbol}: ${price.price.toFixed(8)}`;
          // change24h özelliği varsa ekle
          const changeText = price['change24h'] !== undefined ? 
            ` (${price['change24h'] > 0 ? '+' : ''}${price['change24h'].toFixed(2)}%)` : '';
          return priceText + changeText;
        });
        
        return ctx.reply(formattedPrices.join('\n'));
      }
      
      // Servis ile bulamazsak, doğrudan MongoDB model ile deneyelim
      this.logger.debug(`TEXT HANDLER - UserListService ile liste bulunamadı, doğrudan model üzerinden deneniyor`);
      
      // Doğrudan modele erişerek deneyelim
      let list = await this.userListModel.findOne({
        userId: userId, 
        listName: text.toLowerCase()
      }).exec();
      
      if (!list) {
        list = await this.userListModel.findOne({
          userId: chatId,
          listName: text.toLowerCase()
        }).exec();
      }
      
      // Eski format ID ile ara
      if (!list && chatId.startsWith('-')) {
        const oldFormatId = `${chatId}_${userId}`;
        list = await this.userListModel.findOne({
          userId: oldFormatId,
          listName: text.toLowerCase()
        }).exec();
        
        if (list) {
          this.logger.debug(`TEXT HANDLER - "${text}" listesi eski format ID ile bulundu: ${oldFormatId}`);
        }
      }
      
      if (!list || list.symbols.length === 0) {
        this.logger.debug(`TEXT HANDLER - "${text}" adlı liste bulunamadı veya boş`);
        return;
      }
      
      this.logger.debug(`TEXT HANDLER - Doğrudan model üzerinden "${text}" listesi bulundu, ${list.symbols.length} sembol içeriyor`);
      
      // Liste adına göre asset tipi belirle
      const assetType = text.toLowerCase().includes('hisse') ? 'stock' : 'crypto';
      this.logger.debug(`TEXT HANDLER - "${text}" listesi için ${assetType} tipi belirlenip fiyat alınıyor`);
      
      // Fiyatları al
      const prices = await this.priceService.getPrices(list.symbols, assetType);
      
      if (prices.length === 0) {
        this.logger.debug(`TEXT HANDLER - "${text}" listesi için fiyat bulunamadı`);
        return ctx.reply(`"${text}" listesi için fiyat bilgisi bulunamadı.`);
      }
      
      this.logger.debug(`TEXT HANDLER - "${text}" listesi için ${prices.length} sembol fiyatı alındı, gönderiliyor`);
      
      // Fiyatları formatla
      const formattedPrices = prices.map(price => {
        const priceText = `${price.symbol}: ${price.price.toFixed(8)}`;
        const changeText = price['change24h'] !== undefined ? 
          ` (${price['change24h'] > 0 ? '+' : ''}${price['change24h'].toFixed(2)}%)` : '';
        return priceText + changeText;
      });
      
      return ctx.reply(formattedPrices.join('\n'));
    } catch (error) {
      this.logger.error(`Metin mesajı işleme hatası: ${error.message}`);
    }
  }

  @Help()
  async help(@Ctx() ctx: Context) {
    return ctx.reply(`📋 Liste Bot Komutları:

/l <liste_adi> [sembol1 sembol2 ...] - Yeni liste oluştur
/ekle <liste_adi> <sembol1> [sembol2 ...] - Listeye sembol ekle
/cikar <liste_adi> <sembol> - Listeden sembol çıkar
/listeler - Tüm listeleri göster
/listeler <liste_adi> - Liste için fiyatları göster ✨YENI✨
/listedetay <liste_adi> - Liste detaylarını göster
/listesil <liste_adi> - Listeyi sil
/migrasyongorev - Özel ve grup listelerinizi senkronize eder
/fiyat <liste_adi> - Liste için fiyatları göster ✨YENI✨

Alternatif komutlar: /liste, /add, /çıkar, /remove, /lists, /listdetail, /deletelist

NOT: Telegram güncellemeleri nedeniyle liste adını direkt yazarak fiyat çekme geçici olarak devre dışı kalmıştır. Lütfen "/listeler <liste_adi>" veya "/fiyat <liste_adi>" komutunu kullanın.
`);
  }
  
  // Fiyat komutu ekleyelim - liste adı alıp fiyatları gösterecek
  @Command(['fiyat', 'price'])
  async getListPrices(@Ctx() ctx: Context) {
    try {
      const msgData: any = ctx.message;
      const text = msgData?.text || '';
      const params = text.split(' ').slice(1);
      const userId = msgData.from.id.toString();
      const chatId = msgData.chat.id.toString();
      
      if (params.length < 1) {
        return ctx.reply('Kullanım: /fiyat <liste_adi>');
      }
      
      const listName = params[0].toLowerCase();
      this.logger.debug(`Fiyat komutu: "${listName}" listesi için fiyat sorgusu, userId: ${userId}, chatId: ${chatId}`);
      
      // Liste detaylarını getir
      const list = await this.userListService.getListDetails(chatId, listName, userId);
      
      if (!list || list.symbols.length === 0) {
        return ctx.reply(`"${listName}" isimli liste bulunamadı veya boş.`);
      }
      
      // Liste adına göre asset tipi belirle
      const assetType = listName.toLowerCase().includes('hisse') ? 'stock' : 'crypto';
      this.logger.debug(`Fiyat komutu: "${listName}" listesi için ${assetType} tipi belirlenip fiyat alınıyor, ${list.symbols.length} sembol`);
      
      // Fiyatları al
      const prices = await this.priceService.getPrices(list.symbols, assetType);
      
      if (prices.length === 0) {
        return ctx.reply(`"${listName}" listesi için fiyat bilgisi bulunamadı.`);
      }
      
      this.logger.debug(`Fiyat komutu: "${listName}" listesi için ${prices.length} sembol fiyatı alındı`);
      
      // Fiyatları formatla
      const formattedPrices = prices.map(price => {
        const priceText = `${price.symbol}: ${price.price.toFixed(8)}`;
        const changeText = price['change24h'] !== undefined ? 
          ` (${price['change24h'] > 0 ? '+' : ''}${price['change24h'].toFixed(2)}%)` : '';
        return priceText + changeText;
      });
      
      return ctx.reply(formattedPrices.join('\n'));
    } catch (error) {
      this.logger.error(`Fiyat komutu hatası: ${error.message}`);
      return ctx.reply(`Bir hata oluştu: ${error.message}`);
    }
  }
} 