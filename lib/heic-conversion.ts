import convert from 'heic-convert';

export async function convertHeicToJpeg(input: Buffer): Promise<Buffer> {
  const jpeg = await convert({
    buffer: input,
    format: 'JPEG',
    quality: 0.9,
  });
  return Buffer.from(jpeg);
}
