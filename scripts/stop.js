import { killPorts, killProcessPatterns } from './process-utils.js';

console.log('正在关闭竞品分析平台相关进程...');

killPorts([5174, 5175]);
killProcessPatterns([
  'cloudflared tunnel --url http://localhost:5175',
  'caffeinate -dimsu',
]);

console.log('关闭完成。');
