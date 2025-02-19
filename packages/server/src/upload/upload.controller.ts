import {
  Controller,
  Post,
  Get,
  UploadedFile,
  UseInterceptors,
  Body,
  Res,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

interface ChunkDto {
  hash: string;
  filename: string;
  fileHash: string;
  index: string;
  size: string;
  totalSize: string;
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
    console.log('控制器接收到分片上传请求：', {
      filename: chunkInfo.filename,
      fileHash: chunkInfo.fileHash,
      index: chunkInfo.index,
      size: chunkInfo.size,
      totalSize: chunkInfo.totalSize,
      chunkSize: file?.buffer?.length,
      timestamp: new Date().toISOString()
    });
    const { hash, filename, fileHash, index, size, totalSize } = chunkInfo;
    return this.uploadService.handleChunk({
      chunk: file.buffer,
      hash,
      filename,
      fileHash,
      index: parseInt(index, 10),
      size: parseInt(size, 10),
      totalSize: parseInt(totalSize, 10),
    });
  }

  @Get('files')
  async getUploadedFiles() {
    return this.uploadService.getUploadedFiles();
  }

  @Get('download/:filename')
  async downloadFile(@Param('filename') filename: string, @Res() res: any) {
    const files = await this.uploadService.getUploadedFiles();
    const file = files.find(f => f.filename === filename);
    
    if (!file) {
      res.status(404).send('文件不存在');
      return;
    }

    res.download(file.path);
  }
}
