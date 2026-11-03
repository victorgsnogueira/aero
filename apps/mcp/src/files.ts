import { randomUUID } from 'node:crypto';
import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { ApiError } from './api.ts';

export class RichResult {
  data: Record<string, unknown>;
  content: CallToolResult['content'];
  constructor(data: Record<string, unknown>, content: CallToolResult['content'] = []) {
    this.data = data;
    this.content = content;
  }
}

export const defaultFilesRoot = fileURLToPath(new URL('../../../', import.meta.url));
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

export function createFiles(rootPath = defaultFilesRoot) {
  return {
    async read(filePath: string) {
      const root = await realpath(rootPath);
      const target = await realpath(path.resolve(root, filePath)).catch(() => { throw new ApiError('file_not_found', 'Arquivo local não encontrado.'); });
      const relative = path.relative(root, target);
      if (!inside(root, target) || relative.split(path.sep).some((part) => part.startsWith('.') || ['backups', 'node_modules', 'infra'].includes(part.toLowerCase())) || !/\.(png|jpe?g|webp|mp4|mp3|ogg|m4a|pdf|docx|xlsx|txt)$/i.test(target)) {
        throw new ApiError('file_not_allowed', 'Anexos precisam ser documentos ou mídias dentro de AERO_MCP_FILES_ROOT, fora de pastas ocultas, backups e infraestrutura.');
      }
      const file = await open(target, 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new ApiError('file_too_large', 'Anexo precisa ser um arquivo de até 16 MiB.');
        // Read a bounded amount even if the file grows after stat().
        const buffer = Buffer.alloc(Number(stat.size) + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
          if (bytesRead === 0) break;
          total += bytesRead;
        }
        if (total !== stat.size) throw new ApiError('file_changed', 'O arquivo mudou durante a leitura; revise antes de enviar.');
        return { name: path.basename(target), data: buffer.subarray(0, total) };
      } finally { await file.close(); }
    },
    async save(data: string | Uint8Array, extension: string) {
      const root = await realpath(rootPath);
      const directory = path.join(root, 'exports', 'mcp');
      await mkdir(directory, { recursive: true });
      const resolved = await realpath(directory);
      if (!inside(root, resolved)) throw new ApiError('file_not_allowed', 'A pasta de exportação precisa permanecer dentro de AERO_MCP_FILES_ROOT.');
      const target = path.join(resolved, `${randomUUID()}.${extension}`);
      await writeFile(target, data, { flag: 'wx', mode: 0o600 });
      return target;
    },
  };
}
