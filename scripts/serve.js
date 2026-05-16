import { spawnSync } from 'node:child_process';
import { killPorts, shutdownProcesses, startProcess } from './process-utils.js';

function runStep(label, command, args) {
  console.log(`\n${label}...`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`${label}失败，已停止启动。`);
    process.exit(result.status || 1);
  }
}

function checkCommand(command, installHint) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`未检测到 ${command}。`);
    console.error(installHint);
    process.exit(1);
  }
}

runStep('构建前端正式版本', 'npm', ['run', 'build']);
checkCommand('cloudflared', 'macOS 可执行：brew install cloudflared');
killPorts([5174, 5175]);

console.log('\n正式体验模式启动中...');
console.log('前端本地地址：http://localhost:5175/');
console.log('本地 API：http://127.0.0.1:5174');
console.log('Cloudflare Tunnel 会在下方输出公网访问链接。');
console.log('按 Ctrl + C 会一起关闭所有相关进程。');

const processes = [
  ['防止睡眠', 'caffeinate', ['-dimsu']],
  ['本地API', 'npm', ['run', 'dev:local']],
  ['前端预览', 'npm', ['run', 'preview:local']],
  ['公网分享', 'npm', ['run', 'share']],
];

const children = processes.map(([name, command, args]) => startProcess(name, command, args));

process.on('SIGINT', () => shutdownProcesses(children));
process.on('SIGTERM', () => shutdownProcesses(children));
