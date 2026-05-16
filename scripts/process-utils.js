import { spawn, spawnSync } from 'node:child_process';

export function startProcess(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} 进程退出，code=${code}`);
      process.exitCode = code;
    }
  });

  return child;
}

export function shutdownProcesses(children) {
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

function findPortPids(port) {
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`], {
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function findProcessPids(pattern) {
  const result = spawnSync('pgrep', ['-f', pattern], {
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  const currentPid = String(process.pid);
  return result.stdout
    .trim()
    .split(/\s+/)
    .filter((pid) => pid && pid !== currentPid);
}

function killPids(pids, label) {
  const uniquePids = [...new Set(pids)];
  if (uniquePids.length === 0) {
    console.log(`${label} 未发现需要关闭的进程。`);
    return;
  }

  console.log(`${label} 准备结束进程：${uniquePids.join(', ')}`);
  const killResult = spawnSync('kill', uniquePids, {
    encoding: 'utf8',
  });

  if (killResult.status !== 0) {
    console.error(killResult.stderr || `${label} 结束进程失败`);
    console.error('你可以手动执行：');
    console.error(`  kill ${uniquePids.join(' ')}`);
    process.exit(killResult.status || 1);
  }

  console.log(`${label} 已结束。`);
}

export function killPorts(ports) {
  const pids = [...new Set(ports.flatMap(findPortPids))];
  if (pids.length === 0) {
    console.log(`端口 ${ports.join(', ')} 未被占用。`);
    return;
  }

  killPids(pids, `端口 ${ports.join(', ')}`);
}

export function killProcessPatterns(patterns) {
  for (const pattern of patterns) {
    killPids(findProcessPids(pattern), `进程 ${pattern}`);
  }
}
