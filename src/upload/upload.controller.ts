import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

const storage = diskStorage({
  destination: join(__dirname, '..', '..', 'uploads'),
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const memory = memoryStorage();

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  @Post('single')
  @UseInterceptors(FileInterceptor('file', { storage }))
  uploadSingle(@UploadedFile() file: Express.Multer.File) {
    return { url: `/uploads/${file.filename}`, filename: file.filename };
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    return files.map((f) => ({ url: `/uploads/${f.filename}`, filename: f.filename }));
  }

  /**
   * Product / variant images: resize (max edge 1920), convert to WebP (seller-admin compatible shape).
   */
  @Post('product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memory,
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  async uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    const uploadsDir = join(__dirname, '..', '..', 'uploads');
    const webpName = `${uuidv4()}.webp`;
    const outWebp = join(uploadsDir, webpName);
    try {
      await sharp(file.buffer)
        .rotate()
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(outWebp);
      return { data: { url: `/uploads/${webpName}` } };
    } catch {
      const fallback = `${uuidv4()}${extname(file.originalname) || '.bin'}`;
      const outFallback = join(uploadsDir, fallback);
      await writeFile(outFallback, file.buffer);
      return { data: { url: `/uploads/${fallback}` } };
    }
  }
}
