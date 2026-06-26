import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const BOARD_SIZE = 15;
const WIN_LENGTH = 5;
const PORT = Number(process.env.PORT || 5556);
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const rooms = new Map();

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function emptyRoom(code) {
  return {
    code,
    players: [],
    board: createBoard(),
    moves: [],
    currentTurn: "black",
    status: "waiting",
    winner: null,
    winLine: [],
    undoRequest: null,
    lastEvent: null,
    createdAt: Date.now()
  };
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Unable to generate room code");
}

function normalizeName(value) {
  const name = String(value || "").trim().slice(0, 16);
  return name || "棋手";
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeClientId(value) {
  return String(value || "").trim().slice(0, 80);
}

function findPlayer(room, clientId) {
  return room.players.find((player) => player.clientId === clientId);
}

function otherPlayer(room, clientId) {
  return room.players.find((player) => player.clientId !== clientId);
}

function connectedPlayers(room) {
  return room.players.filter((player) => player.connected);
}

function roomReady(room) {
  return room.players.length === 2 && connectedPlayers(room).length === 2;
}

function ensureRoomStatus(room) {
  if (room.winner) {
    room.status = "finished";
    return;
  }
  if (room.players.length < 2) {
    room.status = "waiting";
    return;
  }
  if (room.status !== "finished") {
    room.status = "playing";
  }
}

function nextColor(room) {
  const colors = new Set(room.players.map((player) => player.color));
  if (!colors.has("black")) return "black";
  if (!colors.has("white")) return "white";
  return null;
}

function publicState(room) {
  return {
    code: room.code,
    board: room.board,
    moves: room.moves,
    currentTurn: room.currentTurn,
    status: room.status,
    winner: room.winner,
    winLine: room.winLine,
    lastMove: room.moves.at(-1) || null,
    undoRequest: room.undoRequest
      ? {
          id: room.undoRequest.id,
          requesterClientId: room.undoRequest.requesterClientId,
          requesterColor: room.undoRequest.requesterColor,
          requesterName: room.undoRequest.requesterName,
          targetClientId: room.undoRequest.targetClientId,
          move: room.undoRequest.move
        }
      : null,
    players: room.players.map((player) => ({
      clientId: player.clientId,
      name: player.name,
      color: player.color,
      connected: player.connected
    })),
    lastEvent: room.lastEvent
  };
}

function broadcast(room) {
  io.to(room.code).emit("room_state", publicState(room));
}

function sendNotice(room, message, tone = "info") {
  const notice = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    tone
  };
  room.lastEvent = notice;
  io.to(room.code).emit("notice", notice);
}

function isInside(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function collectLine(board, row, col, color, dr, dc) {
  const line = [{ row, col }];

  let r = row - dr;
  let c = col - dc;
  while (isInside(r, c) && board[r][c] === color) {
    line.unshift({ row: r, col: c });
    r -= dr;
    c -= dc;
  }

  r = row + dr;
  c = col + dc;
  while (isInside(r, c) && board[r][c] === color) {
    line.push({ row: r, col: c });
    r += dr;
    c += dc;
  }

  return line;
}

function findWinLine(board, row, col, color) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  for (const [dr, dc] of directions) {
    const line = collectLine(board, row, col, color, dr, dc);
    if (line.length >= WIN_LENGTH) {
      return line.slice(0, WIN_LENGTH);
    }
  }

  return [];
}

function boardIsFull(board) {
  return board.every((row) => row.every(Boolean));
}

function resetRoomBoard(room) {
  room.board = createBoard();
  room.moves = [];
  room.currentTurn = "black";
  room.status = room.players.length === 2 ? "playing" : "waiting";
  room.winner = null;
  room.winLine = [];
  room.undoRequest = null;
  room.lastEvent = null;
}

function joinSocketRoom(socket, room, player) {
  socket.data.roomCode = room.code;
  socket.data.clientId = player.clientId;
  socket.join(room.code);
}

