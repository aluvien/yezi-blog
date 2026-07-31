// PM2 进程管理配置：pm2 start ecosystem.config.js
// 首次部署先在项目目录执行 npm ci && npm run build
module.exports = {
  apps: [
    {
      name: "aluvien-blog",
      script: "scripts/start-standalone.mjs",
      args: "",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
