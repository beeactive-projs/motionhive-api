# Database Migrations

Complete database schema for BeeActive API.

## Migration Files

| File | Description |
|------|-------------|
| `000_drop_existing_schema.sql` | Drops all existing tables (clean slate) |
| `001_create_core_tables.sql` | User, Role, Permission, Auth tables |
| `002_create_group_tables.sql` | Group, Group Member tables |
| `003_create_session_tables.sql` | Session, Session Participant, Invitation tables |
| `004_create_profile_tables.sql` | Instructor & User profiles |
| `005_seed_roles_permissions.sql` | Initial roles & permissions data |
| `006_create_super_admin.sql` | Super admin account |
| `007_create_client_tables.sql` | Instructor-Client relationship tables |

## Quick Start

### Option 1: Run All Migrations

**Linux/Mac:**
```bash
cd migrations
./RUN_MIGRATIONS.sh
```

**Windows:**
```cmd
cd migrations
RUN_MIGRATIONS.bat
```

**With custom credentials:**
```bash
./RUN_MIGRATIONS.sh beeactive root your_password localhost
```

### Option 2: Manual Execution

```bash
cd migrations

# 1. Drop existing schema
mysql -u root -p beeactive < 000_drop_existing_schema.sql

# 2. Create tables
mysql -u root -p beeactive < 001_create_core_tables.sql
mysql -u root -p beeactive < 002_create_group_tables.sql
mysql -u root -p beeactive < 003_create_session_tables.sql
mysql -u root -p beeactive < 004_create_profile_tables.sql

# 3. Seed data
mysql -u root -p beeactive < 005_seed_roles_permissions.sql
mysql -u root -p beeactive < 006_create_super_admin.sql
mysql -u root -p beeactive < 007_create_client_tables.sql
```

### Option 3: Railway Production

```bash
# Connect to Railway MySQL
railway connect mysql

# Run migrations (paste each file content)
SOURCE /path/to/migrations/000_drop_existing_schema.sql;
SOURCE /path/to/migrations/001_create_core_tables.sql;
# ... etc
```

## Database Schema Overview

### Core Tables (001)
- **user** - User accounts with security features
- **role** - User roles (SUPER_ADMIN, ADMIN, SUPPORT, INSTRUCTOR, USER)
- **permission** - Granular permissions
- **user_role** - User-to-role assignments
- **role_permission** - Role-to-permission assignments
- **refresh_token** - JWT refresh tokens (hashed)
- **social_account** - OAuth social login

### Group Tables (002)
- **group** - Instructor-owned fitness groups
- **group_member** - Group membership with health data sharing consent

### Session Tables (003)
- **session** - Training sessions with visibility (PUBLIC, GROUP, CLIENTS, PRIVATE)
- **session_participant** - Session registrations
- **invitation** - Group invitations

### Profile Tables (004)
- **instructor_profile** - Instructor profiles (bio, specializations, certifications)
- _(`user_profile` was dropped in migration 027 — personal info now lives directly on the `user` table: firstName, lastName, phone, countryCode, city, avatar)_

### Client Tables (007)
- **instructor_client** - Instructor-client relationships
- **client_request** - Client relationship requests

## Roles & Permissions

### Roles Hierarchy (by level)

1. **SUPER_ADMIN** (level 1) - Full platform access
2. **ADMIN** (level 2) - Platform administration
3. **SUPPORT** (level 3) - Read-only customer support
5. **INSTRUCTOR** (level 5) - Create & manage groups, sessions, clients
10. **USER** (level 10) - Join sessions, manage own profile

### Permission Structure

Permissions follow the format: `resource.action`

**Resources:** user, session, group, invitation, feature, subscription

**Actions:** create, read, update, delete, manage (full control)

## Data Relationships

```
user
 ├─> user_role ─> role ─> role_permission ─> permission
 ├─> group_member ─> group
 ├─> session ─> session_participant
 ├─> invitation
 ├─> refresh_token
 ├─> social_account
 ├─> instructor_profile
 ├─> instructor_client (as instructor)
 └─> instructor_client (as client)
```

## Troubleshooting

### Error: "Access denied"
Check your MySQL username and password

### Error: "Database doesn't exist"
Create database first: `CREATE DATABASE beeactive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`

### Error: "Foreign key constraint fails"
Run migrations in order (000 → 007)

### Error: "Table already exists"
Run `000_drop_existing_schema.sql` first
