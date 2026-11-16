import { describe, expect, it } from 'vitest';
import { bpsOf, formatBRL, hourlyAmount, mulDivHalfUp, parseBRL, penaltyAmount } from '@/lib/money';
import { subMonths } from '@/lib/clock';
import { normalizeCnpj, normalizeCpf, cpfCheckDigits, encrypt, decrypt, hashPassword, verifyPassword } from '@/lib/crypto';
import { zonedToUtc, distanceKm } from '@/lib/time';
import { amountDue } from '@/modules/settlement';
import { evaluateCancellation } from '@/modules/cancellations';
import type { Contract, WorkUnit } from '@/modules/contracts';

describe('dinheiro em centavos inteiros', () => {
  it('tarifa por hora × minutos, half-up', () => {
    expect(hourlyAmount(3000, 240)).toBe(12000);
    expect(hourlyAmount(3000, 180)).toBe(9000);
    expect(hourlyAmount(3333, 1)).toBe(56); // 55,55 → 56
    expect(hourlyAmount(1000, 1)).toBe(17); // 16,67 → 17
    expect(hourlyAmount(100, 3)).toBe(5); // 5,0
    expect(mulDivHalfUp(1, 1, 2)).toBe(1); // 0,5 → 1
    expect(mulDivHalfUp(1, 1, 3)).toBe(0);
  });

  it('percentual e teto de multa', () => {
    expect(bpsOf(12000, 1000)).toBe(1200);
    expect(penaltyAmount(200000, 1000, 10000)).toBe(10000); // 10% de R$2.000 limitado a R$100
    expect(penaltyAmount(50000, 1000, 10000)).toBe(5000);
    expect(penaltyAmount(50000, 2000, 20000)).toBe(10000);
    expect(penaltyAmount(999999999, 2000, 20000)).toBe(20000);
  });

  it('formatação e leitura sem ponto flutuante', () => {
    expect(formatBRL(1234567)).toBe('R$ 12.345,67');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(-150)).toBe('-R$ 1,50');
    expect(parseBRL('120')).toBe(12000);
    expect(parseBRL('120,5')).toBe(12050);
    expect(parseBRL('R$ 1.200,50')).toBe(120050);
    expect(parseBRL('0,29')).toBe(29);
    expect(parseBRL('12,345')).toBeNull();
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('-10')).toBeNull();
  });

  it('valor devido nunca excede o financiado', () => {
    expect(amountDue({ billing_unit: 'hour', amount_cents: 3000 }, { funded_cents: 12000, reported_minutes: 180 })).toEqual({ dueCents: 9000, excessCents: 0 });
    expect(amountDue({ billing_unit: 'hour', amount_cents: 3000 }, { funded_cents: 12000, reported_minutes: 360 })).toEqual({ dueCents: 12000, excessCents: 6000 });
    expect(amountDue({ billing_unit: 'fixed', amount_cents: 12000 }, { funded_cents: 12000, reported_minutes: null })).toEqual({ dueCents: 12000, excessCents: 0 });
  });
});

