import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  AppService,
  RunNotDoneError,
  RunNotFoundError,
} from './app.service.js';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_CONTENT_TYPES,
} from '../../../libs/storage/src/storage.js';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
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
  @ApiAcceptedResponse({ description: 'Run queued for processing' })
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
    return this.appService.processDocument({ file, prompt: dto.prompt });
  }

  // Declared before :runId, which would otherwise match "all".
  @Get('all')
  @ApiOkResponse({ description: 'Every run with its document, newest first' })
  listDocuments() {
    return this.appService.listDocuments();
  }

  @Get(':runId')
  @ApiOkResponse({ description: 'Run found and done' })
  @ApiBadRequestResponse({ description: 'runId is not a UUID' })
  @ApiNotFoundResponse({ description: 'Run not found' })
  @ApiConflictResponse({ description: 'Run is not done yet, or failed' })
  async getDocumentResult(@Param('runId', ParseUUIDPipe) runId: string) {
    try {
      return await this.appService.getDocumentResult(runId);
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof RunNotDoneError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
