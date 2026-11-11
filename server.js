"use strict";

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8192,
  cors: { origin: false }
});

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { etag: true }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const ROOM_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;
const ROOM_IDLE_TTL_MS = 60 * 60 * 1000;

function roomCode() {
  let code;
  do {
    const bytes = crypto.randomBytes(6);
    code = Array.from(bytes, n => ROOM_CHARACTERS[n % ROOM_CHARACTERS.length]).join("");
  } while (rooms.has(code));
  return code;
}

function sanitizeName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>\x00-\x1F\x7F]/g, "").trim().slice(0, 22);
}

function validToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(token);
}

function ackSafely(ack, payload) {
  if (typeof ack === "function") ack(payload);
}

function newRoom() {
  return {
    id: roomCode(),
    chess: new Chess(),
    members: { w: null, b: null },
    rematch: { w: false, b: false },
    updatedAt: Date.now()
  };
}

function allConnected(room) {
  return Boolean(room.members.w?.socketId && room.members.b?.socketId);
}

function statusOf(room) {
  const chess = room.chess;
  const white = room.members.w?.name || "Brancas";
  const black = room.members.b?.name || "Pretas";
  if (chess.isCheckmate()) {
    const winner = chess.turn() === "w" ? black : white;
    return { kind: "mate", message: `Xeque-mate! ${winner} venceu.`, done: true };
  }
  if (chess.isStalemate()) return { kind: "draw", message: "Empate por afogamento.", done: true };
  if (chess.isInsufficientMaterial()) return { kind: "draw", message: "Empate: material insuficiente.", done: true };
  if (chess.isThreefoldRepetition()) return { kind: "draw", message: "Empate por repetição de posição.", done: true };
  if (chess.isDrawByFiftyMoves()) return { kind: "draw", message: "Empate pela regra dos 50 lances.", done: true };
  if (chess.isDraw()) return { kind: "draw", message: "A partida terminou empatada.", done: true };
  const turnName = chess.turn() === "w" ? white : black;
  return {
    kind: chess.isCheck() ? "check" : "playing",
    message: `Vez de ${turnName}${chess.isCheck() ? " — XEQUE!" : ""}`,
    done: false
  };
}

function gameView(room, color) {
  const chess = room.chess;
  return {
    roomId: room.id,
    yourColor: color,
    players: {
      w: room.members.w ? { name: room.members.w.name, connected: Boolean(room.members.w.socketId) } : null,
      b: room.members.b ? { name: room.members.b.name, connected: Boolean(room.members.b.socketId) } : null
    },
    fen: chess.fen(),
    turn: chess.turn(),
    lastMove: chess.history({ verbose: true }).at(-1)
      ? { from: chess.history({ verbose: true }).at(-1).from, to: chess.history({ verbose: true }).at(-1).to }
      : null,
    moves: chess.history(),
    status: statusOf(room),
    isReady: allConnected(room),
    rematch: room.rematch
  };
}

function publish(room) {
  room.updatedAt = Date.now();
  for (const color of ["w", "b"]) {
    const member = room.members[color];
    if (member?.socketId) io.to(member.socketId).emit("game:state", gameView(room, color));
  }
}

function clearMembership(socket, removeSlot = true) {
  const code = socket.data.roomId;
  const color = socket.data.color;
  if (!code || !color) return;
  socket.data.roomId = null;
  socket.data.color = null;
  socket.leave(code);
  const room = rooms.get(code);
  const member = room?.members[color];
  if (!member || member.socketId !== socket.id) return;
  if (removeSlot) {
    room.members[color] = null;
    room.rematch = { w: false, b: false };
    room.chess = new Chess();
  } else {
    member.socketId = null;
    member.disconnectedAt = Date.now();
  }
  if (!room.members.w && !room.members.b) rooms.delete(code);
  else publish(room);
}

function attach(socket, room, color, name, token) {
  const old = room.members[color];
  if (old?.socketId && old.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(old.socketId);
    if (oldSocket) {
      oldSocket.data.roomId = null;
      oldSocket.data.color = null;
      oldSocket.leave(room.id);
      oldSocket.emit("game:kicked", "Esta sessão foi aberta em outra aba.");
    }
  }
  room.members[color] = { name: old?.name || name, token, socketId: socket.id, disconnectedAt: null };
  socket.data.roomId = room.id;
  socket.data.color = color;
  socket.join(room.id);
  publish(room);
}

function memberFor(socket) {
  const room = rooms.get(socket.data.roomId);
  const color = socket.data.color;
  if (!room || !color || room.members[color]?.socketId !== socket.id) return null;
  return { room, color };
}

