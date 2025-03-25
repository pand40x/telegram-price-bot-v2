import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserList } from '../symbol/symbol.schema';

@Injectable()
export class UserListService {
  private readonly logger = new Logger(UserListService.name);

  constructor(
    @InjectModel(UserList.name) private userListModel: Model<UserList>
  ) {}

  // Chat ID kontrolü (Grup mu, özel mesaj mı?)
  private isChatGroup(chatId: string): boolean {
    return chatId.startsWith('-');
  }

  // Her zaman kullanıcı ID'sini döndür, grup içinde olsa bile
  private getUserId(chatId: string, userId: string): string {
    return userId;
  }

  async createList(chatId: string, listName: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const effectiveUserId = userId || chatId;

      // Liste zaten var mı kontrol et
      const existingList = await this.userListModel.findOne({
        userId: effectiveUserId,
        listName: normalizedListName
      }).exec();

      if (existingList) {
        this.logger.debug(`Bu isimde zaten bir liste mevcut: ${normalizedListName}`);
        return false;
      }

      // Yeni liste oluştur
      await this.userListModel.create({
        userId: effectiveUserId,
        listName: normalizedListName,
        symbols: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      this.logger.debug(`Yeni liste oluşturuldu: ${normalizedListName} kullanıcı için: ${effectiveUserId}`);
      return true;
    } catch (error) {
      this.logger.error(`Liste oluşturma hatası: ${error.message}`);
      return false;
    }
  }

  async addSymbolToList(chatId: string, listName: string, symbol: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const normalizedSymbol = symbol.trim().toUpperCase();
      const effectiveUserId = userId || chatId;

      // Liste var mı kontrol et
      const list = await this.userListModel.findOne({
        userId: effectiveUserId,
        listName: normalizedListName
      }).exec();

      if (!list) {
        this.logger.debug(`Liste bulunamadı: ${normalizedListName}`);
        return false;
      }

      // Sembol zaten listede var mı kontrol et
      if (list.symbols.includes(normalizedSymbol)) {
        this.logger.debug(`Sembol zaten listede mevcut: ${normalizedSymbol}`);
        return true;
      }

      // Listeyi güncelle
      const result = await this.userListModel.findOneAndUpdate(
        {
          userId: effectiveUserId,
          listName: normalizedListName
        },
        {
          $addToSet: { symbols: normalizedSymbol },
          updatedAt: new Date()
        },
        { new: true }
      ).exec();

      if (!result) {
        return false;
      }

      this.logger.debug(`"${normalizedSymbol}" sembolü "${normalizedListName}" listesine eklendi`);
      return true;
    } catch (error) {
      this.logger.error(`Listeye sembol ekleme hatası: ${error.message}`);
      return false;
    }
  }

  async removeSymbolFromList(chatId: string, listName: string, symbol: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const normalizedSymbol = symbol.trim().toUpperCase();
      const effectiveUserId = userId || chatId;

      // Listeyi bul ve güncelle
      const result = await this.userListModel.findOneAndUpdate(
        {
          userId: effectiveUserId,
          listName: normalizedListName
        },
        {
          $pull: { symbols: normalizedSymbol },
          updatedAt: new Date()
        },
        { new: true }
      ).exec();

      if (!result) {
        this.logger.debug(`Liste bulunamadı: ${normalizedListName}`);
        return false;
      }

      this.logger.debug(`"${normalizedSymbol}" sembolü "${normalizedListName}" listesinden çıkarıldı`);
      return true;
    } catch (error) {
      this.logger.error(`Listeden sembol çıkarma hatası: ${error.message}`);
      return false;
    }
  }

  async getUserLists(chatId: string, userId: string = null): Promise<{ listName: string, symbolCount: number }[]> {
    try {
      const effectiveUserId = userId || chatId;
      
      const lists = await this.userListModel.find({ userId: effectiveUserId }).exec();
      
      return lists.map(list => ({
        listName: list.listName,
        symbolCount: list.symbols.length
      }));
    } catch (error) {
      this.logger.error(`Kullanıcı listeleri getirme hatası: ${error.message}`);
      return [];
    }
  }

  async getListDetails(chatId: string, listName: string, userId: string = null): Promise<{ listName: string, symbols: string[] } | null> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const effectiveUserId = userId || chatId;
      const isGroup = this.isChatGroup(chatId);
      
      this.logger.debug(`LIST-SERVICE: "${normalizedListName}" listesi detayları aranıyor, userId: ${effectiveUserId}, chatId: ${chatId}`);
      
      // İlk önce normal ID ile ara
      let list = await this.userListModel.findOne({
        userId: effectiveUserId,
        listName: normalizedListName
      }).exec();
      
      // Eğer bulunamadıysa ve bir grup ise, eski format ID ile ara
      if (!list && isGroup && userId) {
        const oldFormatId = `${chatId}_${userId}`;
        list = await this.userListModel.findOne({
          userId: oldFormatId,
          listName: normalizedListName
        }).exec();
        
        // Eğer eski format ile bulunduysa, log oluştur
        if (list) {
          this.logger.debug(`LIST-SERVICE: "${normalizedListName}" listesi eski format ID ile bulundu: ${oldFormatId}`);
        }
      }
      
      // Direkt kullanıcı ID'si ile de deneyelim
      if (!list && userId) {
        list = await this.userListModel.findOne({
          userId: userId,
          listName: normalizedListName
        }).exec();
        
        if (list) {
          this.logger.debug(`LIST-SERVICE: "${normalizedListName}" listesi doğrudan kullanıcı ID ile bulundu: ${userId}`);
        }
      }
      
      if (!list) {
        this.logger.debug(`LIST-SERVICE: "${normalizedListName}" adlı liste bulunamadı`);
        return null;
      }
      
      this.logger.debug(`LIST-SERVICE: "${normalizedListName}" listesi bulundu, ${list.symbols.length} sembol içeriyor`);
      
      return {
        listName: list.listName,
        symbols: list.symbols
      };
    } catch (error) {
      this.logger.error(`Liste detayları getirme hatası: ${error.message}`);
      return null;
    }
  }

  async deleteList(chatId: string, listName: string, userId: string = null): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      const effectiveUserId = userId || chatId;
      
      const result = await this.userListModel.deleteOne({
        userId: effectiveUserId,
        listName: normalizedListName
      }).exec();
      
      if (result.deletedCount === 0) {
        this.logger.debug(`Liste bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      this.logger.debug(`"${normalizedListName}" listesi silindi`);
      return true;
    } catch (error) {
      this.logger.error(`Liste silme hatası: ${error.message}`);
      return false;
    }
  }

  // Görev listelerini migrasyon için metod
  async migrateUserLists(oldUserId: string, newUserId: string): Promise<void> {
    try {
      const lists = await this.userListModel.find({ userId: oldUserId }).exec();
      
      for (const list of lists) {
        // Yeni ID ile aynı isimde liste var mı kontrol et
        const existingList = await this.userListModel.findOne({ 
          userId: newUserId, 
          listName: list.listName 
        }).exec();
        
        if (!existingList) {
          // Listeyi yeni ID ile kaydet
          await this.userListModel.updateOne(
            { _id: list._id },
            { $set: { userId: newUserId }}
          ).exec();
          this.logger.debug(`Liste "${list.listName}" taşındı: ${oldUserId} -> ${newUserId}`);
        }
      }
    } catch (error) {
      this.logger.error(`Liste taşıma hatası: ${error.message}`);
    }
  }
} 