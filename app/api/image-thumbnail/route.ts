import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { fetchJmapSession } from '@/lib/stalwart/jmap-api';
import { convertHeicToJpeg } from '@/lib/heic-conversion';
import { isHeicImage } from '@/lib/file-preview';

export const runtime = 'nodejs';

const MAX_SOURCE_SIZE = 15 * 1024 * 1024;
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;

function expandDownloadUrl(template: string, accountId: string, blobId: string, name: string, type: string): string {
  return template
    .replace('{accountId}', encodeURIComponent(accountId))
    .replace('{blobId}', encodeURIComponent(blobId))
    .replace('{name}', encodeURIComponent(name || 'image'))
    .replace('{type}', encodeURIComponent(type || 'application/octet-stream'));
}

export async function GET(request: NextRequest) {
  // Attachment thumbnails are private mail data. Only allow image loads that
  // originate from the webmail itself and authenticate them with its session.
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return new NextResponse(null, { status: 403 });
  }

  const blobId = request.nextUrl.searchParams.get('blobId');
  const accountId = request.nextUrl.searchParams.get('accountId');
  const name = request.nextUrl.searchParams.get('name') || 'image';
  const type = request.nextUrl.searchParams.get('type') || 'application/octet-stream';
  if (!blobId || !accountId || !type.toLowerCase().startsWith('image/')) {
    return new NextResponse(null, { status: 400 });
  }

  const credentials = await getStalwartCredentials(request);
  if (!credentials) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const session = await fetchJmapSession(credentials.serverUrl, credentials.authHeader);
    if (!session?.downloadUrl) {
      return new NextResponse(null, { status: 502 });
    }

    const downloadType = isHeicImage(name, type) ? 'application/octet-stream' : type;
    const source = await fetch(expandDownloadUrl(session.downloadUrl, accountId, blobId, name, downloadType), {
      headers: { Authorization: credentials.authHeader },
    });
    if (!source.ok) {
      console.warn('[image-thumbnail] source download failed', { status: source.status, type: downloadType });
      return new NextResponse(null, { status: source.status, headers: { 'X-Image-Thumbnail-Stage': 'download' } });
    }

    const length = Number(source.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_SOURCE_SIZE) {
      return new NextResponse(null, { status: 413 });
    }
    const input = Buffer.from(await source.arrayBuffer());
    if (input.byteLength > MAX_SOURCE_SIZE) {
      return new NextResponse(null, { status: 413 });
    }

    const previewInput = isHeicImage(name, type)
      ? await convertHeicToJpeg(input)
      : input;
    const thumbnail = await sharp(previewInput, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();

    return new NextResponse(new Uint8Array(thumbnail), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    // Unsupported formats (or a malformed sender attachment) should simply
    // retain the normal file chip rather than breaking email rendering.
    console.warn('[image-thumbnail] conversion failed', error instanceof Error ? error.message : String(error));
    return new NextResponse(null, { status: 415, headers: { 'X-Image-Thumbnail-Stage': 'conversion' } });
  }
}
