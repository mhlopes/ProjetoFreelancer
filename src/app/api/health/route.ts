import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await q1('SELECT 1');
    return NextResponse.json({ status: 'ok', env: config.env, paymentProvider: config.paymentProvider, mock: config.paymentProvider === 'mock' });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
