"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Teste isolado do fluxo Socket.IO. Não requer conexões externas nem npm install.
function environment() {
  const sockets = new Map();
  let connectionHandler;
  let cleanup;
  let currentTime = 1_000_000;
  let socketSequence = 0;
  const events = [];

  class FakeChess {
    constructor() { this.turnValue = "w"; this.plies = []; }
    turn() { return this.turnValue; }
    fen() { return `position-${this.plies.length}-${this.turnValue}`; }
    history(options) {
      if (options?.verbose) return this.plies.map(p => ({ from: p.from, to: p.to }));
      return this.plies.map(p => `${p.from}-${p.to}`);
    }
    move({ from, to }) {
      this.plies.push({ from, to });
      this.turnValue = this.turnValue === "w" ? "b" : "w";
      return { from, to };
    }
    moves() { return []; }
    isCheckmate() { return false; }
    isStalemate() { return false; }
    isInsufficientMaterial() { return false; }
    isThreefoldRepetition() { return false; }
    isDrawByFiftyMoves() { return false; }
    isDraw() { return false; }
    isGameOver() { return false; }
    isCheck() { return false; }
  }

  const fakeIo = {
    sockets: { sockets },
    on(event, cb) { if (event === "connection") connectionHandler = cb; },
    to(id) { return { emit(event, payload) { events.push({ id, event, payload }); } }; }
  };
  const fakeExpress = () => ({ disable() {}, use() {}, get() {} });
  fakeExpress.static = () => () => {};
  const fakeRequire = name => {
    if (name === "express") return fakeExpress;
    if (name === "http") return { createServer: () => ({ listen() {} }) };
    if (name === "socket.io") return { Server: class { constructor() { return fakeIo; } } };
    if (name === "chess.js") return { Chess: FakeChess };
    return require(name);
  };
  const module = { exports: {} };
  const program = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  vm.runInNewContext(program, {
    module, exports: module.exports, require: fakeRequire, __dirname: path.join(__dirname, ".."),
    Date: { now: () => currentTime },
    setInterval(cb) { cleanup = cb; return { unref() {} }; },
    process: { env: {} }, console
  });

  function connect() {
    const id = `fake-${++socketSequence}`;
    const handlers = new Map();
    const socket = {
      id, data: {}, handlers,
      on(event, cb) { handlers.set(event, cb); },
      emit(event, payload) { events.push({ id, event, payload }); },
      join() {}, leave() {}
    };
    sockets.set(id, socket);
    connectionHandler(socket);
    return socket;
  }
  function send(socket, event, input = {}) {
    let response;
    socket.handlers.get(event)(input, result => { response = result; });
    return response;
  }
  const token = suffix => `session-token-${suffix}-123456`;
  return {
    ...module.exports,
    connect, send, token, events, cleanup,
    advance(ms) { currentTime += ms; },
    disconnect(socket) { socket.handlers.get("disconnect")(); sockets.delete(socket.id); }
  };
}

test("saída voluntária preserva posição, histórico e vez; substituto assume as pretas", () => {
  const e = environment();
  const a = e.connect(), b = e.connect(), c = e.connect();
  const roomId = e.send(a, "room:create", { name: "Ana", token: e.token("a") }).roomId;
  assert.equal(e.send(b, "room:join", { roomId, name: "Bruno", token: e.token("b") }).color, "b");
  assert.equal(e.send(a, "game:move", { from: "e2", to: "e4" }).ok, true);
  const room = e.rooms.get(roomId);
  const before = room.chess.fen();
  assert.equal(room.chess.turn(), "b");
  e.send(b, "room:leave");
  assert.equal(room.chess.fen(), before);
  assert.equal(room.members.b, null);
  assert.equal(e.gameView(room, "w").isReady, false);
  assert.equal(e.send(c, "room:join", { roomId, name: "Carlos", token: e.token("c") }).color, "b");
  assert.equal(room.members.b.name, "Carlos");
  assert.equal(room.chess.fen(), before);
  assert.equal(room.chess.turn(), "b");
  assert.equal(e.gameView(room, "b").moves.length, 1);
  assert.equal(e.gameView(room, "w").isReady, true);
  assert.equal(e.send(c, "game:move", { from: "e7", to: "e5" }).ok, true);
  assert.equal(e.gameView(room, "w").moves.length, 2);
});

test("desconexão libera cadeira imediatamente; reentrada do antigo titular não remove novo jogador", () => {
  const e = environment();
  const a = e.connect(), b = e.connect(), c = e.connect();
  const roomId = e.send(a, "room:create", { name: "Ana", token: e.token("a") }).roomId;
  e.send(b, "room:join", { roomId, name: "Bruno", token: e.token("b") });
  e.send(a, "game:move", { from: "e2", to: "e4" });
  const before = e.rooms.get(roomId).chess.fen();
  e.disconnect(b);
  assert.equal(e.rooms.get(roomId).chess.fen(), before);
  assert.equal(e.send(c, "room:join", { roomId, name: "Carla", token: e.token("c") }).color, "b");
  assert.equal(e.rooms.get(roomId).chess.fen(), before);
  const reconnected = e.connect();
  const response = e.send(reconnected, "room:join", { roomId, name: "Bruno", token: e.token("b") });
  assert.equal(response.ok, false);
  assert.equal(e.rooms.get(roomId).members.b.name, "Carla");
});

test("limpeza de jogador desconectado não reinicia a partida", () => {
  const e = environment();
  const a = e.connect(), b = e.connect();
  const roomId = e.send(a, "room:create", { name: "A", token: e.token("a") }).roomId;
  e.send(b, "room:join", { roomId, name: "B", token: e.token("b") });
  e.send(a, "game:move", { from: "e2", to: "e4" });
  e.disconnect(b);
  const before = e.rooms.get(roomId).chess.fen();
  e.advance(2 * 60_000 + 1);
  e.cleanup();
  assert.equal(e.rooms.get(roomId).members.b, null);
  assert.equal(e.rooms.get(roomId).chess.fen(), before);
  const c = e.connect();
  e.send(c, "room:join", { roomId, name: "C", token: e.token("c") });
  assert.equal(e.rooms.get(roomId).chess.fen(), before);
});

test("sala continua acessível após ambos saírem, mas expira depois de 1 hora sem jogadores", () => {
  const e = environment();
  const a = e.connect(), b = e.connect();
  const roomId = e.send(a, "room:create", { name: "A", token: e.token("a") }).roomId;
  e.send(b, "room:join", { roomId, name: "B", token: e.token("b") });
  e.send(a, "game:move", { from: "e2", to: "e4" });
  const before = e.rooms.get(roomId).chess.fen();
  e.send(a, "room:leave");
  e.send(b, "room:leave");
  assert.equal(e.rooms.get(roomId).chess.fen(), before);
  const c = e.connect(), d = e.connect();
  assert.equal(e.send(c, "room:join", { roomId, name: "C", token: e.token("c") }).color, "w");
  assert.equal(e.send(d, "room:join", { roomId, name: "D", token: e.token("d") }).color, "b");
  assert.equal(e.rooms.get(roomId).chess.fen(), before);
  e.send(c, "room:leave");
  e.send(d, "room:leave");
  e.advance(60 * 60_000 + 1);
  e.cleanup();
  assert.equal(e.rooms.has(roomId), false);
});
