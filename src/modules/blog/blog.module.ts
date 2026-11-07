import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BlogPost } from './entities/blog-post.entity';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [SequelizeModule.forFeature([BlogPost]), RoleModule],
  controllers: [BlogController],
  providers: [BlogService, MediaStorageService],
  exports: [BlogService],
})
export class BlogModule {}
