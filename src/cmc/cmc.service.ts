import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ApiKey, ApiKeyDocument } from './schemas/api-key.schema';

interface CryptoPrice {
  symbol: string;
  price: number;
  percentChange24h: number;
}

@Injectable()
export class CmcService implements OnModuleInit {
  private readonly logger = new Logger(CmcService.name);
  private readonly baseUrl = 'https://pro-api.coinmarketcap.com/v1';
  private currentApiKey: string = null;
  private apiKeysCache: string[] = [];
  private limitedKeysCache: Set<string> = new Set(); // Limiti dolan anahtarları takip et
  private isInitialized = false;

  constructor(
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeApiKeys();
  }

  private async initializeApiKeys() {
    if (this.isInitialized) {
      return;
    }

    const apiKeys = this.configService.get<string>('CMC_API_KEYS')?.split(',') || [];
    
    if (apiKeys.length === 0) {
      this.logger.error('No API keys found in configuration. Please check your .env file.');
      return;
    }
    
    try {
      // Önce mevcut anahtarları veritabanından yükle
      const existingKeys = await this.apiKeyModel.find().exec();
      const existingKeyMap = new Map(existingKeys.map(k => [k.key, k]));
      
      // Yeni anahtarları ekle, mevcut olanları güncelleme
      for (const key of apiKeys) {
        if (key.trim()) {
          if (!existingKeyMap.has(key.trim())) {
            await this.apiKeyModel.create({ key: key.trim() });
          }
        }
      }
      
      // Veritabanında olan ama config'de olmayan anahtarları kaldır
      const configKeySet = new Set(apiKeys.map(k => k.trim()).filter(k => k));
      for (const existingKey of existingKeys) {
        if (!configKeySet.has(existingKey.key)) {
          await this.apiKeyModel.findByIdAndDelete(existingKey._id);
        }
      }
      
      // Limitli anahtarları yükle (program yeniden başlatıldığında hatırlanması için)
      const limitedKeys = await this.apiKeyModel.find({ isLimitReached: true }).exec();
      for (const key of limitedKeys) {
        this.limitedKeysCache.add(key.key);
      }
      
      // Aktif anahtarları önbelleğe al
      await this.refreshApiKeysCache();
    } catch (error) {
      this.logger.error(`Error initializing API keys: ${error.message}`);
    }
    
    this.isInitialized = true;
    this.logger.log(`Initialized API key system with ${this.apiKeysCache.length} active keys and ${this.limitedKeysCache.size} limited keys`);
  }
  
  private async refreshApiKeysCache() {
    // Aktif anahtarları veritabanından yükle
    const apiKeys = await this.apiKeyModel.find({ isLimitReached: false }).sort({ usageCount: 1 }).exec();
    this.apiKeysCache = apiKeys.map(keyDoc => keyDoc.key);
    this.logger.log(`API keys cache refreshed. ${this.apiKeysCache.length} active keys available.`);
    
    // Hiç aktif anahtar yoksa uyar
    if (this.apiKeysCache.length === 0) {
      const allKeys = await this.apiKeyModel.find().exec();
      const keysStatus = allKeys.map(k => ({
        id: k._id.toString(),
        key: `${k.key.substring(0, 5)}...`,
        isLimitReached: k.isLimitReached,
        usageCount: k.usageCount,
        lastUsed: k.lastUsed
      }));
      this.logger.warn(`No active API keys available. All keys status: ${JSON.stringify(keysStatus)}`);
    }
  }

  async getActiveApiKey(): Promise<string> {
    // Mevcut anahtarımız var mı ve hala geçerli mi kontrol et
    if (this.currentApiKey && this.apiKeysCache.includes(this.currentApiKey) && !this.limitedKeysCache.has(this.currentApiKey)) {
      return this.currentApiKey;
    }
    
    // Önbellek boşsa, yenile
    if (this.apiKeysCache.length === 0) {
      await this.refreshApiKeysCache();
      
      // Yenilemeden sonra hala boşsa, durum kritik - tüm anahtarlar kullanılmış demektir
      if (this.apiKeysCache.length === 0) {
        this.logger.error('All API keys have reached their rate limits. Please wait until CoinMarketCap resets the limits (typically 24 hours).');
        throw new Error('No API keys available - all have reached their rate limits');
      }
    }
    
    // Önbellekten en az kullanılan anahtarı al
    this.currentApiKey = this.apiKeysCache[0];
    
    // Kullanım sayısını güncelle
    await this.apiKeyModel.findOneAndUpdate(
      { key: this.currentApiKey },
      {
        $inc: { usageCount: 1 },
        lastUsed: new Date(),
      }
    );
    
    return this.currentApiKey;
  }

  async markApiKeyAsLimited(apiKey: string) {
    if (!apiKey || this.limitedKeysCache.has(apiKey)) {
      return; // Anahtar zaten limitli olarak işaretlenmişse tekrar işaretleme
    }
    
    this.logger.warn(`Marking API key ${apiKey.substring(0, 5)}... as limited`);
    
    // Anahtarı veritabanında limitli olarak işaretle
    await this.apiKeyModel.findOneAndUpdate(
      { key: apiKey },
      { isLimitReached: true, lastUsed: new Date() }
    );
    
    // Önbellekten hemen kaldır
    this.apiKeysCache = this.apiKeysCache.filter(key => key !== apiKey);
    
    // Limitli anahtarlar önbelleğine ekle
    this.limitedKeysCache.add(apiKey);
    
    // Mevcut anahtar limitlendiyse sıfırla
    if (this.currentApiKey === apiKey) {
      this.currentApiKey = null;
    }
    
    this.logger.warn(`API key ${apiKey.substring(0, 5)}... marked as limited. ${this.apiKeysCache.length} keys remaining.`);
    
    // Eğer tüm anahtarlar limitlendiyse uyarı verelim
    if (this.apiKeysCache.length === 0) {
      this.logger.error('All API keys have reached their limits. Waiting until CoinMarketCap resets the limits.');
    }
  }

