import { BadRequestException, Injectable } from '@nestjs/common';
import { extname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

interface UploadImageOptions {
  subDir?: string;
  maxEdge?: number;
  quality?: number;
}

@Injectable()
export class UploadService {
  async uploadOptimizedImage(
    file: Express.Multer.File,
    options: UploadImageOptions = {},
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }

    const uploadsRoot = join(process.cwd(), 'uploads');
    const targetDir = options.subDir
      ? join(uploadsRoot, options.subDir)
      : uploadsRoot;
    await mkdir(targetDir, { recursive: true });

    const maxEdge = options.maxEdge ?? 1920;
    const quality = options.quality ?? 82;
    const webpName = `${uuidv4()}.webp`;
    const webpPath = join(targetDir, webpName);
    const publicPrefix = options.subDir
      ? `/uploads/${options.subDir}`
      : '/uploads';

    try {
      await sharp(file.buffer)
        .rotate()
        .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(webpPath);

      return { data: { url: `${publicPrefix}/${webpName}` } };
    } catch {
      const fallbackName = `${uuidv4()}${extname(file.originalname) || '.bin'}`;
      const fallbackPath = join(targetDir, fallbackName);
      await writeFile(fallbackPath, file.buffer);
      return { data: { url: `${publicPrefix}/${fallbackName}` } };
    }
  }
}
