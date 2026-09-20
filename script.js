const editor = document.getElementById('code-editor');
const consoleOutput = document.getElementById('console');
const lineNumbers = document.getElementById('line-numbers');
const runButton = document.getElementById('run-button');
const status = document.getElementById('runtime-status');
const examples = {
  hello: { file: 'hello.py', code: `name = "PyCloud"\nprint(f"Hello from {name}!")\nprint("Python is running in your browser.")` },
  guess: { file: 'number_game.py', code: `secret = 7\nguess = 5\n\nif guess == secret:\n    print("You got it!")\nelif guess < secret:\n    print("Try a higher number.")\nelse:\n    print("Try a lower number.")` },
  data: { file: 'data.py', code: `cities = ["Tokyo", "Lagos", "Lima", "Oslo"]\npopulation = {"Tokyo": 37, "Lagos": 16}\n\nfor city in cities:\n    print(city, population.get(city, "unknown"), "million")` },
  draw: { file: 'pattern.py', code: `for row in range(1, 8):\n    print("★ " * row)\n\nprint("\\nKeep experimenting!")` }
};
let pyodide = null;

function updateLines() {
  const count = editor.value.split('\n').length;
  lineNumbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}
function setConsole(text, error = false) {
  consoleOutput.innerHTML = '';
  const output = document.createElement('span');
  output.textContent = text || 'Program finished with no output.';
  if (error) output.className = 'console-error';
  consoleOutput.appendChild(output);
}
function loadExample(key) {
  const example = examples[key];
  editor.value = example.code;
  document.getElementById('file-name').textContent = example.file;
  document.querySelectorAll('.example').forEach((button) => button.classList.toggle('active', button.dataset.example === key));
  updateLines();
  setConsole('');
}
async function bootPython() {
  try {
    if (!window.loadPyodide) throw new Error('The Python runtime library could not load.');
    pyodide = await window.loadPyodide();
    status.className = 'status ready';
    status.innerHTML = '<i></i> Python 3 ready';
    runButton.disabled = false;
  } catch (error) {
    status.className = 'status error';
    status.innerHTML = '<i></i> Runtime unavailable';
    setConsole(`Could not load Python: ${error.message}`, true);
  }
}
async function runCode() {
  if (!pyodide) return;
  runButton.disabled = true;
  runButton.textContent = 'Running...';
  setConsole('');
  consoleOutput.querySelector('span').textContent = '';
  try {
    pyodide.setStdout({ batched: (text) => { consoleOutput.querySelector('span').textContent += text; } });
    pyodide.setStderr({ batched: (text) => { consoleOutput.querySelector('span').textContent += text; } });
    await pyodide.runPythonAsync(editor.value);
  } catch (error) {
    setConsole(error.message, true);
  } finally {
    runButton.disabled = false;
    runButton.textContent = '▶ Run code';
  }
}
editor.addEventListener('input', updateLines);
editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') { event.preventDefault(); const start = editor.selectionStart; editor.value = `${editor.value.slice(0, start)}    ${editor.value.slice(editor.selectionEnd)}`; editor.selectionStart = editor.selectionEnd = start + 4; updateLines(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runCode(); }
});
document.querySelectorAll('.example').forEach((button) => button.addEventListener('click', () => loadExample(button.dataset.example)));
runButton.addEventListener('click', runCode);
document.getElementById('clear-button').addEventListener('click', () => { editor.value = ''; updateLines(); });
document.getElementById('clear-console').addEventListener('click', () => setConsole(''));
document.getElementById('theme-button').addEventListener('click', () => document.body.classList.toggle('dark'));
document.getElementById('share-button').addEventListener('click', () => { document.getElementById('share-text').value = editor.value; document.getElementById('share-modal').classList.remove('hidden'); });
document.getElementById('close-modal').addEventListener('click', () => document.getElementById('share-modal').classList.add('hidden'));
document.getElementById('copy-button').addEventListener('click', async () => { await navigator.clipboard.writeText(editor.value); document.getElementById('copy-button').textContent = 'Copied!'; setTimeout(() => { document.getElementById('copy-button').textContent = 'Copy code'; }, 1200); });
loadExample('hello');
runButton.disabled = true;
bootPython();
