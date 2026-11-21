import { randomBytes } from 'node:crypto';
import { docRef, type DocRef } from './docstore.js';

export type Confidence = 'true' | 'joke' | 'unsure';

export interface Fact {
  id: string;
  content: string;
  subjectId: string;
  sourceId: string;
  threadId: string;
  createdAt: number;
  confidence: Confidence;
  visibility: 'private' | 'group';
  volatile: boolean;
  tombstone?: { at: number; reason: string };
}

export interface FactScope {
  threadId: string;
  senderId: string;
  isGroup: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class FactStore {
  private facts: Fact[] = [];

  private readonly ref: DocRef;
  constructor(
    filePath: string | DocRef,
    private readonly now: () => number = Date.now,
  ) {
    this.ref = docRef(filePath);
    this.load();
  }

  private load(): void {
    const raw = this.ref.store.read(this.ref.name);
    if (!raw) {
      this.facts = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.facts = Array.isArray(parsed) ? (parsed as Fact[]) : [];
    } catch {
      this.facts = [];
    }
  }

  private save(): void {
    this.ref.store.write(this.ref.name, JSON.stringify(this.facts, null, 2));
  }

  private inScope(fact: Fact, scope: FactScope): boolean {
    if (scope.isGroup) {
      return fact.visibility === 'group' && fact.threadId === scope.threadId;
    }
    return (
      fact.threadId === scope.threadId
      || (fact.visibility === 'group' && fact.subjectId === scope.senderId)
    );
  }

  add(
    input: {
      content: string;
      subjectId: string;
      sourceId: string;
      threadId: string;
      confidence: Confidence;
      volatile: boolean;
    },
    scope: FactScope,
  ): Fact {
    const fact: Fact = {
      id: randomBytes(4).toString('hex'),
      content: input.content.trim(),
      subjectId: input.subjectId,
      sourceId: input.sourceId,
      threadId: input.threadId,
      createdAt: this.now(),
      confidence: input.confidence,
      visibility: scope.isGroup ? 'group' : 'private',
      volatile: Boolean(input.volatile),
    };
    this.facts.push(fact);
    this.save();
    return fact;
  }

  get(id: string): Fact | undefined {
    return this.facts.find((f) => f.id === id);
  }

  countActive(): number {
    return this.facts.filter((f) => !f.tombstone).length;
  }

  eraseThread(threadId:string):void {
    this.facts=this.facts.filter(f=>f.threadId!==threadId);
    this.save();
  }

  search(scope: FactScope, limit = 30): Array<Fact & { stale: boolean }> {
    const now = this.now();
    return this.facts
      .filter((f) => !f.tombstone && this.inScope(f, scope))
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((f) => {
        const age = now - f.createdAt;
        const stale = f.volatile ? age > 14 * DAY_MS : age > 90 * DAY_MS;
        return { ...f, stale };
      });
  }

  tombstone(id: string, reason: string): void {
    const fact = this.facts.find((f) => f.id === id);
    if (!fact) throw new Error(`Không tìm thấy ghi nhớ [${id}]`);
    fact.tombstone = { at: this.now(), reason };
    this.save();
  }

  tombstones(scope: FactScope, limit = 15): Fact[] {
    return this.facts
      .filter((f) => Boolean(f.tombstone) && this.inScope(f, scope))
      .slice()
      .sort((a, b) => (b.tombstone?.at ?? 0) - (a.tombstone?.at ?? 0))
      .slice(0, limit);
  }
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  true: 'Thật',
  joke: 'Đùa',
  unsure: 'Chưa chắc',
};

export function renderMemoryForPrompt(
  facts: Array<Fact & { stale: boolean }>,
  tombstones: Fact[],
): string {
  if (facts.length === 0 && tombstones.length === 0) return '';
  const parts: string[] = [];
  if (facts.length > 0) {
    parts.push('## Trí nhớ đã lưu về người dùng / nhóm:');
    for (const f of facts) {
      const dateStr = new Date(f.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const staleTag = f.stale ? ' (cũ, cần hỏi lại)' : '';
      parts.push(
        `- [${f.id}] ${f.content} (về: ${f.subjectId}, nguồn: ${f.sourceId}, ${dateStr}, độ tin cậy: ${CONFIDENCE_LABEL[f.confidence]})${staleTag}`,
      );
    }
  }
  if (tombstones.length > 0) {
    parts.push('## Thông tin đã đính chính, KHÔNG dùng lại:');
    for (const t of tombstones) {
      parts.push(`- [Đã bỏ: ${t.id}] ${t.content} (lý do: ${t.tombstone?.reason ?? 'đính chính'})`);
    }
  }
  return parts.join('\n');
}
