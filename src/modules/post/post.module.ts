import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Post } from './entities/post.entity';
import { PostAudience } from './entities/post-audience.entity';
import { PostComment } from './entities/post-comment.entity';
import { PostReaction } from './entities/post-reaction.entity';
import { Group } from '../group/entities/group.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Post,
      PostAudience,
      PostComment,
      PostReaction,
      Group,
      GroupMember,
    ]),
    SearchModule,
  ],
  controllers: [PostController],
  providers: [PostService, CloudinaryService],
  exports: [PostService],
})
export class PostModule {}