function addOrReconnectPlayer(socket, room, clientId, name) {
  let player = findPlayer(room, clientId);
  if (player) {
    player.name = name;
    player.socketId = socket.id;
    player.connected = true;
    return { player, reconnected: true };
  }

  const color = nextColor(room);
  if (!color) {
    return { error: "房间已满" };
  }

  player = {
    clientId,
    socketId: socket.id,
    name,
    color,
    connected: true
  };
  room.players.push(player);
  return { player, reconnected: false };
}

io.on("connection", (socket) => {
  socket.on("create_room", (payload, reply) => {
    const clientId = normalizeClientId(payload?.clientId);
    if (!clientId) {
      reply?.({ ok: false, error: "缺少客户端标识，请刷新后重试" });
      return;
    }

    const code = generateRoomCode();
    const room = emptyRoom(code);
    rooms.set(code, room);

    const { player } = addOrReconnectPlayer(socket, room, clientId, normalizeName(payload?.name));
    joinSocketRoom(socket, room, player);
    ensureRoomStatus(room);

    reply?.({ ok: true, state: publicState(room) });
    broadcast(room);
  });

  socket.on("join_room", (payload, reply) => {
    const code = normalizeCode(payload?.code);
    const room = rooms.get(code);
    const clientId = normalizeClientId(payload?.clientId);

    if (!room) {
      reply?.({ ok: false, error: "没有找到这个房间" });
      return;
    }
    if (!clientId) {
      reply?.({ ok: false, error: "缺少客户端标识，请刷新后重试" });
      return;
    }

    const result = addOrReconnectPlayer(socket, room, clientId, normalizeName(payload?.name));
    if (result.error) {
      reply?.({ ok: false, error: result.error });
      return;
    }

    joinSocketRoom(socket, room, result.player);
    ensureRoomStatus(room);
    reply?.({ ok: true, state: publicState(room) });
    broadcast(room);
    if (!result.reconnected) {
      sendNotice(room, `${result.player.name} 加入房间`, "success");
    }
  });

  socket.on("make_move", (payload, reply) => {
    const room = rooms.get(normalizeCode(payload?.roomCode));
    const clientId = socket.data.clientId;
    if (!room || !clientId) {
      reply?.({ ok: false, error: "还没有加入房间" });
      return;
    }

    const player = findPlayer(room, clientId);
    const row = Number(payload?.row);
    const col = Number(payload?.col);

    if (!player) {
      reply?.({ ok: false, error: "你不在这个房间里" });
      return;
    }
    if (!roomReady(room)) {
      reply?.({ ok: false, error: "等待双方在线后再落子" });
      return;
    }
    if (room.status !== "playing") {
      reply?.({ ok: false, error: "本局已经结束" });
      return;
    }
    if (room.undoRequest) {
      reply?.({ ok: false, error: "先处理当前悔棋请求" });
      return;
    }
    if (player.color !== room.currentTurn) {
      reply?.({ ok: false, error: "还没轮到你" });
      return;
    }
    if (!Number.isInteger(row) || !Number.isInteger(col) || !isInside(row, col)) {
      reply?.({ ok: false, error: "落子位置无效" });
      return;
    }
    if (room.board[row][col]) {
      reply?.({ ok: false, error: "这里已经有棋子了" });
      return;
    }

    room.board[row][col] = player.color;
    const move = {
      row,
      col,
      color: player.color,
      playerName: player.name,
      moveNumber: room.moves.length + 1,
      timestamp: Date.now()
    };
    room.moves.push(move);

    const winLine = findWinLine(room.board, row, col, player.color);
    if (winLine.length) {
      room.status = "finished";
      room.winner = player.color;
      room.winLine = winLine;
      sendNotice(room, `${player.name} 五子连珠`, "success");
    } else if (boardIsFull(room.board)) {
      room.status = "finished";
      room.winner = "draw";
      room.winLine = [];
      sendNotice(room, "棋盘已满，本局和棋", "info");
    } else {
      room.currentTurn = player.color === "black" ? "white" : "black";
    }

    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("request_undo", (payload, reply) => {
    const room = rooms.get(normalizeCode(payload?.roomCode));
    const clientId = socket.data.clientId;
    if (!room || !clientId) {
      reply?.({ ok: false, error: "还没有加入房间" });
      return;
    }

    const player = findPlayer(room, clientId);
    const opponent = otherPlayer(room, clientId);
    const lastMove = room.moves.at(-1);

    if (!player || !opponent) {
      reply?.({ ok: false, error: "需要双方在房间内" });
      return;
    }
    if (!opponent.connected) {
      reply?.({ ok: false, error: "对方离线，暂时无法悔棋" });
      return;
    }
    if (!lastMove) {
      reply?.({ ok: false, error: "还没有可以撤回的落子" });
      return;
    }
    if (lastMove.color !== player.color) {
      reply?.({ ok: false, error: "只能为自己的上一手申请悔棋" });
      return;
    }
    if (room.undoRequest) {
      reply?.({ ok: false, error: "已经有悔棋请求在等待处理" });
      return;
    }

    room.undoRequest = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      requesterClientId: player.clientId,
      requesterName: player.name,
      requesterColor: player.color,
      targetClientId: opponent.clientId,
      move: lastMove
    };

    reply?.({ ok: true });
    broadcast(room);
    sendNotice(room, `${player.name} 申请悔棋`, "info");
  });

  socket.on("respond_undo", (payload, reply) => {
    const room = rooms.get(normalizeCode(payload?.roomCode));
    const clientId = socket.data.clientId;

    if (!room || !clientId || !room.undoRequest) {
      reply?.({ ok: false, error: "没有待处理的悔棋请求" });
      return;
    }
    if (room.undoRequest.targetClientId !== clientId) {
      reply?.({ ok: false, error: "只有对方可以处理这个请求" });
      return;
    }

    const approved = Boolean(payload?.approved);
    const requesterName = room.undoRequest.requesterName;

    if (approved) {
      const lastMove = room.moves.pop();
      if (lastMove) {
        room.board[lastMove.row][lastMove.col] = null;
        room.currentTurn = lastMove.color;
        room.status = room.players.length === 2 ? "playing" : "waiting";
        room.winner = null;
        room.winLine = [];
      }
      room.undoRequest = null;
      reply?.({ ok: true });
      broadcast(room);
      sendNotice(room, `已同意 ${requesterName} 悔棋`, "success");
      return;
    }

    room.undoRequest = null;
    reply?.({ ok: true });
    broadcast(room);
    sendNotice(room, `已拒绝 ${requesterName} 悔棋`, "danger");
  });

  socket.on("reset_round", (payload, reply) => {
    const room = rooms.get(normalizeCode(payload?.roomCode));
    const clientId = socket.data.clientId;
    const player = room && findPlayer(room, clientId);
    if (!room || !player) {
      reply?.({ ok: false, error: "还没有加入房间" });
      return;
    }

    resetRoomBoard(room);
    reply?.({ ok: true });
    broadcast(room);
    sendNotice(room, `${player.name} 开始新一局`, "success");
  });

  socket.on("leave_room", (payload, reply) => {
    const room = rooms.get(normalizeCode(payload?.roomCode));
    const clientId = socket.data.clientId;
    const player = room && findPlayer(room, clientId);
    if (room && player) {
      room.players = room.players.filter((item) => item.clientId !== clientId);
      if (room.players.length === 0) {
        rooms.delete(room.code);
      } else {
        resetRoomBoard(room);
        ensureRoomStatus(room);
        broadcast(room);
        sendNotice(room, `${player.name} 离开房间`, "info");
      }
    }
    socket.leave(socket.data.roomCode);
    socket.data.roomCode = null;
    reply?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    const clientId = socket.data.clientId;
    const player = room && findPlayer(room, clientId);
    if (!room || !player) return;

    player.connected = false;
    ensureRoomStatus(room);
    broadcast(room);
    sendNotice(room, `${player.name} 暂时离线`, "info");
  });
});

app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) {
      res.status(404).send("Run npm run build before starting the production server.");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Gomoku server listening on http://localhost:${PORT}`);
});
