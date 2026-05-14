import {
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
import { mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { UploadService } from './upload.service.js';

const storage = diskStorage({
  destination: join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const memory = memoryStorage();
const bannerStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const bannerDir = join(process.cwd(), 'uploads', 'banner');
    mkdirSync(bannerDir, { recursive: true });
    cb(null, bannerDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname) || '.bin'}`;
    cb(null, uniqueName);
  },
});

const logoStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const logoDir = join(process.cwd(), 'uploads', 'logo');
    mkdirSync(logoDir, { recursive: true });
    cb(null, logoDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname) || '.bin'}`;
    cb(null, uniqueName);
  },
});

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('single')
  @UseInterceptors(FileInterceptor('file', { storage }))
  uploadSingle(@UploadedFile() file: Express.Multer.File) {
    return { url: `/uploads/${file.filename}`, filename: file.filename };
  }

  /** Storefront header logo → `uploads/logo/` on disk, public URL `/uploads/logo/...`. */
  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: logoStorage,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    return { url: `/uploads/logo/${file.filename}`, filename: file.filename };
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    return files.map((f) => ({
      url: `/uploads/${f.filename}`,
      filename: f.filename,
    }));
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
    return this.uploadService.uploadOptimizedImage(file, { subDir: 'product' });
  }

  /**
   * Banner images: optimized and saved inside uploads/banner.
   */
  @Post('banner-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: bannerStorage,
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  async uploadBannerImage(@UploadedFile() file: Express.Multer.File) {
    return { data: { url: `/uploads/banner/${file.filename}` } };
  }
}
