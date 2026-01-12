const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const CACHE_TTL_SECONDS = 60 * 60 * 24;

interface Env {
  TG_BOT_TOKEN: string;
  TG_CHAT_ID: string;
  ALLOWED_ORIGINS?: string;
  IMG_KV: KVNamespace;
  ASSETS: Fetcher;
}

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramPhoto = {
  file_id: string;
};

type TelegramSendPhotoResult = {
  photo?: TelegramPhoto[];
};

type TelegramSendDocumentResult = {
  document?: {
    file_id: string;
  };
};

type TelegramGetFileResult = {
  file_path?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'POST' && url.pathname === '/upload') {
      return handleUpload(request, env, url);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/i/')) {
      const id = url.pathname.replace('/i/', '');
      return handleImageRequest(request, env, id);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/file/')) {
      const id = url.pathname.replace('/file/', '');
      return handleImageRequest(request, env, id);
    }

    return jsonResponse(
      {
        ok: false,
        error: 'Not Found',
      },
      404,
    );
  },
};

async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid form data.' }, 400);
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return jsonResponse({ ok: false, error: 'Missing file field.' }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonResponse({ ok: false, error: 'File too large.' }, 413);
  }

  const useDocument =
    url.searchParams.get('document') === '1' ||
    url.searchParams.get('mode') === 'document';

  const telegramResponse = useDocument
    ? await sendDocument(env, file)
    : await sendPhoto(env, file);

  if (!telegramResponse.ok || !telegramResponse.result) {
    return jsonResponse(
      {
        ok: false,
        error: telegramResponse.description ?? 'Telegram upload failed.',
      },
      502,
    );
  }

  const fileId = extractFileId(telegramResponse.result, useDocument);
  if (!fileId) {
    return jsonResponse({ ok: false, error: 'Telegram response missing file ID.' }, 502);
  }

  const filePath = await getTelegramFilePath(env, fileId);
  if (!filePath) {
    return jsonResponse({ ok: false, error: 'Failed to resolve file path.' }, 502);
  }

  const id = generateId();
  await env.IMG_KV.put(id, filePath);

  const origin = url.origin;

  return jsonResponse({
    ok: true,
    id,
    url: `${origin}/i/${id}`,
  });
}

async function sendPhoto(env: Env, file: File): Promise<TelegramResponse<TelegramSendPhotoResult>> {
  const formData = new FormData();
  formData.append('chat_id', env.TG_CHAT_ID);
  formData.append('photo', file);

  return telegramRequest<TelegramSendPhotoResult>(env, 'sendPhoto', {
    body: formData,
  });
}

async function sendDocument(
  env: Env,
  file: File,
): Promise<TelegramResponse<TelegramSendDocumentResult>> {
  const formData = new FormData();
  formData.append('chat_id', env.TG_CHAT_ID);
  formData.append('document', file);

  return telegramRequest<TelegramSendDocumentResult>(env, 'sendDocument', {
    body: formData,
  });
}

function extractFileId(
  result: TelegramSendPhotoResult | TelegramSendDocumentResult,
  isDocument: boolean,
): string | undefined {
  if (isDocument) {
    return (result as TelegramSendDocumentResult).document?.file_id;
  }

  const photos = (result as TelegramSendPhotoResult).photo;
  return photos?.[photos.length - 1]?.file_id;
}

async function getTelegramFilePath(env: Env, fileId: string): Promise<string | null> {
  const response = await telegramRequest<TelegramGetFileResult>(
    env,
    `getFile?file_id=${encodeURIComponent(fileId)}`,
    { method: 'GET' },
  );

  if (!response.ok || !response.result?.file_path) {
    return null;
  }

  return response.result.file_path;
}

async function handleImageRequest(request: Request, env: Env, id: string): Promise<Response> {
  if (!id) {
    return jsonResponse({ ok: false, error: 'Missing id.' }, 400);
  }

  if (!isAllowedOrigin(request, env)) {
    return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  }

  const filePath = await env.IMG_KV.get(id);
  if (!filePath) {
    return jsonResponse({ ok: false, error: 'Not found.' }, 404);
  }

  const telegramUrl = `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
  const upstream = await fetch(telegramUrl, {
    cf: {
      cacheEverything: true,
      cacheTtl: CACHE_TTL_SECONDS,
    },
  });

  const headers = new Headers(upstream.headers);
  headers.set('cache-control', `public, max-age=${CACHE_TTL_SECONDS}`);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    return true;
  }

  const originHeader = request.headers.get('Origin');
  const refererHeader = request.headers.get('Referer');

  let refererOrigin = '';
  if (refererHeader) {
    try {
      refererOrigin = new URL(refererHeader).origin;
    } catch {
      refererOrigin = '';
    }
  }

  const origin = originHeader ?? refererOrigin;

  if (!origin) {
    return false;
  }

  return allowed.includes(origin);
}

async function telegramRequest<T>(
  env: Env,
  method: string,
  init: RequestInit = {},
): Promise<TelegramResponse<T>> {
  const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: init.method ?? 'POST',
    body: init.body,
  });

  return response.json<never>() as Promise<TelegramResponse<T>>;
}

function generateId(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
