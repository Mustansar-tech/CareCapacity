import { storage } from '../../storage';
import { supabaseAdmin } from '../../infrastructure/supabase';
import { logger } from '../../infrastructure/logger';

/**
 * One-time startup migration: any user that exists in our local `users` table
 * but not yet in Supabase Auth is created in Supabase using their existing
 * bcrypt passwordHash.  Because we cannot recover the plaintext we use
 * Supabase's `createUser` with no password — instead we set a random secure
 * password.  Admins can reset passwords via the admin panel which calls the
 * Supabase Admin API.
 *
 * For the bootstrapped admin user, ADMIN_PASSWORD is used so the first login
 * works immediately without a reset.
 */
export async function migrateUsersToSupabase(): Promise<void> {
  try {
    const localUsers = await storage.getAllUsers();
    if (localUsers.length === 0) return;

    const { data: supaList, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (listError) {
      logger.error('migrateUsersToSupabase: could not list Supabase users', listError);
      return;
    }

    const supaEmails = new Set((supaList?.users ?? []).map(u => u.email?.toLowerCase()));
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;

    let migrated = 0;
    for (const user of localUsers) {
      const email = user.email.toLowerCase();
      if (supaEmails.has(email)) continue;

      const isAdmin = email === adminEmail;
      const password = isAdmin && adminPassword
        ? adminPassword
        : generateSecurePassword();

      const { error } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: { displayName: user.displayName, role: user.role },
      });

      if (error) {
        logger.warn(`migrateUsersToSupabase: failed for ${user.email}`, { message: error.message });
      } else {
        migrated++;
        logger.info(`migrateUsersToSupabase: migrated ${user.email}${isAdmin ? ' (admin — using ADMIN_PASSWORD)' : ' (random password — reset required)'}`);
      }
    }

    if (migrated > 0) {
      logger.info(`migrateUsersToSupabase: ${migrated}/${localUsers.length} users migrated to Supabase Auth`);
    } else {
      logger.info('migrateUsersToSupabase: all users already in Supabase Auth');
    }
  } catch (err) {
    logger.error('migrateUsersToSupabase: unexpected error', err);
  }
}

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
