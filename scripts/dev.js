import { killPorts, shutdownProcesses, startProcess } from './process-utils.js';

killPorts([5174, 5175]);

console.log('开发模式启动中...');
console.log('前端：http://localhost:5175/');
console.log('本地 API：http://127.0.0.1:5174');
console.log('适合写代码和调试，代码修改会自动刷新。');

const processes = [
  ['本地API', 'npm', ['run', 'dev:local']],
  ['前端', 'npm', ['run', 'dev:web']],
];

const children = processes.map(([name, command, args]) => startProcess(name, command, args));

process.on('SIGINT', () => shutdownProcesses(children));
process.on('SIGTERM', () => shutdownProcesses(children));
