import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service.js';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_CONTENT_TYPES,
} from '../../../libs/storage/src/storage.js';
import {
  ApiConsumes,
  ApiPayloadTooLargeResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ProcessDocumentDto } from './dto/processDocument.dto.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiUnsupportedMediaTypeResponse({ description: 'Unsupported media type' })
  @ApiPayloadTooLargeResponse({ description: 'Payload too large' })
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async processDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ProcessDocumentDto,
  ) {
    if (!file || !ALLOWED_CONTENT_TYPES.includes(file.mimetype as never)) {
      throw new UnsupportedMediaTypeException();
    }
    return {
      documentId: await this.appService.processDocument({
        file,
        prompt: dto.prompt,
      }),
    };
  }
}
