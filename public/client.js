"use strict";

const $ = id => document.getElementById(id);
const socket = io();
const glyphs = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎"
};
const namesOfPieces = {
  k: "rei", q: "dama", r: "torre", b: "bispo", n: "cavalo", p: "peão"
};
const files = "abcdefgh";
const SESSION_TOKEN = "xadrez-tab-token";
const SESSION_ROOM = "xadrez-room-code";
const NAME_STORAGE = "xadrez-player-name";
const token = sessionStorage.getItem(SESSION_TOKEN) || (() => {
  const v = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, "0")).join("");
  sessionStorage.setItem(SESSION_TOKEN, v);
  return v;
})();
let gameState = null;
let selected = null;
let legalTargets = [];
let requestSequence = 0;
let promotionMove = null;
let toastTimeout = null;
let idleTimeout = null;
let isIdle = false;
let lastActivityUpdate = 0;
let playerName = localStorage.getItem(NAME_STORAGE) || "";

$("playerName").value = playerName;
const invitedRoom = new URLSearchParams(location.search).get("sala") || "";
$("roomInput").value = invitedRoom.toUpperCase().slice(0, 6);

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add("hidden"), 3200);
}
function displayLobbyError(message) { $("lobbyError").textContent = message; }
function setConnection(connected) {
  const el = $("connection");
  el.classList.toggle("online", connected);
  el.classList.toggle("offline", !connected);
  el.innerHTML = `<span class="dot"></span> ${connected ? "Conectado" : "Sem conexão"}`;
}

function setTheme(theme) {
  const chosen = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = chosen;
  localStorage.setItem("xadrez-theme", chosen);
  $("darkTheme").classList.toggle("active", chosen === "dark");
  $("lightTheme").classList.toggle("active", chosen === "light");
  $("darkTheme").setAttribute("aria-pressed", String(chosen === "dark"));
  $("lightTheme").setAttribute("aria-pressed", String(chosen === "light"));
}
$("darkTheme").addEventListener("click", () => setTheme("dark"));
$("lightTheme").addEventListener("click", () => setTheme("light"));
setTheme(localStorage.getItem("xadrez-theme") || "dark");

function setOpacity(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  $("app").style.opacity = String(n / 100);
  $("app").style.pointerEvents = n === 0 ? "none" : "";
  $("promotionModal").style.opacity = String(n / 100);
  $("opacityValue").textContent = `${n}%`;
  localStorage.setItem("xadrez-opacity", String(n));
}
$("opacityRange").value = localStorage.getItem("xadrez-opacity") ?? "100";
setOpacity($("opacityRange").value);
$("opacityRange").addEventListener("input", e => setOpacity(e.target.value));

function resetIdleTimer() {
  if (isIdle) return;
  clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => {
    isIdle = true;
    $("screensaver").classList.remove("hidden");
    $("screensaver").focus({ preventScroll: true });
  }, 30000);
}
function wakeUp() {
  isIdle = false;
  $("screensaver").classList.add("hidden");
  resetIdleTimer();
}
$("screensaver").addEventListener("click", wakeUp);
$("screensaver").addEventListener("pointerdown", wakeUp);
window.addEventListener("keydown", e => {
  if (isIdle) {
    e.preventDefault();
    wakeUp();
  } else resetIdleTimer();
}, { capture: true });
["pointerdown", "wheel", "touchstart"].forEach(event => window.addEventListener(event, () => {
  if (!isIdle) resetIdleTimer();
}, { passive: true }));
window.addEventListener("pointermove", () => {
  const now = Date.now();
  if (!isIdle && now - lastActivityUpdate > 400) {
    lastActivityUpdate = now;
    resetIdleTimer();
  }
}, { passive: true });
resetIdleTimer();

