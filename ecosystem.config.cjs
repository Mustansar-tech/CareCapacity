module.exports = {
  apps: [
    {
      name: "care-capacity-api",
      script: "dist/index.js",
      cwd: "/root/CareCapacity",
      interpreter: "node",
      node_args: "-r dotenv/config",
      env: {
        NODE_ENV: "production",
        PORT: "5000"
      },
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "5G"
    },
    {
      name: "care-capacity-worker",
      script: "dist/worker.js",
      cwd: "/root/CareCapacity",
      interpreter: "node",
      node_args: "-r dotenv/config",
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      restart_delay: 10000,
      max_memory_restart: "2G"
    }
  ]
};
