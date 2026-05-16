import { spawn, spawnSync } from 'node:child_process';

const check = spawnSync('cloudflared', ['--version'], {
  stdio: 'ignore',
  shell: true,
});

if (check.status !== 0) {
  console.error('未检测到 cloudflared。');
  console.error('');
  console.error('macOS 推荐安装方式：');
  console.error('  brew install cloudflared');
  console.error('');
  console.error('安装后先运行：');
  console.error('  npm run dev');
  console.error('');
  console.error('再另开一个终端运行：');
  console.error('  npm run share');
  process.exit(1);
}

console.log('正在创建 Cloudflare Quick Tunnel...');
console.log('请保持前端、本地 API 和本脚本运行。');

const tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:5175'], {
  stdio: 'inherit',
});

tunnel.on('exit', (code) => {
  process.exitCode = code || 0;
});
