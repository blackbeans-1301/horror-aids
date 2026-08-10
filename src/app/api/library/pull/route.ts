import { NextResponse } from 'next/server';

import { pullSubmodule } from '@/lib/git';

export async function POST(): Promise<NextResponse> {
  try {
    const result = await pullSubmodule();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'git pull failed' },
      { status: 500 },
    );
  }
}
