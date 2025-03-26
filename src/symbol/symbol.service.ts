import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import yahooFinance from 'yahoo-finance2';
import { UserPreference } from './symbol.schema';
import { SymbolData } from './symbol.schema';
import { UserList } from './symbol.schema';

// Sembol mapping arayüzü
export interface SymbolMapping {
  symbol: string;
  type: 'stock' | 'crypto';
  name: string;
  aliases: string[];
  popularity: number; // 1-100 arası
}

// Arama sonucu arayüzü
export interface SymbolSearchResult {
  symbol: string;
  name: string;
  type: 'stock' | 'crypto';
  score: number;
}

// Kullanıcı tercihleri arayüzü
interface UserPreferences {
  stockSearches: number;
  cryptoSearches: number;
  queryPreferences: Map<string, string>; // Sorgu -> seçilen sembol
}

@Injectable()
export class SymbolService implements OnModuleInit {
  private readonly logger = new Logger(SymbolService.name);
  
  // Kullanıcı arama geçmişini tutan map (in-memory cache)
  private userHistory: Map<string, UserPreferences> = new Map();
  
  // Sembol veritabanı - MongoDB'den yüklenecek (in-memory cache)
  private symbolDatabase: SymbolMapping[] = [];

  constructor(
    @InjectModel(UserPreference.name) private userPreferenceModel: Model<UserPreference>,
    @InjectModel(SymbolData.name) private symbolDataModel: Model<SymbolData>,
    @InjectModel(UserList.name) private userListModel: Model<UserList>
  ) {}

  async onModuleInit() {
    // Load initial seed data if database is empty
    const symbolCount = await this.symbolDataModel.countDocuments().exec();
    if (symbolCount === 0) {
      this.logger.log('Initializing symbol database with seed data...');
      await this.seedSymbolDatabase();
    }
    
    // Load symbol database from MongoDB to memory
    const symbols = await this.symbolDataModel.find().exec();
    this.symbolDatabase = symbols.map(symbol => ({
      symbol: symbol.symbol,
      type: symbol.type as 'stock' | 'crypto',
      name: symbol.name,
      aliases: symbol.aliases,
      popularity: symbol.popularity
    }));
    
    // Load user preferences from MongoDB to memory
    const userPrefs = await this.userPreferenceModel.find().exec();
    for (const pref of userPrefs) {
      const queryPrefsMap = new Map<string, string>();
      // Check if it's a mongoose document or plain object
      const prefsObj = typeof pref.queryPreferences === 'object' ? pref.queryPreferences : {};
      
      // Convert to Map
      Object.entries(prefsObj).forEach(([key, value]) => {
        queryPrefsMap.set(key, value as string);
      });
      
      this.userHistory.set(pref.userId, {
        stockSearches: pref.stockSearches,
        cryptoSearches: pref.cryptoSearches,
        queryPreferences: queryPrefsMap
      });
    }
    
    this.logger.log(`Loaded ${this.symbolDatabase.length} symbols and ${this.userHistory.size} user preferences from database`);
  }
  
  // Function to seed the symbol database with initial data
  private async seedSymbolDatabase() {
    // A subset of symbols for seeding (the complete list can be migrated later)
    const seedSymbols = [
    // Kripto paralar
    {
      symbol: 'BTC',
      type: 'crypto',
      name: 'Bitcoin',
        aliases: ['Bitcoin', 'BTC', 'bitcoin'],
      popularity: 100
    },
    {
      symbol: 'ETH',
      type: 'crypto',
      name: 'Ethereum',
        aliases: ['Ethereum', 'Ether', 'ethereum', 'ether'],
      popularity: 95
    },
    {
      symbol: 'USDT',
      type: 'crypto',
      name: 'Tether',
        aliases: ['Tether', 'USDT', 'Stablecoin', 'tether', 'stablecoin'],
      popularity: 92
    },
    {
      symbol: 'BNB',
      type: 'crypto',
      name: 'Binance Coin',
        aliases: ['Binance', 'BNB', 'binance'],
      popularity: 88
    },
    {
      symbol: 'DOGE',
      type: 'crypto',
      name: 'Dogecoin',
        aliases: ['Dogecoin', 'Doge', 'dogecoin', 'doge'],
      popularity: 75
    },
      // Yaygın Hisse Senetleri
    {
      symbol: 'AAPL',
      type: 'stock',
      name: 'Apple Inc.',
        aliases: ['Apple', 'iPhone maker', 'apple', 'iphone maker'],
      popularity: 100
    },
    {
      symbol: 'MSFT',
      type: 'stock',
      name: 'Microsoft Corporation',
        aliases: ['Microsoft', 'MS', 'microsoft', 'ms'],
      popularity: 98
    },
    {
      symbol: 'GOOGL',
      type: 'stock',
      name: 'Alphabet Inc. (Google)',
        aliases: ['Google', 'Alphabet', 'google', 'alphabet'],
      popularity: 97
    },
    {
      symbol: 'META',
      type: 'stock',
      name: 'Meta Platforms Inc.',
        aliases: ['Meta', 'Facebook', 'FB', 'meta', 'facebook', 'fb'],
      popularity: 94
    },
    {
      symbol: 'TSLA',
      type: 'stock',
      name: 'Tesla Inc.',
        aliases: ['Tesla', 'tesla'],
      popularity: 93
    },
    {
      symbol: 'NVDA',
      type: 'stock',
      name: 'NVIDIA Corporation',
        aliases: ['NVIDIA', 'nvidia', 'Nvidia'],
        popularity: 93
      },
      // Türk Hisseleri
    {
      symbol: 'THYAO.IS',
      type: 'stock',
      name: 'TURK HAVA YOLLARI',
        aliases: ['Turkish Airlines', 'Türk Hava Yolları', 'THY', 'thyao', 'thy'],
      popularity: 85
    },
    {
        symbol: 'ASELS.IS',
      type: 'stock',
        name: 'ASELSAN',
        aliases: ['Aselsan', 'asels', 'aselsan'],
        popularity: 80
    },
    {
      symbol: 'GARAN.IS',
      type: 'stock',
      name: 'GARANTI BANKASI',
        aliases: ['Garanti', 'Garanti Bankası', 'garan', 'garanti', 'garanti bankası'],
      popularity: 80
    },
    {
      symbol: 'PETKM.IS',
      type: 'stock',
      name: 'PETKIM PETROKIMYA HOLDING',
        aliases: ['Petkim', 'Petrokimya', 'petkm', 'petkim', 'petrokimya'],
      popularity: 74
    },
    {
      symbol: 'ALFAS.IS',
      type: 'stock',
      name: 'ALFA SOLAR ENERJI',
        aliases: ['Alfa Solar', 'Alfa', 'alfas', 'alfa solar', 'alfa'],
      popularity: 70
    },
    {
      symbol: 'SISE.IS',
      type: 'stock',
      name: 'TURKIYE SISE VE CAM FABRIKALARI',
        aliases: ['Sisecam', 'Şişecam', 'Sise', 'sise', 'sisecam', 'şişecam'],
      popularity: 70
      }
    ];
    
    try {
      await this.symbolDataModel.insertMany(seedSymbols);
      this.logger.log(`Seeded database with ${seedSymbols.length} symbols`);
    } catch (error) {
      this.logger.error('Failed to seed symbol database', error);
    }
  }

