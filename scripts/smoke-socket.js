import { io } from "socket.io-client";

const URL = process.env.SMOKE_URL || "http://127.0.0.1:3001";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function connectClient(label) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, {
      reconnection: false,
      transports: ["websocket", "polling"]
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`${label} connection timed out`));
    }, 5000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || `${event} failed`));
        return;
      }
      resolve(response);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const black = await connectClient("black");
const white = await connectClient("white");
let latestState = null;

black.on("room_state", (state) => {
  latestState = state;
});
white.on("room_state", (state) => {
  latestState = state;
});

try {
  const created = await emitAck(black, "create_room", {
    clientId: `smoke-black-${runId}`,
    name: "黑方"
  });
  const roomCode = created.state.code;

  await emitAck(white, "join_room", {
    code: roomCode,
    clientId: `smoke-white-${runId}`,
    name: "白方"
  });
  await delay(80);
  assert(latestState?.players.length === 2, "room should contain two players");
  assert(latestState.status === "playing", "room should be playing");

  await emitAck(black, "make_move", { roomCode, row: 7, col: 7 });
  await emitAck(white, "make_move", { roomCode, row: 7, col: 8 });
  await emitAck(white, "request_undo", { roomCode });
  await delay(80);
  assert(latestState.undoRequest, "undo request should be pending");

  await emitAck(black, "respond_undo", { roomCode, approved: true });
  await delay(80);
  assert(latestState.board[7][8] === null, "approved undo should clear the stone");
  assert(latestState.currentTurn === "white", "turn should return to white after undo");

  const moves = [
    [white, 7, 8],
    [black, 8, 7],
    [white, 7, 9],
    [black, 9, 7],
    [white, 7, 10],
    [black, 10, 7],
    [white, 7, 11],
    [black, 11, 7]
  ];

  for (const [socket, row, col] of moves) {
    await emitAck(socket, "make_move", { roomCode, row, col });
  }
  await delay(100);

  assert(latestState.status === "finished", "game should finish after five in a row");
  assert(latestState.winner === "black", "black should win the smoke game");
  assert(latestState.winLine.length === 5, "win line should contain five points");

  console.log(`Smoke test passed for room ${roomCode}`);
} finally {
  black.disconnect();
  white.disconnect();
}