io.on("connection", socket => {
  socket.on("room:create", (input, ack) => {
    const name = sanitizeName(input?.name);
    if (!name || !validToken(input?.token)) return ackSafely(ack, { ok: false, error: "Informe um nome válido." });
    clearMembership(socket, true);
    const room = newRoom();
    rooms.set(room.id, room);
    attach(socket, room, "w", name, input.token);
    ackSafely(ack, { ok: true, roomId: room.id, color: "w" });
  });

  socket.on("room:join", (input, ack) => {
    const code = String(input?.roomId ?? "").trim().toUpperCase();
    const name = sanitizeName(input?.name);
    if (!name || !validToken(input?.token)) return ackSafely(ack, { ok: false, error: "Informe seu nome para entrar." });
    if (!/^[A-Z2-9]{6}$/.test(code)) return ackSafely(ack, { ok: false, error: "Código de sala inválido." });
    const room = rooms.get(code);
    if (!room) return ackSafely(ack, { ok: false, error: "Sala não encontrada. Peça um novo convite." });
    const color = ["w", "b"].find(c => room.members[c]?.token === input.token)
      || ["w", "b"].find(c => !room.members[c]);
    if (!color) return ackSafely(ack, { ok: false, error: "A sala já tem dois jogadores." });
    clearMembership(socket, true);
    attach(socket, room, color, name, input.token);
    ackSafely(ack, { ok: true, roomId: room.id, color });
  });

  socket.on("game:moves", (payload, ack) => {
    const auth = memberFor(socket);
    const square = payload?.square;
    if (!auth || typeof square !== "string" || !/^[a-h][1-8]$/.test(square)) return ackSafely(ack, { ok: false, moves: [] });
    const { room, color } = auth;
    if (!allConnected(room) || room.chess.isGameOver() || room.chess.turn() !== color) return ackSafely(ack, { ok: true, moves: [] });
    const moves = room.chess.moves({ square, verbose: true }).map(m => ({
      to: m.to,
      capture: Boolean(m.captured),
      promotion: m.promotion || null
    }));
    ackSafely(ack, { ok: true, moves });
  });

  socket.on("game:move", (payload, ack) => {
    const auth = memberFor(socket);
    if (!auth) return ackSafely(ack, { ok: false, error: "Você não está em uma sala." });
    const { room, color } = auth;
    if (!allConnected(room)) return ackSafely(ack, { ok: false, error: "Aguarde a conexão do adversário." });
    if (room.chess.isGameOver()) return ackSafely(ack, { ok: false, error: "A partida já terminou." });
    if (room.chess.turn() !== color) return ackSafely(ack, { ok: false, error: "Não é sua vez." });
    const from = payload?.from, to = payload?.to;
    const promotion = payload?.promotion || "q";
    if (!/^[a-h][1-8]$/.test(from ?? "") || !/^[a-h][1-8]$/.test(to ?? "") || !/^[qrbn]$/.test(promotion)) {
      return ackSafely(ack, { ok: false, error: "Lance inválido." });
    }
    try {
      const moved = room.chess.move({ from, to, promotion });
      if (!moved) return ackSafely(ack, { ok: false, error: "Movimento proibido pelas regras do xadrez." });
    } catch (_err) {
      return ackSafely(ack, { ok: false, error: "Movimento proibido pelas regras do xadrez." });
    }
    room.rematch = { w: false, b: false };
    publish(room);
    ackSafely(ack, { ok: true });
  });

  socket.on("game:rematch", (_payload, ack) => {
    const auth = memberFor(socket);
    if (!auth) return ackSafely(ack, { ok: false, error: "Sem sala ativa." });
    const { room, color } = auth;
    if (!room.chess.isGameOver()) return ackSafely(ack, { ok: false, error: "A partida ainda não terminou." });
    room.rematch[color] = true;
    if (room.rematch.w && room.rematch.b) {
      room.chess = new Chess();
      room.rematch = { w: false, b: false };
    }
    publish(room);
    ackSafely(ack, { ok: true });
  });

  socket.on("room:leave", (_payload, ack) => {
    clearMembership(socket, true);
    ackSafely(ack, { ok: true });
  });

  socket.on("disconnect", () => clearMembership(socket, false));
});

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let removed = false;
    for (const color of ["w", "b"]) {
      const member = room.members[color];
      if (member && !member.socketId && now - member.disconnectedAt >= DISCONNECT_GRACE_MS) {
        room.members[color] = null;
        removed = true;
      }
    }
    if (removed) {
      room.chess = new Chess();
      room.rematch = { w: false, b: false };
    }
    if ((!room.members.w && !room.members.b) || (!room.members.w?.socketId && !room.members.b?.socketId && now - room.updatedAt > ROOM_IDLE_TTL_MS)) rooms.delete(room.id);
    else if (removed) publish(room);
  }
}, 15 * 1000);
cleanup.unref();

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) server.listen(PORT, "0.0.0.0", () => {
  console.log(`Xadrez Online rodando na porta ${PORT}`);
});

module.exports = { app, server, io, rooms, statusOf, sanitizeName, gameView };