function nameFromForm() {
  const name = $("playerName").value.replace(/[<>\x00-\x1F\x7F]/g, "").trim().slice(0, 22);
  if (!name) { displayLobbyError("Digite seu nome antes de começar."); $("playerName").focus(); return null; }
  playerName = name;
  localStorage.setItem(NAME_STORAGE, name);
  return name;
}
function enterRoom(action, roomId = "") {
  const name = nameFromForm();
  if (!name) return;
  if (!socket.connected) { displayLobbyError("Sem conexão. Verifique sua internet."); return; }
  displayLobbyError("");
  const payload = { name, token, roomId };
  socket.timeout(8000).emit(action, payload, (error, response) => {
    if (error) { displayLobbyError("O servidor não respondeu. Tente novamente."); return; }
    if (!response?.ok) { displayLobbyError(response?.error || "Não foi possível entrar na sala."); return; }
    sessionStorage.setItem(SESSION_ROOM, response.roomId);
    history.replaceState(null, "", `?sala=${encodeURIComponent(response.roomId)}`);
  });
}
$("lobbyForm").addEventListener("submit", event => { event.preventDefault(); enterRoom("room:create"); });
$("joinRoom").addEventListener("click", () => {
  const roomId = $("roomInput").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(roomId)) { displayLobbyError("Informe o código de 6 caracteres da sala."); return; }
  enterRoom("room:join", roomId);
});
$("roomInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); $("joinRoom").click(); }
});

socket.on("connect", () => {
  setConnection(true);
  const oldRoom = sessionStorage.getItem(SESSION_ROOM);
  if (!oldRoom) return;
  const savedName = localStorage.getItem(NAME_STORAGE);
  if (!savedName) return;
  socket.timeout(8000).emit("room:join", { roomId: oldRoom, name: savedName, token }, (err, response) => {
    if (err || !response?.ok) {
      sessionStorage.removeItem(SESSION_ROOM);
      gameState = null;
      $("lobby").classList.remove("hidden");
      $("game").classList.add("hidden");
      displayLobbyError(response?.error || "Sala encerrada. Crie uma nova sala.");
    }
  });
});
socket.on("disconnect", () => {
  setConnection(false);
  if (gameState) showToast("Conexão perdida. Reconectando...");
});
socket.on("game:kicked", message => {
  sessionStorage.removeItem(SESSION_ROOM);
  gameState = null;
  $("game").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  showToast(message);
});
socket.on("game:state", state => {
  gameState = state;
  selected = null;
  legalTargets = [];
  ++requestSequence;
  hidePromotion();
  sessionStorage.setItem(SESSION_ROOM, state.roomId);
  history.replaceState(null, "", `?sala=${encodeURIComponent(state.roomId)}`);
  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");
  updateUI();
});

function boardFromFen(fen) {
  const board = new Map();
  const ranks = String(fen).split(" ")[0].split("/");
  ranks.forEach((rank, row) => {
    let column = 0;
    for (const char of rank) {
      if (/^[1-8]$/.test(char)) column += Number(char);
      else {
        board.set(files[column] + (8 - row), char);
        column++;
      }
    }
  });
  return board;
}
function squareArray(color) {
  const reversed = color === "b";
  const order = reversed ? files.split("").reverse() : files.split("");
  const ranks = reversed ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  return ranks.flatMap((rank, row) => order.map((f, col) => ({
    square: f + rank, row, col, rank, file: f
  })));
}
function kingSquare(board, color) {
  const expected = color === "w" ? "K" : "k";
  for (const [square, piece] of board) if (piece === expected) return square;
  return null;
}
function renderBoard() {
  if (!gameState) return;
  const board = boardFromFen(gameState.fen);
  const boardElement = $("board");
  const checkKing = ["check", "mate"].includes(gameState.status.kind) ? kingSquare(board, gameState.turn) : null;
  const squares = squareArray(gameState.yourColor);
  const fragment = document.createDocumentFragment();
  const playing = gameState.isReady && !gameState.status.done && gameState.turn === gameState.yourColor && socket.connected;
  for (const position of squares) {
    const piece = board.get(position.square);
    const own = piece && (piece === piece.toUpperCase()) === (gameState.yourColor === "w");
    const target = legalTargets.find(t => t.to === position.square);
    const targetCapture = Boolean(target?.capture);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "gridcell");
    button.className = "square " + ((files.indexOf(position.file) + position.rank) % 2 === 1 ? "dark" : "light");
    if (piece && own && playing) button.classList.add("own-piece");
    if (gameState.lastMove && [gameState.lastMove.from, gameState.lastMove.to].includes(position.square)) button.classList.add("last-move");
    if (position.square === checkKing) button.classList.add("in-check");
    if (position.square === selected) button.classList.add("selected");
    if (target) button.classList.add("legal", ...(targetCapture ? ["capture"] : []));
    button.setAttribute("aria-label", `${position.square}${piece ? `, ${namesOfPieces[piece.toLowerCase()]}, ${piece === piece.toUpperCase() ? "brancas" : "pretas"}` : ", vazio"}${target ? `, movimento permitido${targetCapture ? ", captura" : ""}` : ""}`);
    button.addEventListener("click", () => selectSquare(position.square));
    if (piece) {
      const pieceSpan = document.createElement("span");
      pieceSpan.className = "piece " + (piece === piece.toUpperCase() ? "white" : "black");
      pieceSpan.textContent = glyphs[piece];
      button.appendChild(pieceSpan);
    }
    if (position.col === 0) {
      const rankLabel = document.createElement("span");
      rankLabel.className = "coord rank";
      rankLabel.textContent = String(position.rank);
      button.appendChild(rankLabel);
    }
    if (position.row === 7) {
      const fileLabel = document.createElement("span");
      fileLabel.className = "coord file";
      fileLabel.textContent = position.file;
      button.appendChild(fileLabel);
    }
    fragment.appendChild(button);
  }
  boardElement.replaceChildren(fragment);
}

