import { Controller, Post, UseInterceptors, UploadedFile, UploadedFiles, UseGuards } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

const storage = diskStorage({
  destination: join(__dirname, '..', '..', 'uploads'),
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

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
}
