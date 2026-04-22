import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  constructor(private configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.configured = true;
    }
  }

  async uploadImage(
    file: Express.Multer.File,
    folder = 'blog',
  ): Promise<{ url: string; publicId: string }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!this.configured) {
      throw new InternalServerErrorException(
        'Cloudinary is not configured. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }

    let result: UploadApiResponse;
    try {
      result = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: `motionhive/${folder}`,
              resource_type: 'image',
              transformation: [{ quality: 'auto', fetch_format: 'auto' }],
            },
            (error, uploadResult) => {
              if (error) return reject(error);
              resolve(uploadResult!);
            },
          )
          .end(file.buffer);
      });
    } catch (error: unknown) {
      // Cloudinary SDK rejects with a plain object (`{ message, http_code,
      // name }`) rather than an Error instance, so `instanceof Error`
      // alone drops the real message on the floor. Narrow via a type
      // guard on the `message` property so we surface whatever the SDK
      // actually said (e.g. "Invalid image file", "cloud_name required",
      // "api_key mismatch", ...).
      let message = 'Unknown Cloudinary error';
      if (error instanceof Error) {
        message = error.message;
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
      ) {
        message = (error as { message: string }).message;
      }
      // Log the full error object (not PII) so we can see http_code,
      // name, etc. in Railway logs when "message" alone isn't enough.
      this.logger.error(
        `Cloudinary upload failed: ${message}`,
        JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
      );
      throw new InternalServerErrorException(`Image upload failed: ${message}`);
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  }

  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