function selectSquare(square) {
  const state = gameState;
  if (!state || !state.isReady || state.status.done || state.turn !== state.yourColor || !socket.connected) return;
  const board = boardFromFen(state.fen);
  const piece = board.get(square);
  const myPiece = piece && (piece === piece.toUpperCase()) === (state.yourColor === "w");
  if (selected && legalTargets.some(t => t.to === square)) {
    const from = selected;
    const option = legalTargets.find(t => t.to === square && t.promotion);
    if (option) {
      promotionMove = { from, to: square };
      showPromotion();
    } else playMove({ from, to: square });
    return;
  }
  if (!myPiece) { selected = null; legalTargets = []; ++requestSequence; renderBoard(); return; }
  if (square === selected) { selected = null; legalTargets = []; ++requestSequence; renderBoard(); return; }
  selected = square;
  legalTargets = [];
  const requestId = ++requestSequence;
  renderBoard();
  socket.timeout(5000).emit("game:moves", { square }, (err, result) => {
    if (err || requestId !== requestSequence || selected !== square || !gameState) return;
    legalTargets = result?.ok ? result.moves : [];
    renderBoard();
  });
}

function playMove(move) {
  selected = null;
  legalTargets = [];
  ++requestSequence;
  hidePromotion();
  renderBoard();
  socket.timeout(5000).emit("game:move", move, (err, result) => {
    if (err) showToast("Sem resposta do servidor. Confira sua conexão.");
    else if (!result?.ok) showToast(result?.error || "Jogada inválida.");
  });
}
function showPromotion() {
  if (!gameState || !promotionMove) return;
  const choices = $("promotionChoices");
  choices.replaceChildren();
  for (const promotion of ["q", "r", "b", "n"]) {
    const btn = document.createElement("button");
    const p = gameState.yourColor === "w" ? promotion.toUpperCase() : promotion;
    btn.textContent = glyphs[p];
    btn.setAttribute("aria-label", namesOfPieces[promotion]);
    btn.addEventListener("click", () => {
      const move = { ...promotionMove, promotion };
      promotionMove = null;
      playMove(move);
    });
    choices.appendChild(btn);
  }
  $("promotionModal").classList.remove("hidden");
}
function hidePromotion() {
  promotionMove = null;
  $("promotionModal").classList.add("hidden");
}
$("cancelPromotion").addEventListener("click", () => { hidePromotion(); renderBoard(); });

