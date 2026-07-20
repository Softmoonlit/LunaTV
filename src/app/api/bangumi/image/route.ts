/* eslint-disable no-console */
import { NextResponse } from 'next/server';

import { getBangumiImageUrl } from '@/lib/bangumi';
import {
  BANGUMI_REQUEST_TIMEOUT_MS,
  BANGUMI_USER_AGENT,
} from '@/lib/bangumi.server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const trustedImageUrl = imageUrl ? getBangumiImageUrl(imageUrl) : null;

  if (!trustedImageUrl) {
    return NextResponse.json(
      { error: '无效的 Bangumi 图片地址' },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    BANGUMI_REQUEST_TIMEOUT_MS
  );

  try {
    const imageResponse = await fetch(trustedImageUrl, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': BANGUMI_USER_AGENT,
        Referer: 'https://bangumi.tv/',
      },
    });

    if (!imageResponse.ok) {
      throw new Error(`Bangumi image returned ${imageResponse.status}`);
    }

    const contentType = imageResponse.headers.get('content-type');
    if (!contentType?.toLowerCase().startsWith('image/')) {
      throw new Error('Bangumi image returned a non-image response');
    }

    if (!imageResponse.body) {
      throw new Error('Bangumi image response has no body');
    }

    const headers = new Headers({
      'Cache-Control': 'public, max-age=15720000, s-maxage=15720000',
      'CDN-Cache-Control': 'public, s-maxage=15720000',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=15720000',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });

    return new Response(imageResponse.body, { status: 200, headers });
  } catch (error) {
    console.error('获取 Bangumi 图片失败:', error);
    return NextResponse.json(
      { error: 'Bangumi 图片暂时不可用' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
