/* eslint-disable no-console */

import { createHmac, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { generateAuthCookie } from '@/lib/auth-cookie';
import { setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';

export const runtime = 'nodejs';

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateCredentials(username: unknown, password: unknown) {
  if (typeof username !== 'string' || !username.trim()) {
    return { error: '用户名不能为空' };
  }
  if (typeof password !== 'string' || !password) {
    return { error: '密码不能为空' };
  }

  const normalizedUsername = username.trim();
  if (
    normalizedUsername.length < USERNAME_MIN_LENGTH ||
    normalizedUsername.length > USERNAME_MAX_LENGTH
  ) {
    return { error: '用户名长度应为 3-32 个字符' };
  }
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    return { error: '用户名只能包含字母、数字、点、下划线和连字符' };
  }
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return { error: '密码长度应为 6-128 个字符' };
  }

  return { username: normalizedUsername, password };
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json({ error: '当前模式不支持注册' }, { status: 400 });
  }

  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 1024) {
      return NextResponse.json({ error: '请求内容过大' }, { status: 413 });
    }

    let body: { username?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
    }

    const credentials = validateCredentials(body.username, body.password);
    if ('error' in credentials) {
      return NextResponse.json({ error: credentials.error }, { status: 400 });
    }

    const { username, password } = credentials;
    const providedOperationId = request.headers.get('idempotency-key');
    if (
      providedOperationId &&
      !IDEMPOTENCY_KEY_PATTERN.test(providedOperationId)
    ) {
      return NextResponse.json({ error: '幂等键格式错误' }, { status: 400 });
    }

    const operationId = providedOperationId || randomUUID();
    const ownerUsername = process.env.USERNAME || '';
    const requestFingerprint = createHmac(
      'sha256',
      process.env.PASSWORD || 'lunatv-registration'
    )
      .update(`${username}\0${password}`)
      .digest('hex');

    const result = await db.registerUserAtomically({
      username,
      passwordHash: hashPassword(password),
      ownerUsername,
      operationId,
      requestFingerprint,
    });

    if (result.outcome === 'registration_disabled') {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 403 });
    }
    if (result.outcome === 'already_exists') {
      return NextResponse.json({ error: '用户已存在' }, { status: 409 });
    }
    if (result.outcome === 'idempotency_conflict') {
      return NextResponse.json(
        { error: '幂等键已用于其他请求' },
        { status: 409 }
      );
    }

    await setCachedConfig(result.config);

    const response = NextResponse.json({ ok: true });
    const cookieValue = await generateAuthCookie(username, password, 'user');
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    response.cookies.set('auth', cookieValue, {
      path: '/',
      expires,
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    });

    return response;
  } catch (error) {
    console.error('注册接口异常:', error);
    return NextResponse.json(
      { error: '注册状态暂时无法确认，请使用相同信息重试' },
      { status: 503 }
    );
  }
}