  /**
   * Sembol çözümleme fonksiyonu (resolve)
   * @param query Kullanıcı girdisi
   * @param userId Kullanıcı ID'si (opsiyonel)
   */
  async resolveSymbol(query: string, userId?: string): Promise<SymbolSearchResult[]> {
    // Boş girdi kontrolü
    if (!query || query.trim() === '') return [];
    
    this.logger.debug(`Resolving symbol for query: "${query}"`);
    
    // Kullanıcı daha önce bu sorgu için bir sembol seçti mi?
    if (userId) {
      const userPreference = this.getUserQueryPreference(userId, query);
      if (userPreference) {
        // Kullanıcının bu sorgu için önceden seçtiği sembol var
        const preferredSymbol = this.symbolDatabase.find(s => s.symbol === userPreference);
        if (preferredSymbol) {
          this.logger.debug(`Using user preference for "${query}": ${userPreference}`);
          return [{
            symbol: preferredSymbol.symbol,
            name: preferredSymbol.name,
            type: preferredSymbol.type,
            score: 100 // En yüksek skor
          }];
        }
      }
    }
    
    // Force tip kontrolü (prefix'e göre)
    const forcedType = this.getForcedType(query);
    const cleanQuery = this.removePrefix(query);
    const lowerQuery = this.removePrefix(query).toLowerCase();
    const upperQuery = this.removePrefix(query).toUpperCase();

    // Yaygın ABD hisse senetleri - özellikle direkt tek eşleşme için
    const commonStocks = [
      // Teknoloji
      'AAPL', 'MSFT', 'AMZN', 'GOOG', 'GOOGL', 'META', 'TSLA', 'NVDA', 'AMD', 'INTC', 
      'NFLX', 'ADBE', 'CSCO', 'CRM', 'ORCL', 'IBM', 'PYPL', 'UBER', 'SHOP', 'SQ',
      
      // Finans
      'V', 'JPM', 'BAC', 'WFC', 'C', 'MA', 'GS', 'AXP', 'MS', 'BLK', 
      
      // Tüketim
      'WMT', 'COST', 'HD', 'MCD', 'SBUX', 'NKE', 'DIS', 'BKNG', 'ABNB', 'PG',
      
      // Sağlık/Biyoteknoloji
      'JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'AMGN', 'VRTX', 'GILD', 'BIIB', 'BMY',
      'REGN', 'MRNA', 'MDT', 'UNH', 'CVS',
      
      // Otomotiv
      'F', 'GM', 'TM',
      
      // Diğer
      'BABA', 'KO', 'PEP', 'GE'
    ];

    // Şirket isimleri ↔ sembol eşleşmesi
    const companyNameMapping = {
      'apple': 'AAPL',
      'microsoft': 'MSFT',
      'google': 'GOOGL',
      'alphabet': 'GOOGL',
      'meta': 'META',
      'facebook': 'META',
      'amazon': 'AMZN',
      'tesla': 'TSLA',
      'nvidia': 'NVDA',
      'netflix': 'NFLX',
      'pfizer': 'PFE',
      'johnson': 'JNJ',
      'coca cola': 'KO',
      'coca-cola': 'KO',
      'walmart': 'WMT',
      'disney': 'DIS',
      'nike': 'NKE',
      'intel': 'INTC',
      'amd': 'AMD',
      'ibm': 'IBM',
      'cisco': 'CSCO',
      'paypal': 'PYPL',
      'visa': 'V',
      'mastercard': 'MA',
      'jpmorgan': 'JPM',
      'bank of america': 'BAC',
      'vertex': 'VRTX',
      'alibaba': 'BABA',
      'starbucks': 'SBUX',
      'moderna': 'MRNA',
      'abbott': 'ABT'
    };
    
    // 0. ABD hissesi direkt eşleme kontrolü - bunu en önce yapalım
    if (commonStocks.includes(upperQuery)) {
      this.logger.debug(`Direct common US stock symbol match: ${upperQuery}`);
      
      // Veritabanında zaten var mı?
      const stockEntry = this.symbolDatabase.find(s => s.symbol === upperQuery);
      if (stockEntry) {
        return [{
          symbol: stockEntry.symbol,
          name: stockEntry.name,
          type: 'stock',
          score: 100 // Tam eşleşme
        }];
      } 
      
      // Veritabanında yoksa doğrudan Yahoo'dan çekelim
      try {
        this.logger.debug(`Common US stock not in database, checking Yahoo API: ${upperQuery}`);
        const yahooResult = await this.checkYahooAPI(upperQuery);
        if (yahooResult) {
          // Type'ı açıkça stock olarak belirleyelim, yahoo API'den crypto gelmemesi için
          yahooResult.type = 'stock';
          return [yahooResult];
        }
      } catch (error) {
        this.logger.error(`Error checking Yahoo API for common stock: ${error.message}`);
      }
    }
    
    // 1. Şirket ismi kontrolü
    if (companyNameMapping[lowerQuery]) {
      const stockSymbol = companyNameMapping[lowerQuery];
      this.logger.debug(`Company name match found: ${lowerQuery} -> ${stockSymbol}`);
      
      const stockEntry = this.symbolDatabase.find(s => s.symbol === stockSymbol);
      if (stockEntry) {
        return [{
          symbol: stockEntry.symbol,
          name: stockEntry.name,
          type: 'stock', // Tip açıkça belirtiyoruz
          score: 98 // Yüksek skor
        }];
      }
      
      // Veritabanında yoksa doğrudan Yahoo'dan çekelim
      try {
        const yahooResult = await this.checkYahooAPI(stockSymbol);
        if (yahooResult) {
          yahooResult.type = 'stock';
          return [yahooResult];
        }
      } catch (error) {
        this.logger.error(`Error checking Yahoo API for company name match: ${error.message}`);
      }
    }
    
    // Tip zorlaması varsa, sadece o tipi dikkate al
    if (forcedType) {
      this.logger.debug(`Forced type: ${forcedType} (from prefix)`);
    }

    // 2. Tam eşleşme kontrolü
    let matches = this.findExactMatches(query);
    
    // Tam eşleşme bulduysa, doğrudan döndür - bulanık eşleşme arama
    if (matches.length > 0) {
      this.logger.debug(`Found exact match: ${matches[0].symbol}`);
      return matches;
    }
    
    // 3. Ad / takma ad eşleşmesi kontrolü
    matches = this.findNameMatches(query);
      
    // Tek bir isim eşleşmesi varsa hemen dön
    if (matches.length === 1) {
      this.logger.debug(`Found name match: ${matches[0].symbol}`);
      return matches;
    }
    
    // 4. Birebir eşleşme kontrolü (tsla -> TSLA gibi, case-insensitive)
    if (matches.length === 0) {
      const caseInsensitiveMatches = this.symbolDatabase
        .filter(entry => {
          // Tipo zorlaması varsa ve tip uyuşmuyorsa atla
          if (forcedType !== null && entry.type !== forcedType) {
            return false;
          }
          
          const normalizedSymbol = entry.symbol.replace('.IS', '');
          return normalizedSymbol.toLowerCase() === lowerQuery;
        })
        .map(entry => ({
          symbol: entry.symbol,
          name: entry.name,
          type: entry.type,
          score: 99 // Neredeyse tam eşleşme
        }));
      
      if (caseInsensitiveMatches.length > 0) {
        this.logger.debug(`Case-insensitive direct match found for "${lowerQuery}"`);
        matches = caseInsensitiveMatches;
        
        // Tek eşleşme varsa hemen dön
        if (matches.length === 1) {
          return matches;
        }
      }
    }
    
    // 5. Doğrudan ABD hisse senedi sembolü olarak Yahoo'ya sor (4-5 harf uzunluğundaki sembollerde)
    // Bu sayede VRTX gibi doğrudan kodlarda fuzzy göstermek yerine doğruca sonuç alırız
    if (matches.length === 0 && upperQuery.length >= 3 && upperQuery.length <= 5 && 
        !forcedType || forcedType === 'stock') {
      // Olası ABD hisse senedi - doğrudan Yahoo'dan kontrol et
      try {
        this.logger.debug(`Checking if ${upperQuery} is a valid US stock via Yahoo API`);
        const yahooResult = await this.checkYahooAPI(upperQuery);
        if (yahooResult) {
          // Eğer hisse senedi ise tipini belirle
          if (yahooResult.type !== 'crypto') {
            yahooResult.type = 'stock';
            this.logger.debug(`Found valid stock from Yahoo API: ${yahooResult.symbol}`);
            return [yahooResult];
          }
        }
      } catch (error) {
        this.logger.debug(`${upperQuery} is not a valid stock: ${error.message}`);
      }
    }
    
    // 6. Fuzzy matching (bulanık eşleşme) - ama önce tip ayrımı yapalım
    if (matches.length === 0) {
      let fuzzyMatches = this.findFuzzyMatches(query);
      
      // Tip zorlaması varsa veya query uzunluğu 4+ ise, tipi belirterek sonuçları filtrele
      if (forcedType) {
        this.logger.debug(`Filtering fuzzy matches by forced type: ${forcedType}`);
        fuzzyMatches = fuzzyMatches.filter(match => match.type === forcedType);
      }
      // Tip zorlaması yoksa ama sorgu 4+ karakter ve büyük harfliyse, muhtemelen hisse kodu aranıyor
      else if (upperQuery.length >= 4 && upperQuery === cleanQuery) {
        this.logger.debug(`Query looks like a stock symbol (${upperQuery}), preferring stock matches`);
        // Hisse senetlerini öne çıkar
        fuzzyMatches.sort((a, b) => {
          if (a.type === 'stock' && b.type !== 'stock') return -1;
          if (a.type !== 'stock' && b.type === 'stock') return 1;
          return b.score - a.score;
        });
      }
      
      matches = fuzzyMatches;
    }
    
    // 7. Türk hisseleri için özel kontrol - '.IS' uzantısı olmadan arama
    if (matches.length === 0 && this.isPotentialTurkishStock(cleanQuery)) {
      this.logger.debug(`Potential Turkish stock detected: ${cleanQuery}`);
      const turkishMatches = this.symbolDatabase
        .filter(entry => {
          if (entry.type !== 'stock' || !entry.symbol.endsWith('.IS')) return false;
          const baseSymbol = entry.symbol.replace('.IS', '');
          return baseSymbol.toLowerCase() === lowerQuery ||
                 entry.aliases.some(alias => alias && alias.toLowerCase() === lowerQuery);
        })
        .map(entry => ({
          symbol: entry.symbol,
          name: entry.name,
          type: entry.type as 'stock' | 'crypto',
          score: 95 // Turkish stock match
        }));
      
      matches = [...matches, ...turkishMatches];
    }
    
    // 8. Hiç eşleşme bulunamadıysa, temiz sorguyla Yahoo API'den sembol bilgisini kontrol et
    if (matches.length === 0) {
      try {
        this.logger.debug(`No matches found in database for ${cleanQuery}, trying Yahoo API`);
        const yahooResult = await this.checkYahooAPI(cleanQuery);
        if (yahooResult) {
          matches.push(yahooResult);
        }
      } catch (error) {
        this.logger.error(`Error checking Yahoo API: ${error.message}`);
      }
    }
    
    // 9. Kullanıcı tercihi varsa eşleşmeleri filtrele
    if (userId && matches.length > 1) {
      const userPref = this.getUserAssetTypePreference(userId);
      if (userPref && !forcedType) {
        // Kullanıcı tercihi varsa ve kullanıcı zorla tip belirtmediyse
        // o tipteki sonuçlara öncelik ver
        matches.sort((a, b) => {
          if (a.type === userPref && b.type !== userPref) return -1;
          if (a.type !== userPref && b.type === userPref) return 1;
          return b.score - a.score;
        });
      }
    }
    
    // 10. Tip tutarlılığı kontrolü - sonuçlar varsa ve zorlanmış/belirgin bir tip yoksa
    if (matches.length > 1 && !forcedType) {
      // İlk sonucun tipi
      const firstType = matches[0].type;
      let allSameType = true;
      
      // Tüm sonuçlar aynı tipse, farklı tiptekileri filtreleme
      for (let i = 1; i < matches.length; i++) {
        if (matches[i].type !== firstType) {
          allSameType = false;
          break;
        }
      }
      
      // Tüm sonuçlar aynı tipteyse, score'a göre sırala
      if (allSameType) {
        matches.sort((a, b) => b.score - a.score);
      } 
      // Değilse, aynı tipteki sonuçlara öncelik ver
      else {
        matches.sort((a, b) => {
          if (a.type === firstType && b.type !== firstType) return -1;
          if (a.type !== firstType && b.type === firstType) return 1;
          return b.score - a.score;
        });
      }
    }
    
    // 11. Sonuçları skorlarına göre sırala
    else if (!userId || matches.length > 1) {
      matches.sort((a, b) => b.score - a.score);
    }
    
    this.logger.debug(`Found ${matches.length} matches for "${query}"`);
    return matches;
  }
  
