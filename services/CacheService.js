// Simple in-memory cache service
// Replace with Redis in production for distributed caching

class CacheService {
  constructor() {
    this._store = new Map();
    this._ttl = new Map();
    this._hitCount = 0;
    this._missCount = 0;

    // Clean up expired entries every 5 minutes
    setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  get(key) {
    if (!this._store.has(key)) {
      this._missCount++;
      return null;
    }

    const expiresAt = this._ttl.get(key);
    if (expiresAt && Date.now() > expiresAt) {
      this._store.delete(key);
      this._ttl.delete(key);
      this._missCount++;
      return null;
    }

    this._hitCount++;
    return this._store.get(key);
  }

  set(key, value, ttlSeconds = 300) {
    this._store.set(key, value);
    this._ttl.set(key, Date.now() + (ttlSeconds * 1000));
  }

  del(key) {
    this._store.delete(key);
    this._ttl.delete(key);
  }

  flush() {
    this._store.clear();
    this._ttl.clear();
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this._ttl.entries()) {
      if (now > expiresAt) {
        this._store.delete(key);
        this._ttl.delete(key);
      }
    }
  }

  getStats() {
    const total = this._hitCount + this._missCount;
    return {
      size: this._store.size,
      hitCount: this._hitCount,
      missCount: this._missCount,
      hitRate: total > 0 ? (this._hitCount / total * 100).toFixed(1) + '%' : '0%'
    };
  }

  // Generate a cache key from request params
  static key(prefix, ...parts) {
    return `${prefix}:${parts.filter(p => p != null && p !== '').join(':')}`;
  }

  // Middleware factory for route-level caching
  static middleware(ttlSeconds = 300) {
    const cache = new CacheService();
    return (req, res, next) => {
      const originalJson = res.json.bind(res);
      const key = CacheService.key('route', req.originalUrl);

      const cached = cache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return originalJson(cached);
      }

      res.json = (body) => {
        cache.set(key, body, ttlSeconds);
        res.setHeader('X-Cache', 'MISS');
        originalJson(body);
      };

      next();
    };
  }
}

module.exports = new CacheService();
module.exports.CacheService = CacheService;
