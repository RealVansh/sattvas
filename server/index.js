const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const ROOM_SIZE_LIMIT = 7;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

// Maps roomId -> Set of socket ids currently in the room.
const rooms = new Map();
// Maps roomId -> host socket id.
const roomHosts = new Map();
// Maps socket id -> roomId for disconnect cleanup.
const socketToRoom = new Map();

function getRoomUsers(roomId) {
  const users = rooms.get(roomId);
  return users ? Array.from(users) : [];
}

function addUserToRoom(roomId, socketId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  const users = rooms.get(roomId);
  users.add(socketId);
}

function removeUserFromRoom(roomId, socketId) {
  const users = rooms.get(roomId);
  if (!users) {
    return;
  }

  users.delete(socketId);

  if (users.size === 0) {
    rooms.delete(roomId);
  }
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId }) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('room-error', { message: 'Invalid room id.' });
      return;
    }

    const currentUsers = getRoomUsers(roomId);
    if (currentUsers.length >= ROOM_SIZE_LIMIT) {
      socket.emit('room-full', { roomId });
      return;
    }

    if (!roomHosts.has(roomId)) {
      roomHosts.set(roomId, socket.id);
    }

    addUserToRoom(roomId, socket.id);
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    const existingUsers = currentUsers.filter((userId) => userId !== socket.id);
    const hostId = roomHosts.get(roomId);
    socket.emit('existing-users', {
      roomId,
      users: existingUsers,
      hostId,
      selfId: socket.id
    });

    socket.to(roomId).emit('user-joined', {
      roomId,
      socketId: socket.id,
      hostId
    });
  });

  socket.on('admin-command', ({ target, type, value }) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId || !target || !type) {
      return;
    }

    const hostId = roomHosts.get(roomId);
    if (hostId !== socket.id) {
      return;
    }

    const users = getRoomUsers(roomId);
    if (!users.includes(target)) {
      return;
    }

    io.to(target).emit('admin-command', {
      from: socket.id,
      type,
      value
    });
  });

  socket.on('webrtc-offer', ({ target, sdp }) => {
    if (!target || !sdp) {
      return;
    }

    io.to(target).emit('webrtc-offer', {
      from: socket.id,
      sdp
    });
  });

  socket.on('webrtc-answer', ({ target, sdp }) => {
    if (!target || !sdp) {
      return;
    }

    io.to(target).emit('webrtc-answer', {
      from: socket.id,
      sdp
    });
  });

  socket.on('webrtc-ice-candidate', ({ target, candidate }) => {
    if (!target || !candidate) {
      return;
    }

    io.to(target).emit('webrtc-ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  const handleUserExit = () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      return;
    }

    const wasHost = roomHosts.get(roomId) === socket.id;

    removeUserFromRoom(roomId, socket.id);
    socketToRoom.delete(socket.id);
    socket.leave(roomId);

    const remainingUsers = getRoomUsers(roomId);
    if (remainingUsers.length === 0) {
      roomHosts.delete(roomId);
    } else if (wasHost) {
      const nextHostId = remainingUsers[0];
      roomHosts.set(roomId, nextHostId);
      io.to(roomId).emit('host-changed', {
        roomId,
        hostId: nextHostId
      });
    }

    socket.to(roomId).emit('user-left', {
      roomId,
      socketId: socket.id
    });
  };

  socket.on('leave-room', handleUserExit);

  socket.on('disconnect', () => {
    handleUserExit();
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`);
});