  /**
   * Kullanıcının belirli bir sorgu için tercihini güncelle
   * @param userId Kullanıcı ID'si
   * @param query Orijinal sorgu
   * @param selectedSymbol Seçilen sembol
   */
  async updateUserQueryPreference(userId: string, query: string, selectedSymbol: string): Promise<void> {
    // Kullanıcı tercihlerini al veya oluştur
    const prefs = this.getUserPreferences(userId);
    
    // Sorguyu normalize et
    const normalizedQuery = query.trim().toLowerCase();
    
    // Seçilen sembolü kaydet
    prefs.queryPreferences.set(normalizedQuery, selectedSymbol);
    
    // MongoDB'ye kaydet
    const queryPrefsObj = {};
    prefs.queryPreferences.forEach((value, key) => {
      queryPrefsObj[key] = value;
    });
    
    await this.userPreferenceModel.findOneAndUpdate(
      { userId },
      { 
        userId,
        stockSearches: prefs.stockSearches,
        cryptoSearches: prefs.cryptoSearches,
        queryPreferences: queryPrefsObj
      },
      { upsert: true }
    );
    
    this.logger.debug(`Updated user ${userId} preference for query "${normalizedQuery}": ${selectedSymbol}`);
  }
  
  /**
   * Kullanıcının belirli bir sorgu için daha önce seçtiği sembolü al
   */
  private getUserQueryPreference(userId: string, query: string): string | null {
    const prefs = this.userHistory.get(userId);
    if (!prefs || !prefs.queryPreferences) return null;
    
    const normalizedQuery = query.trim().toLowerCase();
    return prefs.queryPreferences.get(normalizedQuery) || null;
  }
  
  /**
   * Kullanıcı arama geçmişini güncelle
   */
  async updateUserHistory(userId: string, searchType: 'stock' | 'crypto'): Promise<void> {
    try {
      // Önce kullanıcı tercihlerini getir
      let prefs = this.getUserPreferences(userId);
      
      // Sayısal değerleri kontrol et ve varsayılan değerlerle başlat
      if (isNaN(prefs.stockSearches)) prefs.stockSearches = 0;
      if (isNaN(prefs.cryptoSearches)) prefs.cryptoSearches = 0;
      
      // İlgili sayacı artır
      if (searchType === 'stock') {
        prefs.stockSearches++;
      } else {
        prefs.cryptoSearches++;
      }
      
      // Belleği güncelle
      this.userHistory.set(userId, prefs);
      
      // MongoDB'ye kaydet
      await this.userPreferenceModel.findOneAndUpdate(
        { userId },
        { 
          userId,
          stockSearches: prefs.stockSearches, 
          cryptoSearches: prefs.cryptoSearches 
        },
        { upsert: true }
      );
      
      this.logger.debug(`Updated user ${userId} history: stock=${prefs.stockSearches}, crypto=${prefs.cryptoSearches}`);
    } catch (error) {
      // Hatayı logla ama işlemin devam etmesine izin ver
      this.logger.error(`Error updating user history: ${error.message}`);
    }
  }
  
