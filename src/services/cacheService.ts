// Simple cache service interface
export interface CacheService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

// Simple in-memory cache implementation (in production, use Redis)
export class SimpleCacheService implements CacheService {
  private cache = new Map<string, { value: string; expiry?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiry: ttlMs ? Date.now() + ttlMs : undefined
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  // Utility methods for cache management
  getSize(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (item.expiry && now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }

  // Get cache statistics
  getStats(): { size: number; expired: number; keys: string[] } {
    const now = Date.now();
    let expired = 0;
    const keys: string[] = [];
    
    for (const [key, item] of this.cache.entries()) {
      keys.push(key);
      if (item.expiry && now > item.expiry) {
        expired++;
      }
    }
    
    return {
      size: this.cache.size,
      expired,
      keys
    };
  }
}