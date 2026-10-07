import { NestFactory } from '@nestjs/core';

describe('outillage', () => {
  it('compile le TypeScript avec bigint natif', () => {
    const amount: bigint = 6000n;
    expect(typeof amount).toBe('bigint');
    expect(amount * 12n / 100n).toBe(720n);
  });

  it('charge NestJS', () => {
    expect(typeof NestFactory.create).toBe('function');
  });
});
