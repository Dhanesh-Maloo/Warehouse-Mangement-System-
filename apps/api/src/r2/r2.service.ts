import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

@Injectable()
export class R2Service {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const endpoint = config.getOrThrow<string>('AWS_ENDPOINT_URL');
    this.bucket = config.getOrThrow<string>('S3_BUCKET');

    this.s3 = new S3Client({
      endpoint,
      region: config.get<string>('AWS_REGION', 'auto'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
      // LocalStack requires path-style; R2 uses virtual-hosted style
      forcePathStyle: endpoint.includes('localhost') || endpoint.includes('127.0.0.1'),
    });
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new InternalServerErrorException(`Empty body for key: ${key}`);
    }
    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
