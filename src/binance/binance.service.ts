import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as WebSocket from 'ws';
import { BinancePrice, BinancePriceDocument } from './schemas/binance-price.schema';
import axios from 'axios';

interface BinanceStreamData {
  s: string; // symbol
  c: string; // current price
  p?: string; // price change
  P?: string; // price change percent
  e?: string; // event type
}

interface CryptoPrice {
  symbol: string;
  price: number;
  percentChange24h: number;
}

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private ws: WebSocket;
  private readonly streamUrl = 'wss://stream.binance.com:9443/ws';
  private isConnected = false;
  private reconnectTimer: NodeJS.Timeout;
  private heartbeatTimer: NodeJS.Timeout;
  
  // Sadece bellek içinde anlık fiyatları tutacağız, veritabanı kullanmadan
  private livePrices: Map<string, CryptoPrice> = new Map();
  private readonly binanceRestAPI = 'https://api.binance.com/api/v3';

  constructor(
    @InjectModel(BinancePrice.name) private binancePriceModel: Model<BinancePriceDocument>,
  ) {}

  async onModuleInit() {
    // Bağlantı başlat
    await this.connectWebSocket();
    this.startHeartbeat();
  }

  onModuleDestroy() {
    this.cleanupConnection();
  }

  private async connectWebSocket() {
    try {
      this.ws = new WebSocket(this.streamUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.logger.log('Connected to Binance WebSocket');
        
        // Popüler kripto paraların ticker'larına abone ol
        const popularSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'SOLUSDT',
                              'MATICUSDT', 'AVAXUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'SHIBUSDT'];
        
        // Bireysel semboller için ticker'a abone ol (24h yüzde değişimini içerir)
        const params = popularSymbols.map(symbol => `${symbol.toLowerCase()}@ticker`);
        
        const subscribeMsg = {
          method: 'SUBSCRIBE',
          params,
          id: 1,
        };
        
        this.ws.send(JSON.stringify(subscribeMsg));
        this.logger.log(`Subscribed to Binance streams for ${popularSymbols.length} popular cryptocurrencies`);
      });

      this.ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // 24hr ticker mesajlarını işle
          if (message.e === '24hrTicker' && message.s) {
            const symbol = message.s;
            const price = parseFloat(message.c);
            const percentChange = parseFloat(message.P);
            
            if (!isNaN(price) && !isNaN(percentChange)) {
              // Veritabanına kaydetmeden sadece bellek içinde tut
              this.livePrices.set(symbol, {
                symbol: this.formatOutputSymbol(symbol),
                price,
                percentChange24h: percentChange
              });
            }
          }
        } catch (error) {
          this.logger.error(`Error processing WebSocket message: ${error.message}`);
        }
      });

      this.ws.on('error', (error) => {
        this.logger.error(`WebSocket error: ${error.message}`);
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.ws.on('close', () => {
        this.logger.warn('Binance WebSocket connection closed');
        this.isConnected = false;
        this.scheduleReconnect();
      });
    } catch (error) {
      this.logger.error(`Failed to connect to Binance WebSocket: ${error.message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = setTimeout(() => {
      this.logger.log('Attempting to reconnect to Binance WebSocket...');
      this.cleanupConnection();
      this.connectWebSocket();
    }, 5000); // Reconnect after 5 seconds
  }
  
  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'PING' }));
      }
    }, 30000); // Send heartbeat every 30 seconds
  }
  
  private cleanupConnection() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (error) {
        // Ignore terminate errors
      }
    }
  }

  // Gerçek zamanlı fiyat bilgisi almak için REST API kullan
  private async fetchPriceFromAPI(symbol: string): Promise<CryptoPrice | null> {
    try {
      // Önce sembolün formatını düzelt
      const formattedSymbol = this.formatSymbol(symbol);
      
      // Binance API'sinden anlık fiyat bilgisi al
      const [tickerResponse, dayStatsResponse] = await Promise.all([
        axios.get(`${this.binanceRestAPI}/ticker/price?symbol=${formattedSymbol}`),
        axios.get(`${this.binanceRestAPI}/ticker/24hr?symbol=${formattedSymbol}`)
      ]);
      
      const price = parseFloat(tickerResponse.data.price);
      const percentChange = parseFloat(dayStatsResponse.data.priceChangePercent);
      
      if (isNaN(price)) {
        return null;
      }
      
      return {
        symbol: this.formatOutputSymbol(formattedSymbol),
        price,
        percentChange24h: isNaN(percentChange) ? 0 : percentChange
      };
    } catch (error) {
      this.logger.error(`Error fetching price for ${symbol} from Binance API: ${error.message}`);
      return null;
    }
  }

  // Bu metod fiyatları WebSocket önbellekten veya gerçek zamanlı API'den alacak
  async getPrices(symbols: string[]): Promise<CryptoPrice[]> {
    try {
      // Sembolleri standart biçime dönüştür
      const formattedSymbols = symbols.map(s => this.formatSymbol(s));
      
      // Her sembol için fiyat bilgisi toplama
      const results: (CryptoPrice | null)[] = await Promise.all(
        formattedSymbols.map(async (symbol) => {
          // Önce WebSocket aracılığıyla aldığımız anlık verilere bak
          const cachedPrice = this.livePrices.get(symbol);
          
          if (cachedPrice) {
            // Eğer WebSocket'ten veri varsa ve 60 saniyeden yeni ise kullan
            return {
              ...cachedPrice,
              symbol: this.formatOutputSymbol(symbol) // Çıktı için sembolü düzelt
            };
          }
          
          // WebSocket'ten veri yoksa direk API'den al
          return await this.fetchPriceFromAPI(symbol);
        })
      );
      
      // null olmayan sonuçları filtreleme
      return results.filter(price => price !== null) as CryptoPrice[];
    } catch (error) {
      this.logger.error(`Error fetching prices from Binance: ${error.message}`);
      return [];
    }
  }
  
  // Format symbol for Binance (e.g., "BTC" -> "BTCUSDT")
  private formatSymbol(symbol: string): string {
    // Convert to uppercase
    symbol = symbol.toUpperCase();
    
    // If the symbol doesn't end with USDT, add it
    if (!symbol.endsWith('USDT')) {
      return `${symbol}USDT`;
    }
    return symbol;
  }
  
  // Format symbol for output (e.g., "BTCUSDT" -> "BTC")
  private formatOutputSymbol(symbol: string): string {
    if (symbol.endsWith('USDT')) {
      return symbol.slice(0, -4);
    }
    return symbol;
  }
  
  // Check if a symbol exists in Binance
  async hasSymbol(symbol: string): Promise<boolean> {
    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const response = await axios.get(`${this.binanceRestAPI}/ticker/price?symbol=${formattedSymbol}`);
      return response.status === 200;
    } catch (error) {
      // 400 hata kodu sembolün olmadığını gösterir
      if (error.response && error.response.status === 400) {
        return false;
      }
      
      // Diğer hata durumlarında tekrar dene
      this.logger.error(`Error checking symbol existence: ${error.message}`);
      return false;
    }
  }
} 