function playerInfo() {
  if (!gameState) return;
  const me = gameState.players[gameState.yourColor];
  const oppColor = gameState.yourColor === "w" ? "b" : "w";
  const opponent = gameState.players[oppColor];
  $("selfName").textContent = me?.name || playerName;
  $("selfAvatar").textContent = (me?.name || playerName || "J").charAt(0).toUpperCase();
  $("selfSide").textContent = gameState.yourColor === "w" ? "Peças brancas" : "Peças pretas";
  $("opponentName").textContent = opponent?.connected ? opponent.name : "Aguardando jogador...";
  $("opponentAvatar").textContent = opponent?.connected ? opponent.name.charAt(0).toUpperCase() : "?";
  $("opponentSide").textContent = `${oppColor === "w" ? "Peças brancas" : "Peças pretas"}${!opponent ? " · vaga disponível" : !opponent.connected ? ` · ${opponent.name} saiu` : ""}`;
  $("opponentOnline").classList.toggle("online", Boolean(opponent?.connected));
}
function turnInfo() {
  const s = gameState;
  const active = s.players[s.turn];
  const ownTurn = s.turn === s.yourColor;
  let main = s.status.message;
  let description = ownTurn ? "Sua vez! Selecione uma peça." : "Aguarde o adversário fazer seu lance.";
  if (!s.isReady) {
    main = s.moves.length ? "Partida pausada — aguardando jogador" : "Aguardando adversário";
    description = s.moves.length
      ? "Peças e jogadas preservadas. Compartilhe o link: quem entrar assume a vaga e continua deste ponto."
      : "Compartilhe o código da sala. O próximo jogador assume a vaga disponível.";
  } else if (s.status.done) {
    description = "Partida encerrada. Os dois jogadores podem pedir uma revanche.";
  } else if (s.status.kind === "check") {
    description = ownTurn ? "Seu rei está em xeque. Proteja-o!" : "O rei adversário está em xeque.";
  }
  $("turnText").textContent = main;
  $("statusDetail").textContent = description;
  const turnName = active?.connected ? active.name : `quem jogar com as ${s.turn === "w" ? "brancas" : "pretas"}`;
  $("turnColor").textContent = `Vez de ${turnName}${!s.status.done && ownTurn && s.isReady ? " (você)" : ""}`;
  $("turnIndicator").querySelector(".indicator-piece").textContent = s.turn === "w" ? "♙" : "♟︎";
  $("rematchBtn").classList.toggle("hidden", !s.status.done);
  $("rematchBtn").textContent = s.rematch[s.yourColor] ? "Revanche solicitada ✓" : "Solicitar revanche";
  $("rematchBtn").disabled = Boolean(s.rematch[s.yourColor]) || !s.isReady;
}
function renderHistory() {
  const target = $("moveHistory");
  if (!gameState.moves.length) {
    target.innerHTML = '<div class="history-empty">Os movimentos aparecerão aqui.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < gameState.moves.length; index += 2) {
    const pair = document.createElement("div");
    pair.className = "move-pair";
    for (const value of [String(index / 2 + 1) + ".", gameState.moves[index], gameState.moves[index + 1] || "—"]) {
      const span = document.createElement("span");
      span.textContent = value;
      pair.appendChild(span);
    }
    pair.firstChild.classList.add("move-num");
    fragment.appendChild(pair);
  }
  target.replaceChildren(fragment);
  target.scrollTop = target.scrollHeight;
}
function updateUI() {
  if (!gameState) return;
  $("roomTag").textContent = gameState.roomId;
  $("roomCode").textContent = gameState.roomId;
  playerInfo();
  turnInfo();
  renderHistory();
  renderBoard();
}

$("copyInvite").addEventListener("click", async () => {
  if (!gameState) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("sala", gameState.roomId);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast("Link copiado! Envie para seu adversário.");
  } catch (_) {
    const input = document.createElement("textarea");
    input.value = url.toString();
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    showToast(ok ? "Link copiado!" : `Copie este código: ${gameState.roomId}`);
  }
});
$("rematchBtn").addEventListener("click", () => {
  socket.emit("game:rematch", {}, response => {
    if (!response?.ok) showToast(response?.error || "Não foi possível solicitar revanche.");
    else showToast("Revanche solicitada. Aguardando o outro jogador.");
  });
});
$("leaveRoom").addEventListener("click", () => {
  socket.emit("room:leave", {}, () => {});
  sessionStorage.removeItem(SESSION_ROOM);
  history.replaceState(null, "", location.pathname);
  gameState = null;
  selected = null;
  legalTargets = [];
  $("game").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  displayLobbyError("");
});
