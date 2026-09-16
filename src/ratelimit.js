/**
 * Lightweight sliding-window rate limiter per client IP.
 */
export class RateLimiter {
  /**
   * @param {number} limit
   * @param {number} [windowSeconds=60]
   */
  constructor(limit, windowSeconds = 60) {
    this.limit = limit;
    this.windowSeconds = windowSeconds;
    /** @type {Map<string, number[]>} */
    this._hits = new Map();
  }

  /**
   * Record a hit for key. Returns { allowed: boolean, remaining: number, retryAfter: number }.
   * @param {string} key
   * @param {number} [now]
   */
  hit(key, now = Date.now() / 1000) {
    const cutoff = now - this.windowSeconds;
    let timestamps = this._hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this._hits.set(key, timestamps);
    }

    // Purge expired hits
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.limit) {
      const retryAfter = timestamps[0] + this.windowSeconds - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(0.0, retryAfter),
      };
    }

    timestamps.push(now);
    return {
      allowed: true,
      remaining: this.limit - timestamps.length,
      retryAfter: 0.0,
    };
  }
}

export function getClientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const raw = Array.isArray(fwd) ? fwd[0] : fwd;
    return raw.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Express middleware for rate limiting.
 *
 * @param {RateLimiter} limiter
 * @param {string} [protectPrefix='/v1']
 */
export function rateLimitMiddleware(limiter, protectPrefix = '/v1') {
  return (req, res, next) => {
    if (!req.path.startsWith(protectPrefix)) {
      return next();
    }

    const key = getClientKey(req);
    const now = Date.now() / 1000;
    const { allowed, remaining, retryAfter } = limiter.hit(key, now);

    res.setHeader('X-RateLimit-Limit', String(limiter.limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(now + limiter.windowSeconds)));

    if (!allowed) {
      res.setHeader('Retry-After', String(Math.ceil(retryAfter) + 1));
      return res.status(429).json({
        error: {
          message: `Rate limit exceeded: ${limiter.limit} requests per ${Math.floor(limiter.windowSeconds)}s. Retry in ${retryAfter.toFixed(1)}s.`,
          type: 'rate_limit_error',
        },
      });
    }

    next();
  };
}
