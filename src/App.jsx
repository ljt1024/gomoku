import {
  Check,
  Copy,
  DoorOpen,
  Link as LinkIcon,
  LogIn,
  Music,
  Plus,
  RefreshCcw,
  Undo2,
  VolumeX,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const BOARD_SIZE = 15;
const LETTERS = "ABCDEFGHIJKLMNO".split("");
const SOCKET_URL = import.meta.env.DEV
  ? import.meta.env.VITE_SOCKET_URL || "http://localhost:3001"
  : import.meta.env.VITE_SOCKET_URL || "http://118.31.167.0:5556";
const LICENSED_MUSIC_URL = "/audio/pipa-yu.mp3";

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function getClientId() {
  const key = "gomoku.clientId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const value =
    globalThis.crypto?.randomUUID?.() ||
    `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(key, value);
  return value;
}

function getInitialName() {
  const existing = localStorage.getItem("gomoku.playerName");
  if (existing) return existing;
  return `棋手${Math.floor(100 + Math.random() * 900)}`;
}

function getInitialRoomCode() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || "").toUpperCase();
}

function colorName(color) {
  if (color === "black") return "黑棋";
  if (color === "white") return "白棋";
  if (color === "draw") return "和棋";
  return "未定";
}

function formatPoint(move) {
  if (!move) return "";
  return `${LETTERS[move.col]}${move.row + 1}`;
}

function roomInviteUrl(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback for browsers that reject the API.
    }
  }

  return copyTextWithSelection(text);
}

function copyTextWithSelection(text) {
  const textarea = document.createElement("textarea");
  const selection = window.getSelection();
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;

  textarea.value = text;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.autocorrect = "off";
  textarea.spellcheck = false;
  textarea.style.position = "absolute";
  textarea.style.top = `${window.scrollY}px`;
  textarea.style.left = "-9999px";
  textarea.style.width = "320px";
  textarea.style.height = "80px";
  textarea.style.fontSize = "16px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  if (/ipad|iphone|ipod/i.test(navigator.userAgent)) {
    const range = document.createRange();
    range.selectNodeContents(textarea);
    selection?.removeAllRanges();
    selection?.addRange(range);
    textarea.setSelectionRange(0, text.length);
  }

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  if (selectedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(selectedRange);
  }

  return copied;
}

function useAmbientMusic(pushToast) {
  const [musicOn, setMusicOn] = useState(false);
  const engineRef = useRef(null);
  const activeEnginesRef = useRef(new Set());
  const cueContextRef = useRef(null);
  const startPromiseRef = useRef(null);
  const musicVersionRef = useRef(0);
  const userPausedMusicRef = useRef(false);

  const stop = useCallback(({ manual = false } = {}) => {
    if (manual) {
      userPausedMusicRef.current = true;
    }
    musicVersionRef.current += 1;
    startPromiseRef.current = null;
    for (const engine of activeEnginesRef.current) {
      try {
        engine.stop();
      } catch {
        // Ignore stale audio handles while ensuring every active engine is attempted.
      }
    }
    activeEnginesRef.current.clear();
    engineRef.current = null;
    setMusicOn(false);
  }, []);

  const start = useCallback(async ({ silent = false, automatic = false } = {}) => {
    if (automatic && userPausedMusicRef.current) {
      return false;
    }
    if (!automatic) {
      userPausedMusicRef.current = false;
    }
    if (engineRef.current) {
      setMusicOn(true);
      return true;
    }
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }

    const startVersion = musicVersionRef.current;
    const registerEngine = (engine) => {
      if (musicVersionRef.current !== startVersion || userPausedMusicRef.current) {
        engine.stop();
        return false;
      }
      activeEnginesRef.current.add(engine);
      engineRef.current = engine;
      setMusicOn(true);
      return true;
    };

    const startPromise = (async () => {
      const licensedTrack = await startLicensedTrack(pushToast, { silent });
      if (licensedTrack) {
        return registerEngine(licensedTrack);
      }

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        pushToast("当前浏览器不支持背景音乐", "danger");
        return;
      }

      const ctx = new AudioContext();
      const master = ctx.createGain();
      const delay = ctx.createDelay(1.8);
      const delayGain = ctx.createGain();
      const warmth = ctx.createBiquadFilter();

      master.gain.value = 0.42;
      delay.delayTime.value = 0.28;
      delayGain.gain.value = 0.22;
      warmth.type = "lowpass";
      warmth.frequency.value = 4300;
      warmth.Q.value = 0.6;

      delay.connect(delayGain);
      delayGain.connect(warmth);
      warmth.connect(master);
      master.connect(ctx.destination);

      const timers = [];
      const phrase = [
        [0, 293.66, 0.86],
        [0.48, 329.63, 0.72],
        [1.08, 392, 0.82],
        [1.72, 493.88, 0.68],
        [2.48, 440, 0.76],
        [3.18, 392, 0.7],
        [3.82, 329.63, 0.78],
        [4.62, 293.66, 0.72],
        [5.42, 246.94, 0.62],
        [6.18, 293.66, 0.8],
        [7.02, 370, 0.58],
        [7.54, 329.63, 0.68]
      ];

      function connectInstrument(node) {
        node.connect(master);
        node.connect(delay);
      }

      function playPluck(freq, when, velocity = 0.75) {
        const osc = ctx.createOscillator();
        const shimmer = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = "triangle";
        shimmer.type = "sine";
        osc.frequency.setValueAtTime(freq, when);
        shimmer.frequency.setValueAtTime(freq * 2.01, when);
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(freq * 2.8, when);
        filter.Q.value = 2.8;

        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.18 * velocity, when + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.018 * velocity, when + 0.34);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.65);

        osc.connect(filter);
        shimmer.connect(filter);
        filter.connect(gain);
        connectInstrument(gain);

        osc.start(when);
        shimmer.start(when + 0.004);
        osc.stop(when + 1.72);
        shimmer.stop(when + 1.2);
      }

      function playBass(freq, when) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, when);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.08, when + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 5.6);

        osc.connect(gain);
        gain.connect(master);
        osc.start(when);
        osc.stop(when + 5.8);
      }

      function schedule() {
        const base = ctx.currentTime + 0.05;
        playBass(146.83, base);
        playBass(196, base + 4.1);
        for (const [offset, freq, velocity] of phrase) {
          playPluck(freq, base + offset, velocity);
          if (offset === 1.72 || offset === 6.18) {
            playPluck(freq * 1.5, base + offset + 0.08, velocity * 0.44);
          }
        }
        timers.push(window.setTimeout(schedule, 8800));
      }

      await ctx.resume();
      schedule();
      if (!silent) {
        pushToast("未找到授权音频，已播放原创古筝风格循环", "info");
      }
      return registerEngine({
        stop() {
          for (const timer of timers) window.clearTimeout(timer);
          delay.disconnect();
          delayGain.disconnect();
          warmth.disconnect();
          master.disconnect();
          ctx.close();
        }
      });
    } catch {
      if (!silent) {
        pushToast("音乐启动失败，请再点一次", "danger");
      }
      return false;
    } finally {
      if (startPromiseRef.current === startPromise) {
        startPromiseRef.current = null;
      }
    }
    })();
    startPromiseRef.current = startPromise;
    return startPromise;
  }, [pushToast]);

  const playMoveCue = useCallback(async () => {
    if (!engineRef.current) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      const ctx = cueContextRef.current || new AudioContext();
      cueContextRef.current = ctx;
      await ctx.resume();

      const now = ctx.currentTime;
      const master = ctx.createGain();
      const wood = ctx.createOscillator();
      const string = ctx.createOscillator();
      const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.055), ctx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      const noise = ctx.createBufferSource();
      const noiseFilter = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();
      const stringGain = ctx.createGain();
      const woodGain = ctx.createGain();

      for (let i = 0; i < noiseData.length; i += 1) {
        noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
      }

      master.gain.setValueAtTime(0.42, now);
      master.connect(ctx.destination);

      noise.buffer = noiseBuffer;
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.setValueAtTime(1050, now);
      noiseFilter.Q.value = 3.2;
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

      wood.type = "triangle";
      wood.frequency.setValueAtTime(184, now);
      wood.frequency.exponentialRampToValueAtTime(124, now + 0.08);
      woodGain.gain.setValueAtTime(0.0001, now);
      woodGain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
      woodGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      string.type = "sine";
      string.frequency.setValueAtTime(587.33, now + 0.018);
      stringGain.gain.setValueAtTime(0.0001, now);
      stringGain.gain.exponentialRampToValueAtTime(0.12, now + 0.032);
      stringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);
      wood.connect(woodGain);
      woodGain.connect(master);
      string.connect(stringGain);
      stringGain.connect(master);

      noise.start(now);
      wood.start(now);
      string.start(now + 0.018);
      noise.stop(now + 0.075);
      wood.stop(now + 0.18);
      string.stop(now + 0.42);

      window.setTimeout(() => {
        master.disconnect();
      }, 520);
    } catch {
      // Sound effects are non-critical; keep gameplay responsive.
    }
  }, [pushToast]);

  useEffect(
    () => () => {
      stop();
      cueContextRef.current?.close();
      cueContextRef.current = null;
    },
    [stop]
  );

  return {
    musicOn,
    playMoveCue,
    startMusic: start,
    toggleMusic: musicOn ? () => stop({ manual: true }) : () => start()
  };
}

async function startLicensedTrack(pushToast, { silent = false } = {}) {
  try {
    const audio = new Audio(LICENSED_MUSIC_URL);
    audio.loop = true;
    audio.volume = 0.82;
    audio.preload = "auto";
    await audio.play();
    if (!silent) {
      pushToast("正在播放授权音频《琵琶语》", "success");
    }

    return {
      stop() {
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
        audio.load();
      }
    };
  } catch {
    return null;
  }
}

function App() {
  const [clientId] = useState(getClientId);
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [playerName, setPlayerName] = useState(getInitialName);
  const [joinCode, setJoinCode] = useState(getInitialRoomCode);
  const [toasts, setToasts] = useState([]);
  const [busyAction, setBusyAction] = useState("");
  const [manualInviteUrl, setManualInviteUrl] = useState("");
  const inviteInputRef = useRef(null);
  const initialInviteCodeRef = useRef(joinCode.trim().toUpperCase());
  const autoJoinTriedRef = useRef(false);

  const pushToast = useCallback((message, tone = "info") => {
    const toast = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message,
      tone
    };
    setToasts((items) => [...items.slice(-3), toast]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== toast.id));
    }, 3400);
  }, []);

  const { musicOn, playMoveCue, startMusic, toggleMusic } = useAmbientMusic(pushToast);
  const moveCueRef = useRef({ roomCode: "", moveKey: "" });

  useEffect(() => {
    if (!manualInviteUrl) return;
    window.setTimeout(() => {
      inviteInputRef.current?.focus();
      inviteInputRef.current?.select();
    }, 30);
  }, [manualInviteUrl]);

  useEffect(() => {
    const nextSocket = io(SOCKET_URL, {
      transports: ["websocket", "polling"]
    });

    nextSocket.on("connect", () => setConnected(true));
    nextSocket.on("disconnect", () => setConnected(false));
    nextSocket.on("room_state", (state) => setRoom(state));
    nextSocket.on("notice", (notice) => pushToast(notice.message, notice.tone));

    setSocket(nextSocket);
    return () => {
      nextSocket.disconnect();
    };
  }, [pushToast]);

  useEffect(() => {
    const roomCode = room?.code || "";
    const lastMove = room?.lastMove;
    const moveKey = lastMove
      ? `${lastMove.moveNumber}-${lastMove.row}-${lastMove.col}-${lastMove.color}`
      : "";
    const previous = moveCueRef.current;

    if (previous.roomCode !== roomCode) {
      moveCueRef.current = { roomCode, moveKey };
      return;
    }

    if (moveKey && previous.moveKey !== moveKey) {
      playMoveCue();
    }

    moveCueRef.current = { roomCode, moveKey };
  }, [
    playMoveCue,
    room?.code,
    room?.lastMove?.col,
    room?.lastMove?.color,
    room?.lastMove?.moveNumber,
    room?.lastMove?.row
  ]);

  useEffect(() => {
    if (room?.code && !musicOn) {
      startMusic({ silent: true, automatic: true });
    }
  }, [musicOn, room?.code, startMusic]);

  const me = useMemo(
    () => room?.players.find((player) => player.clientId === clientId) || null,
    [clientId, room]
  );

  const bothOnline = useMemo(
    () => room?.players.length === 2 && room.players.every((player) => player.connected),
    [room]
  );

  const canPlay =
    Boolean(room && me) &&
    room.status === "playing" &&
    bothOnline &&
    !room.undoRequest &&
    room.currentTurn === me.color;

  const emitWithAck = useCallback(
    (event, payload, actionName, onSuccess) => {
      if (!socket || !connected) {
        pushToast("服务器还没连接上", "danger");
        return;
      }
      setBusyAction(actionName);
      socket.emit(event, payload, (response) => {
        setBusyAction("");
        if (!response?.ok) {
          pushToast(response?.error || "操作失败", "danger");
          return;
        }
        if (response.state) setRoom(response.state);
        onSuccess?.(response);
      });
    },
    [connected, pushToast, socket]
  );

  const updateName = (value) => {
    setPlayerName(value);
    localStorage.setItem("gomoku.playerName", value);
  };

  const joinRoomByCode = useCallback(
    (code, { automatic = false } = {}) => {
      const normalizedCode = code.trim().toUpperCase();
      if (!normalizedCode) {
        pushToast("请输入房间号", "danger");
        return;
      }

      startMusic({ silent: true, automatic });
      emitWithAck(
        "join_room",
        { code: normalizedCode, clientId, name: playerName },
        automatic ? "autoJoin" : "join",
        ({ state }) => {
          window.history.replaceState(null, "", `?room=${state.code}`);
          setJoinCode(state.code);
          pushToast(automatic ? "已通过邀请链接进入房间" : "已进入房间", "success");
        }
      );
    },
    [clientId, emitWithAck, playerName, pushToast, startMusic]
  );

  useEffect(() => {
    const inviteCode = initialInviteCodeRef.current;
    if (!inviteCode || autoJoinTriedRef.current || room || !connected || !socket) return;

    autoJoinTriedRef.current = true;
    setJoinCode(inviteCode);
    joinRoomByCode(inviteCode, { automatic: true });
  }, [connected, joinRoomByCode, room, socket]);

  const createRoom = useCallback(() => {
    startMusic({ silent: true });
    emitWithAck(
      "create_room",
      { clientId, name: playerName },
      "create",
      ({ state }) => {
        window.history.replaceState(null, "", `?room=${state.code}`);
        setJoinCode(state.code);
        pushToast("房间已创建", "success");
      }
    );
  }, [clientId, emitWithAck, playerName, pushToast, startMusic]);

  const joinRoom = useCallback(
    (event) => {
      event?.preventDefault();
      joinRoomByCode(joinCode);
    },
    [joinCode, joinRoomByCode]
  );

  const makeMove = useCallback(
    (row, col) => {
      if (!room || !canPlay) return;
      emitWithAck("make_move", { roomCode: room.code, row, col }, "move");
    },
    [canPlay, emitWithAck, room]
  );

  const requestUndo = useCallback(() => {
    if (!room) return;
    emitWithAck("request_undo", { roomCode: room.code }, "undo");
  }, [emitWithAck, room]);

  const respondUndo = useCallback(
    (approved) => {
      if (!room) return;
      emitWithAck("respond_undo", { roomCode: room.code, approved }, approved ? "approve" : "decline");
    },
    [emitWithAck, room]
  );

  const resetRound = useCallback(() => {
    if (!room) return;
    emitWithAck("reset_round", { roomCode: room.code }, "reset");
  }, [emitWithAck, room]);

  const leaveRoom = useCallback(() => {
    if (room) {
      emitWithAck("leave_room", { roomCode: room.code }, "leave", () => {
        setRoom(null);
        window.history.replaceState(null, "", window.location.pathname);
      });
    }
  }, [emitWithAck, room]);

  const copyInvite = useCallback(async () => {
    if (!room) return;
    const inviteUrl = roomInviteUrl(room.code);
    const copied = await copyTextToClipboard(inviteUrl);
    if (copied) {
      setManualInviteUrl("");
      pushToast("邀请链接已复制", "success");
      return;
    }

    setManualInviteUrl(inviteUrl);
    pushToast("浏览器限制自动复制，请在面板中复制", "info");
  }, [pushToast, room]);

  const retryCopyInvite = useCallback(async () => {
    if (!manualInviteUrl) return;
    const copied = await copyTextToClipboard(manualInviteUrl);
    if (copied) {
      setManualInviteUrl("");
      pushToast("邀请链接已复制", "success");
      return;
    }

    inviteInputRef.current?.focus();
    inviteInputRef.current?.select();
    pushToast("请长按或使用系统菜单复制", "danger");
  }, [manualInviteUrl, pushToast]);

  return (
    <div className="app-shell">
      <div className="room-texture" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p className="eyebrow">Gomoku Room</p>
            <h1>玄纹棋室</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <div className={`connection-pill ${connected ? "is-online" : "is-offline"}`}>
            {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{connected ? "在线" : "离线"}</span>
          </div>
          <button className="icon-button" type="button" onClick={toggleMusic} title="背景音乐">
            {musicOn ? <Music size={18} /> : <VolumeX size={18} />}
            <span>{musicOn ? "音乐开" : "音乐关"}</span>
          </button>
        </div>
      </header>

      <main className={`game-layout ${room ? "is-room" : "is-lobby"}`}>
        <section className="table-zone" aria-label="五子棋棋盘">
          <Board room={room} canPlay={canPlay} onMove={makeMove} me={me} />
        </section>

        <aside className="side-panel" aria-label="房间控制">
          {room ? (
            <RoomPanel
              busyAction={busyAction}
              canPlay={canPlay}
              clientId={clientId}
              copyInvite={copyInvite}
              leaveRoom={leaveRoom}
              me={me}
              requestUndo={requestUndo}
              resetRound={resetRound}
              respondUndo={respondUndo}
              room={room}
              bothOnline={bothOnline}
            />
          ) : (
            <LobbyPanel
              busyAction={busyAction}
              connected={connected}
              createRoom={createRoom}
              joinCode={joinCode}
              joinRoom={joinRoom}
              playerName={playerName}
              setJoinCode={setJoinCode}
              updateName={updateName}
            />
          )}
        </aside>
      </main>

      {manualInviteUrl ? (
        <InviteCopySheet
          inputRef={inviteInputRef}
          onClose={() => setManualInviteUrl("")}
          onRetryCopy={retryCopyInvite}
          url={manualInviteUrl}
        />
      ) : null}
      <ToastStack toasts={toasts} />
    </div>
  );
}

function Board({ room, canPlay, onMove, me }) {
  const board = room?.board || createEmptyBoard();
  const lastMove = room?.lastMove;
  const winSet = useMemo(() => {
    return new Set((room?.winLine || []).map((point) => `${point.row}-${point.col}`));
  }, [room]);

  const boardStatus = getBoardStatus(room, me, canPlay);
  const points = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const stone = board[row][col];
      const key = `${row}-${col}`;
      const isLast = lastMove?.row === row && lastMove?.col === col;
      const isWin = winSet.has(key);
      points.push(
        <button
          aria-label={`${LETTERS[col]}${row + 1}${stone ? ` ${colorName(stone)}` : ""}`}
          className={`board-point ${canPlay && !stone ? "is-open" : ""}`}
          disabled={!canPlay || Boolean(stone)}
          key={key}
          onClick={() => onMove(row, col)}
          style={{
            left: `${(col / (BOARD_SIZE - 1)) * 100}%`,
            top: `${(row / (BOARD_SIZE - 1)) * 100}%`
          }}
          type="button"
        >
          {stone ? <Stone color={stone} isLast={isLast} isWin={isWin} /> : <span className="ghost-dot" />}
        </button>
      );
    }
  }

  return (
    <div className="board-shell">
      <div className="board-header">
        <div>
          <p className="eyebrow">Board 15 x 15</p>
          <h2>{boardStatus.title}</h2>
        </div>
        <div className={`turn-token ${room?.currentTurn === "white" ? "is-white" : "is-black"}`}>
          <span />
          {boardStatus.meta}
        </div>
      </div>

      <div className="board-frame">
        <div className="file-labels top-labels">
          {LETTERS.map((letter) => (
            <span key={letter}>{letter}</span>
          ))}
        </div>
        <div className="rank-labels left-labels">
          {Array.from({ length: BOARD_SIZE }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <div className="board-face">
          <div className="grid-plane">
            <div className="grid-lines" />
            <StarPoints />
            <div className="point-layer">{points}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stone({ color, isLast, isWin }) {
  return (
    <span className={`stone stone-${color} ${isLast ? "is-last" : ""} ${isWin ? "is-win" : ""}`}>
      <span className="stone-glint" />
      <span className="stone-core" />
    </span>
  );
}

function StarPoints() {
  const starIndexes = [3, 7, 11];
  return (
    <div className="star-layer" aria-hidden="true">
      {starIndexes.flatMap((row) =>
        starIndexes.map((col) => (
          <span
            className="star-point"
            key={`${row}-${col}`}
            style={{
              left: `${(col / (BOARD_SIZE - 1)) * 100}%`,
              top: `${(row / (BOARD_SIZE - 1)) * 100}%`
            }}
          />
        ))
      )}
    </div>
  );
}

function getBoardStatus(room, me, canPlay) {
  if (!room) {
    return { title: "准备开局", meta: "未入座" };
  }
  if (room.winner === "draw") {
    return { title: "本局和棋", meta: "棋盘已满" };
  }
  if (room.winner) {
    return { title: `${colorName(room.winner)}胜`, meta: "五子连珠" };
  }
  if (room.players.length < 2) {
    return { title: "等待对手", meta: "分享房间" };
  }
  if (!room.players.every((player) => player.connected)) {
    return { title: "等待重连", meta: "对方离线" };
  }
  if (room.undoRequest) {
    return { title: "处理悔棋", meta: "暂停落子" };
  }
  if (!me) {
    return { title: `轮到${colorName(room.currentTurn)}`, meta: "观战" };
  }
  if (canPlay) {
    return { title: "轮到你", meta: colorName(me.color) };
  }
  return { title: `轮到${colorName(room.currentTurn)}`, meta: "等待" };
}

function LobbyPanel({
  busyAction,
  connected,
  createRoom,
  joinCode,
  joinRoom,
  playerName,
  setJoinCode,
  updateName
}) {
  return (
    <div className="panel-stack">
      <section className="control-section">
        <p className="eyebrow">Seat</p>
        <h2>入座</h2>
        <label className="field">
          <span>昵称</span>
          <input
            maxLength={16}
            onChange={(event) => updateName(event.target.value)}
            placeholder="你的昵称"
            value={playerName}
          />
        </label>
      </section>

      <section className="control-section">
        <p className="eyebrow">Create</p>
        <h2>新房间</h2>
        <button
          className="primary-button"
          disabled={!connected || busyAction === "create"}
          onClick={createRoom}
          type="button"
        >
          <Plus size={18} />
          创建房间
        </button>
      </section>

      <form className="control-section" onSubmit={joinRoom}>
        <p className="eyebrow">Join</p>
        <h2>加入房间</h2>
        <label className="field">
          <span>房间号</span>
          <input
            autoCapitalize="characters"
            inputMode="text"
            maxLength={6}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="例如 8KQ27A"
            value={joinCode}
          />
        </label>
        <button className="secondary-button" disabled={!connected || busyAction === "join"} type="submit">
          <LogIn size={18} />
          加入
        </button>
      </form>
    </div>
  );
}

function RoomPanel({
  busyAction,
  canPlay,
  clientId,
  copyInvite,
  leaveRoom,
  me,
  requestUndo,
  resetRound,
  respondUndo,
  room,
  bothOnline
}) {
  const lastMove = room.lastMove;
  const canRequestUndo =
    Boolean(me && lastMove) && lastMove.color === me.color && !room.undoRequest && room.moves.length > 0;
  const pendingForMe = room.undoRequest?.targetClientId === clientId;
  const requestedByMe = room.undoRequest?.requesterClientId === clientId;

  return (
    <div className="panel-stack">
      <section className="room-section">
        <div className="room-code-row">
          <div>
            <p className="eyebrow">Room</p>
            <h2>{room.code}</h2>
          </div>
          <button className="icon-only-button" onClick={copyInvite} title="复制邀请链接" type="button">
            <Copy size={18} />
          </button>
        </div>
        <button className="secondary-button compact" onClick={copyInvite} type="button">
          <LinkIcon size={17} />
          复制邀请链接
        </button>
      </section>

      <section className="player-section">
        <p className="eyebrow">Players</p>
        <div className="player-list">
          <PlayerSeat color="black" me={me} players={room.players} />
          <PlayerSeat color="white" me={me} players={room.players} />
        </div>
      </section>

      <section className="status-section">
        <p className="eyebrow">State</p>
        <h2>{getPanelTitle(room, me, canPlay, bothOnline)}</h2>
        {lastMove ? (
          <p className="last-move">
            第 {lastMove.moveNumber} 手 · {colorName(lastMove.color)} · {formatPoint(lastMove)}
          </p>
        ) : (
          <p className="last-move">黑棋先行</p>
        )}

        {room.undoRequest ? (
          <div className="undo-request">
            <div>
              <strong>{room.undoRequest.requesterName}</strong>
              <span>申请撤回 {formatPoint(room.undoRequest.move)}</span>
            </div>
            {pendingForMe ? (
              <div className="split-actions">
                <button
                  className="secondary-button approve"
                  disabled={busyAction === "approve"}
                  onClick={() => respondUndo(true)}
                  type="button"
                >
                  <Check size={17} />
                  同意
                </button>
                <button
                  className="ghost-button danger"
                  disabled={busyAction === "decline"}
                  onClick={() => respondUndo(false)}
                  type="button"
                >
                  <X size={17} />
                  拒绝
                </button>
              </div>
            ) : (
              <p>{requestedByMe ? "等待对方处理" : "等待回应"}</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="action-section">
        <button
          className="primary-button"
          disabled={!canRequestUndo || busyAction === "undo"}
          onClick={requestUndo}
          type="button"
        >
          <Undo2 size={18} />
          申请悔棋
        </button>
        <button className="secondary-button" disabled={busyAction === "reset"} onClick={resetRound} type="button">
          <RefreshCcw size={18} />
          新一局
        </button>
        <button className="ghost-button" disabled={busyAction === "leave"} onClick={leaveRoom} type="button">
          <DoorOpen size={18} />
          离开
        </button>
      </section>

      <section className="moves-section">
        <p className="eyebrow">Record</p>
        <div className="move-list">
          {room.moves.length ? (
            room.moves
              .slice(-10)
              .reverse()
              .map((move) => (
                <div className="move-row" key={move.moveNumber}>
                  <span>{move.moveNumber}</span>
                  <i className={`mini-stone mini-${move.color}`} />
                  <strong>{formatPoint(move)}</strong>
                  <small>{move.playerName}</small>
                </div>
              ))
          ) : (
            <div className="empty-record">暂无落子</div>
          )}
        </div>
      </section>
    </div>
  );
}

function PlayerSeat({ color, me, players }) {
  const player = players.find((item) => item.color === color);
  return (
    <div className={`player-seat ${color === "white" ? "is-white" : "is-black"}`}>
      <i className={`mini-stone mini-${color}`} />
      <div>
        <strong>{player?.name || "等待入座"}</strong>
        <span>
          {colorName(color)}
          {player?.clientId === me?.clientId ? " · 你" : ""}
        </span>
      </div>
      <em className={player?.connected ? "online" : "offline"}>{player?.connected ? "在线" : "离线"}</em>
    </div>
  );
}

function InviteCopySheet({ inputRef, onClose, onRetryCopy, url }) {
  return (
    <div className="copy-sheet-backdrop" role="presentation">
      <section className="copy-sheet" aria-label="复制邀请链接">
        <div>
          <p className="eyebrow">Invite Link</p>
          <h2>复制邀请链接</h2>
        </div>
        <p className="copy-sheet-note">当前浏览器限制自动复制。链接已为你选中，可以点击复制，或长按输入框使用系统菜单复制。</p>
        <input
          aria-label="邀请链接"
          className="copy-sheet-input"
          onFocus={(event) => event.target.select()}
          readOnly
          ref={inputRef}
          value={url}
        />
        <div className="copy-sheet-actions">
          <button className="primary-button" onClick={onRetryCopy} type="button">
            <Copy size={18} />
            再试一次
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            <X size={18} />
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}

function getPanelTitle(room, me, canPlay, bothOnline) {
  if (room.winner === "draw") return "和棋";
  if (room.winner) return `${colorName(room.winner)}获胜`;
  if (room.players.length < 2) return "等待第二位玩家";
  if (!bothOnline) return "等待玩家重连";
  if (room.undoRequest) return "悔棋审批中";
  if (!me) return `${colorName(room.currentTurn)}回合`;
  return canPlay ? "轮到你落子" : `等待${colorName(room.currentTurn)}`;
}

function ToastStack({ toasts }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.tone}`} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export default App;
