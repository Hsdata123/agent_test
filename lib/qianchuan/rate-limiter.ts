// 令牌桶限流器: 控制 OceanEngine API 调用频率
// 默认 10 QPS(业内通用基线),可通过 env OCEANENGINE_QPS 覆盖
// 用法: await rateLimiter.acquire();  await callOceanEngine(...)

type AcquireOptions = { timeoutMs?: number };

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private waiters: Array<() => void> = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(qps: number) {
    this.capacity = Math.max(1, qps);
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.refillPerMs = qps / 1000;
    this.startTicker();
  }

  // 周期性 tick 触发 refill, 保证没有新请求时队列里的 waiter 也能被唤醒
  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.refill(), 50);
    if (typeof this.ticker.unref === "function") this.ticker.unref();
  }

  async acquire(opts: AcquireOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(onReady);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`TokenBucket acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      // 只靠 refill() 唤醒, 避免双重 resolve / 双重扣 token
      const onReady = () => {
        clearTimeout(timer);
        if (this.tokens < 1) {
          // 防御: refill 触发 wake 时桶里居然还是空, 拒绝, 让调用方感知真实状态
          reject(new Error("TokenBucket: unexpected empty bucket after wake"));
          return;
        }
        this.tokens -= 1;
        resolve();
      };
      this.waiters.push(onReady);
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const add = elapsed * this.refillPerMs;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefill = now;
    while (this.waiters.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

let _defaultLimiter: TokenBucket | null = null;

export function getOceanEngineLimiter(): TokenBucket {
  if (_defaultLimiter) return _defaultLimiter;
  const qps = Number(process.env.OCEANENGINE_QPS) || 10;
  _defaultLimiter = new TokenBucket(qps);
  return _defaultLimiter;
}
