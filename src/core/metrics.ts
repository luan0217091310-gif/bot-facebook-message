import type { DatabaseSync } from 'node:sqlite';

export type MetricKind = 'in' | 'out' | 'latency' | 'tokens' | 'tool' | 'error';

/** Giá ước tính USD / 1M token; chỉnh bằng env AI_COST_PER_MTOKEN (mặc định 0.3). */
export interface Summary {
  since: number;
  messagesIn: number;
  messagesOut: number;
  activeUsers: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  tokens: number;
  estimatedCostUsd: number;
  errors: number;
  topTools: Array<{ name: string; count: number }>;
  daily: Array<{ day: string; messages: number; users: number }>;
}

export class Metrics {
  constructor(private readonly sql: DatabaseSync, private readonly costPerMToken = 0.3, private readonly now: () => number = Date.now) {}

  record(kind: MetricKind, name?: string, value = 1, user?: string): void {
    try {
      this.sql.prepare('INSERT INTO metrics(at,kind,name,value,user) VALUES(?,?,?,?,?)').run(this.now(), kind, name ?? null, value, user ?? null);
    } catch { /* Thống kê không bao giờ được làm hỏng luồng chat. */ }
  }

  summary(days = 7): Summary {
    const since = this.now() - days * 86400000;
    const one = (q: string) => (this.sql.prepare(q).get(since) as Record<string, number | null>);
    const count = (kind: MetricKind) => Number(one(`SELECT count(*) AS n FROM metrics WHERE at>=? AND kind='${kind}'`).n ?? 0);
    const lat = (this.sql.prepare("SELECT value FROM metrics WHERE at>=? AND kind='latency' ORDER BY value").all(since) as { value: number }[]).map((r) => r.value);
    const tokens = Number(one("SELECT sum(value) AS n FROM metrics WHERE at>=? AND kind='tokens'").n ?? 0);
    return {
      since,
      messagesIn: count('in'),
      messagesOut: count('out'),
      activeUsers: Number(one("SELECT count(DISTINCT user) AS n FROM metrics WHERE at>=? AND kind='in'").n ?? 0),
      avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
      p95LatencyMs: lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]!) : 0,
      tokens,
      estimatedCostUsd: Math.round(tokens / 1e6 * this.costPerMToken * 10000) / 10000,
      errors: count('error'),
      topTools: (this.sql.prepare("SELECT name, count(*) AS count FROM metrics WHERE at>=? AND kind='tool' GROUP BY name ORDER BY count DESC LIMIT 10").all(since) as { name: string; count: number }[])
        .map((r) => ({ name: r.name, count: Number(r.count) })),
      daily: (this.sql.prepare("SELECT date(at/1000,'unixepoch','+7 hours') AS day, count(*) AS messages, count(DISTINCT user) AS users FROM metrics WHERE at>=? AND kind='in' GROUP BY day ORDER BY day").all(since) as { day: string; messages: number; users: number }[])
        .map((r) => ({ day: r.day, messages: Number(r.messages), users: Number(r.users) })),
    };
  }

  /** Giữ bảng gọn: xoá số liệu cũ hơn `days` ngày. */
  prune(days = 90): void { this.sql.prepare('DELETE FROM metrics WHERE at<?').run(this.now() - days * 86400000); }
}
