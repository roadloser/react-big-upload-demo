import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

interface ChunkDto {
  hash: string;
  filename: string;
  fileHash: string;
  index: string;
  size: string;
}

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('chunk')
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body() chunkInfo: ChunkDto,
  ) {
    const { hash, filename, fileHash, index, size } = chunkInfo;
    return this.uploadService.handleChunk({
      chunk: file.buffer,
      hash,
      filename,
      fileHash,
      index: parseInt(index, 10),
      size: parseInt(size, 10),
    });
  }
}