  async getPrices(symbols: string[]): Promise<CryptoPrice[]> {
    // API anahtarı değiştirme için
    const maxRetries = 5; // Maksimum deneme sayısı
    let retryCount = 0;
    const usedKeys = new Set<string>();
    
    while (retryCount < maxRetries) {
      try {
        // Aktif bir API anahtarı al
        const apiKey = await this.getActiveApiKey();
        
        // Bu anahtarı daha önce kullandık mı?
        if (usedKeys.has(apiKey)) {
          // Aynı anahtarı tekrar kullanmayı önle
          this.currentApiKey = null;
          retryCount++;
          continue;
        }
        
        usedKeys.add(apiKey);
        
        this.logger.log(`Attempting to fetch prices with API key ${apiKey.substring(0, 5)}... (attempt ${retryCount + 1}/${maxRetries})`);
        
        const response = await axios.get(`${this.baseUrl}/cryptocurrency/quotes/latest`, {
          headers: {
            'X-CMC_PRO_API_KEY': apiKey,
          },
          params: {
            symbol: symbols.join(','),
          },
          timeout: 8000, // Daha iyi başarı şansı için artırılmış zaman aşımı
        });
        
        if (!response.data || !response.data.data) {
          this.logger.error(`Invalid response from CMC API: ${JSON.stringify(response.data)}`);
          throw new Error('Invalid response from CoinMarketCap API');
        }
        
        const data = response.data.data;
        
        return symbols.map(symbol => {
          const cryptoData = data[symbol.toUpperCase()];
          if (!cryptoData) {
            return {
              symbol,
              price: 0,
              percentChange24h: 0,
            };
          }
          
          return {
            symbol: cryptoData.symbol,
            price: cryptoData.quote.USD.price,
            percentChange24h: cryptoData.quote.USD.percent_change_24h,
          };
        });
      } catch (error) {
        const errorMsg = error.response?.data?.status?.error_message || error.message;
        const statusCode = error.response?.status;
        const errorCode = error.response?.data?.status?.error_code;
        
        this.logger.error(`Error fetching prices: ${errorMsg} (Status: ${statusCode}, Code: ${errorCode})`);
        
        // Gelişmiş API limiti hata tespiti
        const isRateLimitError = 
          error.response && 
          (error.response.status === 429 || 
           error.response.status === 403 ||
           (error.response.data && 
            error.response.data.status && 
            (error.response.data.status.error_code === 1008 || 
             error.response.data.status.error_code === 1006)));
        
        if (isRateLimitError) {
          // Limitli anahtarı işaretle ve yeni bir anahtara geç
          await this.markApiKeyAsLimited(this.currentApiKey);
          retryCount++;
          this.logger.log(`API key limit reached. Switching to next key (attempt ${retryCount}/${maxRetries})`);
          
          // API'yi sürekli sorgulamayı önlemek için küçük bir gecikme ekle
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // Limit hatası değilse ama birden çok anahtar kullandıysak, yine de başka bir anahtar dene
          if (usedKeys.size < this.apiKeysCache.length) {
            this.logger.log(`Non-rate-limit error, but trying another key anyway`);
            this.currentApiKey = null; // Farklı bir anahtar kullanmaya zorla
            retryCount++;
            
            // Yeniden denemeden önce küçük bir gecikme
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            // Tüm anahtarları denediysek veya farklı bir hata varsa, hatayı fırlat
            throw error;
          }
        }
      }
    }
    
    // Buraya geldiyse, tüm denemeleri tükettik
    const allKeys = await this.apiKeyModel.find().exec();
    this.logger.error(`All retries failed. Used keys: ${Array.from(usedKeys).map(k => k.substring(0, 5)).join(', ')}`);
    this.logger.error(`Total keys in DB: ${allKeys.length}, Limited keys: ${allKeys.filter(k => k.isLimitReached).length}`);
    
    throw new Error('Failed to fetch prices after multiple retries with different API keys');
  }

  formatPrice(price: CryptoPrice): string {
    // Akıllı fiyat formatlaması
    let priceString: string;
    const priceValue = price.price;
    
    if (priceValue >= 1000) {
      // Büyük fiyatlarda binlik ayırıcı ekle ve 2 ondalık basamak göster
      priceString = priceValue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    } else if (priceValue >= 1) {
      // Normal fiyatlar için 2 ondalık basamak yeterli
      priceString = priceValue.toFixed(2);
    } else if (priceValue >= 0.01) {
      // Küçük fiyatlar için 4 ondalık basamak
      priceString = priceValue.toFixed(4);
    } else if (priceValue >= 0.0001) {
      // Daha küçük fiyatlar için 6 ondalık basamak 
      priceString = priceValue.toFixed(6);
    } else if (priceValue >= 0.00000001) {
      // Çok küçük fiyatlar için 8 ondalık basamak
      priceString = priceValue.toFixed(8);
    } else {
      // En küçük fiyatlar için bilimsel gösterim
      priceString = priceValue.toExponential(6);
    }
    
    const changePrefix = price.percentChange24h >= 0 ? '+' : '';
    const changeValue = `${changePrefix}${price.percentChange24h.toFixed(2)}%`;
    
    return `${price.symbol}: <b>${priceString}</b>  (${changeValue})`;
  }
} 