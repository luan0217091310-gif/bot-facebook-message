import { describe, expect, it } from 'vitest';
import { Repository } from '../src/repository.js';
import { booking, findPhone } from '../src/services/booking.js';

const run = (db: Repository, text: string, start = false) => booking(db, 'u1', text, false, start);

describe('đặt lịch hẹn', () => {
  it('nhận số điện thoại viết tự do', () => {
    expect(findPhone('sđt mình 0912.345.678 nhé')).toBe('0912345678');
    expect(findPhone('+84 912 345 678')).toBe('+84912345678');
    expect(findPhone('Theo web')).toBeUndefined();
  });
  it('đi hết luồng và lưu', () => {
    const db = new Repository(':memory:');
    run(db, '/book', true);
    expect(run(db, 'Luân')?.text).toContain('số điện thoại');
    expect(run(db, 'số mình là 0912-345-678')?.text).toContain('ngày nào');
    expect(run(db, '9h sáng thứ 7')?.confirm).toBe(true);
    expect(run(db, 'đồng ý')?.ref).toBeTruthy();
    expect(db.get('u1', 'bookingDraft')).toBeUndefined();
  });
  it('cho phép bỏ qua số điện thoại', () => {
    const db = new Repository(':memory:');
    run(db, '/book', true); run(db, 'Luân');
    expect(run(db, 'Theo web')?.text).toContain('ngày nào');
  });
  it('thoát được bằng lời nói, lệnh khác, hoặc sau 3 lần sai', () => {
    const db = new Repository(':memory:');
    run(db, '/book', true); run(db, 'Luân');
    expect(run(db, 'Dừng lại')?.text).toContain('Đã huỷ');
    run(db, '/book', true); run(db, 'Luân');
    expect(run(db, '/nhận dạng')).toBeUndefined();
    expect(db.get('u1', 'bookingDraft')).toBeUndefined();
    run(db, '/book', true); run(db, 'Luân');
    run(db, 'alo'); run(db, 'abc');
    expect(run(db, 'xyz')?.text).toContain('tạm dừng');
    expect(db.get('u1', 'bookingDraft')).toBeUndefined();
  });
  it('nhận tên kèm số trong một tin', () => {
    const db = new Repository(':memory:');
    run(db, '/book', true);
    expect(run(db, 'Luân, 0912345678')?.text).toContain('ngày nào');
  });
});
