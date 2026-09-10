import convert from 'heic-convert';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function convertWithNativeDecoder(input: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'webmail-heic-'));
  const source = join(directory, 'source.heic');
  const output = join(directory, 'preview.jpg');

  try {
    await writeFile(source, input);
    await execFileAsync('heif-dec', ['-q', '90', source, output], { timeout: 30_000 });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function convertHeicToJpeg(input: Buffer): Promise<Buffer> {
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return input;

  try {
    const jpeg = await convert({
      buffer: input,
      format: 'JPEG',
      quality: 0.9,
    });
    return Buffer.from(jpeg);
  } catch {
    return convertWithNativeDecoder(input);
  }
}