  /**
   * Kullanıcı tercihlerini al veya yeni oluştur
   */
  private getUserPreferences(userId: string): UserPreferences {
    if (!this.userHistory.has(userId)) {
      this.userHistory.set(userId, {
        stockSearches: 0,
        cryptoSearches: 0,
        queryPreferences: new Map()
      });
    }
    
    const prefs = this.userHistory.get(userId);
    
    // Sayısal değerleri kontrol et
    if (isNaN(prefs.stockSearches)) prefs.stockSearches = 0;
    if (isNaN(prefs.cryptoSearches)) prefs.cryptoSearches = 0;
    
    return prefs;
  }
  
  /**
   * Exact (birebir) eşleşmeleri bul
   */
  private findExactMatches(query: string): SymbolSearchResult[] {
    const normalizedQuery = query.toUpperCase().trim();
    const lowerQuery = query.toLowerCase().trim();
    
    // Prefix'leri kaldır
    let cleanQuery = normalizedQuery;
    if (cleanQuery.startsWith('$') || cleanQuery.startsWith('#') || cleanQuery.startsWith('@')) {
      cleanQuery = cleanQuery.substring(1);
    }
    
    let cleanLowerQuery = lowerQuery;
    if (cleanLowerQuery.startsWith('$') || cleanLowerQuery.startsWith('#') || cleanLowerQuery.startsWith('@')) {
      cleanLowerQuery = cleanLowerQuery.substring(1);
    }
    
    // Prefix'lerden tip belirleme
    const forcedType: 'stock' | 'crypto' | null = 
      normalizedQuery.startsWith('$') ? 'stock' :
      (normalizedQuery.startsWith('#') || normalizedQuery.startsWith('@')) ? 'crypto' : 
      null;
    
    // Önce direkt sembol eşleşmesini kontrol et (BKR, FANG gibi tam eşleşmeler için)
    const directMatches = this.symbolDatabase
      .filter(entry => {
        // Sadece sembol birebir eşleşsin
        return entry.symbol === cleanQuery;
      })
      .map(entry => ({
        symbol: entry.symbol,
        name: entry.name,
        type: entry.type,
        score: 100 // Tam eşleşme
      }));
    
    // Eğer direkt sembol eşleşmesi varsa, direkt döndür
    if (directMatches.length > 0) {
      this.logger.debug(`Direct symbol match found: ${directMatches[0].symbol}`);
      return directMatches;
    }
    
    // Popüler ABD hisse eşleşmeleri için özel kontrol
    const popularStocks = ['TSLA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'NFLX', 'NVDA'];
    
    if (popularStocks.map(s => s.toLowerCase()).includes(cleanLowerQuery)) {
      const exactStockSymbol = popularStocks.find(s => s.toLowerCase() === cleanLowerQuery);
      if (exactStockSymbol) {
        const stockEntry = this.symbolDatabase.find(entry => entry.symbol === exactStockSymbol);
        if (stockEntry) {
          this.logger.debug(`Popular stock exact match found: ${cleanLowerQuery} -> ${exactStockSymbol}`);
          return [{
            symbol: stockEntry.symbol,
            name: stockEntry.name,
            type: stockEntry.type,
            score: 100 // Tam eşleşme
          }];
        }
      }
    }
    
    // İlk adım: tam eşleşme (case sensitive - TSLA, BTC)
    const exactMatches = this.symbolDatabase
      .filter(entry => {
        // Tip zorlaması varsa ve tip uyuşmuyorsa atla
        if (forcedType !== null && entry.type !== forcedType) {
          return false;
        }
        
        // Tam eşleşme kontrolü
        const exactMatch = entry.symbol === cleanQuery;
        
        // Türk hisselerinde .IS olmadan da eşleştir
        if (!exactMatch && entry.type === 'stock' && entry.symbol.endsWith('.IS')) {
          const baseSymbol = entry.symbol.replace('.IS', '');
          if (baseSymbol === cleanQuery) {
            return true;
          }
        }
        
        return exactMatch;
      })
      .map(entry => ({
        symbol: entry.symbol,
        name: entry.name,
        type: entry.type,
        score: 100 // Tam eşleşme
      }));
    
    if (exactMatches.length > 0) {
      return exactMatches;
    }
    
    // İkinci adım: case insensitive eşleşme (tsla -> TSLA)
    return this.symbolDatabase
      .filter(entry => {
        // Tip zorlaması varsa ve tip uyuşmuyorsa atla
        if (forcedType !== null && entry.type !== forcedType) {
          return false;
        }
        
        // Case insensitive eşleşme
        const caseInsensitiveMatch = entry.symbol.toLowerCase() === cleanLowerQuery;
        
        // Türk hisselerinde .IS olmadan da eşleştir
        if (!caseInsensitiveMatch && entry.type === 'stock' && entry.symbol.endsWith('.IS')) {
          const baseSymbol = entry.symbol.replace('.IS', '').toLowerCase();
          if (baseSymbol === cleanLowerQuery) {
            return true;
          }
        }
        
        // Takma ad birebir eşleşmesi
        const aliasMatch = entry.aliases.some(alias => 
          alias && alias.toLowerCase() === cleanLowerQuery
        );
        
        return caseInsensitiveMatch || aliasMatch;
      })
      .map(entry => ({
        symbol: entry.symbol,
        name: entry.name,
        type: entry.type,
        score: 98 // Neredeyse tam eşleşme
      }));
  }
  
  /**
   * İsim eşleşmelerini bulan metod
   */
  private findNameMatches(query: string): SymbolSearchResult[] {
    const normalizedQuery = query.toLowerCase().trim();
    this.logger.debug(`Finding name matches for: "${normalizedQuery}"`);
    
    // Prefix'leri kaldır
    let cleanQuery = normalizedQuery;
    if (cleanQuery.startsWith('$') || cleanQuery.startsWith('#') || cleanQuery.startsWith('@')) {
      cleanQuery = cleanQuery.substring(1);
    }
    
    // Prefix'lerden tip belirleme
    const forcedType: 'stock' | 'crypto' | null = 
      normalizedQuery.startsWith('$') ? 'stock' :
      (normalizedQuery.startsWith('#') || normalizedQuery.startsWith('@')) ? 'crypto' : 
      null;
    
    this.logger.debug(`Performing name match for: "${cleanQuery}"`);
    
    // Nvidia, Apple, Meta gibi yaygın isimlerin direkt eşleşmesi için
    const commonCompanyNames = {
      'nvidia': 'NVDA',
      'apple': 'AAPL',
      'microsoft': 'MSFT',
      'google': 'GOOGL',
      'alphabet': 'GOOGL',
      'meta': 'META',
      'facebook': 'META',
      'tesla': 'TSLA',
      'amazon': 'AMZN',
      'netflix': 'NFLX'
    };
    
    // Doğrudan isim eşleşmesi kontrolü
    if (commonCompanyNames[cleanQuery]) {
      const directSymbol = commonCompanyNames[cleanQuery];
      const entry = this.symbolDatabase.find(s => s.symbol === directSymbol);
      
      if (entry) {
        this.logger.debug(`Direct company name match: "${cleanQuery}" -> ${directSymbol}`);
        return [{
          symbol: entry.symbol,
          name: entry.name,
          type: entry.type,
          score: 100 // Doğrudan isim eşleşmesi
        }];
      }
    }
    
    const results = this.symbolDatabase
      .filter(entry => {
        // Tip zorlaması varsa ve tip uyuşmuyorsa atla
        if (forcedType !== null && entry.type !== forcedType) {
          return false;
        }
        
        const nameLower = entry.name.toLowerCase();
        
        // İsimlerde kısmi eşleşme ara
        const nameMatch = nameLower.includes(cleanQuery);
        
        // Takma adlarda kısmi eşleşme ara (tam kapsama kontrolü)
        const aliasMatch = entry.aliases.some(alias => {
          if (!alias) return false;
          const aliasLower = alias.toLowerCase();
          
          // Birebir eşleşme
          if (aliasLower === cleanQuery) {
            this.logger.debug(`Exact alias match: "${cleanQuery}" matches alias "${alias}" of symbol ${entry.symbol}`);
            return true;
          }
          
          // Kısmi eşleşme
          const hasMatch = aliasLower.includes(cleanQuery);
          if (hasMatch) {
            this.logger.debug(`Partial alias match: "${cleanQuery}" found in alias "${alias}" of symbol ${entry.symbol}`);
          }
          return hasMatch;
        });
        
        // Özel durum: "google" -> "GOOGL" ve "facebook" -> "META"
        const specialMatch = 
          (cleanQuery === "google" && entry.symbol === "GOOGL") || 
          (cleanQuery === "facebook" && entry.symbol === "META") ||
          (cleanQuery === "nvidia" && entry.symbol === "NVDA") ||
          (cleanQuery === "apple" && entry.symbol === "AAPL") ||
          (cleanQuery === "tesla" && entry.symbol === "TSLA");
        
        if (nameMatch) {
          this.logger.debug(`Found name match: "${cleanQuery}" matches name "${entry.name}" of symbol ${entry.symbol}`);
        }
        
        if (specialMatch) {
          this.logger.debug(`Special match found: "${cleanQuery}" -> ${entry.symbol}`);
        }
        
        return nameMatch || aliasMatch || specialMatch;
      })
      .map(entry => {
        // Tam eşleşme veya özel durumlar için yüksek skor
        if (entry.aliases.some(alias => alias && alias.toLowerCase() === cleanQuery) ||
            (cleanQuery === 'nvidia' && entry.symbol === 'NVDA') ||
            (cleanQuery === 'google' && entry.symbol === 'GOOGL') ||
            (cleanQuery === 'apple' && entry.symbol === 'AAPL') ||
            (cleanQuery === 'tesla' && entry.symbol === 'TSLA') ||
            (cleanQuery === 'facebook' && entry.symbol === 'META')) {
        return {
          symbol: entry.symbol,
          name: entry.name,
          type: entry.type,
            score: 95 // Tam eşleşme için yüksek skor
          };
        }
        
        // İsim eşleşmelerine yüksek skor ver
        return {
          symbol: entry.symbol,
          name: entry.name,
          type: entry.type,
          score: 90 // İsim eşleşmeleri için yüksek skor
        };
      });
    
    this.logger.debug(`Name match found ${results.length} results for "${cleanQuery}"`);
    return results;
  }
  
  /**
   * Fuzzy matching ile benzerlik bulan metod
   */
  private findFuzzyMatches(query: string): SymbolSearchResult[] {
    const normalizedQuery = query.toUpperCase().trim();
    
    // Prefix'leri kaldır
    let cleanQuery = normalizedQuery;
    if (cleanQuery.startsWith('$') || cleanQuery.startsWith('#') || cleanQuery.startsWith('@')) {
      cleanQuery = cleanQuery.substring(1);
    }
    
    // Lowercase versiyonu da tutalım (Google-google karşılaştırması için)
    const lowerQuery = cleanQuery.toLowerCase();
    
    // Prefix'lerden tip belirleme
    const forcedType: 'stock' | 'crypto' | null = 
      normalizedQuery.startsWith('$') ? 'stock' :
      (normalizedQuery.startsWith('#') || normalizedQuery.startsWith('@')) ? 'crypto' : 
      null;
    
    this.logger.debug(`Performing fuzzy match for: "${cleanQuery}"`);

    // Yaygın hisseler için özel kontrol
    const commonStockMapping = {
      'TSLA': 'TSLA', 
      'TESLA': 'TSLA',
      'AAPL': 'AAPL', 
      'APPLE': 'AAPL',
      'MSFT': 'MSFT', 
      'MICROSOFT': 'MSFT',
      'GOOGL': 'GOOGL', 
      'GOOGLE': 'GOOGL',
      'GOOG': 'GOOGL',
      'META': 'META', 
      'FACEBOOK': 'META',
      'AMZN': 'AMZN', 
      'AMAZON': 'AMZN',
      'NVDA': 'NVDA', 
      'NVIDIA': 'NVDA',
      'NFLX': 'NFLX', 
      'NETFLIX': 'NFLX'
    };
    
    // Case insensitive kontrol için lowercase versiyonunu da ekleyelim
    const commonStockLowerMapping = {};
    Object.entries(commonStockMapping).forEach(([key, value]) => {
      commonStockLowerMapping[key.toLowerCase()] = value;
    });
    
    // Yaygın hisse eşleşmesi var mı?
    if (commonStockLowerMapping[lowerQuery]) {
      const stockSymbol = commonStockMapping[cleanQuery] || commonStockLowerMapping[lowerQuery];
      const stockEntry = this.symbolDatabase.find(s => s.symbol === stockSymbol);
      
      if (stockEntry) {
        this.logger.debug(`Common stock fuzzy match found: ${lowerQuery} -> ${stockSymbol}`);
        return [{
          symbol: stockEntry.symbol,
          name: stockEntry.name,
          type: stockEntry.type,
          score: 95 // Yüksek skor (tam eşleşme değil ama çok yakın)
        }];
      }
    }
    
    // Levenshtein mesafesi hesaplama
    const getLevenshteinDistance = (a: string, b: string): number => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      
      if (aLower.length === 0) return bLower.length;
      if (bLower.length === 0) return aLower.length;
      
      const matrix = Array(aLower.length + 1).fill(null).map(() => Array(bLower.length + 1).fill(null));
      
      for (let i = 0; i <= aLower.length; i++) matrix[i][0] = i;
      for (let j = 0; j <= bLower.length; j++) matrix[0][j] = j;
      
      for (let i = 1; i <= aLower.length; i++) {
        for (let j = 1; j <= bLower.length; j++) {
          const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,     // silme
            matrix[i][j - 1] + 1,     // ekleme
            matrix[i - 1][j - 1] + cost  // değiştirme
          );
        }
      }
      
      return matrix[aLower.length][bLower.length];
    };
    
