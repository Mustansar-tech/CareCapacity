/**
 * PM2 ecosystem config — Care Capacity (Hetzner production)
 *
 * Usage:
 *   pm2 startOrRestart ecosystem.config.cjs --update-env
 *   pm2 save
 *
 * Both processes must be built first:
 *   npm run build
 */

module.exports = {
  apps: [
    {
      name: "care-capacity-api",
      script: "dist/index.js",
      cwd: "/root/CareCapacity",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: "5000",
      },
      // Restart the process if memory exceeds 1 GB (Express + session store).
      max_memory_restart: "1G",
      autorestart: true,
      restart_delay: 5000,
      // Keep the last 14 days of logs (requires pm2-logrotate).
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "care-capacity-worker",
      script: "dist/worker.js",
      cwd: "/root/CareCapacity",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      // Allow more memory for Playwright / Chromium (browser + 6 contexts).
      max_memory_restart: "2G",
      autorestart: true,
      restart_delay: 10000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
