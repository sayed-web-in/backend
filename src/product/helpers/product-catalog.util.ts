import { unlink } from 'fs/promises';
import { join } from 'path';
import { Prisma } from '@prisma/client';

  export const webStoreProductWhere: Prisma.StoreProductWhereInput = {
    isActive: true,
    sellingType: { in: ['ONLINE', 'BOTH'] },
  };

  export function toUploadsFsPath(url?: string | null): string | null {
    if (!url) return null;
    let pathPart = url.trim();
    if (!pathPart) return null;

    if (/^https?:\/\//i.test(pathPart)) {
      try {
        const parsed = new URL(pathPart);
        pathPart = parsed.pathname || '';
      } catch {
        return null;
      }
    }

    if (!pathPart.startsWith('/uploads/')) return null;

    const decoded = decodeURIComponent(pathPart).replace(/\\/g, '/');
    const relative = decoded.replace(/^\/+/, '');
    if (relative.includes('..')) return null;

    return join(process.cwd(), relative);
  }

  export async function deleteUploadFiles(urls: (string | null | undefined)[]) {
    const paths = [...new Set(urls.map((u) => toUploadsFsPath(u)).filter(Boolean) as string[])];
    await Promise.all(
      paths.map(async (p) => {
        try {
          await unlink(p);
        } catch {
          // Best-effort cleanup; ignore missing/locked files.
        }
      }),
    );
  }

  export function generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  export function generateSku(prefix: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }

  export function generateBarcode(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `BAR-${ts}-${rand}`;
  }