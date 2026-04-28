/**
 * translate-worker.js — chạy trong worker_threads
 * Spawn translate-server.py (CTranslate2 NLLB-200 int8) qua child_process,
 * giao tiếp bằng JSON-line qua stdin/stdout.
 */
const { workerData, parentPort } = require('worker_threads');
const { spawn, spawnSync }       = require('child_process');
const readline                   = require('readline');
const path                       = require('path');

const { modelDir } = workerData;
const serverScript = path.join(__dirname, 'translate-server.py');

// Tìm Python executable
function findPython() {
  const cmds = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  for (const cmd of cmds) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

const python = findPython();

if (!python) {
  parentPort.postMessage({
    type: 'error',
    msg: 'Không tìm thấy Python. Cài Python 3.8+ rồi chạy: pip install ctranslate2 transformers sentencepiece',
  });
} else {
  parentPort.postMessage({ type: 'progress', msg: 'Đang nạp NLLB-200 CTranslate2...' });

  const proc = spawn(python, [serverScript, modelDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  // Parse stdout của Python theo từng dòng JSON
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  rl.on('line', line => {
    if (!line.trim()) return;
    try { parentPort.postMessage(JSON.parse(line)); } catch {}
  });

  // Log stderr của Python — lọc bỏ warning Mistral-regex không liên quan
  proc.stderr.on('data', d => {
    const msg = d.toString();
    if (!msg.includes('incorrect regex pattern') && !msg.includes('fix_mistral_regex')) {
      process.stderr.write('[py] ' + msg);
    }
  });

  proc.on('error', e => {
    parentPort.postMessage({ type: 'error', msg: `Python spawn lỗi: ${e.message}` });
  });
  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      parentPort.postMessage({ type: 'error', msg: `translate-server.py thoát code ${code}` });
    }
  });

  // Forward request từ main process → Python stdin
  parentPort.on('message', msg => {
    try { proc.stdin.write(JSON.stringify(msg) + '\n'); } catch {}
  });

  // Dọn dẹp khi worker thread kết thúc
  process.on('exit', () => { try { proc.kill(); } catch {} });
}
