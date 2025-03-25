import { Injectable, Logger } from '@nestjs/common';
import yahooFinance from 'yahoo-finance2';

interface StockPrice {
  symbol: string;
  price: number;
  percentChange24h: number;
  name?: string;
}

@Injectable()
export class YahooService {
  private readonly logger = new Logger(YahooService.name);
  private livePrices: Map<string, StockPrice & { timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60 * 1000; // 1 dakika önbellek süresi
  private readonly turkishCodes: Set<string> = new Set(); // Türk kodu olarak tanımlanan sembolleri tutacak

  constructor() {}

  // Hisse senedi fiyatlarını getir
  async getPrices(symbols: string[]): Promise<StockPrice[]> {
    try {
      // Sembolleri temizle ve formatla
      const formattedSymbols = symbols.map(s => this.formatSymbol(s));
      
      // Her sembol için fiyat bilgisi toplama
      const results = await Promise.all(
        formattedSymbols.map(async (symbol) => {
          try {
            // Önbellekte veri var mı ve güncel mi kontrol et
            const cachedPrice = this.livePrices.get(symbol);
            const now = Date.now();
            
            if (cachedPrice && now - cachedPrice.timestamp < this.CACHE_TTL) {
              return {
                symbol: cachedPrice.symbol,
                price: cachedPrice.price,
                percentChange24h: cachedPrice.percentChange24h,
                name: cachedPrice.name
              };
            }
            
            // API'den veri getirme
            return await this.fetchStockPrice(symbol);
          } catch (error) {
            this.logger.error(`Error fetching data for ${symbol}: ${error.message}`);
            return null;
          }
        })
      );
      
      // null olmayan sonuçları filtreleme
      return results.filter(price => price !== null);
    } catch (error) {
      this.logger.error(`Error fetching stock prices: ${error.message}`);
      return [];
    }
  }
  
  // Tek bir hisse senedi fiyatını getir
  private async fetchStockPrice(symbol: string): Promise<StockPrice | null> {
    try {
      // Yahoo Finance'den anlık veri çek - birkaç strateji kullanacağız
      let quote = null;
      let finalSymbol = symbol;
      
      // Borsa İstanbul endeksi için özel durum
      if (symbol === 'BIST' || symbol === 'XU100' || symbol === 'BIST100') {
        this.logger.debug(`Special case for Istanbul Stock Exchange index: ${symbol} -> XU100.IS`);
        symbol = 'XU100.IS';
      }
      
      // Stratejiler: Normal sembol, Türk hissesi (.IS ekli)
      let strategies = [
        // Strateji 1: Normal sembol ile dene
        { symbol, description: "normal symbol" },
      ];
      
      // Strateji 2: Sembol .IS ile bitmiyor ve muhtemelen Türk hissesi ise
      if (!symbol.includes('.IS') && !symbol.startsWith('^') && this.looksLikeTurkishStock(symbol)) {
        strategies.push({ 
          symbol: `${symbol}.IS`, 
          description: "with .IS suffix for Turkish stocks" 
        });
      }
      
      // Strateji 3: Diğer Türk endeksleri için
      if ((symbol === 'XU030' || symbol === 'XU050') && !symbol.includes('.IS')) {
        strategies.push({
          symbol: `${symbol}.IS`,
          description: "Turkish index with .IS suffix"
        });
      }
      
      // Her stratejiyi sırayla dene
      for (const strategy of strategies) {
        try {
          this.logger.debug(`Trying to fetch ${strategy.symbol} (${strategy.description})`);
          
          quote = await yahooFinance.quote(strategy.symbol);
          
          if (quote && quote.regularMarketPrice) {
            // Başarılı olursa sembolü ve stratejiyi kaydet
            finalSymbol = strategy.symbol;
            
            // Eğer bu Türk hissesi ise, gelecekte direkt .IS eki eklemek için kaydedelim
            if (finalSymbol.endsWith('.IS')) {
              const baseSymbol = symbol.toUpperCase();
              this.turkishCodes.add(baseSymbol);
              this.logger.debug(`Added ${baseSymbol} to Turkish stock codes registry`);
            }
            
            this.logger.debug(`Successfully fetched price for ${finalSymbol}: ${quote.regularMarketPrice}`);
            break; // İlk başarılı strateji bulundu, döngüyü sonlandır
          } else {
            this.logger.debug(`Received null/invalid quote for ${strategy.symbol}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.logger.debug(`Failed to fetch ${strategy.symbol} (${strategy.description}): ${errorMsg}`);
          quote = null; // Sonraki stratejiyi denemek için null olarak ayarla
        }
      }
      
      // Quote bulunamadıysa veya fiyat yoksa null döndür
      if (!quote || !quote.regularMarketPrice) {
        let strategiesText = strategies.map(s => s.symbol).join(', ');
        this.logger.warn(`No data found for stock symbol after trying: ${strategiesText}`);
        return null;
      }
      
      const price = quote.regularMarketPrice;
      const percentChange = quote.regularMarketChangePercent || 0;
      const result = {
        symbol: finalSymbol,
        price,
        percentChange24h: percentChange,
        name: quote.shortName || quote.longName
      };
      
      // Önbelleğe al
      const now = Date.now();
      this.livePrices.set(finalSymbol, {
        ...result,
        timestamp: now
      });
      
      return result;
    } catch (error) {
      this.logger.error(`Error in fetchStockPrice for ${symbol}: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Bir sembolün Türk hissesi olma ihtimalini kontrol eder
   * Bu heuristik bazı örüntülere dayanır (örn: 3-6 büyük harf)
   */
  private looksLikeTurkishStock(symbol: string): boolean {
    // Türk hisseleri genelde 4-6 harf uzunluğunda büyük harflerden oluşur 
    if (/^[A-Z]{3,6}$/.test(symbol)) {
      return true;
    }
    
    // Daha önce Türk kodu olarak tanımlanmış mı?
    if (this.turkishCodes.has(symbol.toUpperCase())) {
      return true;
    }
    
    return false;
  }
  
  // Sembol biçimini düzelt
  private formatSymbol(symbol: string): string {
    // Büyük harfe çevir
    let formattedSymbol = symbol.toUpperCase().trim();
    
    // $ işaretini kaldır
    formattedSymbol = formattedSymbol.replace('$', '');
    
    // Eğer daha önce Türk hissesi olarak tanımlanmışsa ve .IS içermiyorsa ekle
    if (this.turkishCodes.has(formattedSymbol) && !formattedSymbol.endsWith('.IS')) {
      formattedSymbol = `${formattedSymbol}.IS`;
    }
    
    return formattedSymbol;
  }
  
  // Hisse senedi var mı kontrol et
  async hasSymbol(symbol: string): Promise<boolean> {
    try {
      const formattedSymbol = this.formatSymbol(symbol);
      
      // Türk hissesi olabilir, her iki şekilde de deneyelim
      const symbols = [formattedSymbol];
      
      // .IS ekli değilse, bir de öyle deneyelim
      if (!formattedSymbol.includes('.IS')) {
        symbols.push(`${formattedSymbol}.IS`);
      }
      
      // Her ikisini de dene
      for (const sym of symbols) {
        try {
          const result = await yahooFinance.quote(sym, { fields: ['symbol'] });
          if (result?.symbol) {
            // Türk hissesi olarak tanımlandıysa kaydet
            if (sym.endsWith('.IS')) {
              this.turkishCodes.add(formattedSymbol);
            }
            return true;
          }
        } catch (error) {
          // Bir sonraki denemeye geç
          continue;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
  
  // Fiyat bilgisini formatlama
  formatPrice(price: StockPrice): string {
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
    } else {
      // Çok küçük fiyatlar için 6 ondalık basamak 
      priceString = priceValue.toFixed(6);
    }
    
    const changePrefix = price.percentChange24h >= 0 ? '+' : '';
    const changeValue = `${changePrefix}${price.percentChange24h.toFixed(2)}%`;
    
    // Türk hisselerinde .IS ekini gösterme
    let displaySymbol = price.symbol;
    if (displaySymbol.endsWith('.IS')) {
      displaySymbol = displaySymbol.replace('.IS', '');
    }
    
    const nameInfo = price.name ? ` (${price.name})` : '';
    
    return `${displaySymbol}${nameInfo}: <b>$${priceString}</b>  (${changeValue})`;
  }
} 