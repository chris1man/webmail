import { NextRequest, NextResponse } from 'next/server';
import { convertHeicToJpeg } from '@/lib/heic-conversion';
import { isHeicImage } from '@/lib/file-preview';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { fetchJmapSession } from '@/lib/stalwart/jmap-api';

export const runtime = 'nodejs';

const MAX_SOURCE_SIZE = 15 * 1024 * 1024;

function expandDownloadUrl(template: string, accountId: string, blobId: string, name: string, type: string): string {
  return template
    .replace('{accountId}', encodeURIComponent(accountId))
    .replace('{blobId}', encodeURIComponent(blobId))
    .replace('{name}', encodeURIComponent(name || 'image.heic'))
    .replace('{type}', encodeURIComponent(type || 'image/heic'));
}

function hasSameOriginRequest(request: NextRequest): boolean {
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

async function responseFromHeic(input: Buffer): Promise<NextResponse> {
  const jpeg = await convertHeicToJpeg(input);
  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(request: NextRequest) {
  if (!hasSameOriginRequest(request)) return new NextResponse(null, { status: 403 });

  const blobId = request.nextUrl.searchParams.get('blobId');
  const accountId = request.nextUrl.searchParams.get('accountId');
  const name = request.nextUrl.searchParams.get('name') || 'image.heic';
  const type = request.nextUrl.searchParams.get('type') || 'image/heic';
  if (!blobId || !accountId || !isHeicImage(name, type)) {
    return new NextResponse(null, { status: 400 });
  }

  const credentials = await getStalwartCredentials(request);
  if (!credentials) return new NextResponse(null, { status: 401 });

  try {
    const session = await fetchJmapSession(credentials.serverUrl, credentials.authHeader);
    if (!session?.downloadUrl) return new NextResponse(null, { status: 502 });

    const source = await fetch(expandDownloadUrl(session.downloadUrl, accountId, blobId, name, 'application/octet-stream'), {
      headers: { Authorization: credentials.authHeader },
    });
    if (!source.ok) return new NextResponse(null, { status: source.status });

    const length = Number(source.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_SOURCE_SIZE) return new NextResponse(null, { status: 413 });
    const input = Buffer.from(await source.arrayBuffer());
    if (input.byteLength > MAX_SOURCE_SIZE) return new NextResponse(null, { status: 413 });

    return await responseFromHeic(input);
  } catch {
    return new NextResponse(null, { status: 415 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasSameOriginRequest(request) || !(await getStalwartCredentials(request))) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string' || !isHeicImage(file.name, file.type)) {
      return new NextResponse(null, { status: 400 });
    }
    if (file.size > MAX_SOURCE_SIZE) return new NextResponse(null, { status: 413 });
    return await responseFromHeic(Buffer.from(await file.arrayBuffer()));
  } catch {
    return new NextResponse(null, { status: 415 });
  }
}
