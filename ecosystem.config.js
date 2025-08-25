module.exports = {
  apps: [
    {
      name: "battle-server",
      script: "/root/battle-system/packages/battle-server/index.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3001
      }
    }
  ]
};
