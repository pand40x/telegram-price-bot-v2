import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../binance/binance.service';
import { CmcService } from '../cmc/cmc.service';
import { YahooService } from '../yahoo/yahoo.service';
import { AssetPrice } from './interfaces/price.interface';

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly cmcService: CmcService,
    private readonly yahooService: YahooService,
  ) {}

  async getPrices(symbols: string[], assetType?: 'crypto' | 'stock'): Promise<AssetPrice[]> {
    // Sembolleri büyük harfe çevir
    const normalizedSymbols = symbols.map(s => s.toUpperCase());
    
    // Belirtilen assetType varsa, onu kullan ve otomatik tespite gerek yok
    if (assetType) {
      this.logger.debug(`Using explicitly provided asset type: ${assetType} for symbols: ${normalizedSymbols.join(', ')}`);
      
      if (assetType === 'stock') {
        return this.getStockPrices(normalizedSymbols);
      } else {
        return this.getCryptoPrices(normalizedSymbols);
      }
    }
    
    // AssetType açıkça belirtilmemişse tespit et
    // Nokta içeriyorsa, muhtemelen bir hisse senedidir (AAPL.US gibi)
    // Veya dolar işareti ile başlıyorsa $AAPL
    let detectedType = assetType;
    
    if (!detectedType && symbols.length > 0) {
      // Yaygın ABD hisse senetleri listesi
      const commonStocks = [
        // Teknoloji hisseleri
        'AAPL', 'MSFT', 'AMZN', 'GOOG', 'GOOGL', 'META', 'TSLA', 'NVDA', 'AMD', 'INTC', 
        'NFLX', 'ADBE', 'CSCO', 'CRM', 'ORCL', 'IBM', 'PYPL', 'UBER', 'SHOP', 'SQ',
        
        // Finans hisseleri
        'V', 'JPM', 'BAC', 'WFC', 'C', 'MA', 'GS', 'AXP', 'MS', 'BLK', 
        
        // Tüketim hisseleri
        'WMT', 'COST', 'HD', 'MCD', 'SBUX', 'NKE', 'DIS', 'BKNG', 'ABNB', 'PG',
        
        // Sağlık/Biyoteknoloji hisseleri
        'JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'AMGN', 'VRTX', 'GILD', 'BIIB', 'BMY',
        'REGN', 'MRNA', 'MDT', 'UNH', 'CVS',
        
        // Otomotiv
        'F', 'GM', 'TM',
        
        // Diğer
        'BABA', 'KO', 'PEP', 'GE'
      ];
      
      // Önce doğrudan eşleşme kontrol et
      const exactMatch = normalizedSymbols.some(s => commonStocks.includes(s));
      if (exactMatch) {
        this.logger.debug(`Direct stock symbol match found in commonStocks list`);
        detectedType = 'stock';
      } else {
        // Yoksa diğer belirteçlere bak
        const hasStockIndicators = normalizedSymbols.some(
          s => s.includes('.') || s.startsWith('$')
        );
        
        detectedType = hasStockIndicators ? 'stock' : 'crypto';
      }
      
      this.logger.log(`Detected asset type: ${detectedType} for symbols: ${symbols.join(', ')}`);
    }
    
    // Net bir tip belirtilmişse veya tespit edilmişse, sadece o tip için sorgu yap
    if (detectedType === 'stock') {
      this.logger.debug(`Getting stock prices for ${normalizedSymbols.join(', ')} from Yahoo`);
      return this.getStockPrices(normalizedSymbols);
    } else if (detectedType === 'crypto') {
      this.logger.debug(`Getting crypto prices for ${normalizedSymbols.join(', ')} from Binance/CMC`);
      return this.getCryptoPrices(normalizedSymbols);
    } else {
      // Bu durumun gerçekleşmemesi lazım, ama yine de kripto olarak varsay
      this.logger.warn(`Asset type detection failed for ${symbols.join(', ')}, defaulting to crypto`);
      return this.getCryptoPrices(normalizedSymbols);
    }
  }
  
  // Kripto para fiyatlarını al
  private async getCryptoPrices(symbols: string[]): Promise<AssetPrice[]> {
    // Try to get prices from Binance first
    const binancePrices = await this.binanceService.getPrices(symbols);
    
    // Create result array with Binance prices where available
    const result: AssetPrice[] = [];
    const missingSymbols: string[] = [];
    
    // Process results and identify missing symbols
    for (let i = 0; i < symbols.length; i++) {
      if (i < binancePrices.length && binancePrices[i]) {
        result.push({
          ...binancePrices[i],
          source: 'binance',
          type: 'crypto'
        });
      } else {
        missingSymbols.push(symbols[i]);
        // Add placeholder that will be filled if CMC has the data
        result.push(null);
      }
    }
    
    // If we have missing symbols, try to get them from CMC
    if (missingSymbols.length > 0) {
      this.logger.log(`Fetching ${missingSymbols.length} crypto symbols from CMC: ${missingSymbols.join(', ')}`);
      
      try {
        const cmcPrices = await this.cmcService.getPrices(missingSymbols);
        
        // Map CMC prices back to original positions
        let cmcIndex = 0;
        for (let i = 0; i < symbols.length; i++) {
          if (!result[i] && cmcIndex < cmcPrices.length) {
            result[i] = {
              ...cmcPrices[cmcIndex],
              source: 'cmc',
              type: 'crypto'
            };
            cmcIndex++;
          }
        }
      } catch (error) {
        this.logger.error(`Error fetching prices from CMC: ${error.message}`);
      }
    }
    
    // Filter out null values and ensure all entries are valid
    return result.filter(p => p !== null);
  }
  
  // Hisse senedi fiyatlarını al
  private async getStockPrices(symbols: string[]): Promise<AssetPrice[]> {
    try {
      // Semboldeki dolar işaretlerini temizle
      const cleanedSymbols = symbols.map(s => s.replace('$', ''));
      
      // Yahoo'dan fiyatları al
      const stockPrices = await this.yahooService.getPrices(cleanedSymbols);
      
      // Sonuçları AssetPrice formatına dönüştür
      return stockPrices.map(price => ({
        ...price,
        source: 'yahoo',
        type: 'stock'
      }));
    } catch (error) {
      this.logger.error(`Error fetching stock prices: ${error.message}`);
      return [];
    }
  }

  formatPrice(price: AssetPrice): string {
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
    
    // Sembolü hazırla - Türk hisseleri için .IS ekini kaldır
    let displaySymbol = price.symbol;
    const isTurkishStock = displaySymbol.endsWith('.IS');
    if (isTurkishStock) {
      displaySymbol = displaySymbol.replace('.IS', '');
    }
    
    // İsim bilgisi - Stock tipinde isim gösterme, sadece kripto paraları göster
    const nameInfo = (price.type === 'crypto' && price.name) ? ` (${price.name})` : '';
    
    // Para birimi sembolü - Türk hisseleri için ₺, diğerleri için $
    const currencySymbol = isTurkishStock ? '₺' : '$';
    
    // Formatlanmış çıktı
    return `${displaySymbol}${nameInfo}: <b>${currencySymbol}${priceString}</b>  (${changeValue})`;
  }
} 