    // Örnek uzunluğuna göre maksimum uzaklık hesabı
    const getMaxDistanceForLength = (len: number): number => {
      if (len <= 2) return 0;      // 1-2 karakter: Tam eşleşme gerekiyor
      if (len === 3) return 1;     // 3 karakter: Max 1 değişikliğe izin var
      if (len <= 5) return 2;      // 4-5 karakter: Max 2 değişikliğe izin var
      return 3;                    // 6+ karakter: Max 3 değişikliğe izin var
    };
    
    // Özel durumlar için kontrol
    const specialCases = {
      "GOOGLE": "GOOGL", // Google -> GOOGL
      "GOOG": "GOOGL", // GOOG -> GOOGL
      "FACE": "META", // Facebook -> META
      "FACEBOOK": "META", // Facebook -> META
      "TSLA": "TSLA", // Tesla -> TSLA
      "TESLA": "TSLA" // Tesla -> TSLA
    };
    
    // Lowercase special cases
    const lowerSpecialCases = {};
    Object.entries(specialCases).forEach(([key, value]) => {
      lowerSpecialCases[key.toLowerCase()] = value;
    });
    
    // Özel durum kontrolü (büyük/küçük harf duyarsız)
    const upperQuery = cleanQuery.toUpperCase();
    const specialCaseCheck = specialCases[upperQuery] || lowerSpecialCases[lowerQuery];
    
    if (specialCaseCheck) {
      const specialSymbol = specialCaseCheck;
      const match = this.symbolDatabase.find(e => e.symbol === specialSymbol);
      if (match) {
        this.logger.debug(`Special case match found: "${cleanQuery}" -> ${specialSymbol}`);
        return [{
          symbol: match.symbol,
          name: match.name,
          type: match.type,
          score: 85 // Özel durum skoru
        }];
      }
    }
    
