module.exports = {
  apps: [
    {
      name: "battle-server",
      cwd: "./packages/battle-server",
      script: "index.js",        // ESM
      node_args: [],             // 필요시 ["--trace-warnings"]
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3001",
        PUBLIC_BASE_URL: "http://65.21.147.119:3001"
      }
    }
  ]
};
