import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ProcessDocumentDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file: Express.Multer.File;

  @ApiProperty({ type: 'string', description: 'Prompt for processing document' })
  @IsString()
  @IsNotEmpty()
  prompt: string;
}
