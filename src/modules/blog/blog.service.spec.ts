import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BlogPost } from './entities/blog-post.entity';
import { BlogService } from './blog.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { CloudinaryService } from '../../common/services/cloudinary.service';

/**
 * Smoke tests for BlogService — covers the surface the FE depends on:
 *   - create: XOR rule between authorUserId and guestAuthorName (only
 *     admins can publish under a guest byline)
 *   - findAllPublished: paginated PrimeNG-shaped response + filter shape
 *   - findBySlug: 404 hides an unpublished post (no existence leak)
 *   - findByIdForEdit: owner-or-admin gate on draft access
 *   - update: stamps publishedAt on first publish; purges replaced
 *     Cloudinary cover only AFTER the DB write
 *   - delete: 403 on cross-user, soft-delete + purge cover on owner
 *   - getSitemapXml: public-site host, one URL per translation with
 *     hreflang alternates, trimmed/deduped slugs, blog articles only
 */
describe('BlogService (smoke — not exhaustive)', () => {
  const me = 'me-user-id';
  const stranger = 'someone-else';

  let service: BlogService;

  // Build a row that quacks like a BlogPost (toJSON + helpers). Keeps
  // the test inline-typed and avoids touching production types.
  const makePost = (overrides: Record<string, unknown> = {}) => {
    const base = {
      id: 'p-1',
      slug: 'hello-world',
      title: 'Hello',
      excerpt: 'world',
      content: 'body',
      category: 'Tips',
      coverImage: null,
      authorUserId: me,
      guestAuthorName: null,
      readTime: 5,
      tags: null,
      language: 'en',
      isPublished: true,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      author: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        avatarUrl: 'https://cdn/x.jpg',
      },
      update: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    return {
      ...base,
      toJSON() {
        // Mirror Sequelize: a shallow clone the service mutates with delete.
        return { ...base };
      },
    };
  };

  const blogPostModel = {
    create: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
  };
  const cloudinaryService = {
    uploadImage: jest.fn(),
    deleteByUrl: jest.fn().mockResolvedValue(undefined),
  };
  // Keyed config: unknown keys (e.g. WEBSITE_DEPLOY_HOOK_URL) resolve to the
  // caller's fallback, so publish paths never fire a real rebuild fetch.
  const config: Record<string, string> = {
    FRONTEND_URL: 'https://app.motionhive.fit',
    PUBLIC_SITE_URL: 'https://www.motionhive.fit',
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost), useValue: blogPostModel },
        { provide: CloudinaryService, useValue: cloudinaryService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(BlogService);
  });

  // ─── Wiring ──────────────────────────────────────────────────────

  it('wires up via the Nest test module', () => {
    expect(service).toBeDefined();
  });

  // ─── create — XOR (registered vs guest byline) ───────────────────

  describe('create', () => {
    const dto = {
      title: 'Hello',
      slug: 'hello',
      excerpt: 'x',
      content: 'body',
      category: 'Tips',
      isPublished: true,
    };

    it('registered post: stamps authorUserId from the caller and publishedAt on publish', async () => {
      const created = makePost({ id: 'p-new', isPublished: true });
      blogPostModel.create.mockResolvedValueOnce(created);
      blogPostModel.findByPk.mockResolvedValueOnce(created);

      const out = await service.create(dto, me, {
        userId: me,
        roles: ['WRITER'],
      });

      const createArg = blogPostModel.create.mock.calls[0][0];
      expect(createArg).toMatchObject({
        title: 'Hello',
        slug: 'hello',
        authorUserId: me,
        guestAuthorName: null,
      });
      expect(createArg.publishedAt).toBeInstanceOf(Date);
      expect(out.id).toBe('p-new');
      // Byline computed from the joined author.
      expect(out.authorName).toBe('Ada Lovelace');
      expect(out.authorInitials).toBe('AL');
    });

    it('rejects a non-admin trying to publish under a guest byline', async () => {
      await expect(
        service.create({ ...dto, guestAuthorName: 'Sarah J.' }, me, {
          userId: me,
          roles: ['WRITER'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(blogPostModel.create).not.toHaveBeenCalled();
    });

    it('admin can publish a guest post: trims the byline, nulls authorUserId', async () => {
      const guestRow = makePost({
        id: 'p-guest',
        authorUserId: null,
        author: undefined,
        guestAuthorName: 'Sarah Johnson',
      });
      blogPostModel.create.mockResolvedValueOnce(guestRow);
      blogPostModel.findByPk.mockResolvedValueOnce(guestRow);

      const out = await service.create(
        { ...dto, guestAuthorName: '  Sarah Johnson  ' },
        me,
        { userId: me, roles: ['ADMIN'] },
      );

      expect(blogPostModel.create.mock.calls[0][0]).toMatchObject({
        guestAuthorName: 'Sarah Johnson',
        authorUserId: null,
      });
      expect(out.authorName).toBe('Sarah Johnson');
      expect(out.authorInitials).toBe('SJ');
      expect(out.authorAvatarUrl).toBeNull();
    });
  });

  // ─── findAllPublished — list shape + filter ──────────────────────

  describe('findAllPublished', () => {
    it('returns the PrimeNG-shaped paginated response and filters on isPublished', async () => {
      blogPostModel.findAndCountAll.mockResolvedValueOnce({
        rows: [makePost()],
        count: 1,
      });

      const out = await service.findAllPublished({
        page: 1,
        limit: 10,
        category: 'Tips',
        locale: 'en',
      });

      expect(out).toEqual(
        expect.objectContaining({ total: 1, page: 1, pageSize: 10 }),
      );
      expect(out.items).toHaveLength(1);
      const queryArg = blogPostModel.findAndCountAll.mock.calls[0][0];
      expect(queryArg.where).toEqual(
        expect.objectContaining({
          isPublished: true,
          language: 'en',
          category: 'Tips',
        }),
      );
    });
  });

  // ─── findBySlug — hides drafts ───────────────────────────────────

  describe('findBySlug', () => {
    it('404s when the slug exists only as a draft (filter is isPublished:true)', async () => {
      blogPostModel.findOne.mockResolvedValueOnce(null);
      await expect(service.findBySlug('not-yet-live')).rejects.toThrow(
        NotFoundException,
      );
      const queryArg = blogPostModel.findOne.mock.calls[0][0];
      expect(queryArg.where).toEqual(
        expect.objectContaining({
          slug: 'not-yet-live',
          language: 'en',
          isPublished: true,
        }),
      );
    });

    it('returns the public response on the happy path', async () => {
      blogPostModel.findOne.mockResolvedValueOnce(makePost());
      const out = await service.findBySlug('hello-world');
      expect(out.slug).toBe('hello-world');
      expect(out.authorName).toBe('Ada Lovelace');
    });
  });

  // ─── findByIdForEdit — owner-or-admin gate ───────────────────────

  describe('findByIdForEdit', () => {
    it('lets a WRITER reopen their own draft', async () => {
      blogPostModel.findByPk.mockResolvedValueOnce(
        makePost({ isPublished: false, publishedAt: null }),
      );
      const out = await service.findByIdForEdit('p-1', {
        userId: me,
        roles: ['WRITER'],
      });
      expect(out.id).toBe('p-1');
      expect(out.isPublished).toBe(false);
    });

    it("forbids a WRITER from opening someone else's draft", async () => {
      blogPostModel.findByPk.mockResolvedValueOnce(
        makePost({ authorUserId: stranger, isPublished: false }),
      );
      await expect(
        service.findByIdForEdit('p-1', { userId: me, roles: ['WRITER'] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("admin can open anyone's draft", async () => {
      blogPostModel.findByPk.mockResolvedValueOnce(
        makePost({ authorUserId: stranger, isPublished: false }),
      );
      const out = await service.findByIdForEdit('p-1', {
        userId: me,
        roles: ['ADMIN'],
      });
      expect(out.id).toBe('p-1');
    });
  });

  // ─── update — first-publish + cover purge ────────────────────────

  describe('update', () => {
    it('stamps publishedAt on first publish (was draft → published)', async () => {
      const draft = makePost({ isPublished: false, publishedAt: null });
      blogPostModel.findByPk.mockResolvedValueOnce(draft);
      // Reload after update.
      blogPostModel.findByPk.mockResolvedValueOnce(
        makePost({ isPublished: true }),
      );

      await service.update(
        'p-1',
        { isPublished: true },
        { userId: me, roles: ['WRITER'] },
      );

      const patch = draft.update.mock.calls[0][0];
      expect(patch.isPublished).toBe(true);
      expect(patch.publishedAt).toBeInstanceOf(Date);
    });

    it('purges the previous Cloudinary cover when coverImage is replaced', async () => {
      const post = makePost({ coverImage: 'https://cdn/old.jpg' });
      blogPostModel.findByPk.mockResolvedValueOnce(post);
      blogPostModel.findByPk.mockResolvedValueOnce(post);

      await service.update(
        'p-1',
        { coverImage: 'https://cdn/new.jpg' },
        { userId: me, roles: ['WRITER'] },
      );

      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith(
        'https://cdn/old.jpg',
      );
    });

    it("forbids a WRITER from editing another author's post", async () => {
      const someoneElses = makePost({ authorUserId: stranger });
      blogPostModel.findByPk.mockResolvedValueOnce(someoneElses);

      await expect(
        service.update(
          'p-1',
          { title: 'attempt' },
          { userId: me, roles: ['WRITER'] },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(someoneElses.update).not.toHaveBeenCalled();
    });

    it('refuses to clear an existing guestAuthorName via empty string', async () => {
      blogPostModel.findByPk.mockResolvedValueOnce(makePost());
      await expect(
        service.update(
          'p-1',
          { guestAuthorName: '   ' },
          { userId: me, roles: ['ADMIN'] },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── delete — owner-or-admin + cover purge ───────────────────────

  describe('delete', () => {
    it('soft-deletes an owned post and purges the cover', async () => {
      const post = makePost({ coverImage: 'https://cdn/old.jpg' });
      blogPostModel.findByPk.mockResolvedValueOnce(post);

      await service.delete('p-1', { userId: me, roles: ['WRITER'] });

      expect(post.destroy).toHaveBeenCalledTimes(1);
      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith(
        'https://cdn/old.jpg',
      );
    });

    it("forbids a WRITER from deleting someone else's post", async () => {
      const someoneElses = makePost({ authorUserId: stranger });
      blogPostModel.findByPk.mockResolvedValueOnce(someoneElses);

      await expect(
        service.delete('p-1', { userId: me, roles: ['WRITER'] }),
      ).rejects.toThrow(ForbiddenException);
      expect(someoneElses.destroy).not.toHaveBeenCalled();
      expect(cloudinaryService.deleteByUrl).not.toHaveBeenCalled();
    });
  });

  // ─── getSitemapXml — blog articles on the public site ───────────

  describe('getSitemapXml', () => {
    const row = (slug: string, language: string, updatedAt = '2026-07-13') => ({
      slug,
      language,
      updatedAt: new Date(`${updatedAt}T11:04:58Z`),
    });
    const locs = (xml: string) =>
      [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    const urlBlock = (xml: string, loc: string) =>
      xml.split('<url>').find((block) => block.includes(`<loc>${loc}</loc>`)) ??
      '';

    it('only asks the DB for published posts', async () => {
      blogPostModel.findAll.mockResolvedValueOnce([]);
      await service.getSitemapXml();
      expect(blogPostModel.findAll.mock.calls[0][0].where).toEqual({
        isPublished: true,
      });
    });

    it('builds URLs on PUBLIC_SITE_URL, never the app origin, and lists articles only', async () => {
      blogPostModel.findAll.mockResolvedValueOnce([row('hiit', 'en')]);
      const xml = await service.getSitemapXml();

      expect(locs(xml)).toEqual(['https://www.motionhive.fit/blog/hiit']);
      expect(xml).not.toContain('app.motionhive.fit');
      expect(xml).not.toMatch(/<loc>[^<]*\/(about|legal)/);
    });

    it('emits one distinct URL per translation, RO under /ro, with reciprocal hreflang', async () => {
      blogPostModel.findAll.mockResolvedValueOnce([
        row('hiit', 'en', '2026-07-13'),
        row('hiit', 'ro', '2026-05-10'),
      ]);
      const xml = await service.getSitemapXml();

      const en = 'https://www.motionhive.fit/blog/hiit';
      const ro = 'https://www.motionhive.fit/ro/blog/hiit';
      expect(locs(xml)).toEqual([en, ro]);
      expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
      for (const loc of [en, ro]) {
        const block = urlBlock(xml, loc);
        expect(block).toContain(`hreflang="en" href="${en}"`);
        expect(block).toContain(`hreflang="ro" href="${ro}"`);
        expect(block).toContain(`hreflang="x-default" href="${en}"`);
      }
      expect(urlBlock(xml, en)).toContain('<lastmod>2026-07-13</lastmod>');
      expect(urlBlock(xml, ro)).toContain('<lastmod>2026-05-10</lastmod>');
    });

    it('omits the RO URL and alternate when the post has no RO translation', async () => {
      blogPostModel.findAll.mockResolvedValueOnce([row('hiit', 'en')]);
      const xml = await service.getSitemapXml();

      expect(xml).not.toContain('/ro/');
      expect(xml).not.toContain('hreflang="ro"');
      expect(xml).toContain(
        'hreflang="x-default" href="https://www.motionhive.fit/blog/hiit"',
      );
    });

    it('trims a whitespace slug, pairs it with its translation and drops duplicates', async () => {
      blogPostModel.findAll.mockResolvedValueOnce([
        row(' why-gym', 'en', '2026-05-03'),
        row('why-gym', 'ro', '2026-05-10'),
        // Older row collapsing onto the same (slug, language) as the first.
        row('why-gym ', 'en', '2026-04-01'),
      ]);
      const xml = await service.getSitemapXml();

      const all = locs(xml);
      expect(all).toEqual([
        'https://www.motionhive.fit/blog/why-gym',
        'https://www.motionhive.fit/ro/blog/why-gym',
      ]);
      expect(new Set(all).size).toBe(all.length);
      expect(all.some((loc) => /\s|%20/.test(loc))).toBe(false);
      // Newest row wins the lastmod.
      expect(
        urlBlock(xml, 'https://www.motionhive.fit/blog/why-gym'),
      ).toContain('<lastmod>2026-05-03</lastmod>');
    });

    it('skips and logs posts whose slug is empty or not a single path segment', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      blogPostModel.findAll.mockResolvedValueOnce([
        row('   ', 'en'),
        row('two words', 'en'),
        row('a/b', 'en'),
        row('ok', 'en'),
      ]);
      const xml = await service.getSitemapXml();

      expect(locs(xml)).toEqual(['https://www.motionhive.fit/blog/ok']);
      expect(warn).toHaveBeenCalledTimes(3);
      warn.mockRestore();
    });
  });
});

describe('CreateBlogPostDto slug', () => {
  const base = {
    title: 'Hello',
    excerpt: 'x',
    content: 'body',
    category: 'Tips',
  };

  it('trims surrounding whitespace before validation', async () => {
    const dto = plainToInstance(CreateBlogPostDto, {
      ...base,
      slug: '  why-you-should-go-to-the-gym ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.slug).toBe('why-you-should-go-to-the-gym');
  });

  it('rejects a whitespace-only slug', async () => {
    const dto = plainToInstance(CreateBlogPostDto, { ...base, slug: '   ' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('slug');
  });

  it('trims on update too (inherited through PartialType)', () => {
    const dto = plainToInstance(UpdateBlogPostDto, { slug: ' hiit ' });
    expect(dto.slug).toBe('hiit');
  });
});
