export interface AssetPrice {
  symbol: string;
  price: number;
  percentChange24h: number;
  source?: string;
  type?: 'crypto' | 'stock' | 'other';
  name?: string;
} 