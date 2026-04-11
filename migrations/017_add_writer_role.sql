-- =========================================================
-- Migration 017: Add WRITER role
-- =========================================================
-- Adds a WRITER role for users who can author blog posts
-- but have no access to platform administration.
-- Level 4 — between SUPPORT (3) and INSTRUCTOR (5).
-- =========================================================

-- --------------------------------------------------------
-- Insert WRITER role
-- --------------------------------------------------------
INSERT INTO role (id, name, display_name, description, level, is_system_role, created_at, updated_at) VALUES
('a1b2c3d4-006c-11f1-b74f-0242ac110002', 'WRITER', 'Content Writer', 'Can create, edit, and delete blog posts', 4, TRUE, NOW(), NOW());

-- --------------------------------------------------------
-- Insert blog permissions
-- --------------------------------------------------------
INSERT INTO permission (id, name, display_name, description, resource, action, created_at) VALUES
('b1000001-006c-11f1-b74f-0242ac110002', 'blog.create', 'Create Blog Posts', 'Can create new blog posts', 'blog', 'create', NOW()),
('b1000002-006c-11f1-b74f-0242ac110002', 'blog.update', 'Update Blog Posts', 'Can edit existing blog posts', 'blog', 'update', NOW()),
('b1000003-006c-11f1-b74f-0242ac110002', 'blog.delete', 'Delete Blog Posts', 'Can delete blog posts', 'blog', 'delete', NOW());

-- --------------------------------------------------------
-- Assign all blog permissions to SUPER_ADMIN
-- --------------------------------------------------------
INSERT INTO role_permission (id, role_id, permission_id, created_at) VALUES
(gen_random_uuid()::TEXT, '7261bd94-006c-11f1-b74f-0242ac110002', 'b1000001-006c-11f1-b74f-0242ac110002', NOW()), -- blog.create
(gen_random_uuid()::TEXT, '7261bd94-006c-11f1-b74f-0242ac110002', 'b1000002-006c-11f1-b74f-0242ac110002', NOW()), -- blog.update
(gen_random_uuid()::TEXT, '7261bd94-006c-11f1-b74f-0242ac110002', 'b1000003-006c-11f1-b74f-0242ac110002', NOW()); -- blog.delete

-- --------------------------------------------------------
-- Assign all blog permissions to ADMIN
-- --------------------------------------------------------
INSERT INTO role_permission (id, role_id, permission_id, created_at) VALUES
(gen_random_uuid()::TEXT, '7261d03c-006c-11f1-b74f-0242ac110002', 'b1000001-006c-11f1-b74f-0242ac110002', NOW()), -- blog.create
(gen_random_uuid()::TEXT, '7261d03c-006c-11f1-b74f-0242ac110002', 'b1000002-006c-11f1-b74f-0242ac110002', NOW()), -- blog.update
(gen_random_uuid()::TEXT, '7261d03c-006c-11f1-b74f-0242ac110002', 'b1000003-006c-11f1-b74f-0242ac110002', NOW()); -- blog.delete

-- --------------------------------------------------------
-- Assign blog permissions to WRITER
-- --------------------------------------------------------
INSERT INTO role_permission (id, role_id, permission_id, created_at) VALUES
(gen_random_uuid()::TEXT, 'a1b2c3d4-006c-11f1-b74f-0242ac110002', 'b1000001-006c-11f1-b74f-0242ac110002', NOW()), -- blog.create
(gen_random_uuid()::TEXT, 'a1b2c3d4-006c-11f1-b74f-0242ac110002', 'b1000002-006c-11f1-b74f-0242ac110002', NOW()), -- blog.update
(gen_random_uuid()::TEXT, 'a1b2c3d4-006c-11f1-b74f-0242ac110002', 'b1000003-006c-11f1-b74f-0242ac110002', NOW()); -- blog.delete

-- =========================================================
-- WRITER role seeded successfully
-- =========================================================
