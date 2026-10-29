import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Post } from './entities/post.entity';
import { PostComment } from './entities/post-comment.entity';
import { PostReaction } from './entities/post-reaction.entity';
import { Group } from '../group/entities/group.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { User } from '../user/entities/user.entity';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { SearchModule } from '../search/search.module';
import { GroupModule } from '../group/group.module';
import { WorkoutModule } from '../workout/workout.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Post,
      PostComment,
      PostReaction,
      Group,
      GroupMember,
      User,
    ]),
    SearchModule,
    GroupModule,
    // A post can carry a shared workout; the cards come from there.
    WorkoutModule,
  ],
  controllers: [PostController],
  providers: [PostService, CloudinaryService],
  exports: [PostService],
})
export class PostModule {}