    // İlk harf kontrolü - ilk harf uyuşmuyorsa false döndür
    const firstCharCheck = (a: string, b: string): boolean => {
      if (!a || !b || a.length === 0 || b.length === 0) return false;
      return a.toLowerCase()[0] === b.toLowerCase()[0];
    };
    
    // Uzunluk farkı kontrolü - uzunluk farkı çok fazlaysa false döndür
    const lengthDiffCheck = (a: string, b: string): boolean => {
      const aLen = a.length;
      const bLen = b.length;
      const maxLen = Math.max(aLen, bLen);
      const diff = Math.abs(aLen - bLen);
      
      // Uzunluk farkı %50'den fazlaysa false döndür
      return diff <= Math.ceil(maxLen * 0.5);
    };
    
    // Hem sembol hem de aliases üzerinde fuzzy match yap
    const results = this.symbolDatabase
      .filter(entry => {
        // Tip zorlaması varsa ve tip uyuşmuyorsa atla
        if (forcedType !== null && entry.type !== forcedType) {
          return false;
        }
        
        // Sembol karşılaştırması
        const baseSymbol = entry.type === 'stock' && entry.symbol.endsWith('.IS') 
          ? entry.symbol.replace('.IS', '')
          : entry.symbol;
          
        // Case-insensitive birebir eşleşme kontrolü (Tesla -> TSLA)
        if (baseSymbol.toLowerCase() === lowerQuery || 
            entry.name.toLowerCase() === lowerQuery) {
          this.logger.debug(`Case-insensitive exact match: "${lowerQuery}" matches ${entry.symbol}`);
          return true;
        }
        
        // İlk harf kontrolü - ilk harfler tamamen farklıysa eleme (BKR-JD gibi saçma eşleşmeleri önler)
        if (!firstCharCheck(baseSymbol, cleanQuery) && !firstCharCheck(entry.name, cleanQuery)) {
          return false;
        }
        
        // Uzunluk farkı kontrolü - uzunluk farkı çok fazlaysa eleme
        if (!lengthDiffCheck(baseSymbol, cleanQuery) && !lengthDiffCheck(entry.name, cleanQuery)) {
          return false;
        }
        
        // Alias'ları kontrol edelim
        const aliasMatch = entry.aliases.some(alias => {
          if (!alias) return false;
          
          // Birebir eşleşme kontrolü
          if (alias.toLowerCase() === lowerQuery) {
            this.logger.debug(`Alias exact match: "${lowerQuery}" matches alias "${alias}" of ${entry.symbol}`);
            return true;
          }
          
          // İlk harf kontrolü - ilk harfler tamamen farklıysa eleme
          if (!firstCharCheck(alias, cleanQuery)) {
            return false;
          }
          
          // Uzunluk farkı kontrolü - uzunluk farkı çok fazlaysa eleme
          if (!lengthDiffCheck(alias, cleanQuery)) {
            return false;
          }
          
          // Fuzzy eşleşme - alias uzunluğuna göre max mesafe hesapla
          const distance = getLevenshteinDistance(alias, cleanQuery);
          const maxDistance = getMaxDistanceForLength(alias.length);
          return distance <= maxDistance;
        });
        
        // İsmi kontrol edelim - isim uzunluğuna göre max mesafe hesapla
        const nameDistance = getLevenshteinDistance(entry.name, cleanQuery);
        const maxNameDistance = getMaxDistanceForLength(entry.name.length);
        const nameMatch = nameDistance <= maxNameDistance;
        
        // Sembol karşılaştırması - sembol uzunluğuna göre max mesafe hesapla
        const symbolDistance = getLevenshteinDistance(baseSymbol, cleanQuery);
        const maxSymbolDistance = getMaxDistanceForLength(baseSymbol.length);
        const symbolMatch = symbolDistance <= maxSymbolDistance;
        
        // Özel durum: "google" -> "GOOGL", "tsla" -> "TSLA"
        const specialMatch = 
          (lowerQuery === "google" && entry.symbol === "GOOGL") || 
          (lowerQuery === "facebook" && entry.symbol === "META") ||
          (lowerQuery === "tsla" && entry.symbol === "TSLA") ||
          (lowerQuery === "tesla" && entry.symbol === "TSLA");
        
        if (symbolMatch || nameMatch || aliasMatch || specialMatch) {
          this.logger.debug(`Fuzzy match: "${cleanQuery}" matches ${entry.symbol} (${entry.name}) with distances: symbol=${symbolDistance}, name=${nameDistance}`);
          return true;
        }
        
        return false;
      })
      .map(entry => {
        const baseSymbol = entry.type === 'stock' && entry.symbol.endsWith('.IS') 
          ? entry.symbol.replace('.IS', '')
          : entry.symbol;
          
        // Birebir lowercase eşleşme için yüksek skor
        if (baseSymbol.toLowerCase() === lowerQuery ||
            entry.name.toLowerCase() === lowerQuery ||
            entry.aliases.some(alias => alias && alias.toLowerCase() === lowerQuery)) {
          return {
            symbol: entry.symbol,
            name: entry.name,
            type: entry.type,
            score: 95 // Yüksek skor
          };
        }
          
        // Özel durumlar için yüksek skor
        if ((lowerQuery === "google" && entry.symbol === "GOOGL") || 
            (lowerQuery === "facebook" && entry.symbol === "META") ||
            (lowerQuery === "tsla" && entry.symbol === "TSLA") ||
            (lowerQuery === "tesla" && entry.symbol === "TSLA")) {
          return {
            symbol: entry.symbol,
            name: entry.name,
            type: entry.type,
            score: 90 // Özel durum yüksek skoru
          };
        }
          
        const distance = getLevenshteinDistance(cleanQuery, baseSymbol);
        
        // Mesafeye ve popülerliğe göre skor hesapla - daha agresif cezalandırma
        const fuzzyScore = Math.max(0, 80 - (distance * 15)); // Her mesafe 15 puan düşürsün (10 yerine)
        return {
          symbol: entry.symbol,
          name: entry.name,
          type: entry.type,
          score: Math.min(fuzzyScore, entry.popularity) // Popülerlik veya fuzzy skor (hangisi düşükse)
        };
      })
      .filter(result => result.score > 30) // Daha yüksek eşik skoru (0 yerine 30)
      .sort((a, b) => b.score - a.score); // Skorlara göre sırala
    
