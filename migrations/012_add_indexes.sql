-- Sprint 5: Database Indexes for Performance
-- Adds indexes to frequently queried columns across all tables

-- User
CREATE INDEX IF NOT EXISTS idx_user_email ON "user" (email);
CREATE INDEX IF NOT EXISTS idx_user_is_active ON "user" (is_active);

-- Group
CREATE INDEX IF NOT EXISTS idx_group_instructor_id ON "group" (instructor_id);
CREATE INDEX IF NOT EXISTS idx_group_is_public ON "group" (is_public);
CREATE INDEX IF NOT EXISTS idx_group_slug ON "group" (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_slug_unique ON "group" (slug) WHERE deleted_at IS NULL;

-- Group Member
CREATE INDEX IF NOT EXISTS idx_group_member_group_id ON group_member (group_id);
CREATE INDEX IF NOT EXISTS idx_group_member_user_id ON group_member (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_member_unique ON group_member (group_id, user_id) WHERE left_at IS NULL;

-- Session
CREATE INDEX IF NOT EXISTS idx_session_instructor_id ON session (instructor_id);
CREATE INDEX IF NOT EXISTS idx_session_group_id ON session (group_id);
CREATE INDEX IF NOT EXISTS idx_session_scheduled_at ON session (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_session_status ON session (status);
CREATE INDEX IF NOT EXISTS idx_session_visibility_status ON session (visibility, status, scheduled_at);

-- Session Participant
CREATE INDEX IF NOT EXISTS idx_session_participant_session_id ON session_participant (session_id);
CREATE INDEX IF NOT EXISTS idx_session_participant_user_id ON session_participant (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_participant_unique ON session_participant (session_id, user_id);

-- Instructor Client
CREATE INDEX IF NOT EXISTS idx_instructor_client_instructor_id ON instructor_client (instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_client_client_id ON instructor_client (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instructor_client_unique ON instructor_client (instructor_id, client_id) WHERE status = 'ACTIVE';

-- Client Request
CREATE INDEX IF NOT EXISTS idx_client_request_from ON client_request (from_user_id);
CREATE INDEX IF NOT EXISTS idx_client_request_to ON client_request (to_user_id);
CREATE INDEX IF NOT EXISTS idx_client_request_status ON client_request (status);
CREATE INDEX IF NOT EXISTS idx_client_request_invited_email ON client_request (invited_email);

-- Invitation
CREATE INDEX IF NOT EXISTS idx_invitation_token ON invitation (token);
CREATE INDEX IF NOT EXISTS idx_invitation_group_id ON invitation (group_id);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON invitation (email);

-- Refresh Token
CREATE INDEX IF NOT EXISTS idx_refresh_token_user_id ON refresh_token (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_token (token_hash);

-- Social Account
CREATE INDEX IF NOT EXISTS idx_social_account_user_id ON social_account (user_id);
CREATE INDEX IF NOT EXISTS idx_social_account_provider ON social_account (provider, provider_user_id);

-- User Role
CREATE INDEX IF NOT EXISTS idx_user_role_user_id ON user_role (user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_role_id ON user_role (role_id);

-- Blog Post
CREATE INDEX IF NOT EXISTS idx_blog_post_status ON blog_post (status);
CREATE INDEX IF NOT EXISTS idx_blog_post_slug ON blog_post (slug);
CREATE INDEX IF NOT EXISTS idx_blog_post_author_id ON blog_post (author_id);
