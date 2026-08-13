// PM2 进程管理配置：pm2 start ecosystem.config.js
// 首次部署先在项目目录执行 npm ci && npm run build
module.exports = {
  apps: [
    {
      name: "yezi-blog",
      script: "scripts/start-standalone.mjs",
      args: "",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      // 给 Next standalone 的优雅退出和 after() 任务留出时间。
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        PORT: 3030,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
