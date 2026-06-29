const { spawn } = require('child_process');

const proc = spawn('tcb', [
  'cloudrun', 'deploy',
  '-s', 'biz-reporting-api',
  '--source', 'E:\\code2\\biz-reporting-system-fix',
  '--port', '3000',
  '--force',
  '--json',
], {
  stdio: ['pipe', 'inherit', 'inherit'],
  cwd: 'E:\\code2\\biz-reporting-system-fix',
});

setTimeout(() => {
  // Answer "No" for gray deployment
  proc.stdin.write('\x1b[B\r');  // Down arrow then Enter (selects "No")
  setTimeout(() => {
    proc.stdin.write('\x1b[B\r');  // Same for "No"  
    setTimeout(() => {
      // If asked about cancelling existing deployments, answer Y
      proc.stdin.write('Y\n');
    }, 2000);
  }, 2000);
}, 5000);