describe('tempo', () => {
  it('janela móvel de meses de calendário', () => {
    expect(subMonths(new Date('2026-11-16T12:00:00Z'), 12).toISOString()).toBe('2025-11-16T12:00:00.000Z');
    expect(subMonths(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('horário local respeita o fuso do serviço', () => {
    expect(zonedToUtc('2026-11-20T10:00', 'America/Sao_Paulo')!.toISOString()).toBe('2026-11-20T13:00:00.000Z');
    expect(zonedToUtc('2026-11-20T10:00', 'America/Manaus')!.toISOString()).toBe('2026-11-20T14:00:00.000Z');
    expect(zonedToUtc('2026-11-20T10:00', 'America/Rio_Branco')!.toISOString()).toBe('2026-11-20T15:00:00.000Z');
    expect(zonedToUtc('lixo', 'America/Sao_Paulo')).toBeNull();
  });

  it('distância aproximada', () => {
    const d = distanceKm(-23.5505, -46.6333, -22.9068, -43.1729); // SP–RJ
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(370);
  });
});

describe('documentos e segredos', () => {
  it('valida dígitos de CPF e CNPJ', () => {
    const cpf = '123456789' + cpfCheckDigits('123456789');
    expect(normalizeCpf(cpf)).toBe(cpf);
    expect(normalizeCpf('123.456.789-00')).toBeNull();
    expect(normalizeCpf('111.111.111-11')).toBeNull();
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeCnpj('11.222.333/0001-80')).toBeNull();
  });

  it('cifra e decifra; senha com hash', () => {
    const enc = encrypt('12345678909');
    expect(enc).not.toContain('12345678909');
    expect(decrypt(enc)).toBe('12345678909');
    const h = hashPassword('segredo-bom');
    expect(verifyPassword('segredo-bom', h)).toBe(true);
    expect(verifyPassword('errada', h)).toBe(false);
  });
});

describe('regras de cancelamento (R23–R27)', () => {
  const policy = {
    version: 1, scheduledFreeCancellationBeforeHours: 24, scheduledBookingGraceMinutes: 30,
    cancellationPenaltyBps: 1000, cancellationCapCents: 10000, noShowPenaltyBps: 2000, noShowCapCents: 20000,
  } as Contract['policy_snapshot'];
  const t = new Date('2026-11-16T12:00:00Z');
  const mk = (over: Partial<Contract>): Contract => ({
    status: 'confirmed', kind: 'scheduled', starts_at: new Date('2026-11-20T12:00:00Z'), confirmed_at: new Date('2026-11-16T11:00:00Z'),
    policy_snapshot: policy, policy_version: 1, ...over,
  } as Contract);
  const unit = { budget_cents: 50000, funded_cents: 50000 } as WorkUnit;

  it('agendado com mais de 24h: gratuito', () => {
    expect(evaluateCancellation(mk({}), unit, 'client', t).outcome).toBe('free');
  });
  it('agendado exatamente a 24h: não é "mais de 24h"', () => {
    const p = evaluateCancellation(mk({ starts_at: new Date('2026-11-17T12:00:00Z') }), unit, 'client', t);
    expect(p).toMatchObject({ outcome: 'penalty', penaltyCents: 5000, settlement: 'from_reserve', refundToClientCents: 45000, penaltyBeneficiary: 'worker' });
  });
  it('agendado a menos de 24h dentro da tolerância de 30min: gratuito', () => {
    const c = mk({ starts_at: new Date('2026-11-17T06:00:00Z'), confirmed_at: new Date('2026-11-16T11:30:00Z') });
    expect(evaluateCancellation(c, unit, 'client', t).outcome).toBe('free');
    expect(evaluateCancellation(c, unit, 'client', new Date('2026-11-16T12:00:01Z')).outcome).toBe('penalty');
  });
  it('tolerância não vale se o deslocamento começou', () => {
    const c = mk({ status: 'en_route', starts_at: new Date('2026-11-17T06:00:00Z'), confirmed_at: new Date('2026-11-16T11:45:00Z') });
    expect(evaluateCancellation(c, unit, 'client', t).outcome).toBe('penalty');
  });
  it('urgente: gratuito antes do deslocamento, compensação depois', () => {
    expect(evaluateCancellation(mk({ kind: 'urgent' }), unit, 'client', t).outcome).toBe('free');
    expect(evaluateCancellation(mk({ kind: 'urgent', status: 'en_route' }), unit, 'client', t)).toMatchObject({ outcome: 'penalty', penaltyCents: 5000 });
  });
  it('multa do trabalhador vira débito separado; contratante recebe tudo de volta', () => {
    const p = evaluateCancellation(mk({ kind: 'urgent', status: 'en_route' }), unit, 'worker', t);
    expect(p).toMatchObject({ outcome: 'penalty', responsible: 'worker', settlement: 'debt', refundToClientCents: 50000, penaltyBeneficiary: 'client' });
  });
  it('teto aplicado', () => {
    const big = { budget_cents: 200000, funded_cents: 200000 } as WorkUnit;
    expect(evaluateCancellation(mk({ kind: 'urgent', status: 'en_route' }), big, 'client', t).penaltyCents).toBe(10000);
  });
  it('trabalho iniciado não é cancelamento simples', () => {
    expect(evaluateCancellation(mk({ status: 'in_progress' }), unit, 'client', t).outcome).toBe('requires_support');
  });
  it('antes da confirmação financeira: gratuito', () => {
    expect(evaluateCancellation(mk({ status: 'awaiting_funding' }), { ...unit, funded_cents: 0 } as WorkUnit, 'client', t).outcome).toBe('free');
  });
});
