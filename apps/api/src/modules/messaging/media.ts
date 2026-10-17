import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../../core/context.ts';
import type { MessageMedia } from '../../db/schema.ts';
import { badRequest } from '../../core/errors.ts';

// Anexos enviados manualmente. Somente tipos suportados pelo gateway e com
// tamanho limitado; o nome do arquivo em disco é gerado (nunca o do usuário).

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'application/pdf': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'text/plain': 'document',
};

export function mediaKind(mimeType: string): string | null {
  return ALLOWED[mimeType] ?? null;
}

export async function storeMedia(ctx: AppContext, input: { data: Buffer; mimeType: string; fileName: string }): Promise<MessageMedia> {
  const kind = mediaKind(input.mimeType);
  if (!kind) throw badRequest('unsupported_media', `Tipo de arquivo não suportado: ${input.mimeType}`);
  if (input.data.length > ctx.config.media.maxBytes) throw badRequest('media_too_large', 'Arquivo excede o tamanho máximo');
  const key = `${randomUUID()}`;
  const dir = path.resolve(ctx.config.media.dir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), input.data, { mode: 0o600 });
  const safeName = input.fileName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'arquivo';
  return { kind, mimeType: input.mimeType, fileName: safeName, size: input.data.length, storageKey: key, gatewayUrl: null };
}

export async function readMedia(ctx: AppContext, media: MessageMedia): Promise<{ data: Buffer; mimeType: string; fileName: string; kind: string }> {
  if (!media.storageKey || !/^[0-9a-f-]{36}$/.test(media.storageKey)) throw new Error('Mídia sem arquivo local');
  const data = await readFile(path.join(path.resolve(ctx.config.media.dir), media.storageKey));
  return { data, mimeType: media.mimeType, fileName: media.fileName, kind: media.kind };
}
