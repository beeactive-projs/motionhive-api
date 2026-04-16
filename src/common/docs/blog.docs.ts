import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const BlogDocs = {
  // -- Public --

  listPublished: {
    summary: 'List published blog posts',
    description:
      'Returns paginated published blog posts. No authentication required. ' +
      'Supports filtering by category (?category=Tips) and search by title, excerpt, or author name (?search=yoga). ' +
      'Ordered by publishedAt descending. Note: content field is excluded from list — use getBySlug for full content.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Blog posts retrieved',
        example: {
          items: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              slug: '5-daily-habits-fitness-routine',
              title: '5 Daily Habits That Will Transform Your Fitness Routine',
              excerpt: 'Small, consistent habits compound over time...',
              category: 'Tips',
              coverImage: 'https://res.cloudinary.com/...',
              authorName: 'Sarah Johnson',
              authorInitials: 'SJ',
              authorRole: 'Certified Trainer',
              readTime: 5,
              tags: ['habits', 'routine', 'wellness'],
              publishedAt: '2026-02-15T10:00:00.000Z',
            },
          ],
          total: 6,
          page: 1,
          pageSize: 10,
        },
      },
    ],
  } as ApiEndpointOptions,

  getCategories: {
    summary: 'List blog categories',
    description:
      'Returns distinct categories from published blog posts, sorted alphabetically. ' +
      'No authentication required.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Categories retrieved',
        example: ['Coaching', 'Fitness', 'Nutrition', 'Tips', 'Wellness'],
      },
    ],
  } as ApiEndpointOptions,

  getBySlug: {
    summary: 'Get blog post by slug',
    description:
      'Returns a single published blog post by its URL slug. No authentication required.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Blog post retrieved',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          slug: '5-daily-habits-fitness-routine',
          title: '5 Daily Habits That Will Transform Your Fitness Routine',
          excerpt: 'Small, consistent habits compound over time...',
          content: '<h2>Introduction</h2><p>Small, consistent habits...</p>',
          category: 'Tips',
          coverImage: 'https://res.cloudinary.com/...',
          authorName: 'Sarah Johnson',
          authorInitials: 'SJ',
          authorRole: 'Certified Trainer',
          readTime: 5,
          tags: ['habits', 'routine', 'wellness'],
          publishedAt: '2026-02-15T10:00:00.000Z',
        },
      },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // -- Authoring (ADMIN, SUPER_ADMIN, WRITER) --

  listForAdmin: {
    summary: 'List posts for authoring (drafts + published)',
    description:
      'Returns posts including drafts. WRITER sees only their own posts; ' +
      'ADMIN and SUPER_ADMIN see every post. Requires WRITER, ADMIN, or SUPER_ADMIN.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Posts retrieved',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getForEdit: {
    summary: 'Get a post for editing (any status)',
    description:
      'Returns a post by id regardless of published state. Only the author ' +
      'of the post or an ADMIN/SUPER_ADMIN may load it. Used by the writer UI ' +
      'to reopen drafts. Requires WRITER, ADMIN, or SUPER_ADMIN.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Post retrieved',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  create: {
    summary: 'Create a blog post',
    description:
      'Create a new blog post. The author is automatically set to the ' +
      'authenticated user. Requires WRITER, ADMIN, or SUPER_ADMIN.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Blog post created',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Update a blog post',
    description:
      'Update an existing blog post. A WRITER can only update their own posts; ' +
      'ADMIN and SUPER_ADMIN can update any post. Legacy posts without an ' +
      'author are editable only by ADMIN/SUPER_ADMIN.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Blog post updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  delete: {
    summary: 'Delete a blog post',
    description:
      'Soft-delete a blog post. A WRITER can only delete their own posts; ' +
      'ADMIN and SUPER_ADMIN can delete any post.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Blog post deleted',
        example: { message: 'Blog post deleted successfully' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  uploadImage: {
    summary: 'Upload an image to Cloudinary',
    description:
      'Upload an image for use in blog posts (cover image or inline). ' +
      'Returns the Cloudinary URL. Requires WRITER, ADMIN, or SUPER_ADMIN.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Image uploaded',
        example: {
          url: 'https://res.cloudinary.com/dom4dfr1q/image/upload/...',
          publicId: 'motionhive/blog/abc123',
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,
};