    this.logger.debug(`Fuzzy match found ${results.length} results for "${cleanQuery}"`);
    return results;
  }
  
  /**
   * Kullanıcı tercih tipini belirle (kripto mu hisse mi daha çok araştırıyor)
   */
  private getUserAssetTypePreference(userId: string): 'stock' | 'crypto' | null {
    const prefs = this.userHistory.get(userId);
    if (!prefs) return null; // Geçmiş yoksa tercih yok
    
    // En az 3 arama yapılmış olmalı ve belirgin fark olmalı
    const totalSearches = prefs.stockSearches + prefs.cryptoSearches;
    if (totalSearches < 3) return null;
    
    // Bir tip diğerinden en az %60 daha fazla aranmışsa tercih göster
    const stockPercentage = prefs.stockSearches / totalSearches;
    if (stockPercentage >= 0.6) return 'stock';
    if (stockPercentage <= 0.4) return 'crypto';
    
    return null; // Belirgin bir tercih yok
  }
  
  /**
   * Sembol tipini tahmin et (basit kural tabanlı)
   */
  guessSymbolType(symbol: string): 'stock' | 'crypto' {
    const upperSymbol = symbol.toUpperCase().trim();
    
    // Prefix varsa kolay
    if (upperSymbol.startsWith('$')) return 'stock';
    if (upperSymbol.startsWith('#') || upperSymbol.startsWith('@')) return 'crypto';
    
    // .IS uzantısı varsa kesinlikle hisse
    if (upperSymbol.endsWith('.IS')) return 'stock';
    
    // Sembol uzunluğuna göre heuristik
    // Kripto paralar genelde 3-4 karakter
    // Hisse senetleri genelde 4-5 karakter veya 1-2 karakter 
    const length = upperSymbol.length;
    if (length <= 2) return 'stock'; // Kısa hisse kodları (V, F, GM gibi)
    if (length >= 5) return 'stock'; // Uzun semboller genelde hisse
    
    // 3-4 karakter arasında belirsiz, en iyisi veritabanına bakmak
    const exactMatch = this.symbolDatabase.find(entry => entry.symbol === upperSymbol);
    if (exactMatch) return exactMatch.type;
    
    // Default değer
    return 'crypto'; // Tahmin edemiyorsak kripto olarak varsay
  }
  
  /**
   * Sembol prefix'ine bakarak tip belirle ($ -> stock, # veya @ -> crypto)
   */
  private getForcedType(query: string): 'stock' | 'crypto' | null {
    const normalizedQuery = query.trim();
    if (normalizedQuery.startsWith('$')) return 'stock';
    if (normalizedQuery.startsWith('#') || normalizedQuery.startsWith('@')) return 'crypto';
    return null;
  }
  
  /**
   * Sembol prefix'ini kaldır ($ veya # veya @)
   */
  private removePrefix(query: string): string {
    let cleanQuery = query.trim();
    if (cleanQuery.startsWith('$') || cleanQuery.startsWith('#') || cleanQuery.startsWith('@')) {
      cleanQuery = cleanQuery.substring(1);
    }
    return cleanQuery.toUpperCase();
  }
  
  /**
   * Potansiyel bir Türk hissesi olup olmadığını kontrol et
   */
  private isPotentialTurkishStock(symbol: string): boolean {
    // Türk hisseleri genelde 3-5 karakter, büyük harfli kodlar
    return /^[A-Z]{3,5}$/i.test(symbol) || 
           /^[a-zA-Z]{3,6}$/i.test(symbol.toLowerCase()); // küçük harfli girişleri de kabul et
  }
  
  /**
   * Doğrudan Yahoo Finance API'den sembol sorgusu yap
   */
  private async checkYahooAPI(symbol: string): Promise<SymbolSearchResult | null> {
    try {
      const upperSymbol = symbol.toUpperCase().trim();
      
      // Türk hissesi kontrolü - önce doğrudan .IS uzantısı ile dene
      if (this.isPotentialTurkishStock(upperSymbol)) {
        try {
          this.logger.debug(`Trying as Turkish stock: ${upperSymbol}.IS`);
          const turkishSymbol = `${upperSymbol}.IS`;
          const turkishQuote = await yahooFinance.quote(turkishSymbol, { fields: ['symbol', 'shortName', 'longName'] });
          
          if (turkishQuote && turkishQuote.symbol) {
            this.logger.debug(`Found Turkish stock: ${turkishQuote.symbol}`);
            
            // Sembolü veritabanına ekle
            const newSymbol: SymbolMapping = {
              symbol: turkishQuote.symbol,
              type: 'stock',
              name: turkishQuote.shortName || turkishQuote.longName || turkishQuote.symbol,
              aliases: [upperSymbol, turkishQuote.shortName, turkishQuote.longName].filter(Boolean),
              popularity: 70 // Orta düzey popülerlik
            };
            
            // Veritabanına ekle
            await this.addOrUpdateSymbol(newSymbol);
            
            return {
              symbol: turkishQuote.symbol,
              name: newSymbol.name,
              type: 'stock',
              score: 95 // Türk hissesi eşleşmesi
            };
          }
        } catch (turkishError) {
          this.logger.debug(`Not a Turkish stock: ${upperSymbol}, error: ${turkishError.message}`);
          // Sessizce geç, diğer yöntemleri dene
        }
      }
      
      // Yaygın hisse senetleri kontrolü
      const commonStocks = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'META', 'AMZN', 'TSLA'];
      if (commonStocks.includes(upperSymbol) || upperSymbol.endsWith('.IS')) {
        try {
          this.logger.debug(`Trying as common stock: ${upperSymbol}`);
          const stockQuote = await yahooFinance.quote(upperSymbol, { fields: ['symbol', 'shortName', 'longName'] });
          
          if (stockQuote && stockQuote.symbol) {
            this.logger.debug(`Found stock: ${stockQuote.symbol}`);
            
            // Sembolü veritabanına ekle
            const newSymbol: SymbolMapping = {
              symbol: stockQuote.symbol,
              type: 'stock',
              name: stockQuote.shortName || stockQuote.longName || stockQuote.symbol,
              aliases: [upperSymbol, stockQuote.shortName, stockQuote.longName].filter(Boolean),
              popularity: 85 // Yüksek popülerlik
            };
            
            // Veritabanına ekle
            await this.addOrUpdateSymbol(newSymbol);
            
            return {
              symbol: stockQuote.symbol,
              name: newSymbol.name,
              type: 'stock',
              score: 90 // Yaygın hisse eşleşmesi
            };
          }
        } catch (stockError) {
          this.logger.debug(`Not a known stock: ${upperSymbol}, error: ${stockError.message}`);
          // Sessizce geç, kripto olarak dene
        }
      }
      
      // Kripto kontrolü - Genelde 2-4 harfli kripto sembolleri
      try {
        this.logger.debug(`Trying as crypto: ${upperSymbol}-USD`);
        // Kripto para format denemesi
        const cryptoSymbol = `${upperSymbol}-USD`;
        const cryptoQuote = await yahooFinance.quote(cryptoSymbol, { fields: ['symbol', 'shortName', 'longName'] });
        
        if (cryptoQuote && cryptoQuote.symbol) {
          this.logger.debug(`Found crypto: ${cryptoQuote.symbol}`);
          
          // Sembolü veritabanına ekle
          const newSymbol: SymbolMapping = {
            symbol: upperSymbol, // Kripto sembolü genelde sade halde saklanır
            type: 'crypto',
            name: cryptoQuote.shortName || cryptoQuote.longName || upperSymbol,
            aliases: [upperSymbol, cryptoQuote.shortName, cryptoQuote.longName].filter(Boolean),
            popularity: 75 // Orta üstü popülerlik
          };
          
          // Veritabanına ekle
          await this.addOrUpdateSymbol(newSymbol);
          
          return {
            symbol: upperSymbol,
            name: newSymbol.name,
            type: 'crypto',
            score: 85 // Kripto eşleşmesi
          };
        }
      } catch (cryptoError) {
        this.logger.debug(`Not a crypto: ${upperSymbol}, error: ${cryptoError.message}`);
      }
      
      // Son çare - doğrudan sembolü dene
      try {
        this.logger.debug(`Last resort - trying direct symbol: ${upperSymbol}`);
        const quote = await yahooFinance.quote(upperSymbol, { fields: ['symbol', 'shortName', 'longName'] });
        
        if (quote && quote.symbol) {
          this.logger.debug(`Found direct match: ${quote.symbol}`);
          
          // Tip belirle (sadece 'stock' veya 'crypto' olabilir)
          const detectedType = (quote.symbol.includes('-') || upperSymbol.length <= 4) ? 'crypto' : 'stock';
          
          // Sembolü veritabanına ekle
          const newSymbol: SymbolMapping = {
            symbol: detectedType === 'crypto' ? upperSymbol : quote.symbol,
            type: detectedType,
            name: quote.shortName || quote.longName || quote.symbol,
            aliases: [upperSymbol, quote.shortName, quote.longName].filter(Boolean),
            popularity: 65 // Orta popülerlik
          };
          
          // Veritabanına ekle
          await this.addOrUpdateSymbol(newSymbol);
          
          return {
            symbol: newSymbol.symbol,
            name: newSymbol.name,
            type: newSymbol.type,
            score: 80 // Son çare eşleşmesi
          };
        }
      } catch (directError) {
        this.logger.debug(`No direct match: ${upperSymbol}, error: ${directError.message}`);
      }
      
      this.logger.debug(`No match found for symbol: ${upperSymbol}`);
      return null;
    } catch (error) {
      this.logger.error(`Error in checkYahooAPI: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Sembol veritabanına yeni sembol ekle veya güncelle
   */
  async addOrUpdateSymbol(symbol: SymbolMapping): Promise<void> {
    try {
      this.logger.log(`Sembol ekleme işlemi başlatıldı: ${symbol.symbol} - Tür: ${symbol.type}`);
      
      // In-memory cache'i güncelle
      const existingIdx = this.symbolDatabase.findIndex(s => s.symbol === symbol.symbol);
      if (existingIdx >= 0) {
        this.logger.log(`Mevcut sembol güncelleniyor: ${symbol.symbol}`);
        this.symbolDatabase[existingIdx] = symbol;
      } else {
        this.logger.log(`Yeni sembol ekleniyor: ${symbol.symbol}`);
        this.symbolDatabase.push(symbol);
      }
      
      // MongoDB'ye kaydet
      const result = await this.symbolDataModel.findOneAndUpdate(
        { symbol: symbol.symbol },
        {
          symbol: symbol.symbol,
          type: symbol.type,
          name: symbol.name,
          aliases: symbol.aliases,
          popularity: symbol.popularity
        },
        { upsert: true, new: true }
      );
      
      this.logger.log(`Sembol başarıyla kaydedildi: ${symbol.symbol}, ID: ${result._id}`);
    } catch (error) {
      this.logger.error(`Sembol kaydetme hatası: ${error.message}`, error.stack);
      throw error; // Hatayı yukarıya ilet
    }
  }

  /**
   * Kullanıcı için yeni bir liste oluştur
   * @param userId Kullanıcı ID
   * @param listName Liste adı
   */
  async createUserList(userId: string, listName: string): Promise<boolean> {
    try {
      // Liste adını normalize et
      const normalizedListName = listName.trim().toLowerCase();
      
      // Bu isimde bir liste var mı kontrol et
      const existingList = await this.userListModel.findOne({
        userId,
        listName: normalizedListName
      }).exec();
      
      if (existingList) {
        this.logger.debug(`Liste "${normalizedListName}" zaten mevcut, kullanıcı: ${userId}`);
        return false;
      }
      
      // Yeni liste oluştur
      await this.userListModel.create({
        userId,
        listName: normalizedListName,
        symbols: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      this.logger.debug(`Yeni liste oluşturuldu: "${normalizedListName}", kullanıcı: ${userId}`);
      return true;
        } catch (error) {
      this.logger.error(`Liste oluşturma hatası: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Kullanıcının listesine sembol ekle
   * @param userId Kullanıcı ID
   * @param listName Liste adı
   * @param symbol Eklenecek sembol
   */
  async addSymbolToList(userId: string, listName: string, symbol: string): Promise<boolean> {
    try {
      // Liste adını normalize et
      const normalizedListName = listName.trim().toLowerCase();
      const normalizedSymbol = symbol.trim().toUpperCase();
      
      // API kontrollerini kaldırdık - kullanıcının girdiği sembolleri doğrudan kabul ediyoruz
      this.logger.debug(`Sembol "${normalizedSymbol}" doğrudan kabul ediliyor (API kontrolü yok)`);
      
      // Liste var mı kontrol et
      const existingList = await this.userListModel.findOne({
        userId,
        listName: normalizedListName
      }).exec();
      
      if (!existingList) {
        this.logger.debug(`Liste bulunamadı: ${normalizedListName}`);
        return false;
      }
      
      // Sembol zaten listede mi kontrol et
      if (existingList.symbols.includes(normalizedSymbol)) {
        this.logger.debug(`Sembol "${normalizedSymbol}" zaten "${normalizedListName}" listesinde`);
        return true; // Sembol zaten listede, başarılı sayılır
      }
      
      // Sembolü listeye ekle
      existingList.symbols.push(normalizedSymbol);
      existingList.updatedAt = new Date();
      await existingList.save();
      
      this.logger.debug(`"${normalizedSymbol}" sembolü "${normalizedListName}" listesine eklendi`);
      return true;
    } catch (error) {
      this.logger.error(`Listeye sembol ekleme hatası: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Kullanıcının listesinden sembol çıkar
   * @param userId Kullanıcı ID
   * @param listName Liste adı
   * @param symbol Çıkarılacak sembol
   */
  async removeSymbolFromList(userId: string, listName: string, symbol: string): Promise<boolean> {
    try {
      // Liste adını ve sembolü normalize et
      const normalizedListName = listName.trim().toLowerCase();
      const normalizedSymbol = symbol.trim().toUpperCase();
      
      // Listeyi bul ve güncelle
      const result = await this.userListModel.findOneAndUpdate(
        {
          userId,
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
  
  /**
   * Kullanıcının tüm listelerini getir
   * @param userId Kullanıcı ID
   */
  async getUserLists(userId: string): Promise<{ listName: string, symbolCount: number }[]> {
    try {
      const lists = await this.userListModel.find({ userId }).exec();
      
      return lists.map(list => ({
        listName: list.listName,
        symbolCount: list.symbols.length
      }));
    } catch (error) {
      this.logger.error(`Kullanıcı listeleri getirme hatası: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Belirli bir listeyi getir
   * @param userId Kullanıcı ID
   * @param listName Liste adı
   */
  async getListDetails(userId: string, listName: string): Promise<{ listName: string, symbols: string[] } | null> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      
      const list = await this.userListModel.findOne({
        userId,
        listName: normalizedListName
      }).exec();
      
      if (!list) {
        return null;
      }
      
      return {
        listName: list.listName,
        symbols: list.symbols
      };
    } catch (error) {
      this.logger.error(`Liste detayları getirme hatası: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Kullanıcının listesini sil
   * @param userId Kullanıcı ID
   * @param listName Liste adı
   */
  async deleteList(userId: string, listName: string): Promise<boolean> {
    try {
      const normalizedListName = listName.trim().toLowerCase();
      
      const result = await this.userListModel.deleteOne({
        userId,
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

  /**
   * Verilen metnin bir ticker (sembol) olup olmadığını kontrol eder
   * @param text Kontrol edilecek metin
   * @returns true: ticker, false: değil
   */
  async isTickerSymbol(text: string): Promise<boolean> {
    if (!text || text.trim() === '') return false;
    
    const upperText = text.toUpperCase().trim();
    
    // Bazı anahtar kelimeler kesinlikle ticker değil
    const nonTickerKeywords = ['HISSE', 'KRIPTO', 'CRYPTO', 'STOCK', 'ENDEKS', 'INDEX', 'LISTE'];
    if (nonTickerKeywords.includes(upperText)) {
      return false;
    }
    
    // Veritabanında bu sembol var mı?
    const exactMatch = this.symbolDatabase.find(s => s.symbol === upperText || s.symbol === `${upperText}.IS`);
    if (exactMatch) {
      return true;
    }
    
    // Türk hissesi formatı kontrolü
    if (upperText.endsWith('.IS') || this.isPotentialTurkishStock(upperText)) {
      return true;
    }
    
    // Potansiyel sembol formatı (2-5 karakter, tümü büyük harf)
    if (upperText.length >= 2 && upperText.length <= 5 && /^[A-Z0-9]+$/.test(upperText)) {
      return true;
    }
    
    // Eğer veritabanında alias olarak mevcutsa
    const aliasMatch = this.symbolDatabase.find(s => 
      s.aliases.some(alias => alias.toUpperCase() === upperText)
    );
    if (aliasMatch) {
      return true;
    }
    
    // Eğer sayı ise ticker değil
    if (!isNaN(parseFloat(text))) {
      return false;
    }
    
    return false;
  }
} 