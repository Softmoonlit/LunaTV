/* eslint-disable @typescript-eslint/no-explicit-any */

export type AuthRole = 'owner' | 'admin' | 'user';

async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function generateAuthCookie(
  username?: string,
  password?: string,
  role: AuthRole = 'user',
  includePassword = false
): Promise<string> {
  const authData: any = { role };

  if (includePassword && password) {
    authData.password = password;
  }

  if (username && process.env.PASSWORD) {
    authData.username = username;
    authData.signature = await generateSignature(
      username,
      process.env.PASSWORD
    );
    authData.timestamp = Date.now();
  }

  return encodeURIComponent(JSON.stringify(authData));
}
