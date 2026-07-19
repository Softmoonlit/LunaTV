/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { generateAuthCookie } from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { UserAlreadyExistsError } from '@/lib/types';

export const runtime = 'nodejs';

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;

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
    const config = await getConfig();
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 403 });
    }

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
    if (
      username === process.env.USERNAME ||
      config.UserConfig.Users.some((user) => user.username === username) ||
      (await db.checkUserExist(username))
    ) {
      return NextResponse.json({ error: '用户已存在' }, { status: 409 });
    }

    try {
      await db.registerUser(username, password);
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        return NextResponse.json({ error: '用户已存在' }, { status: 409 });
      }
      throw error;
    }

    const newUser = { username, role: 'user' as const };
    config.UserConfig.Users.push(newUser);

    try {
      await db.saveAdminConfig(config);
    } catch (error) {
      config.UserConfig.Users = config.UserConfig.Users.filter(
        (user) => user !== newUser
      );
      try {
        await db.deleteUser(username);
      } catch (rollbackError) {
        console.error('注册失败后回滚用户数据失败:', rollbackError);
      }
      throw error;
    }

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
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
