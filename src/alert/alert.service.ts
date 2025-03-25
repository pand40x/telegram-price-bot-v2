import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AlertList } from '../symbol/symbol.schema';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { PriceService } from '../price/price.service';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @InjectModel(AlertList.name) private alertListModel: Model<AlertList>,
    private readonly priceService: PriceService,
    @InjectBot() private bot: Telegraf
  ) {}

  // Chat ID kontrolü (Grup mu, özel mesaj mı?)
  private isChatGroup(chatId: string): boolean {
    return chatId.startsWith('-');
  }

  // Grup içinde komut veren kullanıcı ID'si veya özel mesajda kullanıcının ID'sini döndürür
  private getUserId(chatId: string, userId: string): string {
    // Artık her zaman kullanıcı ID'sini kullan - grup içinde olsa bile
    return userId;
  }

  // Alert için benzersiz liste ID oluştur (Grup veya kullanıcı bazlı)
  private getAlertListId(chatId: string, listName: string): string {
    return `${chatId}:${listName}`;
  }

  async createAlertList(chatId: string, listName: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const isGroup = this.isChatGroup(chatId);
      
      // Eğer grup ise ve userId verilmişse, kişiselleştirilmiş bir ID oluştur
      const effectiveUserId = isGroup && userId ? this.getUserId(chatId, userId) : chatId;
      const listId = this.getAlertListId(effectiveUserId, normalizedListName);
      
      // Liste zaten var mı kontrol et
      const existingList = await this.alertListModel.findOne({ 
        userId: effectiveUserId, 
        listName: normalizedListName 
      }).exec();
      
      if (existingList) {
        this.logger.debug(`Bu isimde zaten bir uyarı listesi mevcut: ${normalizedListName}`);
        return false;
      }
      
      // Yeni uyarı listesi oluştur
      await this.alertListModel.create({
        userId: effectiveUserId,
        listName: normalizedListName,
        symbols: [],
        isActive: true,
        lastPrices: {},
        highThresholds: {},
        percentChangeThreshold: 5,
        isGroupChat: isGroup,  // Grup bilgisini kaydet
        chatId: chatId,  // Bildirim gönderilecek asıl chat ID'sini sakla
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      this.logger.debug(`Yeni ${isGroup ? 'grup' : 'kişisel'} uyarı listesi oluşturuldu: ${normalizedListName}`);
      return true;
    } catch (error) {
      this.logger.error(`Uyarı listesi oluşturma hatası: ${error.message}`);
      return false;
    }
  }

  async addSymbolToAlertList(chatId: string, listName: string, symbol: string, 
    percentThreshold: number = 5, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const normalizedSymbol = symbol.trim().toUpperCase();
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      // Önce normal ID ile listede ara
      let list = await this.alertListModel.findOne({ 
        userId: effectiveUserId, 
        listName: normalizedListName 
      }).exec();
      
      // Eğer bulunamadıysa ve bu bir grup ise, eski format ID ile ara
      if (!list && isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        list = await this.alertListModel.findOne({ 
          userId: oldFormatId, 
          listName: normalizedListName 
        }).exec();
        
        // Eğer eski format ile bulunduysa, log oluştur
        if (list) {
          this.logger.debug(`"${normalizedListName}" listesi eski format ID ile bulundu: ${oldFormatId}, sembol eklenecek`);
          // Listeyi yeni ID formatına taşımayı öneriyoruz
          this.logger.debug(`Bu listeyi yeni ID formatına taşımak için /migrasyonliste komutunu kullanabilirsiniz`);
        }
      }
      
      if (!list) {
        this.logger.debug(`Uyarı listesi bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      // Kullanılacak doğru ID'yi belirle (listede bulunduğu ID)
      const listUserId = list.userId;
      
      // Sembol zaten listede var mı kontrol et
      if (list.symbols.includes(normalizedSymbol)) {
        this.logger.debug(`Sembol zaten uyarı listesinde mevcut: ${normalizedSymbol}`);
        // Sadece eşiği güncelle
        await this.alertListModel.findOneAndUpdate(
          {
            userId: listUserId,
            listName: normalizedListName
          },
          {
            $set: { 
              [`highThresholds.${normalizedSymbol}`]: percentThreshold
            }
          }
        ).exec();
        this.logger.debug(`"${normalizedSymbol}" sembolü için eşik değeri %${percentThreshold} olarak güncellendi`);
        return true;
      }
      
      // Sembolün mevcut fiyatını al - crypto tipinde alınacak şekilde ayarla
      this.logger.debug(`Sembolün mevcut fiyatını alınıyor: ${normalizedSymbol}`);
      const prices = await this.priceService.getPrices([normalizedSymbol], 'crypto');
      let currentPrice = 0;
      
      if (prices.length > 0) {
        currentPrice = prices[0].price;
        this.logger.debug(`Sembol için fiyat alındı: ${normalizedSymbol} - ${currentPrice}`);
      } else {
        this.logger.debug(`Sembol için fiyat bulunamadı: ${normalizedSymbol}`);
        // Fiyat bulunamasa bile listeye ekleyebiliriz, ilk kontrol sırasında fiyat alınacak
      }
      
      // Listeyi güncelle
      const result = await this.alertListModel.findOneAndUpdate(
        {
          userId: listUserId,
          listName: normalizedListName
        },
        {
          $addToSet: { symbols: normalizedSymbol },
          $set: { 
            [`lastPrices.${normalizedSymbol}`]: currentPrice,
            [`highThresholds.${normalizedSymbol}`]: percentThreshold,
            updatedAt: new Date()
          }
        },
        { new: true }
      ).exec();
      
      if (!result) {
        return false;
      }
      
      const listType = isGroup ? 'grup' : 'kişisel';
      this.logger.debug(`"${normalizedSymbol}" sembolü "${normalizedListName}" ${listType} uyarı listesine %${percentThreshold} eşik değeriyle eklendi`);
      return true;
    } catch (error) {
      this.logger.error(`Uyarı listesine sembol ekleme hatası: ${error.message}`);
      return false;
    }
  }

  async removeSymbolFromAlertList(chatId: string, listName: string, symbol: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const normalizedSymbol = symbol.trim().toUpperCase();
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      // Önce normal ID ile listede ara
      let list = await this.alertListModel.findOne({ 
        userId: effectiveUserId, 
        listName: normalizedListName 
      }).exec();
      
      // Eğer bulunamadıysa ve bu bir grup ise, eski format ID ile ara
      if (!list && isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        list = await this.alertListModel.findOne({ 
          userId: oldFormatId, 
          listName: normalizedListName 
        }).exec();
        
        // Eğer eski format ile bulunduysa, log oluştur
        if (list) {
          this.logger.debug(`"${normalizedListName}" listesi eski format ID ile bulundu: ${oldFormatId}, sembol çıkarılacak`);
        }
      }
      
      if (!list) {
        this.logger.debug(`Uyarı listesi bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      // Kullanılacak doğru ID'yi belirle (listede bulunduğu ID)
      const listUserId = list.userId;
      
      // Listeyi bul ve güncelle
      const result = await this.alertListModel.findOneAndUpdate(
        {
          userId: listUserId,
          listName: normalizedListName
        },
        {
          $pull: { symbols: normalizedSymbol },
          $unset: { 
            [`lastPrices.${normalizedSymbol}`]: "",
            [`highThresholds.${normalizedSymbol}`]: "",
            [`lowThresholds.${normalizedSymbol}`]: ""
          },
          updatedAt: new Date()
        },
        { new: true }
      ).exec();
      
      if (!result) {
        this.logger.debug(`Uyarı listesi bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      const listType = isGroup ? 'grup' : 'kişisel';
      this.logger.debug(`"${normalizedSymbol}" sembolü "${normalizedListName}" ${listType} uyarı listesinden çıkarıldı`);
      return true;
    } catch (error) {
      this.logger.error(`Uyarı listesinden sembol çıkarma hatası: ${error.message}`);
      return false;
    }
  }

  async getUserAlertLists(chatId: string, userId: string = null): Promise<{ listName: string, symbolCount: number, isActive: boolean }[]> {
    try {
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      // Kullanıcının kendi ID'si ile kaydedilmiş listeleri bul
      const userLists = await this.alertListModel.find({ userId: effectiveUserId }).exec();
      
      // Eğer grup içindeyse, eski format (grupID_kullanıcıID) ile kaydedilmiş listeleri de bul
      let oldFormatLists = [];
      if (isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        oldFormatLists = await this.alertListModel.find({ userId: oldFormatId }).exec();
        
        // Eğer eski format listeler bulunduysa, log oluştur ve kullanıcıya bildir
        if (oldFormatLists.length > 0) {
          this.logger.debug(`Eski format ile kayıtlı ${oldFormatLists.length} liste bulundu. ID: ${oldFormatId}`);
        }
      }
      
      // Tüm listeleri birleştir
      const allLists = [...userLists, ...oldFormatLists];
      
      return allLists.map(list => ({
        listName: list.listName,
        symbolCount: list.symbols.length,
        isActive: list.isActive
      }));
    } catch (error) {
      this.logger.error(`Kullanıcı uyarı listeleri getirme hatası: ${error.message}`);
      return [];
    }
  }

  async getAlertListDetails(chatId: string, listName: string, userId: string = null): Promise<any | null> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      // Önce normal ID ile ara
      let list = await this.alertListModel.findOne({
        userId: effectiveUserId,
        listName: normalizedListName
      }).exec();
      
      // Eğer bulunamadıysa ve bu bir grup ise, eski format ID ile ara
      if (!list && isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        list = await this.alertListModel.findOne({
          userId: oldFormatId,
          listName: normalizedListName
        }).exec();
        
        // Eğer eski format ile bulunduysa, log oluştur
        if (list) {
          this.logger.debug(`"${normalizedListName}" listesi eski format ID ile bulundu: ${oldFormatId}`);
        }
      }
      
      if (!list) {
        return null;
      }
      
      return {
        listName: list.listName,
        symbols: list.symbols,
        isActive: list.isActive,
        percentChangeThreshold: list.percentChangeThreshold,
        lastPrices: list.lastPrices,
        highThresholds: list.highThresholds,
        isGroupChat: list.isGroupChat,
        chatId: list.chatId,
        lastCheckTime: list.lastCheckTime
      };
    } catch (error) {
      this.logger.error(`Uyarı liste detayları getirme hatası: ${error.message}`);
      return null;
    }
  }

  async toggleAlertList(chatId: string, listName: string, isActive: boolean, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      // Önce normal ID ile listede ara
      let list = await this.alertListModel.findOne({ 
        userId: effectiveUserId, 
        listName: normalizedListName 
      }).exec();
      
      // Eğer bulunamadıysa ve bu bir grup ise, eski format ID ile ara
      if (!list && isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        list = await this.alertListModel.findOne({ 
          userId: oldFormatId, 
          listName: normalizedListName 
        }).exec();
        
        // Eğer eski format ile bulunduysa, log oluştur
        if (list) {
          this.logger.debug(`"${normalizedListName}" listesi eski format ID ile bulundu: ${oldFormatId}, durumu değiştirilecek`);
        }
      }
      
      if (!list) {
        this.logger.debug(`Uyarı listesi bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      // Kullanılacak doğru ID'yi belirle (listede bulunduğu ID)
      const listUserId = list.userId;
      
      const result = await this.alertListModel.findOneAndUpdate(
        {
          userId: listUserId,
          listName: normalizedListName
        },
        {
          $set: { 
            isActive: isActive,
            updatedAt: new Date()
          }
        },
        { new: true }
      ).exec();
      
      if (!result) {
        this.logger.debug(`Uyarı listesi bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      const listType = isGroup ? 'grup' : 'kişisel';
      const activeEmoji = list.isActive ? '✅ Aktif' : '❌ Devre Dışı';
      this.logger.debug(`"${normalizedListName}" ${listType} uyarı listesi ${isActive ? 'aktifleştirildi' : 'devre dışı bırakıldı'}`);
      return true;
    } catch (error) {
      this.logger.error(`Uyarı listesi durumu değiştirme hatası: ${error.message}`);
      return false;
    }
  }

  async deleteAlertList(chatId: string, listName: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      // Önce normal ID ile arayalım
      let result = await this.alertListModel.deleteOne({
        userId: effectiveUserId,
        listName: normalizedListName
      }).exec();
      
      // Eğer bulunamadıysa ve bu bir grup ise, eski format ID ile arayalım
      if (result.deletedCount === 0 && isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        
        // Eski format ID ile tekrar deneyelim
        result = await this.alertListModel.deleteOne({
          userId: oldFormatId,
          listName: normalizedListName
        }).exec();
        
        // Eğer eski format ile silme başarılı olduysa, log oluştur
        if (result.deletedCount > 0) {
          this.logger.debug(`"${normalizedListName}" listesi eski format ID ile bulundu ve silindi: ${oldFormatId}`);
        }
      }
      
      if (result.deletedCount === 0) {
        this.logger.debug(`Uyarı listesi bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      const listType = isGroup ? 'grup' : 'kişisel';
      this.logger.debug(`"${normalizedListName}" ${listType} uyarı listesi silindi`);
      return true;
    } catch (error) {
      this.logger.error(`Uyarı listesi silme hatası: ${error.message}`);
      return false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAlertLists() {
    this.logger.debug('Uyarı listelerini kontrol etme zamanı');
    
    try {
      // Aktif uyarı listelerini bul
      const activeLists = await this.alertListModel.find({ isActive: true }).exec();
      
      if (activeLists.length === 0) {
        this.logger.debug('Aktif uyarı listesi bulunamadı');
        return;
      }
      
      this.logger.debug(`${activeLists.length} adet aktif uyarı listesi kontrol ediliyor`);
      
      for (const list of activeLists) {
        if (list.symbols.length === 0) continue;
        
        // Listedeki sembollerin fiyatlarını al - crypto tipinde
        this.logger.debug(`"${list.listName}" listesindeki ${list.symbols.length} sembol için fiyat alınıyor`);
        const prices = await this.priceService.getPrices(list.symbols, 'crypto');
        
        if (prices.length === 0) continue;
        
        const alertMessages: string[] = [];
        
        // Her semboldeki fiyat değişikliklerini kontrol et
        for (const price of prices) {
          const symbol = price.symbol;
          const currentPrice = price.price;
          const lastPrice = list.lastPrices.get(symbol) || 0;
          
          if (lastPrice === 0) {
            // İlk kez fiyat alınıyorsa, kaydet ve geç
            await this.updateLastPrice(list._id, symbol, currentPrice);
            continue;
          }
          
          // Yüzde değişimi hesapla
          const percentChange = ((currentPrice - lastPrice) / lastPrice) * 100;
          
          // Sembol için özel eşik değerini al, yoksa listedeki genel eşiği kullan
          const thresholdPercent = list.highThresholds.get(symbol) || list.percentChangeThreshold;
          this.logger.debug(`"${symbol}" için eşik kontrolü: değişim %${percentChange.toFixed(2)}, eşik %${thresholdPercent}`);
          
          // Eşik değerini kontrol et
          if (Math.abs(percentChange) >= thresholdPercent) {
            // Daha sade format oluştur
            const direction = percentChange > 0 ? '📈' : '📉';
            const absPercentChange = Math.abs(percentChange).toFixed(2);
            
            // Artık veya azalış olarak tanımla
            const changeType = percentChange > 0 ? "yükseldi" : "düştü";
            
            // Sade format ile mesaj oluştur
            const message = `${direction} ${symbol} %${absPercentChange} ${changeType}, fiyat: ${currentPrice.toFixed(8)}`;
            
            alertMessages.push(message);
            
            // Son fiyatı güncelle
            await this.updateLastPrice(list._id, symbol, currentPrice);
          }
        }
        
        // Eğer alarm mesajı varsa, bildirim gönder
        if (alertMessages.length > 0) {
          // Bildirim gönderilecek chat ID'sini belirle
          const chatId = list.chatId || list.userId; // Eğer chatId varsa onu kullan, yoksa userId'yi kullan
          const listType = list.isGroupChat ? 'grup' : 'kişisel';
          
          // Mesajın formatını sadeleştir
          const alertMessage = `🚨 "${list.listName}" için fiyat uyarıları:\n\n${alertMessages.join('\n')}`;
          
          try {
            this.logger.debug(`${listType} bildirim gönderiliyor, Chat ID: ${chatId}`);
            await this.bot.telegram.sendMessage(chatId, alertMessage);
          } catch (error) {
            this.logger.error(`Telegram mesajı gönderme hatası: ${error.message}`);
          }
        }
        
        // Son kontrol zamanını güncelle
        await this.updateLastCheckTime(list._id);
      }
    } catch (error) {
      this.logger.error(`Uyarı listeleri kontrol hatası: ${error.message}`);
    }
  }

  private async updateLastPrice(listId: string, symbol: string, price: number): Promise<void> {
    try {
      await this.alertListModel.updateOne(
        { _id: listId },
        { 
          $set: { [`lastPrices.${symbol}`]: price }
        }
      ).exec();
    } catch (error) {
      this.logger.error(`Son fiyat güncelleme hatası: ${error.message}`);
    }
  }

  private async updateLastCheckTime(listId: string): Promise<void> {
    try {
      await this.alertListModel.updateOne(
        { _id: listId },
        { 
          $set: { lastCheckTime: new Date() }
        }
      ).exec();
    } catch (error) {
      this.logger.error(`Son kontrol zamanı güncelleme hatası: ${error.message}`);
    }
  }

  // Eski ID'den yeni ID'ye geçiş için ek metod
  private async migrateUserLists(oldId: string, newId: string): Promise<void> {
    try {
      const lists = await this.alertListModel.find({ userId: oldId }).exec();
      
      for (const list of lists) {
        // Yeni ID ile aynı isimde liste var mı kontrol et
        const existingList = await this.alertListModel.findOne({ 
          userId: newId, 
          listName: list.listName 
        }).exec();
        
        if (!existingList) {
          // Listeyi yeni ID ile kaydet
          await this.alertListModel.updateOne(
            { _id: list._id },
            { $set: { userId: newId, chatId: list.chatId || oldId }}
          ).exec();
          this.logger.debug(`Liste "${list.listName}" taşındı: ${oldId} -> ${newId}`);
        }
      }
    } catch (error) {
      this.logger.error(`Liste taşıma hatası: ${error.message}`);
    }
  }
} 