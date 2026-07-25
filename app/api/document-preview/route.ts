import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { readStalwartAuthContextFromStore } from '@/lib/stalwart/auth-context';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { getFilePreviewKind } from '@/lib/file-preview';

export const runtime = 'nodejs';

const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 60_000;

async function hasAuthenticatedSession(): Promise<boolean> {
  const cookieStore = await cookies();

  for (let slot = 0; slot < MAX_ACCOUNT_SLOTS; slot++) {
    const token = cookieStore.get(sessionCookieName(slot))?.value;
    if (token && decryptSession(token)) return true;
    if (readStalwartAuthContextFromStore(cookieStore, slot)) return true;
  }

  return false;
}

function safeFilename(name: string): string {
  return Array.from(name)
    .map((character) => character <= '\u001f' || '\\/:*?"<>|'.includes(character) ? '_' : character)
    .join('')
    .slice(0, 180) || 'document';
}

export async function POST(request: NextRequest) {
  // The route accepts arbitrary Office files, so it must not become a public
  // conversion endpoint. Browser-generated Sec-Fetch headers plus an existing
  // authenticated webmail session restrict it to signed-in, same-origin users.
  if (request.headers.get('sec-fetch-site') !== 'same-origin' || !(await hasAuthenticatedSession())) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const converterUrl = process.env.DOCUMENT_PREVIEW_URL?.replace(/\/+$/, '');
  if (!converterUrl) {
    return NextResponse.json({ error: 'Document preview is not configured' }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Document is required' }, { status: 400 });
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return NextResponse.json({ error: 'Document exceeds the 25 MB preview limit' }, { status: 413 });
  }

  const name = safeFilename(file.name);
  if (getFilePreviewKind(name, file.type) !== 'office') {
    return NextResponse.json({ error: 'Unsupported document type' }, { status: 415 });
  }

  const converterForm = new FormData();
  converterForm.set('files', file, name);
  // Preview is read-only: flatten PDF form fields instead of returning editable
  // widgets and skip index updates that can make document rendering expensive.
  converterForm.set('exportFormFields', 'false');
  converterForm.set('updateIndexes', 'false');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONVERSION_TIMEOUT_MS);

  try {
    const response = await fetch(`${converterUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: converterForm,
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Document conversion failed' }, { status: 502 });
    }

    const pdf = await response.arrayBuffer();
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Document conversion timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Document conversion is unavailable' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
