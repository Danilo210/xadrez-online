const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('pagina inclui nome, tema, transparência e descanso de tela', () => {
  const html = read('public/index.html');
  for (const id of ['playerName', 'darkTheme', 'lightTheme', 'opacityRange', 'screensaver', 'turnText', 'board', 'roomCode']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('casas legais e capturas usam contornos espessos', () => {
  const css = read('public/styles.css');
  assert.match(css, /\.square\.legal::after/);
  assert.match(css, /\.square\.legal\.capture::after/);
  assert.match(css, /border:\s*clamp\(4px/);
});

test('tabuleiro é 8x8, canto a1 escuro e h1 claro', () => {
  const client = read('public/client.js');
  assert.match(read('public/styles.css'), /grid-template-columns:\s*repeat\(8/);
  // a1 -> (0 + 1) % 2 = 1 (escuro); h1 -> (7 + 1) % 2 = 0 (claro)
  assert.match(client, /\+ position\.rank\) % 2 === 1 \? "dark" : "light"/);
  assert.match(read('public/styles.css'), /grid-template-rows:\s*repeat\(8/);
});

test('o protetor de tela surge em 30 segundos, com clique para voltar', () => {
  const client = read('public/client.js');
  assert.match(client, /}, 30000\)/);
  assert.match(client, /"screensaver"\)\.addEventListener\("click", wakeUp\)/);
});
